"use server";

/**
 * localAi.ts — Capa de acceso a IA y base vectorial
 *
 * Este archivo centraliza toda la lógica de backend relacionada con:
 *   1. Procesamiento de PDFs (extracción de texto y fragmentación)
 *   2. Generación de embeddings (vectores semánticos) via Google Gemini
 *   3. Almacenamiento y búsqueda en ChromaDB (base de datos vectorial)
 *   4. Análisis automático de borradores usando RAG (Retrieval-Augmented Generation)
 *   5. Chat conversacional con contexto del borrador y del corpus
 *
 * Flujo general del sistema RAG:
 *   PDF → Texto → Chunks → Embeddings → ChromaDB
 *                                           ↓
 *   Pregunta → Embedding → Búsqueda semántica → Contexto → Gemini → Respuesta
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { ChromaClient } from "chromadb";
import { v4 as uuidv4 } from "uuid";
import pdfParse from "pdf-parse";

// RecursiveCharacterTextSplitter divide texto largo en trozos más pequeños
// respetando límites naturales (párrafos, oraciones, palabras) de forma recursiva.
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

// ─── Inicialización de clientes ───────────────────────────────────────────────

// La API key de Google se lee desde variables de entorno (no se hardcodea por seguridad)
const apiKey = process.env.GOOGLE_API_KEY!;

// Cliente principal de Google Generative AI
const genAI = new GoogleGenerativeAI(apiKey);

// Cliente de ChromaDB: base de datos vectorial que corre localmente en el puerto 8000.
// Almacena los embeddings del corpus (propuestas aprobadas) para búsqueda semántica.
const chromaClient = new ChromaClient({ path: "http://localhost:8000" });

// Modelo especializado en convertir texto a vectores numéricos (embeddings).
// "gemini-embedding-001" transforma frases/párrafos en vectores de alta dimensión
// que capturan el significado semántico del texto.
const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });

// ─── Store en memoria para borradores ─────────────────────────────────────────
//
// Los borradores (propuestas no aprobadas aún) se guardan solo en memoria RAM,
// NO en ChromaDB. Esto los mantiene separados del corpus de referencia y evita
// que "contaminen" la base de buenas prácticas.
// La desventaja: se pierden si el servidor se reinicia.

interface DraftChunk {
  text: string;       // Fragmento de texto del borrador
  embedding: number[]; // Vector semántico correspondiente a ese fragmento
}
interface DraftEntry {
  displayName: string; // Nombre original del archivo PDF
  chunks: DraftChunk[]; // Lista de fragmentos con sus embeddings
}

// Map<draftId, DraftEntry>: clave = UUID generado al subir, valor = datos del borrador
const draftStore = new Map<string, DraftEntry>();

// ─── Utilidades internas ──────────────────────────────────────────────────────

/**
 * Convierte un array de textos en sus representaciones vectoriales (embeddings).
 * Se procesan en paralelo con Promise.all para mayor velocidad.
 *
 * @param texts - Array de strings a vectorizar
 * @returns Array de vectores numéricos, uno por cada texto de entrada
 */
async function embedTexts(texts: string[]): Promise<number[][]> {
  const results = await Promise.all(
    texts.map(t => embeddingModel.embedContent(t).then(r => r.embedding.values))
  );
  return results;
}

/**
 * Calcula la similitud coseno entre dos vectores.
 * Retorna un valor entre -1 y 1, donde 1 = idénticos, 0 = sin relación.
 * Es la métrica estándar para comparar embeddings de texto.
 *
 * Fórmula: (A · B) / (|A| * |B|)
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Busca los fragmentos más relevantes de un borrador (en memoria) dado un query.
 * Implementa la misma lógica de búsqueda semántica que ChromaDB, pero en memoria.
 *
 * @param draftId        - ID del borrador en draftStore
 * @param queryEmbedding - Vector de la pregunta/query del usuario
 * @param topK           - Cuántos fragmentos devolver (los más similares)
 * @returns Array de strings con los fragmentos más relevantes
 */
function searchDraftChunks(draftId: string, queryEmbedding: number[], topK: number): string[] {
  const entry = draftStore.get(draftId);
  if (!entry) return [];
  return entry.chunks
    .map(c => ({ text: c.text, score: cosineSimilarity(queryEmbedding, c.embedding) }))
    .sort((a, b) => b.score - a.score) // Mayor similitud primero
    .slice(0, topK)
    .map(c => c.text);
}

// ─── Acciones exportadas (Server Actions de Next.js) ─────────────────────────

/**
 * Verifica que tanto Gemini como ChromaDB estén accesibles.
 * Útil para mostrar el estado de conexión en el frontend.
 */
export async function checkGeminiConnection() {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
    await model.generateContent("ping");
    // También verificamos si ChromaDB está disponible en el puerto local
    await chromaClient.heartbeat();
    return { success: true };
  } catch (error: any) {
    console.error("Error connecting to Gemini or Chroma:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Procesa un PDF del corpus (propuestas aprobadas) y lo guarda en ChromaDB.
 *
 * Pasos:
 *   1. Extrae el texto del PDF con pdf-parse
 *   2. Fragmenta el texto en chunks de ~1000 chars con solapamiento de 200
 *      (el solapamiento evita perder contexto en los bordes de cada chunk)
 *   3. Genera embeddings para cada chunk via Gemini
 *   4. Almacena todo en la colección "rag_corpus" de ChromaDB
 *
 * Todos los chunks de un mismo archivo comparten el mismo `fileId` en sus
 * metadatos, lo que permite filtrar por archivo en búsquedas posteriores.
 */
export async function addDocumentToVectorStore(formData: FormData) {
  try {
    const file = formData.get("file") as File;
    if (!file) throw new Error("No file provided");

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 1. Extraer texto del PDF
    const pdfData = await pdfParse(buffer);
    const text = pdfData.text;

    // 2. Fragmentar texto (Chunking) con LangChain
    //    chunkSize: máximo de caracteres por fragmento
    //    chunkOverlap: caracteres compartidos entre chunks consecutivos (preserva contexto)
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });
    const chunks = await splitter.createDocuments([text]);

    // 3. Generar Embeddings usando el modelo de Google
    const texts = chunks.map(c => c.pageContent);
    const vectors = await embedTexts(texts);

    // 4. Guardar en ChromaDB (Colección única)
    //    Un fileId único identifica todos los chunks de este archivo
    const fileId = uuidv4();
    const collection = await chromaClient.getOrCreateCollection({
      name: "rag_corpus"
    });

    // Cada chunk recibe un ID único: "{fileId}_chunk_{índice}"
    const ids = chunks.map((_, i) => `${fileId}_chunk_${i}`);
    // Los metadatos permiten filtrar por archivo en búsquedas futuras
    const metadatas = chunks.map(() => ({ fileId, displayName: file.name }));

    await collection.add({
      ids,
      embeddings: vectors,
      metadatas,
      documents: texts,
    });

    // Retornamos fileId como "uri" para compatibilidad con el frontend
    return {
      success: true,
      fileId: fileId,
      displayName: file.name,
      uri: fileId,
    };
  } catch (error: any) {
    console.error("Error uploading to Chroma:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Procesa un PDF borrador y lo guarda en memoria (NO en ChromaDB).
 *
 * Funciona igual que addDocumentToVectorStore pero almacena en draftStore (RAM).
 * Esto mantiene los borradores separados del corpus de referencia.
 *
 * Retorna un draftId que el frontend usa como identificador temporal.
 */
export async function uploadDraft(formData: FormData) {
  try {
    const file = formData.get("file") as File;
    if (!file) throw new Error("No file provided");

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const pdfData = await pdfParse(buffer);
    const text = pdfData.text;

    const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 200 });
    const docs = await splitter.createDocuments([text]);
    const texts = docs.map(d => d.pageContent);
    const vectors = await embedTexts(texts);

    // Guardar en memoria con un UUID como clave
    const draftId = uuidv4();
    draftStore.set(draftId, {
      displayName: file.name,
      chunks: texts.map((t, i) => ({ text: t, embedding: vectors[i] })),
    });

    return { success: true, draftId, displayName: file.name, uri: draftId };
  } catch (error: any) {
    console.error("Error processing draft:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Lista todos los archivos del corpus almacenados en ChromaDB.
 *
 * ChromaDB almacena chunks individuales, no archivos completos. Por eso
 * necesitamos reconstruir la lista de archivos agrupando por fileId en metadatos.
 *
 * El frontend usa esta lista para que el usuario seleccione qué documentos
 * del corpus usar como referencia al analizar un borrador.
 */
export async function listVectorStoreDocuments() {
  try {
    const collection = await chromaClient.getOrCreateCollection({ name: "rag_corpus" });
    const results = await collection.get({
        include: ["metadatas" as any]
    });

    // Agrupar por fileId para regenerar la lista de archivos
    // (un archivo = muchos chunks → deduplicamos con un Map)
    const filesMap = new Map();
    if (results.metadatas) {
        results.metadatas.forEach((meta: any) => {
            if (meta && meta.fileId) {
                filesMap.set(meta.fileId, meta.displayName);
            }
        });
    }

    const files = Array.from(filesMap.entries()).map(([fileId, displayName]) => ({
      uri: fileId,
      displayName: displayName,
      name: fileId
    }));

    return { success: true, files };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Elimina toda la colección "rag_corpus" de ChromaDB.
 * Esto borra TODOS los documentos del corpus de una vez.
 *
 * Nota: los borradores en memoria (draftStore) no se ven afectados.
 */
export async function clearVectorStore() {
  try {
    await chromaClient.deleteCollection({ name: "rag_corpus" });
    return { success: true, count: 1 };
  } catch (error: any) {
    // Si no existe la colección no hay error que reportar
    return { success: true, count: 0 };
  }
}

/**
 * Analiza un borrador comparándolo contra el corpus usando RAG + Gemini.
 *
 * Flujo:
 *   1. Recupera el borrador completo desde draftStore (memoria)
 *   2. Genera un embedding del inicio del borrador para buscar contexto relevante
 *   3. Consulta ChromaDB para obtener los 15 chunks más similares del corpus
 *   4. Construye un prompt con el borrador + contexto del corpus
 *   5. Gemini evalúa 4 pilares y devuelve un JSON estructurado con puntuación
 *
 * @param draftFileUri    - ID del borrador en draftStore
 * @param corpusFileUris  - IDs de los archivos del corpus a usar como referencia
 * @param draftName       - Nombre del archivo borrador (para el prompt)
 */
export async function analyzeDraft(draftFileUri: string, corpusFileUris: string[], draftName: string) {
  try {
    const collection = await chromaClient.getCollection({ name: "rag_corpus" });

    // Obtener el borrador desde memoria y reconstruir el texto completo
    const draftEntry = draftStore.get(draftFileUri);
    if (!draftEntry) throw new Error("Borrador no encontrado en memoria. Vuelve a subirlo.");
    const draftText = draftEntry.chunks.map(c => c.text).join("\n");

    // Usar los primeros 1000 chars del borrador como query de búsqueda semántica
    // para encontrar los fragmentos del corpus más relevantes al tema del borrador
    const draftQuery = draftText.substring(0, 1000);
    const queryEmbeddings = await embedTexts([draftQuery]);

    // Construir el filtro WHERE para ChromaDB:
    // - Si hay múltiples archivos de corpus → usar operador $in (array)
    // - Si hay solo uno → filtro directo por fileId
    // - Si no hay corpus → no aplicar filtro (undefined)
    const corpusWhere = corpusFileUris.length > 1
      ? { fileId: { "$in": corpusFileUris } }
      : (corpusFileUris.length === 1 ? { fileId: corpusFileUris[0] } : undefined);

    let corpusContext = "";

    if (corpusWhere) {
      // Recuperar los 15 chunks más relevantes del corpus (paso RAG)
      const searchResults = await collection.query({
        queryEmbeddings: queryEmbeddings,
        nResults: 15,
        where: corpusWhere as any,
        include: ["documents" as any]
      });
      const relevantCorpusChunks = searchResults.documents?.[0] || [];
      corpusContext = relevantCorpusChunks.join("\n\n");
    }

    // Prompt de evaluación estructurado con 4 pilares de calificación.
    // Se le pide a Gemini responder ÚNICAMENTE con JSON válido (sin markdown)
    // para facilitar el parsing en el frontend.
    const prompt = `
Eres un evaluador de la organización Platohedro.
Estás validando una nueva propuesta (borrador: ${draftName}).
A continuación, te proporciono fragmentos de documentos aprobados previamente ("corpus") y el texto del Borrador:

--INICIO CORPUS DE ÉXITO PARA CONTEXTO--
${corpusContext}
--FIN CORPUS DE ÉXITO--

--INICIO BORRADOR A EVALUAR--
${draftText}
--FIN BORRADOR--

Tu tarea es evaluar este documento comparándolo contra las buenas prácticas del corpus.
Debes calificar la propuesta en base a 4 pilares:
1. Desglose de Rubros: No se aceptan presupuestos con "Total: $X". Debe detallar Honorarios, Materiales, Difusión e Impuestos.
2. Impacto Territorial: Debe mencionar barrios, colectivos o dinámicas específicas de Medellín que se alineen con la filosofía.
3. Cronograma de Ejecución: Debe ser una tabla clara o detallado mes a mes.
4. Calidad Técnica: Legibilidad, profesionalismo, datos legales.

Analiza el borrador provisto e infiere en base a esto. Suma un puntaje del 0 al 100.
Escala de Calificación:
- Aprobado (80-100): Listo para presentar.
- Ajustar (50-79): Faltan detalles técnicos o claridad.
- Rechazado (<50): No cumple la esencia o faltan documentos.

Instrucciones de formato:
Tu respuesta DEBE ser estrictamente un JSON válido con la siguiente estructura y sin markdown de código (raw JSON):
{
  "resultado": "Aprobado" | "Ajustar" | "Rechazado",
  "puntuacion": numero,
  "pilares": {
    "desgloseRubros": { "calificacion": "Bien" | "Regular" | "Mal", "comentario": "" },
    "impactoTerritorial": { "calificacion": "Bien" | "Regular" | "Mal", "comentario": "" },
    "cronograma": { "calificacion": "Bien" | "Regular" | "Mal", "comentario": "" },
    "calidadTecnica": { "calificacion": "Bien" | "Regular" | "Mal", "comentario": "" }
  },
  "feedbackGeneral": "..."
}
`;

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
    // responseMimeType: "application/json" le indica a Gemini que responda solo JSON
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" },
    });

    return { success: true, data: JSON.parse(result.response.text()) };

  } catch (error: any) {
    console.error("Error analyzing draft:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Responde preguntas del usuario sobre el borrador usando RAG conversacional.
 *
 * A diferencia de analyzeDraft (análisis automático), esta función es interactiva:
 * el usuario hace preguntas libres y recibe respuestas contextualizadas.
 *
 * Flujo RAG:
 *   1. Convierte la pregunta del usuario en un embedding
 *   2. Busca los 5 chunks más relevantes del borrador (en memoria)
 *   3. Busca los 5 chunks más relevantes del corpus (en ChromaDB)
 *   4. Combina ambos resultados como contexto para el prompt
 *   5. Incluye el historial de conversación para mantener coherencia
 *   6. Gemini responde basándose en el contexto recuperado
 *
 * @param question       - Pregunta actual del usuario
 * @param chatHistory    - Mensajes anteriores de la conversación
 * @param draftFileUri   - ID del borrador en draftStore
 * @param corpusFileUris - IDs de los archivos del corpus seleccionados
 */
export async function chatWithModel(
  question: string,
  chatHistory: { role: string; content: string }[],
  draftFileUri: string,
  corpusFileUris: string[]
) {
  try {
    // Vectorizar la pregunta para buscar contexto semánticamente relevante
    const queryEmbeddings = await embedTexts([question]);
    const queryEmbedding = queryEmbeddings[0];

    // Buscar en el borrador (memoria): top 5 fragmentos más similares a la pregunta
    const draftChunks = searchDraftChunks(draftFileUri, queryEmbedding, 5);

    // Buscar en el corpus (ChromaDB): top 5 fragmentos más similares
    let corpusChunks: string[] = [];
    if (corpusFileUris.length > 0) {
      const collection = await chromaClient.getCollection({ name: "rag_corpus" });
      const whereClause = corpusFileUris.length > 1
        ? { fileId: { "$in": corpusFileUris } }
        : { fileId: corpusFileUris[0] };
      const searchResults = await collection.query({
        queryEmbeddings: queryEmbeddings,
        nResults: 5,
        where: whereClause as any,
        include: ["documents" as any],
      });
      corpusChunks = searchResults.documents?.[0] ?? [];
    }

    // Unir contexto del borrador y del corpus en un solo bloque
    const relevantContext = [...draftChunks, ...corpusChunks].join("\n\n");

    // Formatear el historial de chat para incluirlo en el prompt
    const formattedHistory = chatHistory.length > 0
      ? "Historial de la conversación:\n" + chatHistory.map(msg => `${msg.role === 'user' ? 'Usuario' : 'Asistente'}: ${msg.content}`).join("\n") + "\n\n"
      : "";

    const prompt = `
Eres un asesor experto de la organización Platohedro.
El usuario ha subido un borrador de propuesta para ser evaluado y está haciendo preguntas abiertas sobre él.
Tienes a tu disposición fragmentos relevantes extraídos tanto del borrador actual como de la base documental del corpus ("buenas prácticas" o ganadores).
Tu objetivo es responder de manera clara, amigable y precisa basándote EN EL CONTEXTO PROPORCIONADO.

--CONTEXTO RELEVANTE RECUPERADO MEDIANTE RAG--
${relevantContext}
------------------------------------------

${formattedHistory}
Pregunta actual del usuario: ${question}

Instrucciones:
- Responde directamente a la pregunta usando el contexto brindado.
- Si sugieres mejoras, sé específico.
- Utiliza un tono profesional pero accesible.
- Tu respuesta debe ser texto plano o markdown amigable para el lector.
`;

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
    const result = await model.generateContent(prompt);

    return { success: true, data: result.response.text() };

  } catch (error: any) {
    console.error("Error during chat:", error);
    return { success: false, error: error.message };
  }
}

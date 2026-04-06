"use server";

/**
 * localAi.ts — Motor de IA y base vectorial local
 *
 * Este archivo centraliza toda la lógica de backend:
 *   1. Extraer texto de PDFs y dividirlo en fragmentos (chunks)
 *   2. Convertir esos fragmentos en vectores numéricos (embeddings)
 *   3. Guardar y buscar en ChromaDB (base de datos vectorial local)
 *   4. Evaluar borradores usando RAG con Gemini
 *   5. Responder preguntas del usuario con contexto recuperado
 *
 * ¿Qué es RAG? (Retrieval-Augmented Generation)
 * Es un patrón donde antes de pedirle a un modelo de lenguaje que responda,
 * primero buscamos información relevante en una base de datos y se la damos
 * como contexto. Así el modelo responde con datos reales, no inventados.
 *
 * Flujo visual del sistema:
 *
 *   PDF → Texto → Chunks → Embeddings → ChromaDB (corpus)
 *                                           ↓
 *   Pregunta → Embedding → Búsqueda → Chunks relevantes → Gemini → Respuesta
 *
 * La directiva "use server" hace que este código solo corra en el servidor.
 * La API key y los datos del corpus nunca llegan al navegador del usuario.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { ChromaClient } from "chromadb";
import { v4 as uuidv4 } from "uuid";
import pdfParse from "pdf-parse";

// RecursiveCharacterTextSplitter divide texto largo en fragmentos más pequeños.
// "Recursive" significa que intenta respetar límites naturales: primero párrafos,
// luego oraciones, luego palabras — solo corta a la mitad si no queda opción.
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

// ─── Inicialización de clientes ───────────────────────────────────────────────

// La API key se lee de variables de entorno — nunca se escribe en el código
const apiKey = process.env.GOOGLE_API_KEY!;

// genAI es el cliente principal para hablar con los modelos de Google
const genAI = new GoogleGenerativeAI(apiKey);

// ChromaDB es la base de datos vectorial que corre en tu máquina via Docker.
// El puerto 8000 es el que configuramos en docker-compose.yml.
const chromaClient = new ChromaClient({ path: "http://localhost:8000" });

// embeddingModel convierte texto a vectores numéricos.
// ¿Para qué sirven esos vectores? Para buscar por significado, no por palabras exactas.
// Ejemplo: "auto" y "coche" tienen vectores muy parecidos aunque las palabras sean distintas.
const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });

// ─── Almacenamiento en memoria para borradores ────────────────────────────────
//
// Los borradores (propuestas aún no aprobadas) se guardan en RAM, NO en ChromaDB.
// Razón: queremos mantenerlos separados del corpus de referencia para que no
// "contaminen" las búsquedas. Si el servidor se reinicia, se pierden — es intencional.
//
// ¿Qué es un Map en JavaScript?
// Es como un diccionario: tiene claves y valores. Aquí la clave es un UUID
// generado al subir el borrador, y el valor son sus datos (texto + vectores).

interface DraftChunk {
  text: string;        // El fragmento de texto original
  embedding: number[]; // El vector numérico que representa ese fragmento
}
interface DraftEntry {
  displayName: string;  // Nombre original del PDF
  chunks: DraftChunk[]; // Lista de todos los fragmentos del documento
}

// Map<draftId, DraftEntry>
const draftStore = new Map<string, DraftEntry>();

// ─── Funciones internas (no exportadas) ──────────────────────────────────────

/**
 * embedTexts — Convierte un array de textos en vectores numéricos
 *
 * Un embedding es una lista de ~3072 números que captura el "significado" del texto.
 * Textos con contenido similar producen vectores parecidos, lo que permite
 * buscar por semántica ("encuentra fragmentos sobre presupuesto").
 *
 * Promise.all ejecuta todas las peticiones en paralelo — en lugar de
 * esperar que termine una para empezar la siguiente, las lanza todas a la vez.
 * Esto es mucho más rápido cuando hay muchos chunks.
 *
 * @param texts - Array de strings a vectorizar
 * @returns Array de vectores, uno por cada texto de entrada
 */
async function embedTexts(texts: string[]): Promise<number[][]> {
  const results = await Promise.all(
    texts.map(t => embeddingModel.embedContent(t).then(r => r.embedding.values))
  );
  return results;
}

/**
 * cosineSimilarity — Mide qué tan parecidos son dos vectores
 *
 * Retorna un número entre -1 y 1:
 *   1  = vectores idénticos (textos con el mismo significado)
 *   0  = vectores perpendiculares (textos sin relación)
 *  -1  = vectores opuestos (textos con significado contrario)
 *
 * Esta es la métrica estándar para comparar embeddings de texto.
 * La fórmula calcula el ángulo entre dos vectores en un espacio de 3072 dimensiones.
 *
 * Fórmula: similitud = (A · B) / (|A| × |B|)
 * Donde "·" es el producto punto y "|x|" es la magnitud del vector.
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
 * searchDraftChunks — Busca los fragmentos más relevantes del borrador
 *
 * Implementa la búsqueda semántica en memoria (lo que ChromaDB hace en disco).
 * Para cada fragmento del borrador, calcula qué tan similar es al query,
 * los ordena de mayor a menor similitud y retorna los topK mejores.
 *
 * ¿Por qué "topK" y no todos?
 * Los modelos tienen un límite de tokens. Mandar demasiado contexto es costoso
 * y puede confundir al modelo. Con los 5 fragmentos más relevantes es suficiente.
 *
 * @param draftId        - ID del borrador en draftStore
 * @param queryEmbedding - Vector de la pregunta del usuario
 * @param topK           - Cuántos fragmentos devolver
 */
function searchDraftChunks(draftId: string, queryEmbedding: number[], topK: number): string[] {
  const entry = draftStore.get(draftId);
  if (!entry) return [];
  return entry.chunks
    .map(c => ({ text: c.text, score: cosineSimilarity(queryEmbedding, c.embedding) }))
    .sort((a, b) => b.score - a.score) // De mayor a menor similitud
    .slice(0, topK)
    .map(c => c.text);
}

// ─── Server Actions exportadas ────────────────────────────────────────────────

/**
 * checkGeminiConnection — Verifica que Gemini y ChromaDB estén disponibles
 *
 * Hace un "ping" a Gemini y un heartbeat a ChromaDB para confirmar que
 * ambos servicios responden. El frontend muestra un indicador de estado basado
 * en el resultado de esta función al cargar la página.
 *
 * heartbeat() es un endpoint de ChromaDB que simplemente confirma que el
 * servidor está vivo — no hace ninguna operación con datos.
 */
export async function checkGeminiConnection() {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
    await model.generateContent("ping");
    await chromaClient.heartbeat();
    return { success: true };
  } catch (error: any) {
    console.error("Error connecting to Gemini or Chroma:", error);
    return { success: false, error: error.message };
  }
}

/**
 * addDocumentToVectorStore — Procesa un PDF del corpus y lo guarda en ChromaDB
 *
 * Este es el proceso de "ingesta" del RAG — transforma un documento legible
 * por humanos en vectores que la máquina puede buscar eficientemente.
 *
 * Paso a paso:
 *   1. pdf-parse extrae el texto plano del PDF (quita imágenes, formato, etc.)
 *   2. RecursiveCharacterTextSplitter divide el texto en chunks de ~1000 chars.
 *      El solapamiento de 200 chars evita perder contexto en los bordes.
 *   3. embedTexts convierte cada chunk en un vector de 3072 números via Gemini.
 *   4. ChromaDB guarda los vectores junto con el texto original y metadatos.
 *
 * ¿Por qué fragmentar en chunks y no guardar el documento completo?
 * Porque la búsqueda semántica es más precisa con fragmentos pequeños.
 * Un vector de un documento entero mezcla demasiados temas; un vector de
 * un párrafo captura una idea específica.
 *
 * Todos los chunks de un archivo comparten el mismo fileId en sus metadatos.
 * Esto permite recuperar o filtrar todos los chunks de un documento específico.
 */
export async function addDocumentToVectorStore(formData: FormData) {
  try {
    const file = formData.get("file") as File;
    if (!file) throw new Error("No file provided");

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 1. Extraer texto del PDF — el resultado es un string con todo el contenido
    const pdfData = await pdfParse(buffer);
    const text = pdfData.text;

    // 2. Fragmentar (chunking)
    //    chunkSize: máximo de caracteres por fragmento
    //    chunkOverlap: cuántos caracteres se repiten entre chunks consecutivos
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });
    const chunks = await splitter.createDocuments([text]);

    // 3. Generar embeddings — un vector por cada chunk
    const texts = chunks.map(c => c.pageContent);
    const vectors = await embedTexts(texts);

    // 4. Guardar en ChromaDB
    //    getOrCreateCollection crea la colección si no existe, o la reutiliza
    const fileId = uuidv4(); // ID único para este archivo
    const collection = await chromaClient.getOrCreateCollection({
      name: "rag_corpus"
    });

    // Cada chunk necesita un ID único dentro de ChromaDB
    const ids = chunks.map((_, i) => `${fileId}_chunk_${i}`);

    // Los metadatos nos permiten filtrar por archivo cuando hagamos búsquedas
    const metadatas = chunks.map(() => ({ fileId, displayName: file.name }));

    await collection.add({
      ids,
      embeddings: vectors,
      metadatas,
      documents: texts, // Guardamos también el texto original para poder mostrarlo
    });

    return {
      success: true,
      fileId: fileId,
      displayName: file.name,
      uri: fileId, // El frontend usa "uri" como identificador — aquí coincide con fileId
    };
  } catch (error: any) {
    console.error("Error uploading to Chroma:", error);
    return { success: false, error: error.message };
  }
}

/**
 * uploadDraft — Procesa un PDF borrador y lo guarda en memoria RAM
 *
 * Hace exactamente lo mismo que addDocumentToVectorStore (extraer, fragmentar,
 * vectorizar), pero guarda el resultado en draftStore (Map en RAM) en vez
 * de en ChromaDB. Esto mantiene el borrador separado del corpus.
 *
 * Retorna un draftId (UUID) que el frontend guarda y envía en cada
 * llamada a analyzeDraft y chatWithModel para identificar el borrador.
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
 * listVectorStoreDocuments — Lista los archivos del corpus en ChromaDB
 *
 * ChromaDB guarda chunks individuales, no archivos completos. Si subiste
 * un PDF de 50 páginas, ChromaDB tiene decenas de chunks de ese archivo.
 * Para mostrar al usuario "1 archivo subido", necesitamos agrupar los chunks
 * por fileId y deduplicar — eso es lo que hace el Map interno.
 *
 * El frontend usa esta lista para mostrar qué documentos del corpus están
 * disponibles y dejar que el usuario seleccione cuáles usar en el análisis.
 */
export async function listVectorStoreDocuments() {
  try {
    const collection = await chromaClient.getOrCreateCollection({ name: "rag_corpus" });
    const results = await collection.get({
        include: ["metadatas" as any]
    });

    // Usamos un Map para deduplicar: si un fileId ya está, lo ignoramos
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
 * clearVectorStore — Borra toda la colección del corpus en ChromaDB
 *
 * deleteCollection elimina todos los chunks y vectores de "rag_corpus".
 * Es una operación destructiva — no hay forma de recuperar los datos borrados.
 *
 * Los borradores en memoria (draftStore) no se ven afectados por esta función.
 */
export async function clearVectorStore() {
  try {
    await chromaClient.deleteCollection({ name: "rag_corpus" });
    return { success: true, count: 1 };
  } catch (error: any) {
    // Si la colección no existía, no es un error — simplemente no hay nada que borrar
    return { success: true, count: 0 };
  }
}

/**
 * analyzeDraft — Evalúa un borrador comparándolo contra el corpus (RAG completo)
 *
 * Este es el paso central del sistema. Implementa el patrón RAG en su forma completa:
 *
 *   Paso 1 — Recuperar el borrador de la memoria usando su draftId
 *   Paso 2 — Convertir el inicio del borrador en un vector (query embedding)
 *   Paso 3 — Buscar en ChromaDB los 15 chunks del corpus más similares a ese vector
 *   Paso 4 — Combinar el borrador completo + esos 15 chunks como contexto del prompt
 *   Paso 5 — Gemini lee todo y genera la evaluación en formato JSON
 *
 * ¿Por qué buscar con los primeros 1000 chars del borrador?
 * La introducción de un documento suele resumir su tema. Buscar con ese texto
 * ayuda a recuperar los fragmentos del corpus más relevantes al tema del borrador.
 *
 * ¿Por qué el filtro WHERE en ChromaDB?
 * Si el usuario seleccionó documentos específicos del corpus, solo queremos
 * buscar dentro de esos documentos — no en todo el corpus.
 * ChromaDB usa operadores como "$in" (está en la lista) para filtrar.
 *
 * @param draftFileUri    - ID del borrador en draftStore (el UUID generado en uploadDraft)
 * @param corpusFileUris  - IDs de los archivos del corpus seleccionados por el usuario
 * @param draftName       - Nombre del archivo para mencionarlo en el prompt
 */
export async function analyzeDraft(draftFileUri: string, corpusFileUris: string[], draftName: string) {
  try {
    const collection = await chromaClient.getCollection({ name: "rag_corpus" });

    // Recuperar el borrador de la memoria y reconstruir el texto completo
    const draftEntry = draftStore.get(draftFileUri);
    if (!draftEntry) throw new Error("Borrador no encontrado en memoria. Vuelve a subirlo.");
    const draftText = draftEntry.chunks.map(c => c.text).join("\n");

    // Usar el inicio del borrador como query para buscar contexto relevante en el corpus
    const draftQuery = draftText.substring(0, 1000);
    const queryEmbeddings = await embedTexts([draftQuery]);

    // Construir el filtro de ChromaDB según cuántos archivos de corpus hay:
    //   - Varios archivos → operador $in: busca donde fileId esté en el array
    //   - Un archivo     → comparación directa por igualdad
    //   - Sin corpus     → undefined (sin filtro, busca en todo)
    const corpusWhere = corpusFileUris.length > 1
      ? { fileId: { "$in": corpusFileUris } }
      : (corpusFileUris.length === 1 ? { fileId: corpusFileUris[0] } : undefined);

    let corpusContext = "";

    if (corpusWhere) {
      // Búsqueda semántica en ChromaDB — retorna los 15 chunks más similares
      const searchResults = await collection.query({
        queryEmbeddings: queryEmbeddings,
        nResults: 15,
        where: corpusWhere as any,
        include: ["documents" as any]
      });
      const relevantCorpusChunks = searchResults.documents?.[0] || [];
      corpusContext = relevantCorpusChunks.join("\n\n");
    }

    // El prompt incluye el contexto del corpus y el borrador completo.
    // Se le pide respuesta SOLO en JSON para facilitar el parsing en el frontend.
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
 * chatWithModel — Responde preguntas del usuario con contexto recuperado por RAG
 *
 * Esta función es el chat interactivo post-análisis. A diferencia de analyzeDraft
 * que evalúa el borrador de forma automática, aquí el usuario hace preguntas libres.
 *
 * El flujo RAG del chat:
 *   1. Vectorizar la pregunta del usuario
 *   2. Buscar los 5 chunks más relevantes del borrador (en memoria, con cosineSimilarity)
 *   3. Buscar los 5 chunks más relevantes del corpus (en ChromaDB)
 *   4. Combinar esos 10 chunks como contexto
 *   5. Construir el prompt con el contexto + historial + pregunta
 *   6. Gemini responde en texto libre (no JSON)
 *
 * ¿Por qué buscamos en ambos — borrador Y corpus?
 * La pregunta puede referirse a "mi propuesta" (borrador) o a "las propuestas
 * exitosas" (corpus). Al buscar en los dos, cubrimos ambos casos.
 *
 * ¿Por qué pasamos el historial completo?
 * Las Server Actions no tienen estado entre llamadas. El frontend mantiene
 * el historial en su estado (useState) y lo envía en cada petición.
 *
 * @param question       - La pregunta actual del usuario
 * @param chatHistory    - Conversación previa: [{role, content}, ...]
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
    // Paso 1: vectorizar la pregunta para buscar contexto relevante
    const queryEmbeddings = await embedTexts([question]);
    const queryEmbedding = queryEmbeddings[0];

    // Paso 2: buscar en el borrador (memoria) — los 5 más similares
    const draftChunks = searchDraftChunks(draftFileUri, queryEmbedding, 5);

    // Paso 3: buscar en el corpus (ChromaDB) — los 5 más similares
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

    // Paso 4: combinar contexto del borrador y del corpus
    const relevantContext = [...draftChunks, ...corpusChunks].join("\n\n");

    // Paso 5: formatear el historial de conversación para incluirlo en el prompt
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

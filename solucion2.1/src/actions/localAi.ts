"use server";

/**
 * localAi.ts — Acciones del servidor para IA y búsqueda semántica
 *
 * ¿Qué hace este archivo?
 * -----------------------
 * Este archivo es el "cerebro" de la aplicación. Conecta tres servicios:
 *   1. Gemini (IA de Google) — lee PDFs y genera respuestas en lenguaje natural
 *   2. ChromaDB              — base de datos que guarda textos como vectores numéricos
 *   3. draftStore            — almacén en memoria RAM para borradores temporales
 *
 * ¿Qué es un "embedding" o vector?
 * ---------------------------------
 * Un embedding es una lista de números (ej. [0.12, -0.87, 0.34, ...]) que representa
 * el significado de un texto. Textos con significado similar tienen vectores parecidos.
 * Esto permite buscar por significado en lugar de por palabras exactas.
 *
 * ¿Qué es RAG?
 * ------------
 * RAG (Retrieval-Augmented Generation) es un patrón de IA en dos pasos:
 *   1. RECUPERAR: buscar los fragmentos de texto más relevantes para una pregunta
 *   2. GENERAR: pasarle esos fragmentos a Gemini como "contexto" para que responda
 * Esto evita que la IA "invente" respuestas: siempre se basa en los documentos reales.
 *
 * Pipeline completo de procesamiento de un PDF:
 * ---------------------------------------------
 *   PDF (archivo) → [Gemini] → secciones semánticas (chunks) → [gemini-embedding-001]
 *                → vectores 3072D → ChromaDB (corpus) o draftStore (borrador en RAM)
 *
 * Pipeline de consulta (RAG):
 * ---------------------------
 *   Pregunta → [gemini-embedding-001] → vector → búsqueda en ChromaDB/draftStore
 *           → fragmentos relevantes → [Gemini con contexto] → Respuesta
 *
 * Diferencia entre corpus y borrador:
 * ------------------------------------
 *   - Corpus:   documentos aprobados, guardados en ChromaDB (persisten entre reinicios)
 *   - Borrador: documento en evaluación, guardado solo en RAM (se pierde al reiniciar)
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { ChromaClient } from "chromadb";
import { v4 as uuidv4 } from "uuid";

// ─── Inicialización de clientes ───────────────────────────────────────────────
//
// Aquí se crean las conexiones con los servicios externos una sola vez,
// cuando el módulo se carga por primera vez (al arrancar el servidor).

// La API key de Google se lee desde variables de entorno por seguridad.
// El "!" al final le dice a TypeScript: "confía en mí, este valor no es undefined".
const apiKey = process.env.GOOGLE_API_KEY!;

// Nombre del modelo de Gemini que se usa para leer PDFs y generar respuestas.
// "flash-lite" es una versión rápida y económica, ideal para prototipos.
const GEMINI_MODEL = "gemini-2.5-flash-lite";

// Cliente principal del SDK de Google Generative AI.
// A partir de este objeto se crean los modelos específicos.
const genAI = new GoogleGenerativeAI(apiKey);

// Cliente de ChromaDB — la base de datos vectorial que corre localmente en el puerto 8000.
// Solo almacena documentos del corpus (los aprobados). Los borradores van en RAM.
const chromaClient = new ChromaClient({ path: "http://localhost:8000" });

// ChromaDB puede generar sus propios embeddings, pero nosotros ya los calculamos con Gemini.
// Esta función "vacía" (no-op) le dice a ChromaDB: "no hagas nada, yo te paso los vectores".
// Si no se hace esto, ChromaDB intenta calcularlos por su cuenta y falla o genera inconsistencias.
const noopEmbeddingFunction = {
  generate: async (texts: string[]): Promise<number[][]> => texts.map(() => []),
};

// Modelo especializado en convertir texto → vector numérico (embedding).
// Genera vectores de 3072 dimensiones: 3072 números que representan el significado del texto.
const embeddingModel = genAI.getGenerativeModel({
  model: "gemini-embedding-001",
});


// ─── Almacén en memoria para borradores ───────────────────────────────────────
//
// Los borradores (PDFs en evaluación) NO se guardan en ChromaDB, sino aquí en RAM.
// Razones:
//   - Separación clara: el corpus son documentos aprobados; los borradores son temporales.
//   - Evitar contaminar ChromaDB con documentos que aún no han sido validados.
//   - Simplicidad: si el servidor se reinicia, el usuario vuelve a subir el borrador.
//
// Estructura:
//   draftStore es un Map (diccionario) donde la clave es un ID único (UUID) y
//   el valor contiene el nombre del archivo y sus fragmentos con sus vectores.

/**
 * Un mensaje en el historial de conversación del chat.
 * "role" indica quién habló: "user" (el usuario) o "assistant" (Gemini).
 */
interface ChatMessage {
  role: string;
  content: string;
}

/**
 * Un fragmento (chunk) de texto del borrador junto con su vector de embedding.
 * El vector permite compararlo semánticamente con la pregunta del usuario.
 */
interface DraftChunk {
  text: string;        // Texto original del fragmento
  embedding: number[]; // Vector numérico de 3072 dimensiones que representa su significado
}

/**
 * Entrada completa de un borrador en memoria.
 * Contiene el nombre del archivo y todos sus fragmentos vectorizados.
 */
interface DraftEntry {
  displayName: string;  // Nombre del archivo PDF original (ej: "propuesta_2026.pdf")
  chunks: DraftChunk[]; // Lista de fragmentos semánticos con sus vectores
}

// El Map usa string (UUID) como clave → DraftEntry como valor.
// Ejemplo: draftStore.get("3f2a...") devuelve { displayName: "propuesta.pdf", chunks: [...] }
const draftStore = new Map<string, DraftEntry>();

// ─── Funciones de utilidad (solo uso interno) ─────────────────────────────────

/**
 * Divide un PDF en fragmentos semánticos usando Gemini como "chunker inteligente".
 *
 * ¿Por qué usar Gemini para dividir el texto?
 * -------------------------------------------
 * La manera tradicional de dividir texto (cada N caracteres o cada N palabras) rompe
 * el contenido a mitad de una tabla, un párrafo o una lista. Gemini entiende el
 * documento y lo divide respetando su estructura natural.
 *
 * ¿Cómo funciona internamente?
 * ----------------------------
 * 1. El PDF se convierte a base64 (texto plano que representa bytes binarios).
 * 2. Se envía a Gemini como "inlineData" (adjunto directo en el mensaje).
 * 3. Gemini lee el PDF y devuelve un JSON con las secciones identificadas.
 * 4. Se extraen los textos de cada sección y se devuelven como un array de strings.
 *
 * Limitación importante: PDFs hasta ~20MB (límite del SDK de Google v0.24).
 * Para archivos más grandes habría que usar la Files API de Google.
 *
 * @param file - El archivo PDF subido por el usuario
 * @returns Array de strings, uno por cada sección semántica del documento
 *
 * Ejemplo de retorno:
 *   ["## Introducción\n\nEsta propuesta busca...", "Presupuesto\n\nHonorarios: $500..."]
 */
async function extractChunksWithGemini(file: File): Promise<string[]> {
  const arrayBuffer = await file.arrayBuffer();
  const base64Data = Buffer.from(arrayBuffer).toString("base64");

  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: "application/pdf",
              data: base64Data,
            },
          },
          {
            text: `Analiza este documento PDF e identifica sus secciones semánticas naturales.
Devuelve ÚNICAMENTE un JSON válido (sin markdown, sin bloques de código) con esta estructura:
{
  "sections": [
    { "title": "Título de la sección o bloque", "content": "Texto completo del bloque..." },
    ...
  ]
}

Reglas estrictas:
- Cada elemento de "sections" debe ser un bloque semántico completo: un párrafo entero, una tabla completa, una lista completa, un encabezado con su contenido.
- NUNCA partas una tabla, una lista o un párrafo en dos secciones distintas.
- Conserva el texto exacto del documento sin resumirlo ni parafrasearlo.
- Si el documento tiene secciones con título (# Título), úsalos como "title". Si no, usa una descripción breve del contenido.
- El campo "content" debe incluir el texto íntegro del bloque, incluyendo el título si lo tiene.`,
          },
        ],
      },
    ],
    generationConfig: { responseMimeType: "application/json" },
  });

  const raw = result.response.text().trim();
  if (!raw) throw new Error("Gemini no pudo extraer texto del PDF.");

  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.sections) || parsed.sections.length === 0)
    throw new Error("Gemini no devolvió secciones válidas del PDF.");

  return parsed.sections
    .map((s: { title?: string; content?: string }) =>
      [s.title, s.content].filter(Boolean).join("\n\n"),
    )
    .filter((t: string) => t.trim().length > 0);
}

/**
 * Convierte un array de textos en vectores numéricos (embeddings).
 *
 * ¿Por qué procesar en batches?
 * ------------------------------
 * La API de Google tiene un límite de solicitudes por segundo (rate limit).
 * Si enviamos 50 textos a la vez en paralelo, la API rechaza las peticiones.
 * Al procesar de a 10 en 10, esperamos que cada grupo termine antes del siguiente,
 * lo que respeta los límites y evita errores 429 (Too Many Requests).
 *
 * @param texts - Array de strings a convertir en vectores
 * @returns Array de vectores numéricos (cada vector tiene 3072 números)
 *
 * Ejemplo:
 *   embedTexts(["hola mundo", "presupuesto detallado"])
 *   → [[0.12, -0.87, ...], [0.45, 0.23, ...]]  (dos vectores de 3072 elementos)
 */
async function embedTexts(texts: string[]): Promise<number[][]> {
  const BATCH_SIZE = 10;
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map((t: string) =>
        embeddingModel.embedContent(t).then((r) => r.embedding.values),
      ),
    );
    results.push(...batchResults);
  }
  return results;
}

/**
 * Calcula la similitud coseno entre dos vectores de embedding.
 *
 * ¿Qué es la similitud coseno?
 * ----------------------------
 * Es una forma de medir qué tan "parecidos" son dos vectores en términos de dirección.
 * Imagina cada vector como una flecha en un espacio de 3072 dimensiones:
 *   - Si dos flechas apuntan en la misma dirección → similitud cercana a 1 (muy parecidos)
 *   - Si apuntan en ángulos distintos → similitud cercana a 0 (sin relación)
 *   - Si apuntan en sentidos opuestos → similitud cercana a -1 (conceptos opuestos)
 *
 * Se usa en lugar de la distancia euclidiana porque es más robusta ante vectores
 * de diferentes magnitudes (longitudes de texto distintas).
 *
 * @param a - Primer vector (ej: embedding de la pregunta del usuario)
 * @param b - Segundo vector (ej: embedding de un fragmento del documento)
 * @returns Número entre -1 y 1 indicando el grado de similitud semántica
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Busca los fragmentos más relevantes de un borrador dado un query (pregunta).
 *
 * Esta función hace manualmente lo que ChromaDB hace automáticamente para el corpus:
 *   1. Compara el vector de la pregunta con el vector de cada fragmento del borrador.
 *   2. Ordena los fragmentos por similitud (de mayor a menor).
 *   3. Devuelve los `topK` más relevantes.
 *
 * ¿Por qué no usar ChromaDB para los borradores?
 * -----------------------------------------------
 * Los borradores son temporales y no deben persistir en disco. Hacer la búsqueda
 * manualmente en memoria es más simple y no requiere limpiar ChromaDB después.
 *
 * @param draftId        - UUID del borrador en draftStore
 * @param queryEmbedding - Vector de la pregunta del usuario (3072 dimensiones)
 * @param topK           - Cuántos fragmentos devolver (ej: 5 = los 5 más relevantes)
 * @returns Array de strings con los textos de los fragmentos más relevantes
 */
function searchDraftChunks(
  draftId: string,
  queryEmbedding: number[],
  topK: number,
): string[] {
  const entry = draftStore.get(draftId);
  if (!entry) return [];
  return entry.chunks
    .map((c) => ({
      text: c.text,
      score: cosineSimilarity(queryEmbedding, c.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((c) => c.text);
}

// ─── Acciones exportadas (Server Actions de Next.js) ─────────────────────────
//
// Estas funciones están marcadas con "use server" (al inicio del archivo), lo que
// significa que Next.js las ejecuta SOLO en el servidor, nunca en el navegador.
// El cliente las llama como si fueran funciones normales, pero la ejecución ocurre
// en el backend. Esto permite usar variables de entorno y conectar a servicios
// privados (ChromaDB, API keys) sin exponerlos al navegador.

/**
 * Verifica que los dos servicios externos estén operativos antes de usarlos.
 *
 * ¿Cuándo llamar esta función?
 * ----------------------------
 * Al cargar la página principal, para mostrar un indicador de estado al usuario
 * y evitar errores crípticos si Gemini o ChromaDB no están disponibles.
 *
 * @returns { success: true } si ambos servicios responden correctamente,
 *          { success: false, error: "..." } si alguno falla
 */
export async function checkGeminiConnection() {
  try {
    await embeddingModel.embedContent("ping");
    await chromaClient.heartbeat();
    return { success: true };
  } catch (error: any) {
    console.error("Error connecting to Gemini or Chroma:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Procesa un PDF del corpus y lo indexa en ChromaDB para búsqueda semántica.
 *
 * ¿Qué es el "corpus"?
 * --------------------
 * El corpus es la colección de documentos aprobados que sirven como referencia.
 * Cuando se evalúa un borrador, se compara contra estos documentos para saber
 * si cumple con las buenas prácticas de la organización.
 *
 * Pipeline paso a paso:
 *   1. Se extrae el PDF del FormData (así es como Next.js recibe archivos del browser)
 *   2. Gemini lee el PDF y devuelve sus secciones semánticas como array de strings
 *   3. Cada sección se convierte en un vector de 3072 dimensiones con gemini-embedding-001
 *   4. Los vectores y textos se guardan en ChromaDB bajo la colección "rag_corpus"
 *      - Cada fragmento recibe un ID único: "{fileId}_chunk_0", "{fileId}_chunk_1", etc.
 *      - Se guarda el fileId en los metadatos para poder filtrar o eliminar por archivo
 *
 * @param formData - FormData enviado desde el formulario del cliente con el campo "file"
 * @returns { success: true, fileId, displayName, uri } si se procesó correctamente,
 *          { success: false, error: "..." } si ocurrió algún error
 */
export async function addDocumentToVectorStore(formData: FormData) {
  try {
    const file = formData.get("file") as File;
    if (!file) throw new Error("No file provided");

    // 1. PDF → chunks semánticos via Gemini
    const texts = await extractChunksWithGemini(file);
    if (!texts.length)
      throw new Error("No se pudo extraer texto del documento PDF.");

    // 2. Chunks → embeddings
    const vectors = await embedTexts(texts);

    // 3. Guardar en ChromaDB
    const fileId = uuidv4();
    const collection = await chromaClient.getOrCreateCollection({
      name: "rag_corpus",
      embeddingFunction: noopEmbeddingFunction,
    });

    const ids = texts.map((_: string, i: number) => `${fileId}_chunk_${i}`);
    const metadatas = texts.map(() => ({ fileId, displayName: file.name }));

    await collection.add({
      ids,
      embeddings: vectors,
      metadatas,
      documents: texts,
    });

    return { success: true, fileId, displayName: file.name, uri: fileId };
  } catch (error: any) {
    console.error("Error uploading to Chroma:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Procesa un PDF borrador y lo guarda en memoria RAM (NO en ChromaDB).
 *
 * ¿Por qué en RAM y no en ChromaDB?
 * ----------------------------------
 * Un borrador es un documento temporal que el usuario está evaluando.
 * Guardarlo en ChromaDB lo mezclaría con los documentos aprobados del corpus,
 * lo que contaminaría los resultados de búsqueda futuros.
 * En RAM, el borrador existe solo durante la sesión actual del servidor.
 *
 * El pipeline es idéntico al de addDocumentToVectorStore:
 *   PDF → Gemini (chunks) → embeddings → draftStore (en lugar de ChromaDB)
 *
 * @param formData - FormData con el campo "file" conteniendo el PDF borrador
 * @returns { success: true, draftId, displayName, uri } si se procesó correctamente,
 *          { success: false, error: "..." } si ocurrió algún error
 */
export async function uploadDraft(formData: FormData) {
  try {
    const file = formData.get("file") as File;
    if (!file) throw new Error("No file provided");

    // PDF → chunks semánticos → embeddings
    const texts = await extractChunksWithGemini(file);
    if (!texts.length)
      throw new Error("No se pudo extraer texto del borrador PDF.");

    const vectors = await embedTexts(texts);

    const draftId = uuidv4();
    draftStore.set(draftId, {
      displayName: file.name,
      chunks: texts.map((t: string, i: number) => ({ text: t, embedding: vectors[i] })),
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
 * ¿Por qué necesitamos agrupar por fileId?
 * -----------------------------------------
 * En ChromaDB, cada fragmento (chunk) de un PDF se guarda como un documento separado.
 * Un PDF de 10 secciones genera 10 entradas en la base de datos, todas con el mismo fileId.
 * Esta función recorre todos esos registros y los agrupa para devolver una lista de
 * archivos únicos (no de fragmentos individuales).
 *
 * @returns { success: true, files: [{uri, displayName, name}] } con la lista de archivos,
 *          { success: false, error: "..." } si ocurrió algún error
 */
export async function listVectorStoreDocuments() {
  try {
    const collection = await chromaClient.getOrCreateCollection({
      name: "rag_corpus",
      embeddingFunction: noopEmbeddingFunction,
    });
    const results = await collection.get({
      include: ["metadatas" as any],
    });

    const filesMap = new Map();
    if (results.metadatas) {
      results.metadatas.forEach((meta: any) => {
        if (meta && meta.fileId) {
          filesMap.set(meta.fileId, meta.displayName);
        }
      });
    }

    const files = Array.from(filesMap.entries()).map(
      ([fileId, displayName]) => ({
        uri: fileId,
        displayName: displayName,
        name: fileId,
      }),
    );

    return { success: true, files };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Elimina toda la colección "rag_corpus" de ChromaDB (borrado total del corpus).
 *
 * Advertencia: esta operación es irreversible. Borra todos los documentos del corpus.
 * Los borradores en RAM (draftStore) no se ven afectados porque están separados.
 *
 * Nota de implementación: si la colección no existe, ChromaDB lanza un error.
 * El catch devuelve { success: true, count: 0 } en ese caso porque el estado
 * final es el mismo: no hay corpus. Esto evita mostrar un error al usuario
 * cuando simplemente ya estaba vacío.
 *
 * @returns { success: true, count: 1 } si se eliminó, { success: true, count: 0 } si ya estaba vacío
 */
export async function clearVectorStore() {
  try {
    await chromaClient.deleteCollection({ name: "rag_corpus" });
    return { success: true, count: 1 };
  } catch (error: any) {
    return { success: true, count: 0, error: error.message };
  }
}

/**
 * Elimina de ChromaDB todos los fragmentos (chunks) de un archivo específico del corpus.
 *
 * ¿Por qué buscar por fileId antes de eliminar?
 * ----------------------------------------------
 * ChromaDB no tiene un comando "elimina todo lo que tenga este metadato".
 * El flujo es:
 *   1. Buscar todos los documentos que tengan { fileId: "..." } en sus metadatos
 *   2. Obtener sus IDs internos (ej: "abc123_chunk_0", "abc123_chunk_1", ...)
 *   3. Eliminarlos por ID
 * Si no hay documentos con ese fileId (ej: ya fue eliminado), no hace nada y retorna éxito.
 *
 * @param fileId - UUID del archivo a eliminar (el mismo que se devolvió al subirlo)
 * @returns { success: true } si se eliminó (o ya no existía), { success: false, error } si falló
 */
export async function removeDocumentFromVectorStore(fileId: string) {
  try {
    const collection = await chromaClient.getOrCreateCollection({
      name: "rag_corpus",
      embeddingFunction: noopEmbeddingFunction,
    });
    const existing = await collection.get({ where: { fileId } });
    if (existing.ids.length > 0) {
      await collection.delete({ ids: existing.ids });
    }
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Analiza un borrador comparándolo contra el corpus usando RAG + Gemini.
 *
 * ¿Cómo funciona el análisis?
 * ----------------------------
 * 1. Se recupera el texto completo del borrador desde draftStore (RAM).
 * 2. Los primeros 1000 caracteres del borrador se usan como "query" de búsqueda semántica
 *    en ChromaDB, para traer los fragmentos del corpus más relevantes.
 * 3. Se construye un prompt con: el corpus como contexto + el borrador completo.
 * 4. Gemini evalúa el borrador en base a 4 pilares y devuelve un JSON estructurado.
 *
 * ¿Por qué solo los primeros 1000 caracteres como query?
 * -------------------------------------------------------
 * La intro de un documento suele describir su tema y propósito, que es suficiente para
 * encontrar documentos del corpus relacionados. Usar el documento completo como query
 * sería costoso y no necesariamente más preciso.
 *
 * El filtro `corpusWhere` maneja 3 casos:
 *   - Sin archivos seleccionados: no se filtra (usa todo el corpus)
 *   - Un archivo: usa { fileId: "abc" }
 *   - Varios archivos: usa { fileId: { $in: ["abc", "def"] } } (sintaxis de ChromaDB)
 *
 * @param draftFileUri    - UUID del borrador en draftStore (obtenido al subirlo)
 * @param corpusFileUris  - UUIDs de los archivos del corpus a usar como referencia
 * @param draftName       - Nombre del archivo borrador (para mostrarlo en el prompt)
 * @returns { success: true, data: { resultado, puntuacion, pilares, feedbackGeneral } }
 */
export async function analyzeDraft(
  draftFileUri: string,
  corpusFileUris: string[],
  draftName: string,
) {
  try {
    const collection = await chromaClient.getCollection({
      name: "rag_corpus",
      embeddingFunction: noopEmbeddingFunction,
    });

    const draftEntry = draftStore.get(draftFileUri);
    if (!draftEntry)
      throw new Error("Borrador no encontrado en memoria. Vuelve a subirlo.");
    const draftText = draftEntry.chunks.map((c) => c.text).join("\n");

    const draftQuery = draftText.substring(0, 1000);
    const queryEmbeddings = await embedTexts([draftQuery]);

    const corpusWhere =
      corpusFileUris.length > 1
        ? { fileId: { $in: corpusFileUris } }
        : corpusFileUris.length === 1
          ? { fileId: corpusFileUris[0] }
          : undefined;

    let corpusContext = "";

    if (corpusWhere) {
      const searchResults = await collection.query({
        queryEmbeddings: queryEmbeddings,
        nResults: 15,
        where: corpusWhere as any,
        include: ["documents" as any],
      });
      const relevantCorpusChunks = searchResults.documents?.[0] || [];
      corpusContext = relevantCorpusChunks.join("\n\n");
    }

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

    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
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
 * ¿Qué es RAG conversacional?
 * ----------------------------
 * Es RAG aplicado a un chat con historial. Además de buscar fragmentos relevantes,
 * se incluye el historial de mensajes anteriores para que Gemini pueda responder
 * de forma coherente con lo que se habló antes (ej: "¿puedes ampliarlo?" sabe
 * a qué "ello" se refiere el usuario).
 *
 * Flujo de la función:
 *   1. La pregunta se convierte en un vector (embedding).
 *   2. Se buscan los 5 fragmentos más relevantes del borrador (en draftStore/RAM).
 *   3. Si hay corpus seleccionado, se buscan también los 5 más relevantes en ChromaDB.
 *   4. Se combinan los fragmentos del borrador + corpus como contexto.
 *   5. Se construye un prompt con: contexto + historial + pregunta actual.
 *   6. Gemini genera una respuesta en texto libre (no JSON).
 *
 * @param question       - Pregunta actual del usuario
 * @param chatHistory    - Mensajes anteriores: [{role: "user"|"assistant", content: "..."}]
 * @param draftFileUri   - UUID del borrador en draftStore
 * @param corpusFileUris - UUIDs de los archivos del corpus seleccionados (puede ser vacío)
 * @returns { success: true, data: "Respuesta en texto..." } o { success: false, error }
 */
export async function chatWithModel(
  question: string,
  chatHistory: ChatMessage[],
  draftFileUri: string,
  corpusFileUris: string[],
) {
  try {
    const queryEmbeddings = await embedTexts([question]);
    const queryEmbedding = queryEmbeddings[0];

    const draftChunks = searchDraftChunks(draftFileUri, queryEmbedding, 5);

    let corpusChunks: string[] = [];
    if (corpusFileUris.length > 0) {
      const collection = await chromaClient.getCollection({
        name: "rag_corpus",
        embeddingFunction: noopEmbeddingFunction,
      });
      const whereClause =
        corpusFileUris.length > 1
          ? { fileId: { $in: corpusFileUris } }
          : { fileId: corpusFileUris[0] };
      const searchResults = await collection.query({
        queryEmbeddings: queryEmbeddings,
        nResults: 5,
        where: whereClause as any,
        include: ["documents" as any],
      });
      corpusChunks = (searchResults.documents?.[0] ?? []).filter(
        (d): d is string => d !== null,
      );
    }

    const relevantContext = [...draftChunks, ...corpusChunks].join("\n\n");

    const formattedHistory =
      chatHistory.length > 0
        ? "Historial de la conversación:\n" +
          chatHistory
            .map(
              (msg) =>
                `${msg.role === "user" ? "Usuario" : "Asistente"}: ${msg.content}`,
            )
            .join("\n") +
          "\n\n"
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

    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    const result = await model.generateContent(prompt);

    return { success: true, data: result.response.text() };
  } catch (error: any) {
    console.error("Error during chat:", error);
    return { success: false, error: error.message };
  }
}

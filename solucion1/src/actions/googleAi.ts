"use server";

/**
 * googleAi.ts — Conexión entre la app y los servicios de Google AI
 *
 * Este archivo contiene todas las funciones que hablan con la API de Google.
 * Al tener la directiva "use server" al inicio, Next.js garantiza que este
 * código SOLO corre en el servidor — nunca en el navegador del usuario.
 * Eso es importante porque aquí usamos la API key, que debe mantenerse secreta.
 *
 * ¿Qué es una Server Action?
 * Es una función que el cliente puede llamar como si fuera local, pero que
 * en realidad se ejecuta en el servidor. Next.js maneja la comunicación
 * automáticamente — tú solo importas y llamas la función desde un componente.
 *
 * Patrón que implementa: Zero-Infra RAG
 * En vez de guardar documentos en una base de datos vectorial, subimos los PDFs
 * a Google AI Studio y los referenciamos por su URI (una dirección única en la nube).
 * Gemini puede leer esos archivos directamente cuando construimos el prompt.
 * Esto elimina la necesidad de instalar y mantener servicios extra como ChromaDB.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager } from "@google/generative-ai/server";
import { tmpdir } from "os";
import { join } from "path";
import { writeFile, unlink } from "fs/promises";
import { v4 as uuidv4 } from "uuid";

// La API key viene del archivo .env.local — nunca se escribe directamente en el código.
// El "!" al final le dice a TypeScript: "confía en que este valor existe".
const apiKey = process.env.GOOGLE_API_KEY!;

// fileManager maneja los archivos subidos a Google AI Studio.
// Piénsalo como un gestor de archivos en la nube vinculado a tu cuenta de Google AI.
const fileManager = new GoogleAIFileManager(apiKey);

// genAI es el punto de entrada para hablar con los modelos de Gemini.
// Con él creamos instancias del modelo para generar texto.
const genAI = new GoogleGenerativeAI(apiKey);

// ─────────────────────────────────────────────────────────────────────────────

/**
 * checkGeminiConnection — Verifica que la API key funciona
 *
 * Envía un mensaje mínimo ("ping") a Gemini para confirmar que la conexión
 * está activa. Si la key es inválida o no hay acceso a internet, retorna error.
 *
 * El frontend llama a esta función al cargar la página para mostrar
 * un indicador de estado (verde = conectado, rojo = error).
 *
 * Concepto clave: try/catch
 * Si algo falla dentro del try, el código salta al catch y devolvemos
 * { success: false } en vez de que la app explote con un error no manejado.
 */
export async function checkGeminiConnection() {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
    // Llamada mínima — solo queremos saber si la conexión funciona
    await model.generateContent("ping");
    return { success: true };
  } catch (error: any) {
    console.error("Error connecting to Gemini:", error);
    return { success: false, error: error.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * uploadToGoogleAI — Sube un PDF a la nube de Google AI Studio
 *
 * ¿Por qué hay un paso con /tmp?
 * El SDK de Google requiere leer el archivo desde el disco del servidor.
 * Como el PDF llega como un objeto File (datos en memoria), primero lo
 * escribimos en la carpeta temporal del sistema (/tmp), lo subimos,
 * y luego borramos ese temporal — ya no lo necesitamos.
 *
 * ¿Qué es un URI?
 * Es la "dirección" única del archivo en la nube de Google AI.
 * Se parece a: "https://generativelanguage.googleapis.com/v1beta/files/abc123"
 * Ese URI es lo que usamos más adelante para referenciar el archivo en los prompts.
 *
 * Lo que retorna:
 * - fileId: nombre interno del archivo en la API (ej. "files/abc123")
 * - displayName: el nombre original del PDF que subió el usuario
 * - uri: la dirección del archivo (se pasa a analyzeDraft y chatWithModel)
 *
 * @param formData - Datos del formulario HTML que contienen el archivo bajo la clave "file"
 */
export async function uploadToGoogleAI(formData: FormData) {
  try {
    const file = formData.get("file") as File;
    if (!file) {
      throw new Error("No file provided");
    }

    // arrayBuffer() convierte el File en bytes crudos que podemos guardar en disco
    const buffer = Buffer.from(await file.arrayBuffer());

    // uuidv4() genera un identificador único (ej. "f47ac10b-58cc-...") para evitar
    // que dos archivos con el mismo nombre colisionen en /tmp
    const tempPath = join(tmpdir(), `${uuidv4()}-${file.name}`);

    // Escribir el archivo en el disco del servidor temporalmente
    await writeFile(tempPath, buffer);

    // Subir a Google AI Studio con el tipo MIME del archivo (ej. "application/pdf")
    const uploadResponse = await fileManager.uploadFile(tempPath, {
      mimeType: file.type,
      displayName: file.name,
    });

    // El archivo ya está en la nube — borramos el temporal del servidor
    await unlink(tempPath);

    return {
      success: true,
      fileId: uploadResponse.file.name,
      displayName: uploadResponse.file.displayName,
      uri: uploadResponse.file.uri,
    };
  } catch (error: any) {
    console.error("Error uploading to Google AI:", error);
    return { success: false, error: error.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * analyzeDraft — Evalúa un borrador comparándolo contra el corpus
 *
 * Este es el corazón del sistema. Implementa el patrón Zero-Infra RAG:
 * en lugar de buscar fragmentos en una base de datos, construimos un prompt
 * que incluye referencias directas a todos los archivos. Gemini los lee todos
 * y genera la evaluación basándose en ese contexto.
 *
 * ¿Qué es un prompt multi-parte?
 * Gemini acepta mensajes que combinan texto e instrucciones con referencias
 * a archivos. El array "parts" es ese mensaje: primero va el prompt de texto
 * con las instrucciones, luego los archivos del corpus, y al final el borrador.
 *
 * ¿Por qué pedimos JSON como respuesta?
 * El parámetro responseMimeType: "application/json" le indica a Gemini
 * que su respuesta debe ser JSON válido. Esto nos permite hacer JSON.parse()
 * directamente sin tener que extraer datos de texto libre.
 *
 * Los 4 pilares que evalúa:
 *   1. Desglose de Rubros — ¿el presupuesto está detallado?
 *   2. Impacto Territorial — ¿menciona comunidades concretas de Medellín?
 *   3. Cronograma — ¿tiene un plan de trabajo claro?
 *   4. Calidad Técnica — ¿es legible y profesional?
 *
 * @param draftFileUri   - URI del borrador subido a Google AI
 * @param corpusFileUris - Array de URIs de los documentos del corpus
 * @param draftName      - Nombre del archivo borrador (se menciona en el prompt)
 */
export async function analyzeDraft(draftFileUri: string, corpusFileUris: string[], draftName: string) {
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash-lite",
    });

    const prompt = `
Eres un evaluador de la organización Platohedro.
Estás validando una nueva propuesta (borrador: ${draftName}).
Tu tarea es evaluar este documento comparándolo contra los documentos aprobados previamente (el corpus), los cuales te proporciono como contexto.

Debes calificar la propuesta en base a 4 pilares:
1. Desglose de Rubros: No se aceptan presupuestos con "Total: $X". Debe detallar Honorarios, Materiales, Difusión e Impuestos.
2. Impacto Territorial: Debe mencionar barrios, colectivos o dinámicas específicas de Medellín que se alineen con la filosofía.
3. Cronograma de Ejecución: Debe ser una tabla clara o detallado mes a mes.
4. Calidad Técnica: Legibilidad, profesionalismo, datos legales.

Analiza el borrador provisto comparado con las buenas prácticas vistas en el corpus. Suma un puntaje del 0 al 100.
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

    // "parts" es el mensaje completo que le enviamos a Gemini.
    // Puede mezclar texto plano y referencias a archivos en la nube.
    const parts: any[] = [
      { text: prompt },
    ];

    // Agregar cada documento del corpus — Gemini los usará como referencia
    // de "cómo se ve una propuesta aprobada"
    for (const uri of corpusFileUris) {
      parts.push({
        fileData: {
          mimeType: "application/pdf",
          fileUri: uri,
        },
      });
    }

    // Agregar el borrador al final — es el documento que se va a evaluar
    parts.push({
      fileData: {
        mimeType: "application/pdf",
        fileUri: draftFileUri,
      },
    });

    const result = await model.generateContent({
      contents: [{ role: "user", parts }],
      generationConfig: {
        // Fuerza a Gemini a responder solo con JSON válido — sin texto extra
        responseMimeType: "application/json",
      },
    });

    const responseText = result.response.text();
    // JSON.parse convierte el string JSON en un objeto JavaScript
    return { success: true, data: JSON.parse(responseText) };
  } catch (error: any) {
    console.error("Error analyzing draft:", error);
    return { success: false, error: error.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * chatWithModel — Responde preguntas del usuario sobre el borrador
 *
 * Una vez analizado el borrador, el usuario puede hacer preguntas libres.
 * Esta función construye el prompt incluyendo:
 *   - El historial de conversación (para que Gemini recuerde lo hablado)
 *   - Los archivos del corpus y el borrador como contexto
 *   - La nueva pregunta del usuario
 *
 * ¿Por qué pasamos el historial manualmente?
 * Las Server Actions de Next.js no tienen estado entre llamadas — cada
 * ejecución es independiente. Para simular una conversación continua,
 * el frontend guarda el historial en su estado (useState) y lo envía
 * completo en cada petición. Gemini recibe toda la conversación de una vez.
 *
 * @param question       - La nueva pregunta del usuario
 * @param chatHistory    - Mensajes anteriores: [{role: "user"|"assistant", content: "..."}]
 * @param draftFileUri   - URI del borrador en Google AI Studio
 * @param corpusFileUris - URIs de los documentos del corpus seleccionados
 */
export async function chatWithModel(
  question: string,
  chatHistory: { role: string; content: string }[],
  draftFileUri: string,
  corpusFileUris: string[]
) {
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash-lite",
    });

    // Convertir el array de mensajes a texto plano para incluirlo en el prompt.
    // Si no hay historial, esta variable queda vacía y no afecta el prompt.
    const formattedHistory = chatHistory.length > 0
      ? "Historial de la conversación:\n" + chatHistory.map(msg => `${msg.role === 'user' ? 'Usuario' : 'Asistente'}: ${msg.content}`).join("\n") + "\n\n"
      : "";

    const prompt = `
Eres un asesor experto de la organización Platohedro.
El usuario ha subido un borrador de propuesta para ser evaluado y está haciendo preguntas abiertas sobre él.
Tienes a tu disposición el documento borrador actual y varios documentos del corpus ("buenas prácticas" o ganadores).
Tu objetivo es responder de manera clara, amigable y precisa basándote EN LOS DOCUMENTOS PROPORCIONADOS.

${formattedHistory}
Pregunta actual del usuario: ${question}

Instrucciones:
- Responde directamente a la pregunta usando el contexto brindado.
- Si sugieres mejoras, sé específico refiriéndote a secciones del borrador.
- Utiliza un tono profesional pero accesible.
- Tu respuesta debe ser texto plano o markdown amigable para el lector, no necesitas devolver un JSON.
`;

    const parts: any[] = [{ text: prompt }];

    for (const uri of corpusFileUris) {
      parts.push({
        fileData: {
          mimeType: "application/pdf",
          fileUri: uri,
        },
      });
    }

    parts.push({
      fileData: {
        mimeType: "application/pdf",
        fileUri: draftFileUri,
      },
    });

    const result = await model.generateContent({
      contents: [{ role: "user", parts }],
    });

    const responseText = result.response.text();
    return { success: true, data: responseText };
  } catch (error: any) {
    console.error("Error during chat:", error);
    return { success: false, error: error.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * deleteAllFilesFromGoogleAI — Elimina todos los archivos de la cuenta
 *
 * Google AI Studio tiene una cuota de almacenamiento por cuenta. Esta función
 * borra todos los archivos subidos para liberar espacio y empezar de cero.
 *
 * ¿Por qué iterar uno a uno?
 * La API de Google no tiene un endpoint de "borrar todo". Solo permite borrar
 * archivos individualmente, así que recorremos la lista y borramos cada uno.
 *
 * Retorna cuántos archivos fueron eliminados, útil para mostrar feedback al usuario.
 */
export async function deleteAllFilesFromGoogleAI() {
  try {
    const listResult = await fileManager.listFiles();
    let deletedCount = 0;

    if (listResult.files && listResult.files.length > 0) {
      for (const file of listResult.files) {
        await fileManager.deleteFile(file.name);
        deletedCount++;
      }
    }

    return { success: true, count: deletedCount };
  } catch (error: any) {
    console.error("Error deleting files:", error);
    return { success: false, error: error.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * listGoogleAIFiles — Lista todos los archivos activos en Google AI Studio
 *
 * Cuando el usuario recarga la página, la interfaz necesita saber qué
 * documentos del corpus ya están subidos para mostrarlos sin pedirle
 * que los suba de nuevo. Esta función consulta la API y retorna el listado.
 *
 * Concepto clave — URI vs nombre:
 * - "name" es el identificador interno de la API (ej. "files/abc123")
 *   y se usa para operaciones como borrar el archivo.
 * - "uri" es la dirección completa del archivo y se usa en los prompts
 *   de analyzeDraft y chatWithModel para referenciar el contenido.
 */
export async function listGoogleAIFiles() {
  try {
    const listResult = await fileManager.listFiles();
    const files = listResult.files?.map(f => ({
      uri: f.uri,
      displayName: f.displayName || f.name,
      name: f.name
    })) || [];
    return { success: true, files };
  } catch (error: any) {
    console.error("Error listing files:", error);
    return { success: false, error: error.message };
  }
}

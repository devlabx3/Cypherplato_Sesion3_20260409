"use server";

import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager } from "@google/generative-ai/server";
import { tmpdir } from "os";
import { join } from "path";
import { writeFile, unlink } from "fs/promises";
import { v4 as uuidv4 } from "uuid";

const apiKey = process.env.GOOGLE_API_KEY!;
const fileManager = new GoogleAIFileManager(apiKey);
const genAI = new GoogleGenerativeAI(apiKey);

/**
 * Verifica la conectividad básica con la API de Gemini realizando una llamada de tipo "ping".
 * Sirve como un rápido control de salud (health check) al cargar la aplicación.
 * @returns Object indicating success or failure of the connection.
 */
export async function checkGeminiConnection() {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
    // Llamada casi instantánea para asegurarnos de que la apiKey y la red funcionan
    await model.generateContent("ping");
    return { success: true };
  } catch (error: any) {
    console.error("Error connecting to Gemini:", error);
    return { success: false, error: error.message };
  }
}


/**
 * Sube un archivo PDF local temporalmente a la nube usando `GoogleAIFileManager`.
 * Este archivo luego puede ser referenciado mediante su URI en prompts de Gemini.
 * Se asegura de guardar el archivo localmente primero (requerido por el SDK) y borrarlo tras la subida exitosa.
 * @param formData FormData containing the 'file' to upload.
 * @returns Object with the uploaded file metadata (fileId, displayName, uri) or an error.
 */
export async function uploadToGoogleAI(formData: FormData) {
  try {
    const file = formData.get("file") as File;
    if (!file) {
      throw new Error("No file provided");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const tempPath = join(tmpdir(), `${uuidv4()}-${file.name}`);
    
    await writeFile(tempPath, buffer);

    const uploadResponse = await fileManager.uploadFile(tempPath, {
      mimeType: file.type,
      displayName: file.name,
    });

    // Clean up local temp file
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

/**
 * Compara y evalúa un borrador de propuesta contra un conjunto de documentos base (corpus).
 * Implementa el patrón Zero-Infra RAG: enviando las URIs nativas de Google AI sin depender de bases de datos vectoriales.
 * Retorna siempre un JSON con las calificaciones de los 4 pilares establecidos.
 * @param draftFileUri URI del documento borrador subido.
 * @param corpusFileUris Array de URIs correspondientes a los documentos de éxito (Corpus).
 * @param draftName Nombre original del archivo borrador.
 * @returns Un objeto JSON parseado con la estructura de calificación definida en el prompt.
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

    const parts: any[] = [
      { text: prompt },
    ];

    // Add Corpus files
    for (const uri of corpusFileUris) {
      parts.push({
        fileData: {
          mimeType: "application/pdf",
          fileUri: uri,
        },
      });
    }

    // Add Draft file
    parts.push({
      fileData: {
        mimeType: "application/pdf",
        fileUri: draftFileUri,
      },
    });

    const result = await model.generateContent({
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const responseText = result.response.text();
    return { success: true, data: JSON.parse(responseText) };
  } catch (error: any) {
    console.error("Error analyzing draft:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Genera una interacción conversacional (chat) sobre el borrador y el corpus.
 * Mantiene la memoria pasando el historial en el prompt e inyecta los archivos relevantes como contexto.
 * @param question La nueva pregunta lanzada por el usuario.
 * @param chatHistory El array de mensajes previos para la continuidad de la conversación.
 * @param draftFileUri El URI (referencia) al borrador actual.
 * @param corpusFileUris Las URIs de la base de conocimiento cargada en la sesión.
 * @returns Una respuesta textual natural del modelo respondiendo la duda específica.
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

    // Formatting history for prompt
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

    // Add Corpus files
    for (const uri of corpusFileUris) {
      parts.push({
        fileData: {
          mimeType: "application/pdf",
          fileUri: uri,
        },
      });
    }

    // Add Draft file
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

/**
 * Funcionalidad utilitaria para purgar permanentemente la base documental remota vinculada a la API Key.
 * Esto asegura que ya no haya rastros en Google AI Studio de los archivos cargados, liberando cuota.
 * @returns Resultado booleano de éxito e información numérica de cuántos archivos fueron borrados.
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

/**
 * Recupera la lista completa de archivos alojados actualmente en Google AI Studio bajo esta cuenta.
 * Resulta clave para la "rehidratación" visual de la interfaz si el usuario recarga la página, 
 * evitando subidas duplicadas del mismo RAG.
 * @returns Array de objetos con URI, nombre clave y nombre para mostrar de cada documento.
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

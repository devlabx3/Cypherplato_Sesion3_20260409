# Arquitectura: Validador Platohedro con RAG Híbrido (ChromaDB + Memoria)

## Modelo de Almacenamiento

El sistema usa **dos almacenes distintos** según el tipo de documento:

| Tipo | Almacén | Persistencia | Motivo |
|------|---------|-------------|--------|
| Corpus (referencia) | ChromaDB (Docker) | Permanente | Documentos aprobados reutilizables entre sesiones |
| Borrador/Licitación | `draftStore` (RAM) | Solo sesión actual | No contamina el corpus; privacidad del evaluado |

## Servicios Docker

| Servicio | Imagen | Puerto | Propósito |
|----------|--------|--------|-----------|
| `chromadb` | `chromadb/chroma:latest` | 8000 | Base de datos vectorial del corpus |

> No hay microservicio de extracción de PDFs. La conversión y el chunking ocurren directamente dentro del servidor de Next.js mediante llamadas a `gemini-2.5-flash-lite`.

## Flujo de Trabajo

1. **Gestión de Conocimiento (Corpus):**
   - El Admin sube los PDFs de licitaciones ganadoras via `CorpusZone` → `addDocumentToVectorStore()`.
   - El PDF se convierte a base64 y se envía a `gemini-2.5-flash-lite` como `inlineData`.
   - Gemini analiza la estructura del documento y devuelve un JSON `{ sections: [{title, content}] }` donde cada sección es un bloque semántico completo: párrafo entero, tabla completa, lista completa. **Nunca parte contenido a mitad.**
   - Se generan embeddings con `gemini-embedding-001` para cada sección (en batches de 10) y se indexan en ChromaDB (colección `rag_corpus`).
   - La lista de documentos del corpus se recupera leyendo los metadatos de ChromaDB al cargar la app.

2. **Carga del Borrador (Usuario):**
   - El usuario sube su PDF via `AnalyzerZone` → `uploadDraft()`.
   - Mismo pipeline: inlineData → JSON de secciones → embeddings.
   - Los chunks y embeddings se guardan en el `Map` en memoria `draftStore` bajo un UUID único.
   - **Nunca se escribe nada en ChromaDB.**

3. **Proceso de Validación:**
   - `analyzeDraft()` recupera el texto completo del borrador desde `draftStore`.
   - Embede los primeros 1000 caracteres del borrador y busca en ChromaDB los 15 fragmentos del corpus más relevantes (búsqueda semántica).
   - Construye un prompt con el contexto del corpus y el texto del borrador, y llama a `gemini-2.5-flash-lite` con `responseMimeType: "application/json"`.

4. **Interacción Continua (Chat):**
   - `chatWithModel()` embede la pregunta del usuario.
   - Busca los 5 chunks más relevantes del borrador usando cosine similarity sobre `draftStore`.
   - Busca los 5 chunks más relevantes del corpus en ChromaDB.
   - Combina ambos contextos e invoca a `gemini-2.5-flash-lite`.

5. **Gestión y Limpieza del Corpus:**
   - El botón X en cada documento llama a `removeDocumentFromVectorStore(fileId)` que elimina todos los chunks de ese archivo en ChromaDB.
   - El botón "Vaciar Nube" llama a `clearVectorStore()` que ejecuta `chromaClient.deleteCollection("rag_corpus")`.
   - Los borradores en memoria (`draftStore`) no se ven afectados al vaciar el corpus.
   - El borrador en memoria se descarta automáticamente al subir uno nuevo o al reiniciar el servidor.

## Pipeline de Extracción y Chunking

```
PDF (File)
  │
  ▼ Buffer.from(arrayBuffer).toString("base64")
inlineData base64  (mimeType: application/pdf)
  │
  ▼ generateContent() con responseMimeType: "application/json"
gemini-2.5-flash-lite
  │
  │  Prompt: identifica secciones semánticas naturales
  │  → JSON { sections: [ {title, content}, ... ] }
  │
  │  Cada sección = bloque semántico completo:
  │    - Párrafo entero
  │    - Tabla completa
  │    - Lista completa
  │    - Sección con título + contenido
  │  NUNCA parte un bloque a mitad
  │
  ▼ string[]  (title + "\n\n" + content por sección)
localAi.ts — extractChunksWithGemini()
  │
  ▼ embedTexts()  →  gemini-embedding-001  →  number[][]  (3072D, batches de 10)
  │
  ▼
ChromaDB (corpus)  ─ ó ─  draftStore en RAM (borrador)
```

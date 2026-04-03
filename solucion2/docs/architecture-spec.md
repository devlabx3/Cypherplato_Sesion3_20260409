# Arquitectura: Validador Platohedro con RAG Híbrido (ChromaDB + Memoria)

## Modelo de Almacenamiento

El sistema usa **dos almacenes distintos** según el tipo de documento:

| Tipo | Almacén | Persistencia | Motivo |
|------|---------|-------------|--------|
| Corpus (referencia) | ChromaDB (Docker) | Permanente | Documentos aprobados reutilizables entre sesiones |
| Borrador/Licitación | `draftStore` (RAM) | Solo sesión actual | No contamina el corpus; privacidad del evaluado |

## Flujo de Trabajo

1. **Gestión de Conocimiento (Corpus):**
   - El Admin sube los PDFs de licitaciones ganadoras via `CorpusZone` → `uploadToGoogleAI()`.
   - El texto se extrae con `pdf-parse`, se divide en chunks con `RecursiveCharacterTextSplitter` (1000 chars, overlap 200).
   - Se generan embeddings con `gemini-embedding-001` y se indexan en ChromaDB (colección `rag_corpus`).
   - La lista de documentos del corpus se recupera leyendo los metadatos de ChromaDB al cargar la app.

2. **Carga del Borrador (Usuario):**
   - El usuario sube su PDF via `AnalyzerZone` → `uploadDraft()`.
   - Se extrae texto, se genera chunking y embeddings igual que el corpus.
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
   - El botón "Vaciar Nube" llama a `deleteAllFilesFromGoogleAI()` que ejecuta `chromaClient.deleteCollection("rag_corpus")`.
   - El borrador en memoria se descarta automáticamente al subir uno nuevo o al reiniciar el servidor.
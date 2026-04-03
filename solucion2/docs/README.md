# Documentación Solución 2

Esta carpeta contiene la documentación sobre la implementación de RAG híbrido usando ChromaDB, memoria del servidor y Gemini 2.5 Flash Lite.

## Arquitectura

- **Base de Datos Vectorial (Corpus)**: `chromadb` v3 corriendo en Docker (`localhost:8000`). Almacena los documentos de referencia aprobados de forma persistente.
- **Almacenamiento del Borrador**: `Map` en memoria del servidor (`draftStore`). El borrador/licitación a evaluar se guarda solo en RAM — nunca toca ChromaDB.
- **Procesamiento de PDF**: `pdf-parse` v1.1.1 para extracción de texto + `RecursiveCharacterTextSplitter` de `@langchain/textsplitters` para chunking.
- **Embeddings**: `gemini-embedding-001` vía SDK directo `@google/generative-ai`. No se usa el wrapper `@langchain/google-genai` (presenta bug que retorna vectores vacíos).
- **Búsqueda semántica en borrador**: Cosine similarity implementada localmente sobre los chunks en memoria.
- **Generación Textual**: `gemini-2.5-flash-lite` a través del SDK `@google/generative-ai`.

## Archivos de documentación

- [architecture-spec.md](architecture-spec.md) — Flujo completo del sistema RAG híbrido.
- [tech-spec.md](tech-spec.md) — Dependencias, configuración y patrones de código.
- [business-rules.md](business-rules.md) — Reglas de evaluación y pilares de Platohedro.

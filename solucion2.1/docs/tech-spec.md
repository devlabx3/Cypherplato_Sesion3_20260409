# Especificación Técnica

## Dependencias clave

El proyecto requiere estas dependencias principales de IA/vectores:

- **`chromadb`** — cliente para la base de datos vectorial local que almacena el corpus permanente
- **`@google/generative-ai`** — SDK directo de Google para enviar PDFs como `inlineData`, generar embeddings e invocar el modelo de lenguaje

> `@langchain/textsplitters` y `@langchain/google-genai` **no forman parte del pipeline activo**. No se usa ningún splitter externo — el chunking lo hace Gemini de forma nativa. `@langchain/google-genai` fue descartado porque `embedDocuments()` retornaba arrays vacíos.

---

## Configuración de Next.js

La propiedad `serverExternalPackages` en `next.config.ts` debe permanecer como array vacío. Esto permite que los módulos de IA (`chromadb`, `@google/generative-ai`) corran directamente en el servidor de Next.js sin ser procesados por el bundler de Webpack, evitando incompatibilidades en tiempo de compilación.

La extracción y chunking de PDFs ocurre completamente dentro del servidor de Next.js mediante llamadas a `gemini-2.5-flash-lite` — no se delega a ningún microservicio externo.

---

## Configuración de embeddings

Los embeddings se generan usando el SDK `@google/generative-ai` directamente, sin capas de abstracción intermedias. El modelo es **`gemini-embedding-001`**, que produce vectores de **3072 dimensiones**.

> El modelo `text-embedding-004` no está disponible con la API key actual del proyecto — no debe usarse.

La función `embedTexts()` acepta un arreglo de textos y retorna un arreglo de vectores numéricos. Para evitar rate limits, procesa los textos en **batches de 10** usando `Promise.all()` por batch.

---

## Procesamiento de PDF y chunking semántico

El procesamiento de PDFs ocurre en un único llamado a Gemini, dentro de `src/actions/localAi.ts`:

**Función:** `extractChunksWithGemini(file: File): Promise<string[]>`

1. **PDF → base64:** El archivo se lee como `ArrayBuffer` y se convierte a base64.

2. **Envío a Gemini como `inlineData`:** El base64 se pasa a `gemini-2.5-flash-lite` con `mimeType: "application/pdf"`. El SDK `@google/generative-ai` v0.24 soporta `inlineData` para archivos hasta ~20MB.

3. **Chunking semántico por Gemini:** El prompt instrucye a Gemini a identificar las secciones semánticas naturales del documento y devolverlas como JSON estructurado:
   ```json
   {
     "sections": [
       { "title": "Nombre de la sección", "content": "Texto completo..." },
       ...
     ]
   }
   ```
   Se usa `responseMimeType: "application/json"` para garantizar JSON válido en la respuesta.

4. **Garantías del chunking:**
   - Cada sección es un bloque semántico **completo**: párrafo entero, tabla completa, lista completa.
   - **Nunca** se parte una tabla, lista o párrafo en dos secciones distintas.
   - El texto se conserva exacto, sin resúmenes ni paráfrasis.
   - Si el documento tiene títulos de sección, se usan como `title`; si no, Gemini describe el bloque brevemente.

5. **Formato de salida:** Cada elemento del array resultante combina `title + "\n\n" + content`, listo para ser vectorizado.

Este mismo pipeline aplica tanto para documentos del corpus como para borradores.

> **Ventaja clave:** a diferencia de los splitters de longitud fija, Gemini entiende la semántica del documento y respeta sus límites naturales — una tabla de presupuesto nunca queda partida entre dos chunks.

---

## Store en memoria para borradores

Cuando el usuario sube un PDF borrador desde `AnalyzerZone`, este pasa exactamente por el mismo pipeline que el corpus (inlineData → secciones JSON → embeddings). Sin embargo, los chunks resultantes **nunca se escriben en ChromaDB** — se almacenan en un mapa en memoria del servidor (`draftStore` en `localAi.ts`) bajo un identificador UUID único.

Cada entrada del mapa asocia el nombre del archivo con su lista de chunks, donde cada chunk contiene el texto y su vector de embedding correspondiente.

La búsqueda semántica sobre el borrador se realiza localmente calculando la **similitud coseno** entre el vector de la consulta y los vectores almacenados en memoria, ordenando por puntuación y retornando los fragmentos más relevantes.

> Los borradores en memoria se descartan al subir un nuevo borrador o al reiniciar el servidor — no hay persistencia deliberada.

---

## Gestión de ChromaDB (solo corpus)

ChromaDB se usa exclusivamente para los documentos del corpus (propuestas históricas exitosas). Se ejecuta localmente mediante el `docker-compose.yml` incluido en el proyecto y escucha en `http://localhost:8000`.

La colección vectorial se llama **`rag_corpus`**. Las operaciones clave son:

- **Agregar documentos:** se pasan los IDs, los vectores de embedding, los textos y los metadatos (`fileId`, nombre del archivo)
- **Consultar:** se buscan los **15 fragmentos más relevantes** por similitud semántica, pasando el vector de la consulta directamente
- **Eliminar documento individual:** `removeDocumentFromVectorStore(fileId)` elimina todos los chunks con ese `fileId`
- **Vaciar corpus:** se elimina la colección completa (`rag_corpus`) vía `clearVectorStore()`

Los embeddings se pasan como vectores numéricos precalculados — ChromaDB no genera embeddings propios en este proyecto.

---

## Variables de entorno

Solo se requiere una variable:

```env
GOOGLE_API_KEY=tu_api_key_aqui
```

No hay `MARKER_SERVICE_URL` ni ninguna otra variable de entorno de servicios externos.

---

## Arquitectura general

Este documento cubre las decisiones técnicas de dependencias y configuración. Para el flujo completo del sistema RAG híbrido (corpus persistente + borradores en memoria), incluyendo los pasos de ingesta, análisis y chat, consultar [architecture-spec.md](architecture-spec.md).

Para arrancar todos los servicios en local:

```bash
docker compose up -d   # solo levanta chromadb
npm run dev
```

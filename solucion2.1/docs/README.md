# Solución 2.1 — Validador de Propuestas Platohedro

Aplicación Next.js que evalúa borradores de propuestas PDF comparándolos contra un corpus de documentos aprobados, usando RAG híbrido con ChromaDB y Gemini 2.5 Flash Lite.

## Qué hace

1. **Corpus:** el administrador sube PDFs de propuestas ganadoras. Se procesan, vectorizan y persisten en ChromaDB.
2. **Borrador:** el usuario sube su propuesta en PDF. Se vectoriza y guarda solo en memoria RAM (nunca toca ChromaDB).
3. **Análisis:** la app busca en el corpus los fragmentos más relevantes al borrador y le pide a Gemini que evalúe 4 pilares con puntuación 0-100.
4. **Chat:** tras el análisis, el usuario puede hacer preguntas libres; el sistema recupera contexto del borrador y del corpus para responder.

## Requisitos previos

- Node.js 20+
- Docker (para ChromaDB y marker-service)
- API Key de Google Gemini con acceso a `gemini-2.5-flash-lite`, `gemini-2.0-flash-lite` y `gemini-embedding-001`

## Puesta en marcha

**1. Variables de entorno**

Crear un archivo `.env` en la raíz de `solucion2.1/`:

```
GOOGLE_API_KEY=tu_api_key_aquí
MARKER_SERVICE_URL=http://localhost:8001
```

**2. Levantar servicios Docker**

```bash
docker compose up -d
```

Levanta dos servicios:
- **ChromaDB** en `http://localhost:8000` — base de datos vectorial del corpus
- **marker-service** en `http://localhost:8001` — extracción de PDF a chunks con Gemini híbrido

> La primera vez, marker-service descarga los modelos ML (~2-4 GB). Esperar hasta ver `Application startup complete` en los logs:
> ```bash
> docker compose logs -f marker-service
> ```

**3. Instalar dependencias**

```bash
npm install
```

**4. Iniciar la app**

```bash
npm run dev
```

Abrir [http://localhost:3000](http://localhost:3000).

## Arquitectura

- **Base de Datos Vectorial (Corpus):** ChromaDB v3 en Docker (`localhost:8000`). Almacena propuestas aprobadas de forma persistente en la colección `rag_corpus`.
- **Almacenamiento del Borrador:** `Map` en memoria del servidor (`draftStore`). El borrador se guarda solo en RAM — nunca toca ChromaDB — y se pierde al reiniciar el proceso.
- **Procesamiento de PDF:** microservicio Docker `marker-service` (puerto 8001) que corre marker-pdf en modo híbrido con **Gemini 2.0 Flash Lite**. Retorna bloques nativos del documento (párrafos, tablas, listas) como chunks directos — sin splitter manual.
- **Embeddings:** `gemini-embedding-001` vía SDK directo `@google/generative-ai`. `@langchain/google-genai` no forma parte del proyecto (fue removido por un bug que retornaba vectores vacíos).
- **Búsqueda semántica en borrador:** cosine similarity implementada localmente sobre los chunks en memoria.
- **Generación textual:** `gemini-2.5-flash-lite` a través del SDK `@google/generative-ai`.

## Documentación adicional

- [architecture-spec.md](architecture-spec.md) — Flujo completo del sistema RAG híbrido.
- [tech-spec.md](tech-spec.md) — Dependencias, configuración y patrones de código.
- [business-rules.md](business-rules.md) — Reglas de evaluación y pilares de Platohedro.

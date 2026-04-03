# CypherplatoSesion3

Repositorio de soluciones RAG para la validación documental de licitaciones de **PlatoHedro**. Cada solución explora un enfoque distinto de Retrieval-Augmented Generation (RAG), desde infraestructura cero hasta bases de datos vectoriales locales.

---

## Soluciones

| Carpeta | Enfoque RAG | Modelo IA | Infraestructura |
|---|---|---|---|
| [`solucion1/`](solucion1/) | Zero-Infra RAG (Google AI File API) | Gemini 2.5 Flash-Lite | Sin DB vectorial externa |
| [`solucion2/`](solucion2/) | RAG Híbrido con ChromaDB (corpus) + RAM (borrador) | Gemini 2.5 Flash-Lite + gemini-embedding-001 | ChromaDB vía Docker |
| [`solucion3/`](solucion3/) | RAG con Contextual.ai | — | En desarrollo |

---

## Solucion1 — Zero-Infra RAG con Google AI File API

Valida borradores de licitación comparándolos contra un corpus de propuestas históricas exitosas, sin necesidad de una base de datos vectorial. Delega el almacenamiento y recuperación de contexto directamente a la nube de Google AI Studio.

**Stack:** Next.js 16.2 · React 19 · TailwindCSS · `@google/generative-ai`

**Flujo:**
1. Los PDFs del corpus se suben a Google AI File API (`GoogleAIFileManager`).
2. El borrador se envía junto con los URIs del corpus a Gemini 2.5 Flash-Lite.
3. El modelo devuelve un JSON estructurado con calificación (Aprobado / Ajustar / Rechazado) y sugerencias.
4. El evaluador puede continuar con un chat interactivo contextualizado.

**Arranque:**
```bash
cd solucion1
cp .env.example .env   # agregar GOOGLE_API_KEY
npm install
npm run dev            # http://localhost:3000
```

---

## Solucion2 — RAG Híbrido con ChromaDB y Gemini

Misma funcionalidad que `solucion1`, pero con un pipeline RAG completamente local. Los documentos del corpus se trocean, vectorizan y almacenan en ChromaDB. Los borradores se mantienen solo en memoria RAM (nunca tocan ChromaDB). En cada consulta se recuperan los fragmentos más relevantes de ambas fuentes antes de llamar a Gemini, reduciendo el consumo de tokens.

**Stack:** Next.js · TailwindCSS · `chromadb` · `pdf-parse` · `@langchain/textsplitters` · `@google/generative-ai`

**Flujo:**
1. Los PDFs del corpus se parsean con `pdf-parse` y se trocean con `RecursiveCharacterTextSplitter` (chunks de 1000 chars, overlap 200).
2. Cada chunk se vectoriza con `gemini-embedding-001` y se indexa en ChromaDB (Docker), colección `rag_corpus`.
3. El borrador se vectoriza igual pero se guarda solo en memoria RAM (`draftStore`), nunca en ChromaDB.
4. Al analizar, se recuperan los 15 chunks más relevantes del corpus (ChromaDB) y se busca por cosine similarity en el borrador (memoria).
5. El contexto reducido + borrador se envían a Gemini 2.5 Flash-Lite, que devuelve un JSON con puntuación y 4 pilares.

**Arranque:**
```bash
cd solucion2
cp .env.example .env   # agregar GOOGLE_API_KEY
npm install
docker compose up -d   # iniciar ChromaDB en localhost:8000
npm run dev            # http://localhost:3000
```

---

## Solucion3 — Contextual.ai *(en desarrollo)*

Exploración de RAG con el servicio [Contextual.ai](https://contextual.ai). Ver [`solucion3/README.md`](solucion3/README.md).

---

## Requisitos Comunes

- Node.js >= 18
- Una `GOOGLE_API_KEY` válida de [Google AI Studio](https://aistudio.google.com/)
- Docker (solo para `solucion2`)

## Variables de Entorno

Cada solución requiere un archivo `.env` en su raíz (nunca se sube al repositorio):

```env
GOOGLE_API_KEY="AIzaSy...tu_clave_de_google_ai_studio..."
```

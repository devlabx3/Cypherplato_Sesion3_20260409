# CypherplatoSesion3

Repositorio de soluciones RAG para la validación documental de licitaciones de **PlatoHedro**. Cada solución explora un enfoque distinto de Retrieval-Augmented Generation (RAG), desde infraestructura cero hasta bases de datos vectoriales locales.

---

## Soluciones

| Carpeta | Enfoque RAG | Modelo IA | Infraestructura |
|---|---|---|---|
| [`solucion1/`](solucion1/) | Zero-Infra RAG (Google AI File API) | Gemini 2.5 Flash-Lite | Sin DB vectorial externa |
| [`solucion2/`](solucion2/) | RAG Local Avanzado con ChromaDB | Gemini 2.5 Flash-Lite + text-embedding-004 | ChromaDB vía Docker |
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

## Solucion2 — RAG Local con ChromaDB y Gemini

Misma funcionalidad que `solucion1`, pero con un pipeline RAG completamente local. Los documentos del corpus se trocean, vectorizan y almacenan en ChromaDB. En cada consulta se recuperan solo los fragmentos más relevantes antes de llamar a Gemini, reduciendo el consumo de tokens.

**Stack:** Next.js 16.2 · TailwindCSS · `chromadb` · `pdf-parse` · LangChain · `@google/generative-ai`

**Flujo:**
1. Los PDFs del corpus se parsean con `pdf-parse` y se trocean con `RecursiveCharacterTextSplitter`.
2. Cada chunk se vectoriza con `text-embedding-004` y se indexa en ChromaDB (Docker).
3. Al analizar un borrador se hace búsqueda bidireccional en ChromaDB para recuperar contexto relevante.
4. El contexto reducido + borrador se envían a Gemini 2.5 Flash-Lite.

**Arranque:**
```bash
cd solucion2
cp .env.example .env   # agregar GOOGLE_API_KEY
npm install
docker-compose up -d   # iniciar ChromaDB en localhost:8000
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

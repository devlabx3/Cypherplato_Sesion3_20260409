# Validador Platohedro con ChromaDB y Gemini 2.5 Flash-Lite

Herramienta para evaluar propuestas PDF de manera automatizada, comparando borradores contra un corpus de propuestas históricas exitosas mediante un sistema **RAG híbrido**.

## Propósito

El sistema resuelve el cuello de botella de la validación humana de documentos. Actúa como experto asesor que:

1. **Analiza borradores** contra 4 pilares críticos: desglose de rubros, impacto territorial, cronograma y calidad técnica.
2. **Brinda retroalimentación** con sugerencias concretas de mejora y calificación (Aprobado / Ajustar / Rechazado).
3. **Ofrece chat contextual** apoyándose en el corpus vectorial y el borrador cargado.

## Stack Tecnológico

| Componente | Tecnología |
|-----------|-----------|
| Framework UI | Next.js 16.2 (App Router) |
| Estilos | TailwindCSS 4 |
| Base de datos vectorial | ChromaDB v3 (Docker, puerto 8000) |
| Extracción y chunking de PDF | `gemini-2.5-flash-lite` vía `inlineData` — Gemini identifica secciones semánticas nativas (párrafos, tablas, listas completas) |
| Embeddings | `gemini-embedding-001` vía `@google/generative-ai` |
| Generación textual | `gemini-2.5-flash-lite` vía `@google/generative-ai` |

> No se requiere ningún microservicio adicional ni splitter externo. Gemini hace el chunking directamente — nunca parte una tabla o párrafo a mitad.

---

## Cómo Levantar la Aplicación

**1. Variables de entorno**

Crea un archivo `.env` o `.env.local` en la raíz del proyecto con el siguiente contenido:

```env
GOOGLE_API_KEY=tu_api_key_aqui
```

> **¿Dónde obtener la API key?**  
> Ve a [Google AI Studio](https://aistudio.google.com/apikey), inicia sesión con tu cuenta de Google y genera una nueva clave. Cópiala y pégala en lugar de `tu_api_key_aqui`.
>
> **`.env` vs `.env.local`:** Next.js carga ambos archivos. Usa `.env.local` para claves personales (está en `.gitignore` por defecto y nunca se sube al repositorio). Usa `.env` solo si quieres compartir valores no secretos con el equipo.

**2. Levantar ChromaDB**

```bash
docker compose up -d
```

Levanta un solo contenedor:
- **chromadb** (`localhost:8000`) — corpus vectorial persistente

**3. Instalar dependencias Node**

```bash
npm install
```

**4. Iniciar la app**

```bash
npm run dev
```

Acceder en [http://localhost:3000](http://localhost:3000).

---

## Componentes de Interfaz

- **`src/app/page.tsx`** — estado global de `corpusFiles`, header con indicador de conexión, layout de dos zonas.
- **`CorpusZone.tsx`** — subida de PDFs al corpus (ChromaDB), listado de documentos y limpieza total.
- **`AnalyzerZone.tsx`** — subida del borrador, disparo del análisis RAG, display de los 4 pilares con puntuación, chat interactivo.

## Pipeline de Procesamiento

```
PDF (base64 inlineData)
 │
 ▼
gemini-2.5-flash-lite
 │  Identifica secciones semánticas naturales del documento
 │  Devuelve JSON: { sections: [{title, content}] }
 │  Cada sección = bloque completo (párrafo, tabla, lista)
 │  Nunca parte contenido a mitad
 │
 ▼
gemini-embedding-001  →  vectores 3072D  (batches de 10)
 │
 ├─► CORPUS: ChromaDB  rag_corpus  (persistente)
 └─► BORRADOR: draftStore Map  (RAM, solo sesión)
```

## Documentación

- [docs/architecture-spec.md](docs/architecture-spec.md) — flujo completo del sistema RAG
- [docs/tech-spec.md](docs/tech-spec.md) — decisiones técnicas y configuración
- [docs/business-rules.md](docs/business-rules.md) — pilares de evaluación Platohedro

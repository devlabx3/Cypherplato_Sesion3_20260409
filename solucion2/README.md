# Solución 2 — Validador de Propuestas con ChromaDB y Gemini

Esta solución construye un pipeline RAG completo y local. Los documentos se convierten en vectores y se guardan en ChromaDB (una base de datos que corre en tu máquina). Cuando llega una pregunta, se buscan los fragmentos más relevantes y se le pasan a Gemini como contexto.

Es el siguiente paso natural después de la Solución 1: aquí aprendes cómo funciona RAG "por dentro", sin delegar nada a la nube.

---

## ¿Qué aprenderás aquí?

- Qué son los embeddings y cómo se generan con Gemini
- Qué es ChromaDB y cómo guardar y buscar vectores en él
- Por qué se divide el texto en chunks y cómo configurarlo
- Qué es la similitud coseno y para qué sirve en búsqueda semántica
- Cómo mantener dos almacenamientos separados (corpus en DB, borrador en RAM)
- Cómo construir un prompt RAG con contexto recuperado dinámicamente

---

## Concepto clave: RAG con base vectorial local

A diferencia de la Solución 1, aquí los documentos no se envían completos a Gemini. En cambio, se fragmentan, se vectorizan, y se guardan en ChromaDB. Cuando llega una consulta, se recuperan solo los fragmentos más relevantes.

```
PDF → Texto → Chunks → Embeddings → ChromaDB
                                        ↓
Pregunta → Embedding → Búsqueda → Top 15 chunks → Gemini → Respuesta
```

**Ventaja:** el contexto que le llega a Gemini es reducido y preciso — menos tokens, menor costo, mejores respuestas.  
**Diferencia con Solución 1:** requiere Docker para correr ChromaDB.

---

## Dos almacenamientos distintos

Un detalle importante del diseño: el corpus y el borrador se guardan en lugares diferentes.

| Tipo | Dónde | Por qué |
|---|---|---|
| Corpus (propuestas aprobadas) | ChromaDB (Docker) | Persiste entre sesiones, se reutiliza |
| Borrador (propuesta nueva) | `Map` en memoria RAM | Privacidad, no contamina el corpus |

Los borradores se pierden si reinicias el servidor. Eso es intencional.

---

## Cómo está organizado el código

```
solucion2/
├── src/
│   ├── app/
│   │   └── page.tsx          # Página principal y estado global
│   ├── actions/
│   │   └── localAi.ts        # Pipeline RAG completo (solo servidor)
│   └── components/
│       ├── CorpusZone.tsx     # Subida y gestión del corpus en ChromaDB
│       └── AnalyzerZone.tsx   # Subida del borrador y análisis
└── docker-compose.yml         # Configura ChromaDB en localhost:8000
```

---

## Cómo correrlo

**1. Crea el archivo de variables de entorno**

Crea un archivo `.env` o `.env.local` en la raíz de `solucion2/` con el siguiente contenido:

```env
GOOGLE_API_KEY=tu_api_key_aqui
```

> **¿Dónde obtener la API key?**  
> Ve a [Google AI Studio](https://aistudio.google.com/apikey), inicia sesión con tu cuenta de Google y genera una nueva clave. Cópiala y pégala en lugar de `tu_api_key_aqui`.
>
> **`.env` vs `.env.local`:** Next.js carga ambos archivos. Usa `.env.local` para claves personales (está en `.gitignore` por defecto y nunca se sube al repositorio). Usa `.env` solo si quieres compartir valores no secretos con el equipo.

**2. Levanta ChromaDB con Docker**

```bash
docker compose up -d
```

ChromaDB quedará disponible en `http://localhost:8000`. Si ves un error, verifica que Docker esté corriendo.

**3. Instala las dependencias**

```bash
npm install
```

**4. Inicia la app**

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

---

## Flujo de uso

1. **Sube el corpus** — arrastra PDFs de propuestas aprobadas. Se procesan y guardan en ChromaDB.
2. **Sube el borrador** — arrastra el PDF a evaluar. Se procesa y guarda en memoria.
3. **Analiza** — se recuperan los 15 chunks más relevantes del corpus y se evalúa el borrador.
4. **Chat** — cada pregunta busca los 5 chunks más relevantes del borrador y del corpus antes de responder.

---

## Documentación adicional

- [docs/architecture-spec.md](docs/architecture-spec.md) — Flujo detallado del sistema RAG
- [docs/tech-spec.md](docs/tech-spec.md) — Decisiones técnicas y configuración
- [docs/business-rules.md](docs/business-rules.md) — Los 4 pilares de evaluación de Platohedro

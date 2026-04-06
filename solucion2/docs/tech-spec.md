# Especificación Técnica — Solución 2

## ¿Qué hace este archivo?

Define las decisiones técnicas concretas: qué librerías se usan, cómo se configuran y por qué se eligieron así. Es una referencia para entender el "cómo" detrás del "qué" que describe la arquitectura.

---

## Dependencias principales

```bash
npm install chromadb @google/generative-ai @langchain/textsplitters pdf-parse@1.1.1
```

Cada una cumple un rol específico en el pipeline:

- **`pdf-parse`** — extrae el texto plano de un archivo PDF.
- **`@langchain/textsplitters`** — divide ese texto en fragmentos más pequeños (chunks) respetando límites naturales del lenguaje.
- **`@google/generative-ai`** — convierte los chunks en vectores numéricos (embeddings) y genera las respuestas de texto.
- **`chromadb`** — guarda y busca los vectores del corpus de forma eficiente.

> Los embeddings se generan con el SDK directo de Google, **no** con `@langchain/google-genai`. Esa alternativa fue descartada porque retornaba arrays vacíos.

---

## Configuración especial de Next.js

```typescript
// next.config.ts
serverExternalPackages: ["pdf-parse"]
```

`pdf-parse` usa módulos nativos de Node.js (CommonJS) que Next.js no puede incluir en su bundle. Esta línea le dice a Next.js que deje `pdf-parse` fuera del empaquetado y lo use directamente desde Node.

---

## Cómo se generan los embeddings

Un **embedding** es una lista de números que representa el significado de un texto. Textos con significado similar producen vectores parecidos, lo que permite buscar por semántica y no solo por palabras clave.

Se usa el modelo `gemini-embedding-001`, que produce vectores de 3072 dimensiones. Cada chunk de texto pasa por este modelo antes de guardarse o compararse.

---

## Chunking: por qué dividir el texto

Los modelos tienen un límite de tokens por llamada. Además, buscar dentro de fragmentos pequeños es más preciso que buscar en documentos completos. El `RecursiveCharacterTextSplitter` divide el texto intentando respetar párrafos, oraciones y palabras — nunca corta a la mitad de una idea si puede evitarlo.

Configuración usada: chunks de 1000 caracteres con 200 de solapamiento. El solapamiento garantiza que el contexto entre dos chunks consecutivos no se pierda.

---

## Dos almacenamientos distintos

| Tipo de documento | Dónde se guarda | Por qué |
|---|---|---|
| Corpus (propuestas aprobadas) | ChromaDB (Docker, persistente) | Se reutiliza entre sesiones |
| Borrador (propuesta nueva) | `Map` en memoria RAM | Privacidad; nunca contamina el corpus |

---

## ChromaDB y Docker

ChromaDB es la base de datos vectorial que corre localmente vía Docker. Se accede en `http://localhost:8000`. Los documentos del corpus se almacenan en una colección llamada `rag_corpus`.

Arrancar con:

```bash
docker compose up -d
```

---

## Server Actions de Next.js

Todas las funciones de `localAi.ts` usan la directiva `"use server"`. Se ejecutan solo en el servidor; la API key y los datos del corpus nunca llegan al navegador.

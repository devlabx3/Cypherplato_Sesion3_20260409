# Especificación Técnica

## Dependencias clave

```bash
npm install chromadb @google/generative-ai @langchain/textsplitters pdf-parse@1.1.1
```

> **Nota:** `@langchain/google-genai` está instalado pero **no se usa para embeddings** — presenta un bug donde `embedDocuments()` retorna arrays vacíos. Se usa el SDK directo `@google/generative-ai`.

## next.config.ts

```typescript
const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse"],
};
```

`pdf-parse` es CommonJS y usa módulos nativos de Node.js; debe excluirse del bundle de Next.js.

## Configuración de embeddings (SDK directo)

```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });

async function embedTexts(texts: string[]): Promise<number[][]> {
  return Promise.all(
    texts.map(t => embeddingModel.embedContent(t).then(r => r.embedding.values))
  );
}
```

> Modelo disponible: `gemini-embedding-001` (3072 dims). `text-embedding-004` no está disponible en esta API key.

## Procesamiento de PDF y chunking

```typescript
import pdfParse from "pdf-parse";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

const pdfData = await pdfParse(buffer);
const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 200 });
const chunks = await splitter.createDocuments([pdfData.text]);
```

## Store en memoria para borradores

```typescript
interface DraftChunk { text: string; embedding: number[]; }
interface DraftEntry { displayName: string; chunks: DraftChunk[]; }
const draftStore = new Map<string, DraftEntry>();
```

Búsqueda semántica local con cosine similarity:

```typescript
function cosineSimilarity(a: number[], b: number[]): number { /* ... */ }

function searchDraftChunks(draftId: string, queryEmbedding: number[], topK: number): string[] {
  return draftStore.get(draftId)!.chunks
    .map(c => ({ text: c.text, score: cosineSimilarity(queryEmbedding, c.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(c => c.text);
}
```

## Gestión de ChromaDB (solo corpus)

```typescript
import { ChromaClient } from "chromadb";
const chromaClient = new ChromaClient({ path: "http://localhost:8000" });

// Insertar fragmentos del corpus
const collection = await chromaClient.getOrCreateCollection({ name: "rag_corpus" });
await collection.add({ ids, embeddings: vectors, metadatas, documents: texts });

// Búsqueda semántica en corpus
const results = await collection.query({ queryEmbeddings, nResults: 15, where: corpusWhere });

// Vaciar corpus
await chromaClient.deleteCollection({ name: "rag_corpus" });
```

## Infraestructura local (Docker)

ChromaDB corre vía Docker Compose (`docker-compose.yml`). Arrancar con:

```bash
docker compose up -d
```
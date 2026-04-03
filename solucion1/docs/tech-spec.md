# Especificación Técnica para Antigravity

## Integración SDK
Instalar: `npm install @google/generative-ai`

### Configuración del Modelo
```typescript
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ 
  model: "gemini-2.5-flash-lite",
  tools: [{ fileSearch: {} }] 
});
```

### Gestión de Archivos (Google AI FileManager)
Se emplea `@google/generative-ai/server` para subir, listar y eliminar archivos permanentemente:
```typescript
import { GoogleAIFileManager } from "@google/generative-ai/server";

// Listar archivos para rehidratar la Interfaz de Usuario (Control Visual)
const listResult = await fileManager.listFiles();
const files = listResult.files.map(f => ({ uri: f.uri, displayName: f.displayName || f.name }));

// Borrar iterativamente (Limpieza total de la nube)
for (const file of listResult.files) {
  await fileManager.deleteFile(file.name);
}
```
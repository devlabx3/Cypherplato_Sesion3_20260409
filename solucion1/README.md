# Solución 1 — Validador de Propuestas con Gemini

Esta solución muestra la forma más sencilla de construir un sistema RAG: sin base de datos, sin infraestructura extra. Solo subes los PDFs a la nube de Google AI y le pides a Gemini que los compare.

Es un buen punto de partida para entender cómo funciona RAG antes de agregar complejidad.

---

## ¿Qué aprenderás aquí?

- Cómo subir archivos a la nube de Google AI Studio con `GoogleAIFileManager`
- Cómo construir un prompt que incluye múltiples documentos PDF como contexto
- Cómo pedirle a Gemini que responda en formato JSON estructurado
- Cómo implementar un chat con memoria pasando el historial en el prompt
- Cómo usar Server Actions de Next.js para mantener la API key en el servidor

---

## Concepto clave: Zero-Infra RAG

En un sistema RAG clásico, los documentos se convierten en vectores y se guardan en una base de datos para buscar fragmentos relevantes. Eso requiere infraestructura.

Este enfoque es más simple: en lugar de guardar vectores, subimos los archivos PDF directamente a Google AI Studio y los referenciamos por su URI en el prompt. Gemini los lee todos como contexto.

```
Usuario sube PDF → Google AI Studio lo guarda
                         ↓
      Gemini recibe el prompt + URI del PDF
                         ↓
         Gemini evalúa y responde en JSON
```

**Ventaja:** no hay servicios extra que instalar ni mantener.  
**Limitación:** si tienes muchos documentos grandes, el costo de tokens crece.

---

## Cómo está organizado el código

```
src/
├── app/
│   └── page.tsx          # Página principal — estado global y layout
├── actions/
│   └── googleAi.ts       # Toda la lógica de IA (solo corre en el servidor)
└── components/
    ├── CorpusZone.tsx     # Zona para subir documentos de referencia
    └── AnalyzerZone.tsx   # Zona para subir el borrador y ver el resultado
```

La separación es intencional: `googleAi.ts` nunca corre en el navegador, así que la API key está siempre protegida.

---

## Cómo correrlo

**1. Crea el archivo de variables de entorno**

Crea un archivo `.env.local` en la carpeta `solucion1/` con tu API key de Google AI Studio:

```
GOOGLE_API_KEY=tu_api_key_aqui
```

Puedes obtener tu API key en [Google AI Studio](https://aistudio.google.com/apikey).

**2. Instala las dependencias**

```bash
npm install
```

**3. Inicia la app**

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

---

## Flujo de uso

1. **Sube el corpus** — arrastra PDFs de propuestas aprobadas a la zona izquierda. Quedan guardados en Google AI Studio.
2. **Sube el borrador** — arrastra el PDF a evaluar a la zona derecha.
3. **Analiza** — la app envía ambos a Gemini y muestra la calificación por pilares.
4. **Chat** — haz preguntas sobre el borrador; Gemini responde con contexto de ambos documentos.

---

## Documentación adicional

- [docs/architecture-spec.md](docs/architecture-spec.md) — Flujo detallado del sistema
- [docs/tech-spec.md](docs/tech-spec.md) — Decisiones técnicas y configuración
- [docs/business-rules.md](docs/business-rules.md) — Los 4 pilares de evaluación de Platohedro

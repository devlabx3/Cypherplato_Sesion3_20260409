# Especificación Técnica — Solución 1

## ¿Qué hace este archivo?

Define las decisiones técnicas concretas: qué librerías se usan, cómo se configuran y por qué se eligieron así. Es una referencia para entender el "cómo" detrás del "qué" que describe la arquitectura.

---

## SDK de Google AI

La comunicación con Gemini se hace a través del paquete oficial `@google/generative-ai`. Expone dos cosas que usamos:

- **`GoogleGenerativeAI`** — para enviar prompts y recibir respuestas del modelo de lenguaje.
- **`GoogleAIFileManager`** — para subir, listar y eliminar archivos en la nube de Google AI Studio.

La API key se lee siempre desde variables de entorno (`process.env.GOOGLE_API_KEY`), nunca se escribe directamente en el código.

---

## Gestión de archivos en la nube

Google AI Studio permite guardar archivos PDF y referenciarlos por su URI en cualquier prompt. Esto elimina la necesidad de una base de datos vectorial: Google se encarga de almacenar y servir el contenido.

Las operaciones que usamos:

- **Subir** un archivo: se guarda temporalmente en `/tmp` del servidor (requerido por el SDK), se sube a la nube y luego se borra el temporal.
- **Listar** archivos: permite que la interfaz muestre qué documentos están activos sin que el usuario tenga que subirlos de nuevo.
- **Eliminar** archivos: limpia la cuota de la cuenta y reinicia el ciclo de evaluación.

---

## Modelo de lenguaje

Se usa `gemini-2.5-flash-lite` para todas las generaciones de texto. Es el modelo de Gemini optimizado para respuestas rápidas y bajo costo de tokens, adecuado para prototipos y aplicaciones de evaluación como esta.

---

## Patrón Zero-Infra RAG

En lugar de convertir documentos a vectores y guardarlos en una base de datos, se envían directamente los URIs de los archivos como parte del prompt. Gemini los lee y los usa como contexto.

Ventaja: no hay infraestructura extra que mantener.
Desventaja: si hay muchos documentos grandes, el costo de tokens puede crecer.

---

## Server Actions de Next.js

Todas las funciones de `googleAi.ts` usan la directiva `"use server"`. Esto significa que se ejecutan solo en el servidor de Node.js, nunca en el navegador. La API key nunca llega al cliente.

# Validador Platohedro con Gemini 2.5 Flash-Lite

Este proyecto es una herramienta diseñada para evaluar propuestas y proyectos (borradores) de manera automatizada. Su principal objetivo es asistir a miembros de la organización a comparar propuestas entrantes contra un conjunto de propuestas históricas exitosas, utilizando Inteligencia Artificial para emitir juicios rápidos y ofrecer orientación guiada.

## 🎯 Propósito del Ejemplo
El sistema resuelve un problema de cuello de botella en la validación humana de documentos. La aplicación actúa como un experto asesor que:
1. **Analiza borradores** contra pilares críticos (desglose de rubros, impacto territorial, cronograma, calidad técnica).
2. **Brinda Retroalimentación**, generando sugerencias concretas de mejora y asignando una calificación (Aprobado, Ajustar, Rechazado).
3. **Ofrece un Chat Contextual (Zero-Infra RAG)** en el que el evaluador puede mantener una comunicación abierta con el modelo, haciendo preguntas iterativas sobre el documento actual apoyado en el repositorio de éxito ("corpus").

## 🛠️ Stack Tecnológico Usado
Esta aplicación moderna está construida con el siguiente stack:
- **[Next.js 16.2 (App Router)](https://nextjs.org/)**: Framework principal para React. Permite utilizar tanto componentes de cliente interactivos como *Server Actions* de forma integrada.
- **[React 19](https://react.dev/)**: Para el manejo iterativo de interfaces y control del DOM.
- **[TailwindCSS](https://tailwindcss.com/)**: Encargado del diseño visual, con soporte nativo para *Modo Oscuro/Claro* y prototipado veloz.
- **`lucide-react`**: Biblioteca de iconografía dinámica y ligera.
- **`@google/generative-ai`**: El SDK Oficial de Google para interactuar de forma impecable con el servicio de Inteligencia Artificial (Gemini).

---

## 🏗️ Cómo fue Diseñado: Componentes de Interfaz

La aplicación sigue un flujo amigable y segmentado en dos zonas principales administradas por componentes aislados pero comunicados por su elemento padre `page.tsx`.

1. **`src/app/page.tsx`**: Es la raíz de la interfaz. Mantiene el estado global de todos los archivos (`corpusFiles`) verificados y carga la conexión inicial del servidor (validación tipo "ping" hacia Gemini).
2. **`CorpusZone.tsx`**: Administra los "Documentos de Éxito". En este componente los administradores pueden añadir los PDFs base. Está diseñado para hidratarse automáticamente leyendo los archivos presentes en el Cloud de Google AI Studio, y tiene el control total para reiniciar (Vaciar Nube) tu ciclo RAG.
3. **`AnalyzerZone.tsx`**: Aquí sucede la magia principal. Recibe el borrador del usuario, despliega la animación de análisis, presenta la calificación y finalmente despliega una ventana de **Preguntas Abiertas** (Chat interactivo).

---

## 🚀 Énfasis Principal: `googleAi.ts` y el Patrón RAG
El núcleo computacional e inteligente de la aplicación está alojado en `src/actions/googleAi.ts`. 

Al estar definido bajo la directiva `"use server";` de Next.js, este archivo asegura de que **ninguna clave API sea revelada al front-end**, actuando como el cerebro privado de la aplicación móvil. Funciona en estricta coordinación con la librería de Google AI y encapsula los siguientes métodos cruciales:

### Gestión Segura con `GoogleAIFileManager`
Implementamos el concepto de **Zero-Infra RAG**; esto significa que en lugar de instalar, mantener y sincronizar bases de datos vectoriales gigantes (como Pinecone o ChromaDB), dejamos que Google se encargue de todo usando su `GoogleAIFileManager`.
- `uploadToGoogleAI(formData)`: Recibe temporalmente los PDFs desde la UI (`AnalyzerZone` o `CorpusZone`), los escribe en el directorio `/tmp` temporal de NodeJS y los despacha mediante el SDK a la nube de Google, registrando el nombre clave asignado en la API.
- `listGoogleAIFiles()`: Enlaza visualmente la nube al componente `CorpusZone.tsx`, trayendo a la UI todos los PDFs almacenados para que el usuario corrobore qué modelo de contexto hay activo.
- `deleteAllFilesFromGoogleAI()`: Despliega una limpieza profunda. Por comando de la UI, destruye todas las referencias almacenadas por el File API, reseteando por completo el conocimiento.

### Motores Analíticos y Conversacionales
Utilizando `GoogleGenerativeAI`, extraemos la capacidad máxima conversacional del modelo `gemini-2.5-flash-lite`:
- `analyzeDraft(draftFileUri, corpusFileUris, draftName)`: Conecta directamente desde `AnalyzerZone.tsx`. Ensambla los documentos del corpus y el borrador sin procesarlos explícitamente en el backend, los envía por medio del File API a Gemini junto con un *Prompt* altamente estructurado que exige una respuesta **estrictamente con formato JSON**.
- `chatWithModel(question, chatHistory, draftFileUri, corpusFileUris)`: El corazón de la funcionalidad de *Preguntas Abiertas*. Encapsula la memoria textual del chat y las referencias del PDF, haciendo que el usuario sienta que un asesor leyó al unísono toda esa información para resolver la duda exacta lanzada en la ventana de chat.

---

## 🏃‍♀️ Cómo Levantar la Aplicación

1. Clona el repositorio y ubícate en la raíz.
2. Crea el archivo `.env` en la raíz asegurando lo siguiente:
   ```env
   GOOGLE_API_KEY="AIzaSy...tu_clave..."
   ```
3. Instala los módulos:
   ```bash
   npm install
   ```
4. Ejecuta el servidor de desarrollo:
   ```bash
   npm run dev
   ```
5. Accede a través de [http://localhost:3000](http://localhost:3000).

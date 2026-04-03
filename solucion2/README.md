# Validador Platohedro con ChromaDB y Gemini 2.5 Flash-Lite

Este proyecto es una herramienta diseñada para evaluar propuestas y proyectos (borradores) de manera automatizada. Su principal objetivo es asistir a miembros de la organización a comparar propuestas entrantes contra un conjunto de propuestas históricas exitosas, utilizando un modelo **RAG Local Avanzado**.

## 🎯 Propósito del Ejemplo
El sistema resuelve un problema de cuello de botella en la validación humana de documentos. La aplicación actúa como un experto asesor que:
1. **Analiza borradores** contra pilares críticos (desglose de rubros, impacto territorial, cronograma, calidad técnica).
2. **Brinda Retroalimentación**, generando sugerencias concretas de mejora y asignando una calificación (Aprobado, Ajustar, Rechazado).
3. **Ofrece un Chat Contextual** apoyándose en la base de datos vectorial local.

## 🛠️ Stack Tecnológico Usado
Esta aplicación moderna está construida con el siguiente stack:
- **[Next.js 16.2 (App Router)](https://nextjs.org/)**: Framework principal para React.
- **[TailwindCSS](https://tailwindcss.com/)**: Encargado del diseño visual.
- **`chromadb`**: Base de Datos Vectorial de alto desempeño alojada localmente (vía Docker).
- **`pdf-parse` y `langchain`**: Manipulación e ingesta de PDFs. Extraen, separan el texto en *chunks* semánticos.
- **`@google/generative-ai` & `@langchain/google-genai`**: Motores de IA de Google. Usamos `text-embedding-004` para embeber texto y `gemini-2.5-flash-lite` para razonamiento y respuestas.

---

## 🏗️ Cómo fue Diseñado: Componentes de Interfaz

1. **`src/app/page.tsx`**: Mantiene el estado global de `corpusFiles` y renderiza la interfaz dividida en dos zonas.
2. **`CorpusZone.tsx`**: Interfaz de arrastrar y soltar para la subida de los "Documentos de Éxito" a ChromaDB. Permite purgar la base de datos visualmente.
3. **`AnalyzerZone.tsx`**: Recibe el borrador del usuario, lanza el RAG para calificarlo y despliega la ventana de **Preguntas Abiertas** (Chat interactivo) para inmersión conversacional.

---

## 🚀 Énfasis Principal: Servidor con ChromaDB
A diferencia de alternativas alojadas remotamente, `solucion2` aloja los datos cognitivamente valiosos de la plataforma de manera segura.

### Motor de Toma de Datos (Ingesta)
- `uploadToGoogleAI(formData)`: Recibe temporalmente los PDFs desde la UI, y ejecuta localmente `pdf-parse` antes de limpiar el archivo. Posteriormente entra Langchain dividiendo el texto en fragmentos (chunks) usando `RecursiveCharacterTextSplitter`. Finalmente estos fragmentos se vectorizan y envían a nuestra base de datos local `chromadb`.
- `listGoogleAIFiles()`: Regresa a la UI la lista de documentos al mapear `collections.get()` desde Chroma.
- `deleteAllFilesFromGoogleAI()`: Despliega una limpieza en ChromaDB destruyendo `rag_corpus`.

### Retrival y Evaluación RAG
- `analyzeDraft(draftFileUri, corpusFileUris, draftName)`: Realiza una búsqueda bidireccional en ChromaDB para conseguir el contexto vital del borrador, reduciendo dramáticamente el tokenaje total comparado con enviar los documentos PDF crudos a Gemini. Una vez obtenido el texto más cercano a la evaluación, lo compila junto con el JSON Schema de Platohedro.
- `chatWithModel()`: Vectoriza cada nueva pregunta del usuario al vuelo y la confronta contra ChromaDB para re-recuperar contexto y asistir asertivamente el chat.

---

## 🏃‍♀️ Cómo Levantar la Aplicación

1. Clona el repositorio y ubícate en la raíz.
2. Crea el archivo `.env` en la raíz asegurando tu token de acceso (Google AI Studio):
   ```env
   GOOGLE_API_KEY="AIzaSy...tu_clave..."
   ```
3. Instala los módulos:
   ```bash
   npm install
   ```
4. **INICIA CHROMA**: Asegúrate de tener Docker instalado para ejecutar el motor vectorial:
   ```bash
   docker-compose up -d
   ```
5. Ejecuta el servidor de desarrollo en Node:
   ```bash
   npm run dev
   ```
6. Accede a través de [http://localhost:3000](http://localhost:3000).

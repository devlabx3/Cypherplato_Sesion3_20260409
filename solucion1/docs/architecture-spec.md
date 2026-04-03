# Arquitectura: Validador Platohedro con Gemini 2.0 Flash-Lite

## Flujo de Trabajo
El sistema opera bajo un modelo de **Zero-Infra RAG**, delegando la búsqueda y el embedding a Google.

1. **Gestión de Conocimiento (Corpus):**
   - El Admin sube los PDFs de licitaciones ganadoras.
   - Estos archivos se indexan en el "File Service" de Google AI.
   - Al iniciar la aplicación, se *sincroniza automáticamente* con la nube listando los archivos subidos, lo que permite un control visual del RAG cargado en la misma UI.
   - Se almacenan sus IDs para ser usados como `context` en cada consulta.

2. **Proceso de Validación (Usuario):**
   - El usuario sube su borrador (PDF).
   - El sistema invoca a `gemini-2.5-flash-lite` pasando el archivo del usuario y referenciando los archivos del Corpus.
   - El modelo realiza una comparación semántica y técnica.

3. **Interacción Continua (Preguntas Abiertas):**
   - Se habilita una interfaz de chat debajo de los resultados de análisis para hacer consultas libres sobre el borrador evaluado.
   - Esta funcionalidad de Chat (Zero-Infra RAG) permite aclarar detalles o pedir recomendaciones apoyándose en el Corpus de licitaciones ganadoras.

4. **Gestión y Limpieza del RAG:**
   - La plataforma ofrece un panel de control ('Vaciar Nube') para gestionar los documentos remotos.
   - Usando `GoogleAIFileManager`, la UI permite al administrador purgar la base de datos documental limpiando todos los archivos subidos al Google AI Studio desde la aplicación, garantizando control sobre el ciclo de vida de la información.
# Solucion 3: Contextual RAG

Sistema de Q&A sobre documentos con **contexto conversacional persistente**. A diferencia de RAG basico que trata cada pregunta de forma aislada, Contextual RAG mantiene memoria de la conversacion para mejorar la relevancia y coherencia de las respuestas.

## Arquitectura

```
Pregunta del usuario
       |
       v
┌──────────────────────────┐
│ 1. MEMORIA CONVERSACIONAL │  Historial de preguntas/respuestas
│    (ConversationMemory)   │  Contexto acumulado
└────────────┬─────────────┘
             v
┌──────────────────────────┐
│ 2. ANALISIS DE CONTEXTO   │  Tipo de pregunta (seguimiento, nueva, etc.)
│    (ContextAnalyzer)      │  Relevancia con historial
└────────────┬─────────────┘
             v
┌──────────────────────────┐
│ 3. RECUPERACION           │  Busqueda vectorial en documentos
│    (SimpleVectorStore)    │  Ranking por relevancia
└────────────┬─────────────┘
             v
┌──────────────────────────┐
│ 4. AUGMENTACION DE PROMPT │  Combina: contexto + documentos + pregunta
│    (build_augmented_prompt)│
└────────────┬─────────────┘
             v
┌──────────────────────────┐
│ 5. GENERACION             │  LLM genera respuesta contextualizada
│    (generate_response)    │
└────────────┬─────────────┘
             v
       Respuesta + Memoria actualizada
```

## Estructura

```
solucion3/
├── README.md                         # Este archivo
├── contextual_rag.py                 # Implementacion completa
├── providers.py                      # Integraciones con LLMs (OpenAI, Gemini, Ollama)
├── requirements.txt                  # Dependencias Python
└── ejemplo_simplificado/
    ├── README.md                     # Documentacion del ejemplo minimo
    └── demo.py                       # Contextual RAG en ~80 lineas
```

## Inicio rapido

### Ejemplo simplificado (sin dependencias)
```bash
cd ejemplo_simplificado
python demo.py
```

### Ejemplo completo (sin dependencias)
```bash
python contextual_rag.py
```

### Con LLM real
```bash
pip install -r requirements.txt
export OPENAI_API_KEY="tu-clave"   # o GOOGLE_API_KEY para Gemini
python providers.py
```

## Componentes principales

### ConversationMemory
Gestiona el historial conversacional. Mantiene una ventana deslizante de mensajes recientes para inyectar en el prompt.

```python
memory = ConversationMemory(max_messages=50, window_size=10)
memory.add_message(Role.USER, "Cual es el monto de la licitacion?")
context = memory.get_conversation_context()
```

### ContextAnalyzer
Clasifica el tipo de pregunta (seguimiento, clarificacion, nuevo tema) para decidir cuanto contexto conversacional usar.

```python
analyzer = ContextAnalyzer()
analysis = analyzer.analyze_question_type(question, context)
# {"type": "follow_up", "context_relevance": 0.9, "should_use_memory": True}
```

### SimpleVectorStore
Almacena documentos divididos en chunks y realiza busqueda por similaridad. En produccion, reemplazar por ChromaDB, Pinecone, Weaviate, etc.

```python
store = SimpleVectorStore()
store.add_document("doc_1", "contenido...", "fuente")
results = store.similarity_search("query", k=3)
```

### ContextualRAGEngine
Orquesta los 5 pasos del flujo: memoria → analisis → recuperacion → augmentacion → generacion.

```python
engine = ContextualRAGEngine()
engine.add_documents(documents)
result = engine.process_question("Cual es el monto maximo?")
```

## Diferencia clave con RAG basico

```
Pregunta 1: "Cual es el monto de la licitacion de infraestructura?"
Respuesta:  "$100,000 USD"

Pregunta 2: "Y cual es la fecha de cierre?"

RAG basico:       Busca "fecha de cierre" sin contexto → puede traer otro documento
Contextual RAG:   Sabe que hablamos de infraestructura → busca en el contexto correcto
```

## Integraciones disponibles (providers.py)

| Proveedor | Clase | Modelo |
|-----------|-------|--------|
| OpenAI | `OpenAIProvider` | gpt-4, gpt-3.5-turbo |
| Google | `GoogleGeminiProvider` | gemini-pro |
| Ollama (local) | `OllamaProvider` | mistral, llama2, etc. |

Cada proveedor implementa la interfaz `LLMProvider` y puede usarse como backend de generacion.

## Tecnologias

- **Lenguaje**: Python 3.10+
- **Sin dependencias** para el ejemplo basico
- **Opcional**: openai, google-generativeai, chromadb, langchain

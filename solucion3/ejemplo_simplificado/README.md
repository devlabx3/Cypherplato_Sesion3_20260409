# Contextual RAG - Ejemplo Simplificado

Implementacion minima de Contextual RAG en ~80 lineas de Python. Demuestra los conceptos fundamentales sin dependencias externas.

## Que hace

Simula un sistema de Q&A sobre documentos que **mantiene contexto conversacional** entre preguntas. A diferencia de RAG basico, las preguntas de seguimiento se enriquecen con el historial de la conversacion.

## Ejecutar

```bash
python demo.py
```

No requiere dependencias externas.

## Componentes

El codigo implementa los 5 pasos de Contextual RAG:

| Paso | Funcion | Que hace |
|------|---------|----------|
| Base de conocimiento | `knowledge_base` | Diccionario que simula documentos indexados |
| Memoria | `conversation_memory` | Lista que almacena el historial de la conversacion |
| Recuperacion | `search_documents()` | Busca documentos relevantes por coincidencia de terminos |
| Augmentacion | `build_prompt()` | Combina contexto conversacional + documentos + pregunta |
| Orquestacion | `ask()` | Coordina todo el flujo de Contextual RAG |

## Flujo

```
Pregunta del usuario
       |
       v
  Es seguimiento? ──si──> Enriquecer query con contexto previo
       |                          |
       no                         |
       |                          |
       v                          v
  Buscar documentos relevantes <──┘
       |
       v
  Construir prompt (memoria + documentos + pregunta)
       |
       v
  Generar respuesta (LLM)
       |
       v
  Guardar en memoria conversacional
```

## Ejemplo de salida

```
>> Cual es el presupuesto del proyecto Alpha?
   Tipo: independiente
   Memoria: 0 turnos previos
   Documentos encontrados: 2

>> Y quien es el responsable?
   Tipo: seguimiento
   Memoria: 1 turnos previos
   Query enriquecida con contexto previo    <-- AQUI ESTA LA MAGIA
   Documentos encontrados: 2
```

En la segunda pregunta, "Y quien es el responsable?" no menciona "proyecto Alpha", pero el sistema lo sabe porque enriquece la busqueda con el contexto de la conversacion anterior.

## Para produccion

Este ejemplo usa simulacion. Para una implementacion real, reemplazar:

- `knowledge_base` → ChromaDB, Pinecone, o cualquier vector store con embeddings
- `search_documents()` → Busqueda vectorial con embeddings reales
- La respuesta simulada → Llamada a un LLM (OpenAI, Gemini, Ollama, etc.)

Ver el ejemplo completo en `../contextual_rag.py` y los providers en `../providers.py`.

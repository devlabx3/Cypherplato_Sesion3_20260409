"""
Contextual RAG - Solución 3
Sistema de Q&A sobre documentos con contexto conversacional persistente

Características:
- Memoria conversacional
- Análisis de contexto
- Recuperación semántica
- Generación contextualizada

Autor: DevLabX3
Sesión: CypherPlato #3 - 09 Abril 2026
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Dict, Optional, Tuple
from enum import Enum
import json
import re
from abc import ABC, abstractmethod

# ============================================================================
# PARTE 1: MODELOS Y ESTRUCTURAS DE DATOS
# ============================================================================

class Role(Enum):
    """Roles en la conversación"""
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


@dataclass
class Message:
    """Representa un mensaje en la conversación"""
    role: Role
    content: str
    timestamp: datetime = field(default_factory=datetime.now)
    metadata: Dict = field(default_factory=dict)

    def to_dict(self):
        return {
            "role": self.role.value,
            "content": self.content,
            "timestamp": self.timestamp.isoformat(),
            "metadata": self.metadata
        }


@dataclass
class Document:
    """Representa un documento en la base de conocimiento"""
    id: str
    content: str
    source: str
    chunks: List[str] = field(default_factory=list)
    metadata: Dict = field(default_factory=dict)


@dataclass
class RetrievedContext:
    """Contexto recuperado de documentos"""
    chunks: List[Tuple[str, float]]  # (content, similarity_score)
    source_docs: List[str]
    total_tokens: int


# ============================================================================
# PARTE 2: MEMORY MANAGER - Gestión de Memoria Conversacional
# ============================================================================

class ConversationMemory:
    """
    Gestor de memoria conversacional que mantiene contexto de la conversación
    """

    def __init__(self, max_messages: int = 50, window_size: int = 10):
        self.messages: List[Message] = []
        self.max_messages = max_messages
        self.window_size = window_size  # Cuántos mensajes recientes mantener
        self.context_summary: str = ""

    def add_message(self, role: Role, content: str, metadata: Dict = None):
        """Añade un mensaje a la memoria"""
        message = Message(
            role=role,
            content=content,
            metadata=metadata or {}
        )
        self.messages.append(message)

        # Limitar tamaño de memoria
        if len(self.messages) > self.max_messages:
            self.messages = self.messages[-self.max_messages:]

    def get_recent_messages(self, limit: Optional[int] = None) -> List[Message]:
        """Obtiene los mensajes más recientes"""
        if limit is None:
            limit = self.window_size
        return self.messages[-limit:]

    def get_conversation_context(self) -> str:
        """
        Construye un string del contexto conversacional reciente
        para incluir en el prompt
        """
        recent = self.get_recent_messages(self.window_size)
        context_parts = []

        for msg in recent:
            role_name = "Usuario" if msg.role == Role.USER else "Asistente"
            context_parts.append(f"{role_name}: {msg.content}")

        return "\n".join(context_parts)

    def get_last_user_message(self) -> Optional[str]:
        """Obtiene el último mensaje del usuario"""
        for message in reversed(self.messages):
            if message.role == Role.USER:
                return message.content
        return None

    def get_conversation_history(self) -> List[Dict]:
        """Retorna el historial completo como lista de dicts"""
        return [msg.to_dict() for msg in self.messages]

    def clear(self):
        """Limpia la memoria"""
        self.messages = []
        self.context_summary = ""

    def summarize_for_context(self) -> str:
        """
        Crea un resumen del contexto conversacional
        Útil para conversaciones muy largas
        """
        if len(self.messages) < 5:
            return ""

        # Extraer temas principales
        user_messages = [
            msg.content for msg in self.messages
            if msg.role == Role.USER
        ]

        # Palabras clave simples (en producción usarías NLP)
        keywords = []
        for msg in user_messages[-5:]:  # Últimas 5 preguntas
            words = msg.lower().split()
            keywords.extend([w for w in words if len(w) > 5])

        summary = f"Temas discutidos: {', '.join(set(keywords[-5:]))}"
        return summary


# ============================================================================
# PARTE 3: CONTEXT ANALYZER - Análisis de Contexto
# ============================================================================

class ContextAnalyzer:
    """
    Analiza la pregunta actual en relación al contexto de la conversación
    """

    def __init__(self):
        self.question_markers = {
            "follow_up": ["eso", "eso significa", "y qué", "cuál es", "explicación", "más"],
            "clarification": ["qué quieres decir", "por qué", "cómo"],
            "continuation": ["continúa", "sigue", "más información"],
            "new_topic": ["diferente", "otro", "nuevo", "acerca de"]
        }

    def analyze_question_type(self, current_question: str,
                            conversation_context: str) -> Dict:
        """
        Analiza el tipo de pregunta y su relación con el contexto
        """
        question_lower = current_question.lower()

        question_type = "independent"
        relevance_score = 0.0

        # Detectar tipo de pregunta
        if any(marker in question_lower for marker in self.question_markers["follow_up"]):
            question_type = "follow_up"
            relevance_score = 0.9
        elif any(marker in question_lower for marker in self.question_markers["clarification"]):
            question_type = "clarification"
            relevance_score = 0.85
        elif any(marker in question_lower for marker in self.question_markers["continuation"]):
            question_type = "continuation"
            relevance_score = 0.8
        elif any(marker in question_lower for marker in self.question_markers["new_topic"]):
            question_type = "new_topic"
            relevance_score = 0.5

        # Si hay contexto conversacional, la pregunta probablemente es relacionada
        if conversation_context and len(conversation_context) > 50:
            relevance_score = max(relevance_score, 0.7)

        return {
            "type": question_type,
            "context_relevance": relevance_score,
            "should_use_memory": relevance_score > 0.5
        }

    def extract_key_terms(self, text: str) -> List[str]:
        """Extrae términos clave de un texto"""
        # Implementación simple - en producción usar NLP
        words = text.lower().split()
        # Filtrar palabras cortas y stopwords comunes
        stopwords = {"el", "la", "de", "que", "a", "en", "es", "y", "o", "por", "para", "con"}
        keywords = [w for w in words if len(w) > 4 and w not in stopwords]
        return list(set(keywords))  # Retornar únicos


# ============================================================================
# PARTE 4: VECTOR STORE SIMULATOR - Simulador de Base de Datos Vectorial
# ============================================================================

class SimpleVectorStore:
    """
    Simulador simple de vector store.
    En producción usarías ChromaDB, Pinecone, Weaviate, etc.
    """

    def __init__(self):
        self.documents: Dict[str, Document] = {}
        self.chunks_index: List[Tuple[str, str, str]] = []  # (chunk, doc_id, source)

    def add_document(self, doc_id: str, content: str, source: str,
                    chunk_size: int = 500):
        """Añade un documento chunkeado al store"""
        # Dividir documento en chunks
        chunks = self._chunk_text(content, chunk_size)

        doc = Document(
            id=doc_id,
            content=content,
            source=source,
            chunks=chunks
        )

        self.documents[doc_id] = doc

        # Indexar chunks
        for chunk in chunks:
            self.chunks_index.append((chunk, doc_id, source))

    def _chunk_text(self, text: str, chunk_size: int) -> List[str]:
        """Divide texto en chunks"""
        sentences = text.split(". ")
        chunks = []
        current_chunk = ""

        for sentence in sentences:
            if len(current_chunk) + len(sentence) < chunk_size:
                current_chunk += sentence + ". "
            else:
                if current_chunk:
                    chunks.append(current_chunk)
                current_chunk = sentence + ". "

        if current_chunk:
            chunks.append(current_chunk)

        return chunks

    def similarity_search(self, query: str, k: int = 3) -> RetrievedContext:
        """
        Búsqueda simple de similaridad (en producción usarías embeddings)
        """
        query_terms = set(query.lower().split())

        # Calcular relevancia basada en coincidencia de términos
        scored_chunks = []
        for chunk, doc_id, source in self.chunks_index:
            chunk_terms = set(chunk.lower().split())
            # Jaccard similarity
            if len(chunk_terms) == 0:
                similarity = 0
            else:
                intersection = len(query_terms & chunk_terms)
                union = len(query_terms | chunk_terms)
                similarity = intersection / union if union > 0 else 0

            if similarity > 0.1:  # Umbral mínimo
                scored_chunks.append((chunk, similarity, doc_id, source))

        # Ordenar por relevancia
        scored_chunks.sort(key=lambda x: x[1], reverse=True)

        # Retornar top k
        top_chunks = scored_chunks[:k]

        return RetrievedContext(
            chunks=[(chunk, score) for chunk, score, _, _ in top_chunks],
            source_docs=list(set([source for _, _, _, source in top_chunks])),
            total_tokens=sum(len(chunk.split()) for chunk, _, _, _ in top_chunks)
        )


# ============================================================================
# PARTE 5: CONTEXTUAL RAG ENGINE - Motor Principal
# ============================================================================

class ContextualRAGEngine:
    """
    Motor de Contextual RAG que orquesta:
    - Memoria conversacional
    - Análisis de contexto
    - Recuperación de documentos
    - Generación de respuestas
    """

    def __init__(self, llm_api_key: Optional[str] = None):
        self.memory = ConversationMemory()
        self.analyzer = ContextAnalyzer()
        self.vector_store = SimpleVectorStore()
        self.llm_api_key = llm_api_key
        self.conversation_id = f"conv_{datetime.now().timestamp()}"

    def add_documents(self, documents: List[Dict[str, str]]):
        """
        Añade documentos a la base de conocimiento

        Args:
            documents: List de dicts con keys 'id', 'content', 'source'
        """
        for doc in documents:
            self.vector_store.add_document(
                doc_id=doc["id"],
                content=doc["content"],
                source=doc.get("source", "unknown")
            )
            print(f"✅ Documento añadido: {doc['id']} ({doc.get('source', 'unknown')})")

    def process_question(self, question: str) -> Dict:
        """
        Procesa una pregunta usando Contextual RAG
        """
        print(f"\n{'='*70}")
        print(f"📝 Pregunta: {question}")
        print(f"{'='*70}")

        # Paso 1: Analizar contexto
        print(f"\n1️⃣ Analizando contexto conversacional...")
        context_analysis = self.analyzer.analyze_question_type(
            question,
            self.memory.get_conversation_context()
        )
        print(f"   - Tipo de pregunta: {context_analysis['type']}")
        print(f"   - Relevancia con contexto: {context_analysis['context_relevance']:.2%}")

        # Paso 2: Recuperar contexto conversacional
        print(f"\n2️⃣ Recuperando contexto conversacional...")
        conv_context = self.memory.get_conversation_context()
        if conv_context:
            print(f"   - Contexto previo encontrado ({len(conv_context)} caracteres)")
        else:
            print(f"   - Sin contexto previo (primera pregunta)")

        # Paso 3: Recuperar documentos relevantes
        print(f"\n3️⃣ Recuperando documentos relevantes...")
        retrieved = self.vector_store.similarity_search(question, k=3)
        print(f"   - Documentos encontrados: {len(retrieved.source_docs)}")
        print(f"   - Chunks recuperados: {len(retrieved.chunks)}")
        print(f"   - Tokens totales: {retrieved.total_tokens}")

        for i, (chunk, score) in enumerate(retrieved.chunks, 1):
            print(f"   [{i}] Relevancia: {score:.2%}")
            print(f"       {chunk[:100]}...")

        # Paso 4: Construir prompt contextualizado
        print(f"\n4️⃣ Construyendo prompt contextualizado...")
        augmented_prompt = self._build_augmented_prompt(
            question,
            retrieved,
            conv_context,
            context_analysis
        )
        print(f"   - Prompt creado ({len(augmented_prompt)} caracteres)")

        # Paso 5: Generar respuesta (simulado)
        print(f"\n5️⃣ Generando respuesta...")
        response = self._generate_response(augmented_prompt, question)
        print(f"   ✅ Respuesta generada")

        # Paso 6: Actualizar memoria
        print(f"\n6️⃣ Actualizando memoria conversacional...")
        self.memory.add_message(Role.USER, question)
        self.memory.add_message(Role.ASSISTANT, response)
        print(f"   - Memoria actualizada ({len(self.memory.messages)} mensajes)")

        # Retornar resultado
        result = {
            "conversation_id": self.conversation_id,
            "question": question,
            "response": response,
            "context_analysis": context_analysis,
            "retrieved_documents": retrieved.source_docs,
            "conversation_depth": len(self.memory.messages),
            "augmented_prompt": augmented_prompt
        }

        print(f"\n{'='*70}")
        print(f"🤖 RESPUESTA:")
        print(f"{'='*70}")
        print(response)

        return result

    def _build_augmented_prompt(self, question: str, retrieved: RetrievedContext,
                               conv_context: str, analysis: Dict) -> str:
        """Construye el prompt aumentado con contexto"""

        prompt_parts = []

        # Sistema
        prompt_parts.append("""Eres un asistente experto que responde preguntas basándote en documentos.
Usa SOLO la información de los documentos proporcionados.
Si no conoces la respuesta, di: "No tengo información sobre eso en los documentos."
Mantén consistencia con la conversación anterior si es relevante.
""")

        # Contexto conversacional si es relevante
        if analysis["should_use_memory"] and conv_context:
            prompt_parts.append(f"""CONTEXTO DE CONVERSACIÓN ANTERIOR:
{conv_context}

""")

        # Documentos recuperados
        prompt_parts.append("DOCUMENTOS RELEVANTES:\n")
        for i, (chunk, score) in enumerate(retrieved.chunks, 1):
            prompt_parts.append(f"[Documento {i} - Relevancia: {score:.0%}]\n{chunk}\n")

        # Pregunta actual
        prompt_parts.append(f"\nPREGUNTA DEL USUARIO:\n{question}\n")
        prompt_parts.append("\nRESPUESTA:")

        return "\n".join(prompt_parts)

    def _generate_response(self, augmented_prompt: str, question: str) -> str:
        """
        Genera respuesta usando LLM

        En producción, aquí harías llamadas a OpenAI, Google Gemini, Ollama, etc.
        Por ahora, retorna una respuesta simulada basada en el prompt.
        """

        # Simulación simple - en producción llamarías a un LLM real
        # Ejemplo con OpenAI:
        # response = openai.ChatCompletion.create(
        #     model="gpt-4",
        #     messages=[{"role": "user", "content": augmented_prompt}],
        #     temperature=0.7
        # )

        # Para demo, generamos respuesta basada en patrones
        if "contextual" in question.lower() or "rag" in question.lower():
            response = """Contextual RAG es un sistema avanzado que mantiene la memoria de la conversación
mientras recupera y utiliza información relevante de documentos. A diferencia de RAG simple,
permite que cada respuesta sea consciente del contexto histórico, mejorando la coherencia y relevancia."""

        elif "solución" in question.lower():
            response = """Esta es la Solución 3 - Contextual RAG, que implementa:
- Memoria conversacional persistente
- Análisis inteligente de contexto
- Recuperación de documentos relevantes
- Generación contextualizada de respuestas"""

        else:
            response = """Basándome en los documentos recuperados y el contexto de nuestra conversación,
puedo proporcionarte información relevante. Por favor, especifica más sobre qué quieres saber."""

        return response

    def get_conversation_summary(self) -> Dict:
        """Retorna un resumen de la conversación"""
        return {
            "conversation_id": self.conversation_id,
            "total_messages": len(self.memory.messages),
            "total_turns": len([m for m in self.memory.messages if m.role == Role.USER]),
            "history": self.memory.get_conversation_history(),
            "documents_used": list(self.vector_store.documents.keys())
        }


# ============================================================================
# PARTE 6: EJEMPLO DE USO
# ============================================================================

def main():
    """Ejemplo de uso del Contextual RAG Engine"""

    print("="*70)
    print("CONTEXTUAL RAG - SOLUCIÓN 3")
    print("Sistema de Q&A con Contexto Conversacional")
    print("="*70)

    # Inicializar engine
    engine = ContextualRAGEngine()

    # Documentos de ejemplo (simulando licitaciones de PlatoHedro)
    sample_documents = [
        {
            "id": "licitacion_001",
            "source": "Licitación 001 - Infraestructura",
            "content": """CONVOCATORIA DE LICITACIÓN - INFRAESTRUCTURA
Monto: $100,000 USD
Fecha de cierre: 15 de mayo de 2026
Alcance: Construcción y mejora de infraestructura vial
Requisitos: Experiencia mínima 5 años, certificaciones ISO 9001
Empresa ganadora anterior: Constructora Moderna S.A.
Beneficiario: Municipio de San José"""
        },
        {
            "id": "licitacion_002",
            "source": "Licitación 002 - Servicios de TI",
            "content": """CONVOCATORIA DE LICITACIÓN - SERVICIOS DE TECNOLOGÍA
Monto: $50,000 USD
Plazo de entrega: 6 meses
Servicios incluidos: Implementación de sistema ERP, capacitación
Requisitos técnicos: Experiencia en SAP o Dynamics 365
Garantía: 24 meses de soporte técnico
Cliente: Ministerio de Hacienda"""
        },
        {
            "id": "licitacion_003",
            "source": "Licitación 003 - Consultoría",
            "content": """CONVOCATORIA DE LICITACIÓN - CONSULTORÍA ESTRATÉGICA
Monto: $75,000 USD
Duración: 4 meses
Entregas: Plan estratégico, análisis de mercado, recomendaciones
Consultores requeridos: Mínimo 2, con 10+ años experiencia
Metodología: Workshops, entrevistas, análisis cuantitativo
Sector enfoque: Comercio electrónico y transformación digital"""
        }
    ]

    # Cargar documentos
    print("\n📚 Cargando documentos de base de conocimiento...\n")
    engine.add_documents(sample_documents)

    # Simular conversación
    print("\n" + "="*70)
    print("INICIANDO CONVERSACIÓN DE PRUEBA")
    print("="*70)

    questions = [
        "¿Cuál es el monto máximo de la licitación de infraestructura?",
        "¿Y cuál es la fecha de cierre?",
        "¿Qué empresa ganó anteriormente?",
        "Dime sobre los requisitos técnicos",
        "¿Cuántos consultores se requieren en la solución 003?"
    ]

    for question in questions:
        result = engine.process_question(question)
        print("\n")

    # Mostrar resumen final
    print("\n" + "="*70)
    print("📊 RESUMEN DE LA CONVERSACIÓN")
    print("="*70)
    summary = engine.get_conversation_summary()
    print(json.dumps(summary, indent=2, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()

"""
Contextual RAG - Implementaciones Avanzadas con APIs Reales
Ejemplos de integración con LLMs profesionales

Incluye:
- OpenAI GPT-4 / GPT-3.5
- Google Gemini
- Ollama (modelos locales)
- Estrategias avanzadas de recuperación
"""

import os
from typing import Optional, List, Dict
from datetime import datetime
from abc import ABC, abstractmethod
import json


# ============================================================================
# PARTE 1: INTERFAZ ABSTRACTA DE LLM
# ============================================================================

class LLMProvider(ABC):
    """Interfaz abstracta para proveedores de LLM"""

    @abstractmethod
    def generate(self, prompt: str, max_tokens: int = 500) -> str:
        """Genera texto dado un prompt"""
        pass

    @abstractmethod
    def validate_credentials(self) -> bool:
        """Valida que las credenciales sean correctas"""
        pass


# ============================================================================
# PARTE 2: IMPLEMENTACIÓN CON OPENAI
# ============================================================================

class OpenAIProvider(LLMProvider):
    """Proveedor basado en OpenAI (GPT-4, GPT-3.5-turbo)"""

    def __init__(self, api_key: Optional[str] = None, model: str = "gpt-3.5-turbo"):
        """
        Inicializa el proveedor de OpenAI

        Args:
            api_key: Clave API de OpenAI (o usar OPENAI_API_KEY env)
            model: Modelo a usar (gpt-4, gpt-3.5-turbo, etc)
        """
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        self.model = model

        if not self.api_key:
            raise ValueError(
                "OpenAI API key not found. "
                "Provide via constructor or OPENAI_API_KEY env variable"
            )

        # Import dinámico para no requerir openai si no se usa
        try:
            from openai import OpenAI
            self.client = OpenAI(api_key=self.api_key)
        except ImportError:
            raise ImportError(
                "openai package required. Install with: pip install openai"
            )

    def validate_credentials(self) -> bool:
        """Valida credenciales haciendo una llamada simple"""
        try:
            self.client.models.retrieve("gpt-3.5-turbo")
            return True
        except Exception as e:
            print(f"❌ Credenciales inválidas: {e}")
            return False

    def generate(self, prompt: str, max_tokens: int = 500,
                temperature: float = 0.7) -> str:
        """Genera respuesta usando OpenAI"""

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=max_tokens,
                temperature=temperature
            )
            return response.choices[0].message.content

        except Exception as e:
            print(f"❌ Error al generar respuesta: {e}")
            return f"Error: {str(e)}"


# ============================================================================
# PARTE 3: IMPLEMENTACIÓN CON GOOGLE GEMINI
# ============================================================================

class GoogleGeminiProvider(LLMProvider):
    """Proveedor basado en Google Gemini"""

    def __init__(self, api_key: Optional[str] = None, model: str = "gemini-pro"):
        """
        Inicializa el proveedor de Google Gemini

        Args:
            api_key: Clave API de Google (o usar GOOGLE_API_KEY env)
            model: Modelo a usar (gemini-pro, gemini-pro-vision, etc)
        """
        self.api_key = api_key or os.getenv("GOOGLE_API_KEY")
        self.model = model

        if not self.api_key:
            raise ValueError(
                "Google API key not found. "
                "Provide via constructor or GOOGLE_API_KEY env variable"
            )

        try:
            import google.generativeai as genai
            self.genai = genai
            self.genai.configure(api_key=self.api_key)
        except ImportError:
            raise ImportError(
                "google-generativeai package required. "
                "Install with: pip install google-generativeai"
            )

    def validate_credentials(self) -> bool:
        """Valida credenciales"""
        try:
            model = self.genai.GenerativeModel(self.model)
            model.generate_content("test")
            return True
        except Exception as e:
            print(f"❌ Credenciales inválidas: {e}")
            return False

    def generate(self, prompt: str, max_tokens: int = 500,
                temperature: float = 0.7) -> str:
        """Genera respuesta usando Gemini"""

        try:
            model = self.genai.GenerativeModel(self.model)

            response = model.generate_content(
                prompt,
                generation_config=self.genai.types.GenerationConfig(
                    max_output_tokens=max_tokens,
                    temperature=temperature
                )
            )

            return response.text

        except Exception as e:
            print(f"❌ Error al generar respuesta: {e}")
            return f"Error: {str(e)}"


# ============================================================================
# PARTE 4: IMPLEMENTACIÓN CON OLLAMA (LOCAL)
# ============================================================================

class OllamaProvider(LLMProvider):
    """Proveedor basado en Ollama (modelos locales)"""

    def __init__(self, base_url: str = "http://localhost:11434",
                model: str = "mistral"):
        """
        Inicializa el proveedor de Ollama

        Args:
            base_url: URL de servidor Ollama
            model: Modelo a usar (mistral, llama2, neural-chat, etc)

        Nota: Requiere tener Ollama instalado y servidor corriendo
        """
        self.base_url = base_url
        self.model = model

        try:
            import requests
            self.requests = requests
        except ImportError:
            raise ImportError(
                "requests package required. "
                "Install with: pip install requests"
            )

    def validate_credentials(self) -> bool:
        """Valida que Ollama esté disponible"""
        try:
            response = self.requests.get(f"{self.base_url}/api/tags")
            if response.status_code == 200:
                models = response.json()
                print(f"✅ Ollama disponible. Modelos: {models}")
                return True
            return False
        except Exception as e:
            print(f"❌ Ollama no disponible: {e}")
            return False

    def generate(self, prompt: str, max_tokens: int = 500,
                temperature: float = 0.7) -> str:
        """Genera respuesta usando Ollama"""

        try:
            response = self.requests.post(
                f"{self.base_url}/api/generate",
                json={
                    "model": self.model,
                    "prompt": prompt,
                    "stream": False,
                    "options": {
                        "temperature": temperature,
                        "num_predict": max_tokens
                    }
                }
            )

            if response.status_code == 200:
                result = response.json()
                return result.get("response", "Sin respuesta")
            else:
                return f"Error Ollama: {response.status_code}"

        except Exception as e:
            print(f"❌ Error al generar respuesta: {e}")
            return f"Error: {str(e)}"


# ============================================================================
# PARTE 5: ESTRATEGIAS AVANZADAS DE RECUPERACIÓN
# ============================================================================

class AdvancedRetriever:
    """Recuperador avanzado con múltiples estrategias"""

    @staticmethod
    def hybrid_search(query: str, vector_results: List[tuple],
                     keyword_results: List[tuple],
                     alpha: float = 0.6) -> List[tuple]:
        """
        Búsqueda híbrida: combina resultados vectoriales y keyword

        Args:
            query: Consulta
            vector_results: Resultados de búsqueda vectorial (content, score)
            keyword_results: Resultados de búsqueda keyword
            alpha: Peso para resultados vectoriales (0-1)

        Returns:
            Resultados combinados y rankeados
        """
        # Normalizar scores
        max_vector_score = max([s for _, s in vector_results]) if vector_results else 1
        max_keyword_score = max([s for _, s in keyword_results]) if keyword_results else 1

        combined = {}

        # Añadir resultados vectoriales
        for content, score in vector_results:
            normalized = (score / max_vector_score) * alpha
            combined[content] = combined.get(content, 0) + normalized

        # Añadir resultados keyword
        for content, score in keyword_results:
            normalized = (score / max_keyword_score) * (1 - alpha)
            combined[content] = combined.get(content, 0) + normalized

        # Retornar ordenados
        return sorted(
            [(content, score) for content, score in combined.items()],
            key=lambda x: x[1],
            reverse=True
        )

    @staticmethod
    def rerank_by_query_similarity(query: str, documents: List[str],
                                  threshold: float = 0.3) -> List[tuple]:
        """
        Re-rankea documentos basándose en similitud con query

        En producción, usar: sentence-transformers
        Aquí usamos métrica simple
        """
        query_terms = set(query.lower().split())

        scored = []
        for doc in documents:
            doc_terms = set(doc.lower().split())
            intersection = len(query_terms & doc_terms)
            similarity = intersection / len(query_terms) if query_terms else 0

            if similarity >= threshold:
                scored.append((doc, similarity))

        return sorted(scored, key=lambda x: x[1], reverse=True)

    @staticmethod
    def diversity_sampling(documents: List[tuple], k: int,
                          diversity_weight: float = 0.3) -> List[tuple]:
        """
        Selecciona top-k documentos maximizando diversidad

        Evita obtener documentos muy similares entre sí
        """
        if len(documents) <= k:
            return documents

        selected = [documents[0]]  # Tomar el mejor
        remaining = documents[1:]

        for _ in range(k - 1):
            if not remaining:
                break

            best_candidate = None
            best_score = -float('inf')

            for candidate, orig_score in remaining:
                # Score = relevancia original + penalidad por similaridad
                similarity_penalty = 0
                for selected_doc, _ in selected:
                    # Medir similitud simple
                    candidate_terms = set(candidate.lower().split())
                    selected_terms = set(selected_doc.lower().split())
                    if len(candidate_terms | selected_terms) > 0:
                        similarity = len(candidate_terms & selected_terms) / \
                                   len(candidate_terms | selected_terms)
                        similarity_penalty += similarity

                adjusted_score = orig_score - \
                               (diversity_weight * similarity_penalty / len(selected))

                if adjusted_score > best_score:
                    best_score = adjusted_score
                    best_candidate = candidate

            if best_candidate is not None:
                selected.append((best_candidate, best_score))
                remaining = [
                    (doc, score) for doc, score in remaining
                    if doc != best_candidate
                ]

        return selected


# ============================================================================
# PARTE 6: ADVANCED CONTEXTUAL RAG ENGINE
# ============================================================================

class AdvancedContextualRAG:
    """
    Versión avanzada de Contextual RAG con:
    - Múltiples proveedores LLM
    - Estrategias de recuperación avanzadas
    - Logging y monitoreo
    - Caching de respuestas
    """

    def __init__(self, llm_provider: LLMProvider):
        """
        Inicializa el engine avanzado

        Args:
            llm_provider: Instancia de proveedor LLM (OpenAI, Gemini, Ollama)
        """
        self.llm = llm_provider
        self.retriever = AdvancedRetriever()
        self.conversations: Dict = {}
        self.response_cache: Dict = {}
        self.logs: List[Dict] = []

    def log_event(self, event_type: str, details: Dict):
        """Registra evento para monitoreo"""
        log_entry = {
            "timestamp": datetime.now().isoformat(),
            "event_type": event_type,
            "details": details
        }
        self.logs.append(log_entry)

        if len(self.logs) > 1000:  # Limitar tamaño
            self.logs = self.logs[-500:]

    def process_with_caching(self, prompt: str,
                           cache_key: Optional[str] = None) -> str:
        """
        Procesa prompt con caching opcional

        Args:
            prompt: Prompt a procesar
            cache_key: Clave para caché (None = sin caché)

        Returns:
            Respuesta generada o cacheada
        """
        if cache_key and cache_key in self.response_cache:
            self.log_event("cache_hit", {"key": cache_key})
            return self.response_cache[cache_key]

        response = self.llm.generate(prompt)

        if cache_key:
            self.response_cache[cache_key] = response
            self.log_event("cache_store", {"key": cache_key})

        return response

    def get_statistics(self) -> Dict:
        """Retorna estadísticas de uso"""
        return {
            "total_logs": len(self.logs),
            "cache_size": len(self.response_cache),
            "conversations": len(self.conversations),
            "cache_hits": sum(
                1 for log in self.logs
                if log["event_type"] == "cache_hit"
            ),
            "events_by_type": self._count_events_by_type()
        }

    def _count_events_by_type(self) -> Dict[str, int]:
        """Cuenta eventos por tipo"""
        counts = {}
        for log in self.logs:
            event_type = log["event_type"]
            counts[event_type] = counts.get(event_type, 0) + 1
        return counts


# ============================================================================
# PARTE 7: EJEMPLOS DE USO
# ============================================================================

def example_with_openai():
    """Ejemplo con OpenAI"""
    print("\n" + "="*70)
    print("EJEMPLO 1: OpenAI GPT-3.5-turbo")
    print("="*70)

    try:
        llm = OpenAIProvider(
            api_key=os.getenv("OPENAI_API_KEY"),
            model="gpt-3.5-turbo"
        )

        if not llm.validate_credentials():
            print("❌ Credenciales de OpenAI inválidas")
            return

        print("✅ Credenciales validadas")

        prompt = """Basándote en el siguiente contexto sobre licitaciones:

CONTEXTO:
- Licitación 001: Infraestructura, $100,000
- Licitación 002: Servicios TI, $50,000
- Licitación 003: Consultoría, $75,000

PREGUNTA: ¿Cuál es el presupuesto total?

RESPUESTA:"""

        response = llm.generate(prompt, max_tokens=200)
        print(f"\n🤖 Respuesta:\n{response}")

    except Exception as e:
        print(f"❌ Error: {e}")


def example_with_gemini():
    """Ejemplo con Google Gemini"""
    print("\n" + "="*70)
    print("EJEMPLO 2: Google Gemini")
    print("="*70)

    try:
        llm = GoogleGeminiProvider(
            api_key=os.getenv("GOOGLE_API_KEY"),
            model="gemini-pro"
        )

        if not llm.validate_credentials():
            print("❌ Credenciales de Google inválidas")
            return

        print("✅ Credenciales validadas")

        prompt = "¿Qué es Contextual RAG en 2 párrafos?"

        response = llm.generate(prompt, max_tokens=300)
        print(f"\n🤖 Respuesta:\n{response}")

    except Exception as e:
        print(f"❌ Error: {e}")


def example_with_ollama():
    """Ejemplo con Ollama (local)"""
    print("\n" + "="*70)
    print("EJEMPLO 3: Ollama (Local)")
    print("="*70)

    try:
        llm = OllamaProvider(
            base_url="http://localhost:11434",
            model="mistral"
        )

        if not llm.validate_credentials():
            print("❌ Ollama no está disponible")
            print("   Instala Ollama: https://ollama.ai")
            print("   Luego ejecuta: ollama pull mistral")
            print("   Y inicia: ollama serve")
            return

        print("✅ Ollama disponible")

        prompt = "Explica RAG en una frase"

        response = llm.generate(prompt, max_tokens=100)
        print(f"\n🤖 Respuesta:\n{response}")

    except Exception as e:
        print(f"❌ Error: {e}")


def example_advanced_rag():
    """Ejemplo de RAG avanzado con caching y estadísticas"""
    print("\n" + "="*70)
    print("EJEMPLO 4: RAG Avanzado con Caching")
    print("="*70)

    try:
        # Usar OpenAI si está disponible, sino simular
        if os.getenv("OPENAI_API_KEY"):
            llm = OpenAIProvider()
        else:
            print("⚠️  Sin API key de OpenAI, usando simulación")
            llm = None

        if llm:
            rag = AdvancedContextualRAG(llm)

            # Primera consulta (no cacheada)
            prompt1 = "¿Qué es RAG?"
            print(f"\n📝 Consulta 1: {prompt1}")
            response1 = rag.process_with_caching(prompt1, cache_key="rag_definition")
            print(f"✅ Respuesta: {response1[:100]}...")

            # Segunda consulta igual (cacheada)
            print(f"\n📝 Consulta 2: {prompt1} (misma pregunta)")
            response2 = rag.process_with_caching(prompt1, cache_key="rag_definition")
            print(f"✅ Respuesta (cacheada): {response2[:100]}...")

            # Mostrar estadísticas
            stats = rag.get_statistics()
            print(f"\n📊 Estadísticas:")
            print(json.dumps(stats, indent=2))

    except Exception as e:
        print(f"❌ Error: {e}")


# ============================================================================
# MAIN
# ============================================================================

def main():
    """Ejecuta ejemplos"""
    print("="*70)
    print("CONTEXTUAL RAG - IMPLEMENTACIONES AVANZADAS")
    print("="*70)

    # Revisar variables de entorno disponibles
    print("\n🔑 Credenciales detectadas:")
    print(f"   OpenAI API Key: {'✅' if os.getenv('OPENAI_API_KEY') else '❌'}")
    print(f"   Google API Key: {'✅' if os.getenv('GOOGLE_API_KEY') else '❌'}")
    print(f"   Ollama disponible: Verificando...")

    # Ejecutar ejemplos
    try:
        example_with_ollama()
    except:
        pass

    try:
        example_with_openai()
    except:
        print("⏭️  Saltando ejemplo de OpenAI (no configurado)")

    try:
        example_with_gemini()
    except:
        print("⏭️  Saltando ejemplo de Gemini (no configurado)")

    try:
        example_advanced_rag()
    except:
        print("⏭️  Saltando ejemplo avanzado (no configurado)")

    print("\n" + "="*70)
    print("✨ Ejemplos completados")
    print("="*70)


if __name__ == "__main__":
    main()

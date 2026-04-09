"""
Contextual RAG - Ejemplo Simplificado
Demuestra el concepto completo en ~80 lineas de codigo.
"""

# ── Base de conocimiento (simula documentos indexados) ──────────────────────

knowledge_base = {
    "proyecto_alpha": (
        "Proyecto Alpha: Presupuesto $120,000. Responsable: Maria Lopez. "
        "Area: Infraestructura. Estado: En ejecucion. Plazo: 8 meses."
    ),
    "proyecto_beta": (
        "Proyecto Beta: Presupuesto $85,000. Responsable: Carlos Ruiz. "
        "Area: Tecnologia. Estado: Planificacion. Plazo: 6 meses."
    ),
    "proyecto_gamma": (
        "Proyecto Gamma: Presupuesto $200,000. Responsable: Ana Torres. "
        "Area: Tecnologia. Estado: En ejecucion. Plazo: 12 meses."
    ),
}

# ── Memoria conversacional ──────────────────────────────────────────────────

conversation_memory = []  # Lista de tuplas (rol, texto)


def search_documents(query):
    """Busca documentos relevantes por coincidencia de terminos."""
    query_words = set(query.lower().replace("?", "").replace(".", "").split())
    results = []
    for doc_id, content in knowledge_base.items():
        doc_words = set(content.lower().replace(".", "").replace(":", "").split())
        common = query_words & doc_words
        score = len(common) / max(len(query_words), 1)
        if score > 0.1:
            results.append((content, round(score, 3)))
    results.sort(key=lambda x: x[1], reverse=True)
    return results[:2]


def build_prompt(question, docs, memory):
    """Construye el prompt aumentado con contexto conversacional + documentos."""
    prompt = "Responde usando SOLO la informacion proporcionada.\n\n"

    # Inyectar memoria conversacional (esto es lo que hace CONTEXTUAL al RAG)
    if memory:
        prompt += "CONVERSACION PREVIA:\n"
        for role, text in memory[-6:]:  # Ultimos 3 turnos
            prompt += f"  {role}: {text}\n"
        prompt += "\n"

    # Inyectar documentos recuperados
    prompt += "DOCUMENTOS:\n"
    for doc, score in docs:
        prompt += f"  [{score}] {doc}\n"

    prompt += f"\nPREGUNTA: {question}\nRESPUESTA:"
    return prompt


def ask(question):
    """Procesa una pregunta con Contextual RAG."""
    print(f"\n{'─'*60}")
    print(f">> {question}")
    print(f"{'─'*60}")

    # 1. Analizar tipo de pregunta
    follow_up_markers = ["y ", "y cual", "y quien", "y como", "tambien", "ademas"]
    is_follow_up = (
        any(question.lower().startswith(m) for m in follow_up_markers)
        and len(conversation_memory) > 0
    )
    print(f"   Tipo: {'seguimiento' if is_follow_up else 'independiente'}")
    print(f"   Memoria: {len(conversation_memory)//2} turnos previos")

    # 2. Recuperar documentos relevantes
    enriched_query = question
    if is_follow_up and conversation_memory:
        # CLAVE: enriquecer la query con contexto previo
        last_context = conversation_memory[-2][1] if len(conversation_memory) >= 2 else ""
        enriched_query = f"{last_context} {question}"
        print(f"   Query enriquecida con contexto previo")

    docs = search_documents(enriched_query)
    print(f"   Documentos encontrados: {len(docs)}")
    for doc, score in docs:
        print(f"     [{score}] {doc[:60]}...")

    # 3. Construir prompt contextualizado
    prompt = build_prompt(question, docs, conversation_memory)
    print(f"   Prompt: {len(prompt)} caracteres")

    # 4. Generar respuesta (simulada - aqui iria la llamada al LLM)
    # En produccion: response = llm.generate(prompt)
    response = f"[Respuesta generada por LLM basada en {len(docs)} documentos"
    if conversation_memory:
        response += f" y {len(conversation_memory)//2} turnos de contexto"
    response += "]"

    # 5. Actualizar memoria
    conversation_memory.append(("Usuario", question))
    conversation_memory.append(("Asistente", response))

    print(f"\n   Respuesta: {response}")
    print(f"   Memoria actualizada: {len(conversation_memory)//2} turnos\n")
    return response


# ── Ejecucion ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 60)
    print("CONTEXTUAL RAG - Ejemplo Simplificado")
    print("=" * 60)
    print(f"Documentos cargados: {len(knowledge_base)}")

    # Conversacion de ejemplo
    ask("Cual es el presupuesto del proyecto Alpha?")
    ask("Y quien es el responsable?")                    # Seguimiento contextual
    ask("Que proyectos hay de tecnologia?")              # Cambio de tema
    ask("Cual tiene mayor presupuesto?")                 # Seguimiento del nuevo tema

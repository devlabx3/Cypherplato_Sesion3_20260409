# CypherplatoSesion3

Repositorio para [Plato Hedro](https://platohedro.org/) en sus sesiones de **CypherPlato**.
Hecho por **DevLabX3**.

---

Colección de soluciones RAG para validar propuestas de licitación de **PlatoHedro**. Cada solución aborda el mismo problema con un enfoque diferente — de menor a mayor complejidad.

---

## ¿Qué es RAG?

RAG (Retrieval-Augmented Generation) es un patrón donde antes de pedirle a un modelo de IA que responda, primero buscas información relevante y se la das como contexto. Así el modelo responde basado en tus documentos, no en su entrenamiento genérico.

---

## Las soluciones

| Carpeta | Enfoque | Infraestructura necesaria |
|---|---|---|
| [`solucion1/`](solucion1/) | Zero-Infra RAG — PDFs enviados directo a Gemini por URI | Solo una API key |
| [`solucion2/`](solucion2/) | RAG local — vectores en ChromaDB, búsqueda semántica propia | Docker |
| [`solucion2.1/`](solucion2.1/) | RAG local con chunking semántico via Gemini | Docker (1 servicio) |

Recomendamos leerlas en orden: cada una introduce conceptos que la siguiente da por conocidos.

---

## Requisitos comunes

- Node.js 18 o superior
- API key de Google AI Studio ([obtener aquí](https://aistudio.google.com/))
- Docker — solo para `solucion2` y `solucion2.1`

Cada solución tiene su propio `README.md` con instrucciones de arranque.

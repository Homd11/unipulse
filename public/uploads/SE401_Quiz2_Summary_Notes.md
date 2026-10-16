# SE-401 Software Engineering — Quiz 2 Study Summary
Prepared by: Sara M.

## 1. Sequence Diagrams (Lecture 5)
- **Lifelines:** Represent object/actor instances over time.
- **Activation Bars:** Show when a participant is actively executing a method.
- **Synchronous Message:** Solid arrowhead (caller waits for return).
- **Asynchronous Message:** Open arrowhead (non-blocking call, e.g. Web Push queue).
- **Alt / Opt / Loop Fragments:**
  - `alt`: if/else conditional branches
  - `opt`: single optional branch
  - `loop`: repeated execution with guard condition `[until status == 'done']`

## 2. Architectural Patterns (Lecture 6)
- **Layered / MVC:** Separation of UI presentation, domain logic, and data persistence.
- **Event-Driven / Pub-Sub:** Decoupled producers and consumers (ideal for notifications and real-time comments).
- **Microservices vs. Modular Monolith:** Trade-offs in deployment complexity, latency, and data consistency.

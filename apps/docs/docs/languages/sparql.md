# SPARQL 1.1

`@modelscript/sparql` provides first-class W3C SPARQL 1.1 Query and Update support compiled to a native WebAssembly GLR parser (`parser.wasm`) with a built-in algebra and Leapfrog Triejoin execution engine.

## Supported Forms

- **Queries:** `SELECT`, `ASK`, `CONSTRUCT`, `DESCRIBE`, subqueries (`{ SELECT ... }`), `OPTIONAL`, `UNION`, `MINUS`, `FILTER`, `BIND`, `VALUES`, `GRAPH`, `GROUP BY`, `HAVING`, `ORDER BY`, `LIMIT`, `OFFSET`, and SPARQL 1.1 Property Paths (`+`, `*`, `?`, `^`, `/`, `|`, `!(...)`).
- **Updates:** `INSERT DATA`, `DELETE DATA`, and `DELETE { ... } INSERT { ... } WHERE { ... }`.
- **Triple Store Backends:** Direct adapters for `WasmOntologyReasoner`, `WasmOntologyStore`, `PagedStorageEngine` (WASM 4KB slotted B+Tree), and `SqliteRdfSource`.

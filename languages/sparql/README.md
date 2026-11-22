<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/sparql`

First-class W3C SPARQL 1.1 Query & Update language implementation for ModelScript, built with `@modelscript/dsl` (native WebAssembly GLR parser) and a zero-dependency algebra + Leapfrog Triejoin execution engine.

## Features

- **WASM GLR Parser (`parser.wasm`):** Full SPARQL 1.1 Query (`SELECT`, `CONSTRUCT`, `DESCRIBE`, `ASK`, `OPTIONAL`, `UNION`, `MINUS`, `FILTER`, `BIND`, `VALUES`, `GRAPH`, `SubSelect`, `GROUP BY`, `HAVING`, `ORDER BY`, `LIMIT`/`OFFSET`, Property Paths including `!(...)`, Blank-Node Property Lists `[...]`, Collections `(...)`) and Update (`INSERT DATA`, `DELETE DATA`, `DELETE/INSERT WHERE`).
- **Native Execution Engine:** Generalized Leapfrog Triejoin (WCOJ) for multi-pattern BGPs, with direct `SparqlTripleSource` adapters for `WasmOntologyReasoner`, `WasmOntologyStore`, `PagedStorageEngine`, and `SqliteRdfSource`.
- **Static Linter (`lintSparqlDocument`):** Syntax (`S1001`), undeclared/duplicate prefixes (`S2001`/`S2002`), unbound `SELECT` variables (`S3001`), and AST-level `SERVICE` policy enforcement (`S4001`).

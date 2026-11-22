<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/sparql

**Maturity:** Beta · **Extensions:** `.rq`, `.sparql` · **Docs:** [modelscript.org/languages/sparql](https://modelscript.org/languages/sparql)

First-class W3C SPARQL 1.1 Query & Update language implementation for ModelScript, built with `@modelscript/dsl` (native WebAssembly GLR parser) and a zero-dependency algebra + Leapfrog Triejoin execution engine.

## Features

- **WASM GLR Parser (`parser.wasm`):** Full SPARQL 1.1 Query (`SELECT`, `CONSTRUCT`, `DESCRIBE`, `ASK`, `OPTIONAL`, `UNION`, `MINUS`, `FILTER`, `BIND`, `VALUES`, `GRAPH`, `SubSelect`, `GROUP BY`, `HAVING`, `ORDER BY`, `LIMIT`/`OFFSET`, Property Paths including `!(...)`, Blank-Node Property Lists `[...]`, Collections `(...)`) and Update (`INSERT DATA`, `DELETE DATA`, `DELETE/INSERT WHERE`).
- **Native Execution Engine:** Generalized Leapfrog Triejoin (WCOJ) for multi-pattern BGPs, with direct `SparqlTripleSource` adapters for `WasmOntologyReasoner`, `WasmOntologyStore`, `PagedStorageEngine`, and `SqliteRdfSource`.
- **OWL 2 QL Query Rewriting (`src/owl2ql-rewriter.ts`):** Rewrites conjunctive SPARQL queries over OWL 2 QL TBox axioms for ontology-based data access (OBDA).
- **Reactive Subscriptions & Virtual Arena (`src/reactive.ts`, `src/virtual-arena.ts`):** Incremental reactive query evaluation and zero-copy virtual RDF graph projection over ModelScript's linear-memory DAE arena.
- **Static Linter (`lintSparqlDocument`):** Syntax (`S1001`), undeclared/duplicate prefixes (`S2001`/`S2002`), unbound `SELECT` variables (`S3001`), and AST-level `SERVICE` policy enforcement (`S4001`).

## Package Structure

| File                     | Responsibility                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `src/language.ts`        | `@modelscript/dsl` SPARQL 1.1 grammar and language registration (`.rq`, `.sparql`) |
| `src/ast.ts`             | SPARQL 1.1 query and update algebra AST types                                      |
| `src/engine.ts`          | Leapfrog Triejoin (WCOJ) SPARQL 1.1 query & update execution engine                |
| `src/owl2ql-rewriter.ts` | OWL 2 QL TBox query rewriter for OBDA                                              |
| `src/reactive.ts`        | Reactive live-query subscription manager                                           |
| `src/virtual-arena.ts`   | Zero-copy virtual RDF graph adapter over ModelScript DAE linear memory             |
| `src/lints.ts`           | `lintSparqlDocument` static linter (`S1001`, `S2001`, `S2002`, `S3001`, `S4001`)   |
| `src/index.ts`           | Public package entry point and barrel exports                                      |

## Scripts

```bash
pnpm --filter @modelscript/sparql build
pnpm --filter @modelscript/sparql test
pnpm --filter @modelscript/sparql lint
pnpm --filter @modelscript/sparql typecheck
```

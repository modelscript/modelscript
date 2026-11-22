---
title: "SPARQL 1.1 Query & Update (.rq, .sparql)"
description: "The @modelscript/sparql package provides native W3C SPARQL 1.1 Query and Update parsing, Leapfrog Triejoin execution, OWL 2 QL query rewriting, and virtual triple-store adapters over SymbolIndex and DAEBuilder arenas."
---

# SPARQL 1.1 Query & Update (`.rq`, `.sparql`)

The `@modelscript/sparql` package (`languages/sparql`) provides first-class **W3C SPARQL 1.1 Query and Update** support compiled to a native WebAssembly GLR parser (`parser.wasm`) with a built-in algebraic query engine, Leapfrog Triejoin evaluation, OWL 2 QL query rewriting, and reactive graph subscriptions.

---

## Supported File Formats

| Extension | Format           | Description                                                                                                      |
| :-------- | :--------------- | :--------------------------------------------------------------------------------------------------------------- |
| `.rq`     | SPARQL 1.1 Query | Standard W3C SPARQL 1.1 query and update documents (`SELECT`, `CONSTRUCT`, `ASK`, `DESCRIBE`, `INSERT`/`DELETE`) |
| `.sparql` | SPARQL 1.1 File  | Alternate extension for SPARQL 1.1 queries, federated graph traversals, and update scripts                       |

---

## Capabilities

- **Query Forms**: `SELECT`, `ASK`, `CONSTRUCT`, `DESCRIBE`, subqueries (`{ SELECT ... }`), `OPTIONAL`, `UNION`, `MINUS`, `FILTER`, `BIND`, `VALUES`, `GRAPH`, `GROUP BY`, `HAVING`, `ORDER BY`, `LIMIT`, `OFFSET`, and SPARQL 1.1 Property Paths (`+`, `*`, `?`, `^`, `/`, `|`, `!(...)`).
- **Update Forms**: `INSERT DATA`, `DELETE DATA`, `DELETE { ... } INSERT { ... } WHERE { ... }`, and `INSERT { ... } WHERE { ... }`.
- **OWL 2 QL Query Rewriting (`rewriteSparqlQueryOwl2QL`)**: Rewrites conjunctive SPARQL queries against OWL 2 QL TBox ontologies (class hierarchies, inverse properties, domain/range axioms) for complete ontology-based data access (OBDA).
- **Virtual Arena Triple Sources (`virtual-arena.ts`)**: Exposes ModelScript's in-memory `SymbolIndex` (`createSymbolIndexTripleSource`) and linear-memory `DAEBuilder` (`createDaeArenaTripleSource`) directly as queryable RDF triple sources without serialization overhead, composable via `createCompositeTripleSource`.
- **Triple Store Backends (`engine.ts`)**: Direct adapters for `WasmOntologyReasoner` (`createOntologyReasonerSource`), `WasmOntologyStore` (`createOntologyStoreSource`), `PagedStorageEngine` (`createPagedStorageSource`), and in-memory quad arrays (`createArrayTripleSource`).
- **Static Linting (`lintSparqlDocument`)**: Checks syntax errors (`1001`), undefined prefixes (`2001`), unbound variables (`2002`), type/aggregate consistency (`3001`), and structural query advisories (`4001`).
- **MCP Integration**: Exposes `execute_sparql_query` via `sparql-mcp` for AI-assisted knowledge graph querying.

---

## Programmatic TypeScript API

```typescript
import {
  createArrayTripleSource,
  createCompositeTripleSource,
  createSymbolIndexTripleSource,
  lintSparqlDocument,
  rewriteSparqlQueryOwl2QL,
} from "@modelscript/sparql";

// Combine static RDF quads with a live workspace SymbolIndex
const staticSource = createArrayTripleSource([]);
const workspaceSource = createCompositeTripleSource(staticSource, createSymbolIndexTripleSource(symbolIndex));

// Rewrite a query against an OWL 2 QL ontology or lint a parsed document
const diagnostics = lintSparqlDocument(cstRoot, sourceText);
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="sparql" />

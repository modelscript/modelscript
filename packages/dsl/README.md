# `@modelscript/dsl`

ModelScript Grammar Workbench, native WebAssembly GLR parser compiler, linear-memory CST accessors, declarative static analysis & linter engine, Triple Graph Grammar (TGG) bidirectional transformation compiler, Critical Pair Analysis (CPA), E-graph equality saturation, and surgical CST unparser.

---

## Architecture & Capabilities

### 1. Declarative Language Workbench DSL (`@modelscript/dsl/dsl`)

Every polyglot language in ModelScript (`modelica`, `sysml2`, `modelscript`, `pscad`, `step`, `owl2`, `scad`, `cfd`, `fea`, `ssp`, `csv`) is defined via a single declarative `defineLanguage({...})` specification (`src/dsl/language.ts`):

- **Grammar Combinators (`src/dsl/combinators.ts`, `src/dsl/grammar.ts`)**: `seq`, `choice`, `repeat`, `repeat1`, `optional`, `prec`, `prec.left`, `prec.right`, `prec.dynamic`, `field`, `token`, `alias`, and external scanner hooks (`src/dsl/scanner-types.ts`).
- **Unified Language Facets**: A `LanguageDefinition` co-locates grammar rules with scope/symbol indexing (`scopes`), Salsa semantic queries (`queries`), static lints (`lints`), graphical diagram mappings (`diagram`), DAE lowering rules (`dae`), 3D CAD bindings (`cad`), bidirectional writeback rules (`writeback`), and MCP tool declarations (`mcp`).

### 2. Native WebAssembly GLR Parser Compiler (`@modelscript/dsl/parser`)

- **LR(1) / LALR(1) Automaton & GLR Table Generation (`src/codegen/parser/`)**: `buildParser` compiles declarative grammar definitions into compact parse tables, resolving shift/reduce and reduce/reduce ambiguities via Tomita-style Generalized LR (GLR) graph-structured stack (GSS) splitting and dynamic precedence merging.
- **Direct Binary `.wasm` Emission**: Emits standalone, zero-dependency WebAssembly parser modules (`parser.wasm`) that construct flat, cache-friendly Concrete Syntax Trees (CST) directly in WASM linear memory—eliminating external native C/C++ parser toolchains.
- **CLI Generator (`bin/language-generate.js`)**: Provides the `language-generate` binary used across `languages/*` workspaces to compile `language.ts` into `parser.wasm` and generated TypeScript/AssemblyScript bindings.

### 3. Linear-Memory CST Accessors & Surgical CST Unparser (`@modelscript/dsl/unparser`)

- **Zero-Allocation CST Traversal (`src/utils/cst-facade.ts`, `src/bindings/javascript/`)**: Provides typed integer-handle CST cursors (`u32` node pointers, `startOffset`, `endOffset`, `startPosition`, `endPosition`, child field lookup) operating directly over WebAssembly linear memory.
- **Surgical CST Unparser & Patch Engine (`src/unparser/index.ts`)**: Format-preserving CST printer and surgical text patcher that applies structural AST/diagram mutations (such as moving a component, rerouting a `connect()` wire, or updating a parameter modifier) back into source files while preserving surrounding comments, whitespace, and formatting.

### 4. Declarative `CompilerLint` & Static Analysis Engine (`@modelscript/dsl/codegen/analysis`)

- **CST & CodeGraph Lints (`src/dsl/codegraph.ts`)**: `CompilerLint` rules attach to specific CST node kinds and inspect structural patterns, scope bindings, and control-flow graphs (`db.ast`, `db.scope`, `db.diagnostic(node)`).
- **AOT Transpilation (`src/codegen/transpiler/`)**: Compiles declarative TypeScript query and lint specifications into native AssemblyScript kernels for in-WASM execution.

### 5. Triple Graph Grammars (`TggEngine`), Critical Pair Analysis (`CPA`) & E-Graphs

- **Triple Graph Grammar Compiler (`@modelscript/dsl/tgg`, `src/codegen/rewriting/compile_tgg.ts`)**: Compiles declarative multi-domain correspondence rules (`source`, `correspondence`, `target` graphs with attribute constraints) into executable forward, backward, and synchronization transformation kernels (`TggEngine`) linking SysML v2, Modelica, SPICE, and CAD.
- **Critical Pair Analysis (`@modelscript/dsl/cpa`, `src/codegen/rewriting/cpa.ts`)**: Statically analyzes pairs of TGG or graph-rewriting rules for produce-forbid, delete-use, and attribute-write conflicts, guaranteeing confluence and detecting concurrent multi-master engineering conflicts at edit time.
- **E-Graph Equality Saturation (`@modelscript/dsl/egraph`, `src/codegen/rewriting/egraph.ts`)**: Congruence-closure E-graph engine with algebraic rewrite rules and cost-function extraction for symbolic expression simplification, unit normalization, and DAE algebraic canonicalization.

---

## Subpath Exports

| Subpath                     | Description                                                                                               |
| :-------------------------- | :-------------------------------------------------------------------------------------------------------- |
| `@modelscript/dsl`          | Root barrel exporting grammar combinators, codegen, bindings, unparser, and tools                         |
| `@modelscript/dsl/dsl`      | `defineLanguage`, grammar combinators (`seq`, `choice`, `repeat`, `field`, `prec`), and `CodeGraph` types |
| `@modelscript/dsl/parser`   | Native WebAssembly GLR parser compiler (`buildParser`)                                                    |
| `@modelscript/dsl/bindings` | Runtime WASM parser loader (`createWasmParser`) and linear CST accessors                                  |
| `@modelscript/dsl/tgg`      | Triple Graph Grammar compiler and bidirectional synchronization engine                                    |
| `@modelscript/dsl/cpa`      | Critical Pair Analysis (CPA) conflict detector for graph transformation rules                             |
| `@modelscript/dsl/egraph`   | E-graph equality saturation and cost-based term extraction                                                |
| `@modelscript/dsl/unparser` | Format-preserving CST unparser and surgical source patcher                                                |
| `@modelscript/dsl/tools`    | Internationalization (i18n) catalog and semantic CST diff utilities                                       |

---

## Usage

```typescript
import { buildParser, choice, defineLanguage, field, prec, repeat, seq } from "@modelscript/dsl";
import { createWasmParser } from "@modelscript/dsl/bindings";

// 1. Define a language grammar and lint rules
export const miniCalc = defineLanguage({
  name: "minicalc",
  extensions: [".calc"],
  grammar: {
    program: ($) => repeat($.statement),
    statement: ($) => seq(field("name", $.identifier), "=", field("value", $.expr), ";"),
    expr: ($) => choice($.number, $.identifier, prec.left(1, seq(field("left", $.expr), "+", field("right", $.expr)))),
    identifier: () => /[a-zA-Z_][a-zA-Z0-9_]*/,
    number: () => /[0-9]+(\.[0-9]+)?/,
  },
});

// 2. Compile to a native WebAssembly GLR parser
const wasmBytes = await buildParser(miniCalc);
const { parser } = await createWasmParser(wasmBytes);
const tree = parser.parse("x = 10 + 20;");
```

---

## Scripts

```bash
# Bundle templates, compile TypeScript, and build browser bundle
npm run build --workspace=@modelscript/dsl

# Verify generated AssemblyScript kernels
npm run check:as --workspace=@modelscript/dsl

# Run unit tests (GLR parser, TGG, CPA, E-graph, unparser)
npm run test --workspace=@modelscript/dsl

# Typecheck and lint
npm run typecheck --workspace=@modelscript/dsl
npm run lint --workspace=@modelscript/dsl
```

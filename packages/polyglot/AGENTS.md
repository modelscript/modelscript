# AGENTS.md — Polyglot Coding Agent Guide

## Project Overview

Polyglot (`@modelscript/polyglot`) is a language workbench that generates tree-sitter grammars, typed AST wrappers, symbol indexers, query hooks, and reference resolution configs from a single declarative `language.ts` definition file.

## Converting Xtext Grammars to `language.ts`

When given an Xtext (`.xtext`) grammar, convert it to a polyglot `language.ts` file using the mapping below.

### Xtext → Polyglot Combinator Mapping

| Xtext Construct                                    | Polyglot Equivalent                                                |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| `grammar Name hidden(WS, ...)`                     | `language({ name: "...", extras: ($) => [/\s/, ...] })`            |
| `RuleName returns Type : body ;`                   | `RuleName: ($) => body`                                            |
| `A B C` (sequence)                                 | `seq(A, B, C)`                                                     |
| `A \| B` (alternatives)                            | `choice(A, B)`                                                     |
| `A?` (optional)                                    | `opt(A)`                                                           |
| `A*` (zero or more)                                | `rep(A)`                                                           |
| `A+` (one or more)                                 | `rep1(A)`                                                          |
| `field = Rule` (assignment)                        | `field("field", $.Rule)`                                           |
| `field += Rule` (list append)                      | `field("field", $.Rule)` (same — tree-sitter handles multiplicity) |
| `field ?= Rule` (boolean)                          | `field("field", $.Rule)`                                           |
| `'keyword'` (keyword literal)                      | `"keyword"`                                                        |
| `terminal NAME : regex ;`                          | `NAME: () => token(...)`                                           |
| `{Type}` (empty action, creates node)              | Remove — tree-sitter forbids empty-matching rules                  |
| `{Type.field += current}` (left-recursive rewrite) | `prec.left(PREC, seq(...))`                                        |
| `fragment RuleName`                                | `_RuleName` (underscore prefix, inlined by tree-sitter)            |
| `[Type \| QualifiedName]` (cross-reference)        | `ref({ syntax: ..., targetKinds: [...], resolve: "qualified" })`   |
| `import "uri" as Alias`                            | Not needed — polyglot uses TypeScript types directly               |

### Precedence

Xtext encodes precedence through the call chain (lower rules = higher precedence). In polyglot, use explicit `prec()` / `prec.left()` / `prec.right()` with numeric constants:

```typescript
const PREC = {
  CONDITIONAL: 1, // lowest
  NULL_COALESCING: 2,
  IMPLIES: 3,
  OR: 4,
  // ...
  PRIMARY: 16, // highest
} as const;
```

- **Left-associative binary operators** → `prec.left(PREC.X, seq(operand, rep(seq(operator, operand))))`
- **Right-associative operators** (e.g. exponentiation) → `prec.right(PREC.X, seq(operand, opt(seq(operator, operand))))`
- **Unary prefix operators** → `prec(PREC.X, seq(operator, operand))`

### Semantic Annotations

- **Symbol definitions** → `def({ syntax: ..., symbol: (self) => ({ kind, name, ... }) })`
- **References** → `ref({ syntax: ..., name: (self) => ..., targetKinds: [...], resolve: "qualified" })`
- **Queries** → Add `queries: { ... }` inside `def()` for computed properties
- **Lint rules** → Add `lints: { ... }` inside `def()` for diagnostics
- **Model config** → Add `model: { name, visitable, specializable, properties, queryTypes }` inside `def()`

### Tree-sitter Constraints to Watch For

1. **No empty-matching rules**: Xtext `{SysML::Feature}` (action-only rules with no parsed tokens) must be removed. Restructure alternatives that referenced them to start with the operator/keyword directly.
2. **Grammar name**: Must contain only word characters `[a-zA-Z0-9_]` — no hyphens. Use underscores.
3. **`tree-sitter.json`**: Must have a `metadata` field (not `attributes`), and `"c": true` in bindings for WASM compilation.
4. **Keyword conflicts**: If a keyword like `'*'` is also used as an operator, tree-sitter may need `conflicts` or `prec()` disambiguation.

### Workflow

```bash
# 1. Generate grammar.js and support files from language.ts
npm run generate ./examples/<lang>/language.ts

# 2. Launch the playground (auto-builds WASM parser)
npm run playground ./examples/<lang>/language.ts
```

### Example Reference

See `examples/modelica/language.ts` for a complete, production-quality language definition with:

- Full grammar (~3000 lines)
- Symbol definitions with `def()` for classes, components, extends, imports
- Cross-references with `ref()` for type specifiers and component references
- Salsa-memoized queries for Modelica instantiation algorithm
- Lint rules for naming conventions, type checking, arity checking
- Cross-language adapters for SysML2 interop

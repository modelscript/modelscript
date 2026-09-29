# @modelscript/runtime

Core runtime engine, linear-memory WebAssembly DAE arena, solver kernels, and formal verification framework for ModelScript.

## Linear Memory & Data-Oriented Architecture

The ModelScript compiler and simulation runtime operate on a data-oriented struct-of-arrays architecture in WebAssembly linear memory (`DAEBuilder`, linear CST pointers).

- Equations, expressions, and statements are lowered directly into `DAEBuilder` integer identifiers (`ExprId`, `EqId`, `StmtId`).
- Zero intermediate TypeScript AST wrapper allocations are created during lowering.
- In the arena-native pipeline (`ModelicaFlattener`), CST nodes are accessed via `db.cstNode(classId)` and lowered directly into `DAEBuilder`.

## Naming Conventions

Internal WebAssembly modules, numerical solver bindings, and linear-memory data structures use `snake_case` (e.g., `wasm_dae.ts`, `wasm_qr.ts`, `wasm_blt.ts`, `octagon_dbm.ts`, `sparse_cholesky.ts`) to:

1. Mirror native low-level AssemblyScript, C, Rust, and WebAssembly memory layout conventions.
2. Maintain stable, backwards-compatible public npm subpath exports specified in `package.json` (such as `@modelscript/runtime/wasm_dae.js`, `@modelscript/runtime/wasm_blt.js`, etc.).

All other services, utilities, and components across ModelScript follow standard repository `kebab-case.ts` and `PascalCase.tsx`.

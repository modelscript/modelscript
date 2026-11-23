<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/vhdl`

VHDL (IEEE Std 1076-1987 / 1076-1993 — VHSIC Hardware Description Language) language package for ModelScript (**Beta** tier).

## Features

- **Native WASM GLR Grammar (`src/language.ts`)**: Declarative `@modelscript/dsl` grammar compiled to `dist/parser.wasm` + `src-gen/bindings.{js,d.ts}` supporting `library`, `use`, `entity`, `port`, `generic`, `architecture`, `package`, `package body`, `signal`, `variable`, `constant`, `type`, `component`, `process`, `if/elsif/else`, `case/when`, `for/loop`, `<=`, `:=`, `port map`, `generic map`, `with ... select`, `when ... else`, and `--` comments.
- **Static Analysis & Lints (`src/errors.ts`, `src/lints/`)**: Diagnostics `VHDL1001`–`VHDL5006` covering syntax errors, mismatched entity/architecture end identifiers, duplicate declarations, undefined signal/port references, port direction violations (`in` driven / `out` read), incomplete sensitivity lists & inferred latches, vector width mismatches, and multiple drivers on unresolved signals.
- **Event-Driven Delta-Cycle 9-Value RTL Simulator (`src/solver/`)**: Full IEEE 1164 9-value (`U`, `X`, `0`, `1`, `Z`, `W`, `L`, `H`, `-`) resolution function, delta-cycle signal scheduling, immediate variable semantics, `rising_edge`/`falling_edge` clock detection, and hierarchical component instantiation.
- **DAE / Clocked Arena Lowering (`src/dae/`)**: Direct lowering of clocked synchronous processes and combinational logic into `@modelscript/runtime`'s `IDaeBuilder` linear memory arena.
- **Cross-Language Projections (`src/projections/`)**: Projections to Modelica 3.3+ synchronous clocks (`Clock`, `previous`, `when sample(...)`) and synthesizable IEEE 1364 Verilog (`module`, `always @(posedge clk)`, `assign`).
- **Cleanroom IEEE Standard Library (`src/catalog/`, `assets/vhdl-std-lib/`)**: Zero-I/O registered cleanroom library for `STD.STANDARD`, `IEEE.STD_LOGIC_1164`, `IEEE.NUMERIC_STD`, resolution functions, and primitive logic gates with an AssemblyScript WASM runtime (`runtime.wasm`) and parametric SVG block icons.
- **Workspace Indexing & LSP (`src/indexing.ts`, `src/lsp.ts`)**: UnifiedWorkspace symbol indexing, diagnostics, document symbols, hover documentation, and completions for `.vhd` / `.vhdl` files.

## Commands

```bash
npm run build       # Build stdlib WASM, GLR parser.wasm, and TypeScript output
npm run typecheck   # Strict TypeScript type checking
npm run lint        # ESLint checks on src/ and tests/
npm test            # Run full unit, grammar, lint, DAE, benchmark, stdlib, projection & LSP tests
```

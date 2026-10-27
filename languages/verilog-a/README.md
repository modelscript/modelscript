<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/verilog-a

**Verilog-A** and **Verilog-AMS** (IEEE 1857 / Accellera, `.va`, `.vams`) compact semiconductor device modeling and analog behavioral simulation language package for ModelScript. Features zero-regex AST parsing, 10 pre-flight analog convergence & discipline lint rules (`M7601`–`M7610`), direct linear-memory WebAssembly `DAEBuilder` lowering, bidirectional projections to Modelica 3.x and SPICE `.SUBCKT` netlists, and multi-file workspace indexing.

---

## Core Capabilities

- **Zero-Regex Verilog-A / Verilog-AMS Parser (`parseVerilogA`)**: Parses `.va` and `.vams` compact device models (BSIM, PSP, EKV, HEMT, PN diodes, memristors, RLC networks), extracting `module` headers, `inout`/`input`/`output` ports, disciplines (`electrical`, `thermal`, `kinematic`), `parameter real`/`integer` declarations with `from [min:max]` range bounds, `analog begin ... end` procedural blocks, branch contributions (`I(p, n) <+ ...`, `V(p, n) <+ ...`), and `ddt()`/`idt()`/`limexp()` operators.
- **Pre-Flight Analog Device Linter (`lintVerilogA`, `VerilogAErrorCode`)**: 10 static checks (`M7601`–`M7610`) enforcing port discipline declarations, parameter range constraints, constitutive branch coverage, `limexp()` convergence safety, and continuous `ddt()` usage with 1-click LSP quick-fixes.
- **Direct Linear-Memory DAE Arena Lowering (`lowerVerilogAToDae`)**: Lowers branch voltage/current conservation laws and `ddt(...)` charge/flux time-derivatives directly into `@modelscript/runtime`'s `DAEBuilder` without intermediate wrapper allocations.
- **Polyglot Projections (`verilogAToModelica`, `verilogAToSpice`)**:
  - `verilogAToModelica`: Translates Verilog-A modules into acausal Modelica 3.x electrical components (`Modelica.Electrical.Analog.Interfaces.Pin`)
  - `verilogAToSpice`: Synthesizes SPICE `.SUBCKT` definitions with non-linear behavioral `B`-sources and companion capacitances.
- **Multi-File Workspace Indexer & LSP (`VerilogAWorkspaceIndex`, `validateVerilogA`, `getVerilogADocumentSymbols`, `getVerilogAHover`)**: Implements `IWorkspaceIndex` for `.va`/`.vams` model libraries.

---

## Package Structure

| Path                                       | Description                                                                                  |
| :----------------------------------------- | :------------------------------------------------------------------------------------------- |
| `src/index.ts`                             | Public package exports                                                                       |
| `src/language.ts`                          | `verilogALanguage` definition and LSP actions (`verilog_a_lint`, `verilog_a_to_dae`, etc.)   |
| `src/types.ts`                             | Core TypeScript interfaces (`VerilogADocument`, `VerilogAModule`, `VerilogAStatement`, etc.) |
| `src/parser/verilog-a-parser.ts`           | `parseVerilogA` zero-regex parser for `.va` and `.vams` compact device models                |
| `src/parser/index.ts`                      | Parser module re-exports                                                                     |
| `src/lints/rules.ts`                       | `lintVerilogA` and `VerilogAErrorCode` (`M7601`–`M7610`) pre-flight analog linter            |
| `src/lints/index.ts`                       | Linter module re-exports                                                                     |
| `src/dae/verilog-a-to-dae.ts`              | `lowerVerilogAToDae` direct lowering of analog branch contributions to `DAEBuilder`          |
| `src/dae/index.ts`                         | DAE module re-exports                                                                        |
| `src/projections/verilog-a-to-modelica.ts` | `verilogAToModelica` translator to acausal Modelica 3.x electrical models                    |
| `src/projections/verilog-a-to-spice.ts`    | `verilogAToSpice` translator to SPICE `.SUBCKT` behavioral netlists                          |
| `src/projections/index.ts`                 | Projections module re-exports                                                                |
| `src/workspace-index.ts`                   | `VerilogAWorkspaceIndex` implementing `IWorkspaceIndex`                                      |
| `src/lsp.ts`                               | LSP diagnostics, document symbols, and hover providers                                       |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                                  | Severity  | Description                                                                                         |
| :------ | :------------------------------------ | :-------- | :-------------------------------------------------------------------------------------------------- |
| `M7601` | `unassigned-analog-branch`            | `error`   | Electrical port pair has no constitutive branch contribution equation (`<+`) in the `analog` block. |
| `M7602` | `discontinuous-derivative-expression` | `warning` | Discontinuous time-derivative operator `ddt()` is used inside a conditional `if`/`else` branch.     |
| `M7603` | `invalid-parameter-range`             | `error`   | Parameter default value violates its declared `from [min:max]` or `(min:max)` range constraint.     |
| `M7604` | `unbounded-exponential-growth`        | `warning` | Unbounded `exp()` function used in analog expression instead of numerically damped `limexp()`.      |
| `M7605` | `port-discipline-mismatch`            | `error`   | Module port has no declared discipline (e.g., `electrical`) or mismatches the module domain.        |
| `M7606` | `undefined-node-reference`            | `error`   | Branch access `V(...)` or `I(...)` references an undeclared node identifier.                        |
| `M7607` | `duplicate-module-declaration`        | `error`   | Duplicate `module` declaration with an identical name in the document.                              |
| `M7608` | `zero-resistance-branch`              | `error`   | Potential contribution `V(p, n) <+ 0.0` forms an unconstrained ideal short-circuit branch.          |
| `M7609` | `floating-internal-node`              | `warning` | Internal node is declared in a discipline statement but never referenced in any analog branch.      |
| `M7610` | `unsupported-analog-primitive`        | `warning` | Unsupported or deprecated analog primitive or system task.                                          |

---

## CLI & Programmatic Usage

### Command-Line Interface

```bash
# Lint a Verilog-A compact device model (M7601–M7610)
npx msx verilog-a lint bsim_mosfet.va

# Lower Verilog-A module to the ModelScript DAE arena
npx msx verilog-a flatten bsim_mosfet.va

# Project Verilog-A module to Modelica 3.x or SPICE .SUBCKT
npx msx verilog-a to-modelica bsim_mosfet.va
npx msx verilog-a to-spice bsim_mosfet.va
```

### Programmatic API

```typescript
import {
  lintVerilogA,
  lowerVerilogAToDae,
  parseVerilogA,
  verilogAToModelica,
  verilogAToSpice,
} from "@modelscript/verilog-a";

// 1. Parse Verilog-A compact device model
const doc = parseVerilogA(vaSource);
const mod = doc.modules[0]!;

// 2. Run pre-flight analog convergence & discipline linter (M7601–M7610)
const diagnostics = lintVerilogA(doc);

// 3. Lower directly to WebAssembly DAEBuilder arena
const dae = lowerVerilogAToDae(mod);
console.log(`Variables: ${dae.getVarCount()}, Equations: ${dae.getEqCount()}`);

// 4. Project to Modelica 3.x and SPICE .SUBCKT
const modelicaCode = verilogAToModelica(mod);
const spiceSubckt = verilogAToSpice(mod);
```

---

## Scripts

| Command             | Description                                                    |
| :------------------ | :------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript sources to `dist/` (`tsc`)                  |
| `npm run clean`     | Remove `dist/` build artifacts (`rimraf dist`)                 |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                          |
| `npm test`          | Run unit and integration test suite via `test-runner.js`       |
| `npm run typecheck` | Run TypeScript type checking without emitting (`tsc --noEmit`) |

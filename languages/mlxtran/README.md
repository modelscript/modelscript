<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/mlxtran

Monolix MLXTRAN (`.mlxtran`) pharmacometrics and clinical non-linear mixed-effects (NLME) modeling language package for ModelScript. Features a zero-regex parser and serializer (`parseMlxtran`, `serializeMlxtran`), multi-compartment pharmacokinetic macro and differential equation lowering directly to `DAEBuilder` in linear memory (`lowerMlxtranToDae`), pre-flight diagnostic lints (`M9421`–`M9430`), deterministic PK simulation with non-compartmental metrics (`solveMlxtranPk`), Modelica 3.x projections (`mlxtranToModelica`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **Zero-Regex MLXTRAN Parser & Serializer (`parseMlxtran`, `serializeMlxtran`)**: Character-by-character scanner extracting `[LONGITUDINAL]`, `[INDIVIDUAL]`, `[POPULATION]`, `input = {...}`, `EQUATION:`, `ddt_... = ...`, `OUTPUT:`, `output = {...}`, and `PK:` macros (`compartment`, `depot`, `absorption`, `elimination`, `transfer`).
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerMlxtranToDae`)**: Compiles continuous states `A_i` (from `ddt_A_i`), parameters, algebraic concentrations, and PK macros directly into ModelScript's zero-GC WebAssembly `DAEBuilder` struct-of-arrays arena.
- **Deterministic Pharmacokinetic Solver (`solveMlxtranPk`)**: Simulates 1- and 2-compartment oral and intravenous drug administration with bioavailability ($F$), absorption rate ($k_a$), clearance ($CL$), central volume ($V$), peripheral volume ($V_2$), and inter-compartmental clearance ($Q$).
- **Pre-Flight Pharmacometric Lint Rules (`M9421`–`M9430`, `lintMlxtran`)**: Static verification of required `[LONGITUDINAL]` sections, undeclared input parameters, mass conservation in compartment transfers, non-positive parameter bounds, and duplicate state equations.
- **Modelica 3.x PK/PD Projection (`mlxtranToModelica`)**: Synthesizes standalone Modelica 3.x pharmacokinetic models for whole-body physiological co-simulation.
- **Language Server Protocol (`lsp.ts`)**: Diagnostics, document symbols, hover definitions, completion suggestions, and code actions.

---

## Package Structure

| Path                                     | Description                                                                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                           | Public package exports                                                                                                     |
| `src/language.ts`                        | `mlxtranLanguage` definition and LSP actions (`lint_mlxtran`, `mlxtran_simulate`, `mlxtran_to_dae`, `mlxtran_to_modelica`) |
| `src/types.ts`                           | `MlxtranDocument`, `MlxtranModel`, `MlxtranEquation`, `MlxtranMacro`, `MlxtranParameter` AST definitions                   |
| `src/errors.ts`                          | `MlxtranErrorCode` diagnostic registry (`M9421`–`M9430`)                                                                   |
| `src/parser/mlxtran-parser.ts`           | Zero-regex MLXTRAN parser and serializer                                                                                   |
| `src/parser/index.ts`                    | Parser barrel exports                                                                                                      |
| `src/lints/mlxtran-linter.ts`            | Pharmacometric diagnostic linter                                                                                           |
| `src/lints/index.ts`                     | Linter barrel exports                                                                                                      |
| `src/solvers/mlxtran-solver.ts`          | Compartmental PK integrator with trapezoidal AUC, Cmax, and half-life calculations                                         |
| `src/solvers/index.ts`                   | Solver barrel exports                                                                                                      |
| `src/dae/mlxtran-to-dae.ts`              | Direct lowering into `DAEBuilder` linear memory arena                                                                      |
| `src/dae/index.ts`                       | DAE lowering barrel exports                                                                                                |
| `src/projections/mlxtran-to-modelica.ts` | Translation to Modelica 3.x continuous model                                                                               |
| `src/projections/index.ts`               | Projections barrel exports                                                                                                 |
| `src/lsp.ts`                             | LSP validation, hover, document symbols, and completions                                                                   |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                              | Severity  | Description                                                                                               |
| ------- | --------------------------------- | --------- | --------------------------------------------------------------------------------------------------------- |
| `M9421` | `missing-longitudinal-block`      | `error`   | MLXTRAN model is missing the required `[LONGITUDINAL]` block.                                             |
| `M9422` | `undeclared-input-parameter`      | `error`   | Equation references parameter `'param'` not declared in `'input = {...}'`.                                |
| `M9423` | `orphan-derivative`               | `warning` | Differential state variable `'var'` has time derivative `'ddt_var'` but is never observed or transferred. |
| `M9424` | `mass-conservation-leak`          | `error`   | Mass conservation violation: transfer from compartment `'from'` to `'to'` has mismatched rates.           |
| `M9425` | `negative-parameter-bound`        | `error`   | Physiological parameter `'param'` has non-positive value or lower bound $\le 0$.                          |
| `M9426` | `duplicate-equation-definition`   | `error`   | Variable or derivative `'name'` is defined multiple times.                                                |
| `M9427` | `missing-output-definition`       | `warning` | Model defines differential equations but lacks an `'OUTPUT:'` section.                                    |
| `M9428` | `invalid-macro-target`            | `error`   | PK macro `'macro'` targets undefined compartment or variable `'target'`.                                  |
| `M9429` | `syntax-error`                    | `error`   | MLXTRAN syntax error parsing tokens or equation blocks.                                                   |
| `M9430` | `unbalanced-compartment-transfer` | `error`   | Compartment transfer specifies undefined source or destination compartment index.                         |

<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/nmodl

NEURON Model Description Language (NMODL, `.mod`) biophysical electrophysiology and neural simulation modeling package for ModelScript. Features a zero-regex block parser (`parseNmodl`, `serializeNmodl`), direct linear-memory `DAEBuilder` lowering (`lowerNmodlToDae`), pre-flight biophysical and ionic current lints (`M9441`–`M9450`), deterministic Hodgkin-Huxley action potential solver with voltage clamp and current clamp integration (`solveNmodlActionPotential`), Modelica 3.x continuous projection (`nmodlToModelica`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **Zero-Regex NMODL Parser & Serializer (`parseNmodl`, `serializeNmodl`)**: Extracts `TITLE`, `NEURON` (`SUFFIX`, `USEION`, `READ`, `WRITE`, `RANGE`, `GLOBAL`), `UNITS`, `PARAMETER` (with units and `<min, max>` bounds), `ASSIGNED`, `STATE` (gating variables, concentrations), `BREAKPOINT` (`SOLVE`, conductance and current assignments), `DERIVATIVE` (`m' = ...`), `PROCEDURE`, and `INITIAL` blocks.
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerNmodlToDae`)**: Compiles gating state variables, reversal potentials, maximum conductances, time-derivatives $\frac{dm}{dt}$, and non-linear ionic currents into ModelScript's zero-GC WebAssembly `DAEBuilder` struct-of-arrays arena.
- **Hodgkin-Huxley Action Potential Simulator (`solveNmodlActionPotential`)**: Simulates single-compartment soma membrane dynamics under current-clamp injection ($I_{\text{stim}}$), extracting firing frequency, peak potential ($V_{\text{peak}}$), resting potential ($V_{\text{rest}}$), and action potential half-width.
- **Pre-Flight Biophysical Lint Rules (`M9441`–`M9450`, `lintNmodl`)**: Static verification of `NEURON` and `SUFFIX` declarations, missing state evolution in `DERIVATIVE`, unassigned `WRITE` ionic currents, gating variable bounds $[0, 1]$, and reversal potential signs.
- **Modelica 3.x Electrophysiology Projection (`nmodlToModelica`)**: Synthesizes standalone Modelica 3.x continuous membrane channel models for multi-compartment cable co-simulation.
- **Language Server Protocol (`lsp.ts`)**: Diagnostics, document symbols, hover definitions, completion suggestions, and code actions.

---

## Package Structure

| Path                                   | Description                                                                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                         | Public package exports                                                                                           |
| `src/language.ts`                      | `nmodlLanguage` definition and LSP actions (`lint_nmodl`, `nmodl_simulate`, `nmodl_to_dae`, `nmodl_to_modelica`) |
| `src/types.ts`                         | `NmodlDocument`, `NmodlModel`, `NmodlIonUse`, `NmodlParameter`, `NmodlEquation` AST definitions                  |
| `src/errors.ts`                        | `NmodlErrorCode` diagnostic registry (`M9441`–`M9450`)                                                           |
| `src/parser/nmodl-parser.ts`           | Zero-regex NMODL parser and serializer                                                                           |
| `src/parser/index.ts`                  | Parser barrel exports                                                                                            |
| `src/lints/nmodl-linter.ts`            | Biophysical and ionic current diagnostic linter                                                                  |
| `src/lints/index.ts`                   | Linter barrel exports                                                                                            |
| `src/solvers/nmodl-solver.ts`          | Action potential integrator with firing frequency, spike amplitude, and threshold calculations                   |
| `src/solvers/index.ts`                 | Solver barrel exports                                                                                            |
| `src/dae/nmodl-to-dae.ts`              | Direct lowering into `DAEBuilder` linear memory arena                                                            |
| `src/dae/index.ts`                     | DAE lowering barrel exports                                                                                      |
| `src/projections/nmodl-to-modelica.ts` | Translation to Modelica 3.x continuous model                                                                     |
| `src/projections/index.ts`             | Projections barrel exports                                                                                       |
| `src/lsp.ts`                           | LSP validation, hover, document symbols, and completions                                                         |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                           | Severity  | Description                                                                                                     |
| ------- | ------------------------------ | --------- | --------------------------------------------------------------------------------------------------------------- |
| `M9441` | `missing-neuron-block`         | `error`   | NMODL file is missing the required `'NEURON { ... }'` interface block.                                          |
| `M9442` | `missing-suffix-declaration`   | `error`   | `'NEURON'` block is missing the required `'SUFFIX'` mechanism identifier.                                       |
| `M9443` | `missing-derivative-evolution` | `error`   | State variable `'var'` declared in `'STATE'` block has no time-derivative equation in `'DERIVATIVE'`.           |
| `M9444` | `unassigned-write-current`     | `error`   | Ion current `'cur'` declared in `'USEION ... WRITE'` is never computed in `'BREAKPOINT'`.                       |
| `M9445` | `gating-probability-bounds`    | `error`   | Gating variable initial condition or value `'val'` falls outside physical probability bounds $[0, 1]$.          |
| `M9446` | `reversal-potential-sign`      | `warning` | Reversal potential parameter `'param'` has unphysical polarity ($E_{\text{Na}} \le 0$ or $E_{\text{K}} \ge 0$). |
| `M9447` | `missing-breakpoint-block`     | `error`   | Channel mechanism is missing the required `'BREAKPOINT'` block.                                                 |
| `M9448` | `duplicate-block-declaration`  | `error`   | Section block `'block'` is declared multiple times.                                                             |
| `M9449` | `syntax-error`                 | `error`   | NMODL syntax error parsing tokens or procedure bodies.                                                          |
| `M9450` | `unbalanced-units-bracket`     | `warning` | Parameter declaration has unbalanced unit parentheses or bracket specifications.                                |

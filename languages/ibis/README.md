<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/ibis

ANSI/EIA-656-B IBIS (I/O Buffer Information Specification) high-speed digital signal integrity and IC package parasitic modeling package (`.ibs`) for ModelScript. Features an IBIS v3.2–v7.x parser (`parseIbis`), multi-file workspace indexing (`IbisWorkspaceIndex`), piecewise-linear I/V curve and dynamic output impedance solvers (`evaluateBufferCurrent`, `calculateOutputResistance`, `interpolateIvTable`), direct linear-memory `DAEBuilder` RLC package & behavioral driver lowering (`lowerIbisToDae`), 9 pre-flight signal-integrity lint rules (`M8303`–`M8322`), Modelica 3.x analog buffer projections (`ibisToModelica`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **ANSI/EIA-656-B IBIS Parser (`parseIbis`)**: Parses `.ibs` behavioral buffer specification files with engineering SI suffix scaling (`f`, `p`, `n`, `u`, `m`, `k`, `M`, `G`) and `typ` / `min` / `max` process-voltage-temperature (PVT) corner extraction across:
  - **File Header & Component Sections**: `[IBIS Ver]`, `[Component]`, `[Manufacturer]`, `[Package]` lumped RLC parasitics (`R_pkg`, `L_pkg`, `C_pkg`), `[Pin]` per-pin parasitic overrides (`R_pin`, `L_pin`, `C_pin`), and `[Diff Pin]` differential pair declarations.
  - **Behavioral `[Model]` Sections**: `Model_type` (`I/O`, `Output`, `Input`, `3-state`, `Open_drain`), `C_comp` die capacitance, `Vinl` / `Vinh` input thresholds, `[Voltage Range]`, `[Pulldown]` / `[Pullup]` / `[GND Clamp]` / `[POWER Clamp]` I/V tables, `[Ramp]` $dV/dt$ rising/falling slew rates, and `[Rising Waveform]` / `[Falling Waveform]` V/T tables.
- **Behavioral I/V Interpolation & Output Impedance Solver (`interpolateIvTable`, `evaluateBufferCurrent`, `calculateOutputResistance`)**: $\mathcal{O}(\log N)$ binary-search piecewise-linear interpolation and boundary slope extrapolation across `[Pullup]`, `[Pulldown]`, `[GND Clamp]`, and `[POWER Clamp]` tables, computing total pad current $I_{\text{pad}}(V)$ and linear-region high/low driver on-resistance ($R_{\text{on,low}}$, $R_{\text{on,high}}$).
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerIbisToDae`)**: Lowers die pad capacitance ($C_{\text{comp}} \frac{dV_{\text{die}}}{dt}$), bond-wire/lead package inductance ($L_{\text{pkg}} \frac{dI_{\text{pkg}}}{dt}$), series package resistance ($R_{\text{pkg}}$), pin capacitance ($C_{\text{pkg}}$), and driver output conductance directly into ModelScript's zero-GC WebAssembly `DAEBuilder` struct-of-arrays arena.
- **9 Pre-Flight Signal-Integrity Lint Rules (`M8303`–`M8322`, `lintIbis`)**: Static verification of I/V table monotonicity (`[Pulldown]`, `[Pullup]`, `[GND Clamp]`, `[POWER Clamp]`), dangling `[Pin]` model bindings, empty `[Pin]` tables, inverted `[Voltage Range]` corners, ESD clamping diode current divergence, missing `[Ramp]` / I/V driver definitions, and non-positive $C_{\text{comp}}$ or package RLC parasitics.
- **Modelica 3.x Analog Buffer Projection (`ibisToModelica`)**: Synthesizes standardized Modelica 3.x equivalent RLC package and behavioral driver models for mixed-signal board-level signal integrity co-simulation.
- **Multi-File Workspace Indexing & LSP (`IbisWorkspaceIndex`, `provideIbisHover`, `provideIbisCompletions`)**: Implements `IWorkspaceIndex` for cross-file component, pin, and buffer model navigation with hover cards, keyword completion, and AST writeback.

---

## Package Structure

| Path                                  | Description                                                                                                     |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                        | Public package exports                                                                                          |
| `src/language.ts`                     | `ibisLanguage` definition and LSP actions (`lint_ibis`, `ibis_to_dae`, `ibis_to_modelica`, `ibis_eval_buffer`)  |
| `src/types.ts`                        | `IbisDeck`, `IbisComponent`, `IbisPin`, `IbisModel`, `CornerValues`, `TableRow`, and `WaveformTable` interfaces |
| `src/errors.ts`                       | `IbisErrorCode` diagnostic registry (`M8303`–`M8322`)                                                           |
| `src/parser/ibis-parser.ts`           | `parseIbis` ANSI/EIA-656-B `.ibs` parser with engineering unit prefix scaling                                   |
| `src/lints/ibis-linter.ts`            | `lintIbis` I/V monotonicity, pin binding, and package parasitic diagnostic engine                               |
| `src/lints/index.ts`                  | Linter barrel exports                                                                                           |
| `src/solvers/buffer-solver.ts`        | `interpolateIvTable`, `evaluateBufferCurrent`, and `calculateOutputResistance` behavioral buffer solvers        |
| `src/dae/ibis-to-dae.ts`              | `lowerIbisToDae` direct lowering of buffer drivers and RLC package networks into `DAEBuilder` linear memory     |
| `src/projections/ibis-to-modelica.ts` | `ibisToModelica` translator to Modelica 3.x analog I/O buffer models                                            |
| `src/workspace-index.ts`              | `IbisWorkspaceIndex` implementing `IWorkspaceIndex` across `.ibs` files                                         |
| `src/lsp.ts`                          | LSP hover, completion, and symbol providers                                                                     |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                         | Severity  | Description                                                                                                        |
| ------- | ---------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------ |
| `M8303` | `non-monotonic-iv-curve`     | `warning` | IBIS model `'modelName'` contains non-monotonic slope in `'tableType'` I/V table between $V_1$ and $V_2$.          |
| `M8305` | `missing-pin-model-binding`  | `error`   | Component pin `'pinName'` references undefined `[Model]` `'modelName'` (and is not `POWER`, `GND`, or `NC`).       |
| `M8316` | `missing-component-pins`     | `error`   | Component `'compName'` declaration has no defined pins in `[Pin]` section.                                         |
| `M8317` | `invalid-voltage-range`      | `error`   | IBIS model `'modelName'` has invalid `[Voltage Range]`: `min` voltage is greater than `max` voltage.               |
| `M8318` | `clamping-diode-divergence`  | `warning` | Model `'modelName'` clamp table (`[GND Clamp]` / `[POWER Clamp]`) diverges to excessive current ($> 10\text{ A}$). |
| `M8319` | `missing-pullup-pulldown`    | `error`   | Driver model `'modelName'` of type `'modelType'` is missing both `[Pullup]`/`[Pulldown]` I/V tables and `[Ramp]`.  |
| `M8320` | `negative-die-capacitance`   | `error`   | IBIS model `'modelName'` specifies non-positive die capacitance `C_comp`.                                          |
| `M8321` | `negative-package-parasitic` | `error`   | Component `'compName'` package parasitic (`R_pkg`, `L_pkg`, or `C_pkg`) has a non-positive value.                  |
| `M8322` | `no-models-defined`          | `error`   | IBIS file contains no buffer `[Model]` definitions.                                                                |

---

## CLI & Programmatic Usage

### CLI Commands

```bash
# Inspect components, pin mappings, and [Model] definitions in an IBIS file
npx msx ibis inspect ddr5_dq.ibs

# Run pre-flight I/V monotonicity, pin binding, and parasitic checks (M8303-M8322)
npx msx ibis lint ddr5_dq.ibs

# Evaluate driver on-resistance (R_on) and output pad current characteristics
npx msx ibis eval ddr5_dq.ibs

# Lower IBIS buffer & RLC package parasitics to the linear-memory DAE arena
npx msx ibis to-dae ddr5_dq.ibs

# Export IBIS buffer model to a Modelica 3.x analog model
npx msx ibis to-modelica ddr5_dq.ibs -o Ddr5Buffer.mo
```

### Programmatic Usage

```typescript
import {
  calculateOutputResistance,
  evaluateBufferCurrent,
  ibisToModelica,
  lintIbis,
  lowerIbisToDae,
  parseIbis,
} from "@modelscript/ibis";

const ibsSource = `
[IBIS Ver] 5.1
[Component] DDR5_SDRAM
[Manufacturer] ModelScript Semiconductor
[Package]
R_pkg  50.0m   40.0m   65.0m
L_pkg  1.2n    0.9n    1.6n
C_pkg  0.4p    0.3p    0.5p
[Pin] signal_name  model_name  R_pin  L_pin  C_pin
A1    DQ0          DQ_IO       45m    1.1n   0.38p
[Model] DQ_IO
Model_type I/O
C_comp  1.1p  0.9p  1.3p
[Voltage Range]  1.10V  1.05V  1.15V
[Pulldown]
0.00V   0.0mA   0.0mA   0.0mA
0.55V   16.0mA  13.0mA  19.0mA
1.10V   28.0mA  23.0mA  33.0mA
[Pullup]
0.00V   0.0mA   0.0mA   0.0mA
0.55V  -15.5mA -12.5mA -18.5mA
1.10V  -27.5mA -22.5mA -32.5mA
[Ramp]
dV/dt_r  0.66V/0.15n  0.60V/0.18n  0.72V/0.12n
dV/dt_f  0.66V/0.15n  0.60V/0.18n  0.72V/0.12n
`;

// 1. Parse IBIS deck and run M8303-M8322 pre-flight diagnostics
const deck = parseIbis(ibsSource, "ddr5_dq.ibs");
const diagnostics = lintIbis(deck);

// 2. Evaluate driver output impedance and pad current
const dqModel = deck.models.get("DQ_IO")!;
const { rOnLow, rOnHigh } = calculateOutputResistance(dqModel);
const current = evaluateBufferCurrent(dqModel, 0.9, 1);
console.log(rOnLow, rOnHigh, current.iTotal);

// 3. Lower to DAEBuilder linear memory or export to Modelica
const dae = lowerIbisToDae(deck);
const modelicaCode = ibisToModelica(deck);
```

---

## Scripts

| Command             | Description                                                           |
| ------------------- | --------------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                                         |
| `npm test`          | Run IBIS parser, linter, I/V buffer solver, DAE, and projection tests |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                 |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                  |
| `npm run clean`     | Remove `dist/` build artifacts                                        |

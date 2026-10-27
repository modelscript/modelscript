<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/easy5

Boeing / MSC Software **EASY5** multidisciplinary systems dynamic modeling, simulation, and linear control systems engineering package (`.ez5`, `.ezm`, `.ezd`, `.eas`, `.tab`) for ModelScript. Features component & lookup-table parsing, GP Standard Component Library lowering to linear-memory `DAEBuilder`, embedded Fortran `UG`/`UX` block compilation, equilibrium trim & Jacobian state-space linearization, Bode/Nyquist frequency-response analysis, 12 pre-flight static lint rules (`M7001`–`M7012`), and bidirectional Modelica/SSP projections.

---

## Core Capabilities

- **EASY5 Model & Table Parsers (`parseEasy5`, `parseEasy5Table`)**: Full ingestion of `.ez5`, `.ezm`, `.ezd`, and `.eas` schematics, parameter blocks (`XP`), initial state vectors (`S0`), custom port declarations, connections, and `.tab` multidimensional lookup tables.
- **GP Standard Component Catalog (`GP_BLOCK_DESCRIPTORS`, `getBlockDescriptor`)**: Native mathematical and physical formulations for `GA` (Gain), `SJ` (Summing Junction), `IN` (Integrator), `TF` (Transfer Function), `LA` (Lead-Lag Filter), `LM` (Limiter), `DZ` (Deadband), `HY` (Hysteresis), `TD` (Time Delay), `SW` (Switch), and `FN` (Table Lookup).
- **User General Fortran Blocks (`UG`/`UX`, `validateUserFortranCode`, `compileUserComponentStep`, `lowerUserComponentToDae`)**: Seamless integration with `@modelscript/fortran` for procedural Fortran derivative equations (`SD(i) = ...`, `S(i)`, `XP(i)`).
- **Direct Continuous DAE Arena Lowering (`easy5ToDae`, `lowerEasy5ToDae`)**: Zero-allocation lowering of continuous state derivatives and algebraic equations directly into `@modelscript/runtime`'s `IDaeBuilder`.
- **Linear Control Systems Suite (`trimEasy5`, `linearizeEasy5`, `computeEigenvalues`, `computeBodePlot`)**:
  - Newton-Raphson non-linear equilibrium trim solver ($\dot{x} = 0$)
  - Central finite-difference Jacobian linearization extracting continuous state-space matrices $(A, B, C, D)$
  - Eigenvalue/pole extraction with damping ratios ($\zeta$), natural frequencies ($\omega_n$), and right-half-plane stability checks
  - Frequency-response sweeps producing Bode magnitude (dB), phase (deg), and Nyquist loci.
- **Pre-Flight Static Linter (`lintEasy5`, `Easy5ErrorCode`)**: 12 control-theoretic and structural rules (`M7001`–`M7012`) including Tarjan SCC direct-feedthrough algebraic loop detection.
- **Polyglot Projections & Bidirectional TGG Sync (`easy5ToModelica`, `easy5ToSsp`, `synchronizeModelicaToEasy5`)**: Projects EASY5 models to `Modelica.Blocks` and FMI `SystemStructure.ssd`, with Triple Graph Grammar (TGG) synchronization back to `.ez5`.
- **Schematic Diagramming & Workspace Indexing (`buildEasy5DiagramData`, `renderEasy5SchematicSvg`, `Easy5WorkspaceIndex`)**: AntV X6 graph generation, headless SVG schematic rendering, and `IWorkspaceIndex` multi-file symbol indexing.

---

## Package Structure

| Path                                 | Description                                                                                      |
| :----------------------------------- | :----------------------------------------------------------------------------------------------- |
| `src/index.ts`                       | Public package exports                                                                           |
| `src/language.ts`                    | `easy5Language` grammar, LSP actions, and polyglot TGG configuration                             |
| `src/types.ts`                       | Core TypeScript interfaces (`Easy5Model`, `Easy5Component`, `LinearSystemModel`, `BodePlotData`) |
| `src/grammar/easy5-grammar.ts`       | EASY5 lexical and syntactic grammar combinators                                                  |
| `src/grammar/index.ts`               | Grammar module re-exports                                                                        |
| `src/parser/easy5-parser.ts`         | `parseEasy5` model deck parser (`.ez5`, `.ezm`, `.ezd`, `.eas`)                                  |
| `src/parser/table-parser.ts`         | `parseEasy5Table` lookup table parser (`.tab`)                                                   |
| `src/catalog/gp-library.ts`          | `GP_BLOCK_DESCRIPTORS` standard General Purpose block library catalog                            |
| `src/script/user-code.ts`            | Embedded Fortran `UG`/`UX` validation, step compilation, and DAE lowering                        |
| `src/lints/index.ts`                 | `lintEasy5` and `Easy5ErrorCode` pre-flight diagnostic engine (`M7001`–`M7012`)                  |
| `src/dae/lowering.ts`                | `lowerEasy5ToDae` continuous state and algebraic equation lowering to `IDaeBuilder`              |
| `src/dae/easy5-to-dae.ts`            | High-level `easy5ToDae` arena builder wrapper                                                    |
| `src/dae/index.ts`                   | DAE module re-exports                                                                            |
| `src/linear/trim.ts`                 | `trimEasy5` non-linear equilibrium operating point solver ($\dot{x} = 0$)                        |
| `src/linear/jacobian.ts`             | `linearizeEasy5` and `computeEigenvalues` state-space $(A, B, C, D)$ & pole analyzer             |
| `src/linear/frequency-response.ts`   | `computeBodePlot` frequency-response magnitude/phase and stability margin calculator             |
| `src/linear/index.ts`                | Linear analysis module re-exports                                                                |
| `src/projections/easy5ToModelica.ts` | `easy5ToModelica` projection to `Modelica.Blocks`                                                |
| `src/projections/easy5ToSsp.ts`      | `easy5ToSsp` projection to FMI `SystemStructure.ssd`                                             |
| `src/projections/index.ts`           | Projections module re-exports                                                                    |
| `src/tgg/easy5-rules.ts`             | Declarative TGG rules linking EASY5 and Modelica                                                 |
| `src/tgg/easy5-sync.ts`              | `synchronizeModelicaToEasy5` bidirectional parameter and topology synchronizer                   |
| `src/tgg/modelica-parser.ts`         | Lightweight Modelica block extractor for TGG synchronization                                     |
| `src/tgg/types.ts`                   | TGG synchronization types                                                                        |
| `src/tgg/index.ts`                   | TGG module re-exports                                                                            |
| `src/diagram/easy5-diagram.ts`       | `buildEasy5DiagramData` and `renderEasy5SchematicSvg` schematic visualizer                       |
| `src/workspace-index.ts`             | `Easy5WorkspaceIndex` multi-file workspace indexer                                               |
| `src/lsp.ts`                         | LSP validation, document symbols, hover, and action handlers                                     |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                         | Severity  | Description                                                                                                 |
| :------ | :--------------------------- | :-------- | :---------------------------------------------------------------------------------------------------------- |
| `M7001` | `unconnected-input-port`     | `warning` | Input port `comp.port` has no incoming connection.                                                          |
| `M7002` | `csmf-algebraic-loop`        | `error`   | Direct-feedthrough algebraic loop detected with no continuous state or delay.                               |
| `M7003` | `duplicate-component-id`     | `error`   | Duplicate component identifier declared in model.                                                           |
| `M7004` | `uninitialized-state`        | `info`    | Continuous state in component defaults to `0.0` with no explicit `S0` specified.                            |
| `M7005` | `improper-transfer-function` | `error`   | Transfer function in `TF` component is improper: numerator degree exceeds denominator degree.               |
| `M7006` | `parameter-out-of-bounds`    | `error`   | Component parameter is out of valid physical bounds (e.g., `LA` lag $\tau_2 \le 0$ or `LM` $LL > UL$).      |
| `M7007` | `port-dimension-mismatch`    | `error`   | Connection width mismatch between source port dimension and destination port dimension.                     |
| `M7008` | `state-index-out-of-bounds`  | `error`   | State index `S(idx)` in component exceeds allocated continuous states.                                      |
| `M7009` | `sample-rate-mismatch`       | `warning` | Sample rate mismatch between connected discrete components without a rate transition block.                 |
| `M7010` | `user-fortran-syntax-error`  | `error`   | Embedded User Fortran (`UG`) subroutine in component contains a syntax or semantic defect.                  |
| `M7011` | `unstable-linear-pole`       | `warning` | Component has an open-loop pole in the right-half plane ($\text{Re}(\lambda) > 0$), indicating instability. |
| `M7012` | `table-extrapolation-hazard` | `warning` | Component references a lookup table without bounded extrapolation protection.                               |

---

## CLI & Programmatic Usage

### Command-Line Interface

```bash
# Lint an EASY5 model for algebraic loops and parameter bounds
npx msx easy5 lint flight_control.ez5

# Trim, linearize, and lower EASY5 model to DAE arena
npx msx easy5 flatten flight_control.ez5

# Project EASY5 model to Modelica 3.x or FMI SSP
npx msx easy5 to-modelica flight_control.ez5
npx msx easy5 to-ssp flight_control.ez5
```

### Programmatic API

```typescript
import {
  computeBodePlot,
  computeEigenvalues,
  easy5ToModelica,
  linearizeEasy5,
  lintEasy5,
  lowerEasy5ToDae,
  parseEasy5,
  trimEasy5,
} from "@modelscript/easy5";

// 1. Parse EASY5 model deck
const model = parseEasy5(ez5Source);

// 2. Run pre-flight linter (M7001–M7012)
const diagnostics = lintEasy5(model);

// 3. Solve equilibrium trim and extract linear state-space (A, B, C, D)
const trim = trimEasy5(model);
const linearSys = linearizeEasy5(model, trim.states);
const poles = computeEigenvalues(linearSys.A);
const bode = computeBodePlot(linearSys, { fMinHz: 0.01, fMaxHz: 100, numPoints: 100 });

// 4. Lower to linear-memory DAE arena and project to Modelica 3.x
const dae = lowerEasy5ToDae(model);
const modelicaCode = easy5ToModelica(model);
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

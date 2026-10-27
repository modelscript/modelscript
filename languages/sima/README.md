<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/sima

MARINTEK / SINTEF Ocean **SIMO** (Simulation of Marine Operations) and **RIFLEX** (Riser and Slender Marine Structure Dynamics) package (`.inp`, `.sima`, `.sys`, `.hyd`) for ModelScript. Features multi-file workspace indexing (`SimaWorkspaceIndex`), card-deck and modern `.sima` XML parsers, SINTEF `.hyd` hydrodynamic RAO ingestion, DNV-OS-E301 & DNV-ST-0119 mooring line tension safety factor verification, fast in-WASM catenary shooting solver (`solveCatenary`), 15 pre-flight static marine linter rules (`M7001`–`M7015`), and turnkey Modelica/SSP co-simulation projections.

---

## Core Capabilities

- **SIMO & RIFLEX Card Deck Parser (`parseCardDeck`)**: Ingests classical card decks (`SYS`, `BODY`, `MASS`, `FAIRLEAD`, `LINE`, `SEGM`, `CRS`, `WAVE`, `WIND`, `CURR`, `DYNMOD`).
- **Modern SIMA XML Archive Parser (`parseSimaXml`)**: Ingests modern SINTEF Ocean `.sima` XML manifests, tasks, floater geometry, and line cross-section tables.
- **Hydrodynamic Transfer Function Reader (`parseHydFile`)**: Reads SINTEF `.hyd` and WAMIT `.out` tables: 1st-order Force RAO amplitude/phase tables, frequency-dependent added mass $A(\omega)$, potential damping $B(\omega)$, and restoring matrices.
- **Analytical & Elastic Catenary Solver (`solveCatenary`)**: High-performance shooting solver calculating fairlead horizontal tension $H$, vertical tension $V_f$, suspended length, touchdown point (TDP), anchor uplift angle, and 2D catenary sag profile in $< 1\text{ ms}$.
- **DNV-OS-E301 & DNV-ST-0119 Compliance Engine (`verifyDnvMooringCompliance`)**: Evaluates line tension safety factors against Minimum Breaking Load (MBL) for intact ($S_F \ge 1.67$) and damaged ($S_F \ge 1.25$) conditions, as well as anchor uplift angles.
- **15 Pre-Flight Marine Linter Rules (`M7001`–`M7015`, `lintSimaProject`)**: Detects hydrostatic instability ($GM < 0$), line length underflow, acoustic Courant time-step violations, unconnected fairleads, RAO frequency extrapolation, non-physical stiffness, and unphysical seabed friction.
- **Modelica & SSP Co-Simulation Projections (`simaToModelica`, `simaToSsp`)**: Synthesizes `Modelica.Mechanics.MultiBody` floater dynamics and `SystemStructure.ssd` multi-FMU architectures.

---

## Pre-Flight Marine Lint Rules (`M7001`–`M7015`)

| Code    | Identifier                    | Severity  | Description                                                                                      |
| :------ | :---------------------------- | :-------- | :----------------------------------------------------------------------------------------------- |
| `M7001` | `negative-metacentric-height` | `error`   | Floater hydrostatic instability ($GM_t < 0$ or $GM_l < 0$).                                      |
| `M7002` | `line-length-underflow`       | `error`   | Total unstretched line length is shorter than water depth at fairlead position.                  |
| `M7003` | `acoustic-courant-violation`  | `error`   | Dynamic time step exceeds line axial acoustic travel time ($\Delta t > \Delta L / \sqrt{EA/m}$). |
| `M7004` | `unconnected-attachment-node` | `error`   | Line end references a non-existent floater body attachment node or anchor.                       |
| `M7005` | `rao-frequency-extrapolation` | `warning` | Wave peak period $T_p$ falls outside tabulated `.hyd` RAO frequency range.                       |
| `M7006` | `invalid-stiffness-hierarchy` | `error`   | Non-physical cross-sectional axial ($EA \le 0$) or bending ($EI \le 0$) stiffness.               |
| `M7007` | `unphysical-seabed-friction`  | `warning` | Seabed friction coefficient $\mu < 0$ or $\mu > 2.0$.                                            |
| `M7008` | `missing-hydrostatic-matrix`  | `error`   | 6-DOF floater defined without waterplane area or restoring matrix $C$.                           |
| `M7009` | `duplicate-line-identifier`   | `error`   | Duplicate line or segment name declared in the slender system.                                   |
| `M7010` | `slack-compression-hazard`    | `warning` | Segment pre-tension is near zero with high wave excitation, risking snap loads.                  |
| `M7011` | `morison-drag-unspecified`    | `warning` | Slender member in wave active zone has zero Morison drag coefficient ($C_d = 0$).                |
| `M7012` | `anchor-uplift-warning`       | `warning` | Catenary anchor subject to vertical uplift angle where drag-embedment anchor is specified.       |
| `M7013` | `mass-matrix-asymmetric`      | `error`   | Floater structural mass/inertia matrix $M$ is not positive-definite or symmetric.                |
| `M7014` | `qtf-symmetry-violation`      | `warning` | Quadratic Transfer Function (QTF) matrix does not satisfy conjugate symmetry.                    |
| `M7015` | `exceeds-minimum-bend-radius` | `error`   | Flexible riser or dynamic cable nominal minimum bending radius (MBR) violated.                   |

---

## Package Structure

| Path                        | Description                                                                                                                     |
| :-------------------------- | :------------------------------------------------------------------------------------------------------------------------------ |
| `src/index.ts`              | Public package exports (`simaLanguage`, `parseSimaFile`, `solveCatenary`, `lintSimaProject`, `verifyDnvMooringCompliance`)      |
| `src/language.ts`           | `simaLanguage` grammar specification and file extension registration (`.inp`, `.sima`, `.sys`, `.hyd`)                          |
| `src/types.ts`              | Core TypeScript interfaces (`SimaModel`, `Vessel`, `MooringLine`, `LineSegment`, `HydrodynamicData`, `EnvironmentalConditions`) |
| `src/parser/index.ts`       | `parseCardDeck`, `parseSimaXml`, `parseHydFile`, and unified `parseSimaFile` parsers                                            |
| `src/solver/index.ts`       | `solveCatenary`, `WasmCatenaryBridge`, `simulateCumminsDynamics`, `createRationalRealization`, and `lowerSimaToDae`             |
| `assembly/`                 | In-WASM AssemblyScript catenary shooting and marine hydrodynamics kernel                                                        |
| `src/verification/index.ts` | `verifyDnvMooringCompliance`, `evaluateOffsetLimits`, `rainflowCount`, and `computeFatigueDamage` (DNV-OS-E301 / DNV-RP-C203)   |
| `src/lints/index.ts`        | `lintSimaProject` and `SimaErrorCode` (`M7001`–`M7015`) pre-flight marine diagnostic engine                                     |
| `src/projections/index.ts`  | `simaToModelica`, `simaToSsp`, and `simaToSysml2` cross-domain projectors                                                       |
| `src/dae/index.ts`          | `simaToDae` linear-memory `DAEBuilder` lowering                                                                                 |
| `src/workspace-index.ts`    | `SimaWorkspaceIndex` multi-file symbol indexer                                                                                  |
| `src/lsp.ts`                | LSP diagnostics (`validateSima`), hover cards (`getSimaHover`), and document symbols (`getSimaDocumentSymbols`)                 |

---

## Scripts

| Command              | Description                                                                                 |
| :------------------- | :------------------------------------------------------------------------------------------ |
| `npm run build`      | Build WASM kernel (`npm run build:wasm`) and compile TypeScript to `dist/`                  |
| `npm run build:wasm` | Compile AssemblyScript catenary kernel (`node scripts/build-wasm.js`)                       |
| `npm test`           | Run card/XML/.hyd parser, catenary solver, Cummins dynamics, DNV verification, & lint tests |
| `npm run lint`       | Run ESLint across `src/` and `tests/`                                                       |
| `npm run typecheck`  | Run `tsc --noEmit` type verification                                                        |
| `npm run clean`      | Remove `dist/` build artifacts                                                              |

---

## CLI Usage (`msx sima`)

```bash
# Inspect vessel hydrostatics, fairleads, mooring lines, and wave environment
msx sima inspect SemiSub.sima

# Run pre-flight marine lint rules (M7001–M7015)
msx sima lint SemiSub.sima

# Verify DNV-OS-E301 / DNV-ST-0119 mooring tension safety factors & anchor uplift
msx sima verify SemiSub.sima --consequence-class=2

# Evaluate vessel offset limits and damaged-line excursion envelopes
msx sima offset SemiSub.sima

# Project offshore model to Modelica MultiBody, SSP SystemStructure.ssd, SysML v2, or DAE
msx sima to-modelica SemiSub.sima --out=SemiSub.mo
msx sima to-ssp SemiSub.sima --out=SystemStructure.ssd
msx sima to-sysml2 SemiSub.sima --out=SemiSub.sysml
```

---

## Programmatic Usage

```typescript
import {
  lintSimaProject,
  parseSimaFile,
  simaToModelica,
  simaToSsp,
  solveCatenary,
  verifyDnvMooringCompliance,
} from "@modelscript/sima";

// 1. Parse SIMO/RIFLEX card deck (.inp / .sys) or .sima XML project
const model = parseSimaFile(sourceText, "SemiSub.sima");

// 2. Run pre-flight marine linter (M7001–M7015)
const diagnostics = lintSimaProject(model);

// 3. Solve elastic catenary equilibrium for a mooring line
const catenary = solveCatenary({
  horizontalSpan: 850,
  verticalSpan: 320,
  lineLength: 940,
  submergedWeightPerMeter: 1250,
  axialStiffnessEA: 8.5e8,
});
console.log(catenary.fairleadTension, catenary.horizontalTension, catenary.groundedLength);

// 4. Verify DNV-OS-E301 / DNV-ST-0119 mooring safety factors (Consequence Class 2)
const dnvReport = verifyDnvMooringCompliance(model, { consequenceClass: 2 });
console.log("DNV compliance passed:", dnvReport.passed);

// 5. Project to Modelica or SSP SystemStructure.ssd
const modelicaSource = simaToModelica(model);
const ssdXml = simaToSsp(model);
```

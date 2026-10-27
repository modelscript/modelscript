<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/gensys

GENSYS railway vehicle dynamics, wheel-rail contact mechanics, track geometry, and European homologation engineering package (`.calc`, `.run`, `.sub`, `.geom`, `.trax`, `.wheel`) for ModelScript. Features GENSYS deck and track geometry parsers (`parseGensysDeck`, `parseGensysTrack`), multi-file workspace indexing (`GensysWorkspaceIndex`), an AssemblyScript WebAssembly wheel-rail contact kernel (`assembly/contact.ts` → `dist/contact.wasm`) implementing Kalker FASTSIM and Polach creep force theories, EN 14363 / UIC 518 / EN 12299 / EN 14067-6 homologation verification (`evaluateEn14363`, `createHomologationReport`), direct linear-memory `DAEBuilder` lowering (`lowerGensysToDae`), 6 pre-flight railway lint rules (`G1001`–`G1006`), kinematic SVG diagram generation, and Modelica projections (`gensysToModelica`).

---

## Core Capabilities

- **GENSYS Deck & Track Geometry Parser (`parseGensysDeck`, `parseGensysTrack`, `evaluateGensysExpr`)**: Parses GENSYS `.calc`, `.run`, and `.sub` calculation decks (`mass`/`body`, `wheelset`, `coupl`/`spring`/`damper`, `sub`, `func`), `.geom` / `.trax` track alignments (horizontal curvature, cant/superelevation, gauge, and ERRI B176 PSD stochastic track irregularities), and `.wheel` wheel-rail profiles (S1002 / UIC60).
- **In-WASM Kalker FASTSIM & Polach Wheel-Rail Contact Kernel (`solveFastsim`, `solvePolach`, `assembly/contact.ts` → `dist/contact.wasm`)**:
  - **Kalker FASTSIM Tangential Rolling Contact**: Discretized Hertzian contact ellipse strip integration computing longitudinal ($F_x$), lateral ($F_y$), and spin ($M_z$) creep forces and slip/adhesion zone ratios.
  - **Polach Non-Linear High-Creep Theory**: Velocity-dependent friction decay ($\mu(w) = \mu_0 [(1 - A)e^{-B w} + A]$) for traction and braking saturation.
  - **UIC 519 Equivalent Conicity & Non-Linear Suspension (`profile-analysis.ts`, `suspension-elements.ts`)**: Klingel wavelength integration for equivalent conicity $\lambda_{\text{eq}}$, pneumatic airsprings, friction wedges, bumpstops, and yaw dampers.
- **EN 14363, EN 12299 & EN 14067-6 Homologation Verification (`evaluateEn14363`, `evaluateRideComfort`, `evaluateCrossWind`, `createHomologationReport`)**:
  - **EN 14363 / UIC 518**: Nadal derailment quotient ($(Y/Q)_{\max} \le 0.80$), Prud'homme track shifting resistance ($\sum Y_{2\text{m}} \le \alpha (10 + P_0 / 3)\text{ kN}$), and wheel unloading ($\Delta Q / Q_0 \le 0.60$).
  - **ISO 2631 / EN 12299 & Sperling $W_z$**: Frequency-weighted RMS passenger ride comfort and Sperling ride index evaluation.
  - **EN 14067-6 Crosswind Stability**: Characteristic wind curve (CWC) overturning and wheel-unloading assessment ($\Delta Q / Q_0 \le 0.90$).
  - **Multi-Format Homologation Reports**: Exports audit-ready HTML, SARIF, JUnit XML, and CTRF JSON reports.
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerGensysToDae`)**: Lowers multi-body carbody, bogie, and wheelset equations of motion, primary/secondary suspension couplings, and linearized Kalker creep damping directly into ModelScript's zero-GC WebAssembly `DAEBuilder` struct-of-arrays arena.
- **6 Pre-Flight Railway Dynamics Lint Rules (`G1001`–`G1006`, `lintGensysModel`)**: Static verification of carbody/bogie masses, principal moments of inertia ($J_x, J_y, J_z > 0$), dangling suspension coupling references (`body1`, `body2`), track gauge bounds, and wheel-rail profile continuity.
- **Kinematic Diagram Synthesis & Modelica Projection (`renderGensysSvg`, `gensysToModelica`)**: Generates interactive kinematic bogie/suspension schematic SVGs via `@modelscript/diagram` and translates GENSYS vehicle topologies into Modelica 3.x models.

---

## Package Structure

| Path                                      | Description                                                                                                      |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                            | Public package exports                                                                                           |
| `src/language.ts`                         | `gensysLanguage` grammar specification for `.calc`, `.run`, `.sub`, `.geom`, `.trax`, and `.wheel` files         |
| `src/types.ts`                            | `GensysModel`, `GensysBody`, `GensysWheelset`, `GensysCoupling`, `TrackGeometry`, and contact data structures    |
| `src/errors.ts`                           | `GensysErrorCode` diagnostic registry (`G1001`–`G1006`)                                                          |
| `src/parser/deck-parser.ts`               | `parseGensysDeck` parser for GENSYS `.calc`, `.run`, and `.sub` vehicle decks                                    |
| `src/parser/track-parser.ts`              | `parseGensysTrack` parser for `.geom` and `.trax` track geometry files                                           |
| `src/parser/expr-eval.ts`                 | `evaluateGensysExpr` arithmetic expression evaluator for deck variables (`func`)                                 |
| `assembly/contact.ts`                     | AssemblyScript WebAssembly kernel (`contact.wasm`) for Kalker FASTSIM and Polach creep force solving             |
| `src/contact/fastsim.ts`                  | `solveFastsim` Kalker FASTSIM tangential rolling contact solver                                                  |
| `src/contact/polach.ts`                   | `solvePolach` Polach non-linear high-creep wheel-rail force solver                                               |
| `src/contact/wheel-rail-profile.ts`       | S1002 wheel and UIC60 rail profile geometry and contact point locator                                            |
| `src/contact/profile-analysis.ts`         | UIC 519 equivalent conicity ($\lambda_{\text{eq}}$) and contact angle difference ($\Delta \gamma$) analyzer      |
| `src/contact/suspension-elements.ts`      | Pneumatic airspring, friction damper, bumpstop, and hydraulic yaw damper models                                  |
| `src/contact/track-irregularities.ts`     | ERRI B176 power spectral density (PSD) stochastic track irregularity synthesizer                                 |
| `src/contact/wasm-bridge.ts`              | WebAssembly linear-memory bridge for batched FASTSIM and Polach execution                                        |
| `src/aerodynamics/cross-wind.ts`          | EN 14067-6 crosswind aerodynamic forces, overturning moments, and CWC wheel-unloading evaluator                  |
| `src/verification/en14363.ts`             | `evaluateEn14363` Nadal derailment quotient ($Y/Q$) and Prud'homme lateral track shift verifier                  |
| `src/verification/ride-comfort.ts`        | Sperling $W_z$ and EN 12299 / ISO 2631 passenger ride comfort index calculators                                  |
| `src/verification/homologation-report.ts` | `createHomologationReport` and HTML / SARIF / JUnit / CTRF report exporters                                      |
| `src/dae/gensys-to-dae.ts`                | `lowerGensysToDae` direct lowering of vehicle bodies, wheelsets, and suspensions into `DAEBuilder` linear memory |
| `src/diagram/gensys-diagram.ts`           | `gensysToKinematicDiagram` and `renderGensysSvg` schematic diagram generator                                     |
| `src/projections/gensys-to-modelica.ts`   | `gensysToModelica` translator to Modelica 3.x multi-body railway vehicle models                                  |
| `src/lints/index.ts`                      | `lintGensysModel` pre-flight railway vehicle diagnostic engine                                                   |
| `src/workspace-index.ts`                  | `GensysWorkspaceIndex` implementing `IWorkspaceIndex` across `.calc`, `.sub`, and `.run` files                   |
| `src/lsp.ts`                              | LSP hover, completion, definition, and symbol providers                                                          |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                       | Severity  | Description                                                                              |
| ------- | -------------------------- | --------- | ---------------------------------------------------------------------------------------- |
| `G1001` | `invalid-body-mass`        | `error`   | Body `'name'` has non-positive mass ($\le 0\text{ kg}$).                                 |
| `G1002` | `non-positive-inertia`     | `error`   | Body `'name'` has non-positive principal inertia tensor components ($J_x, J_y, J_z$).    |
| `G1003` | `dangling-body1-reference` | `error`   | Coupling `'name'` references unknown `body1` `'body1'`.                                  |
| `G1004` | `dangling-body2-reference` | `error`   | Coupling `'name'` references unknown `body2` `'body2'`.                                  |
| `G1005` | `invalid-track-gauge`      | `error`   | Track specification defines non-positive or unphysical gauge ($\text{m}$).               |
| `G1006` | `unclosed-rail-profile`    | `warning` | Wheel-rail contact profile `'profileName'` curve has discontinuous slope or is unclosed. |

---

## CLI & Programmatic Usage

### CLI Commands

```bash
# Run pre-flight railway vehicle topology and inertia checks (G1001-G1006)
npx msx gensys lint ManchesterBench.calc

# Verify EN 14363 Nadal derailment quotient (Y/Q) and Prud'homme track shift limits
npx msx gensys verify --y-force 25.0 --q-force 80.0 --axle-load 160.0

# Simulate GENSYS vehicle dynamics in the linear-memory DAE arena and export CSV trajectory
npx msx gensys simulate ManchesterBench.calc --stop-time 5.0 --step 0.005 --out trajectory.csv

# Generate an EN 14363 / EN 12299 / EN 14067-6 homologation report (html | sarif | junit | ctrf)
npx msx gensys report ManchesterBench.calc --format html --out homologation.html

# Export GENSYS vehicle model to Modelica 3.x or FMI 2.0 Co-Simulation FMU
npx msx gensys to-modelica ManchesterBench.calc --out ManchesterVehicle.mo
npx msx gensys to-fmu ManchesterBench.calc --out ManchesterVehicle.fmu
```

### Programmatic Usage

```typescript
import {
  createHomologationReport,
  evaluateEn14363,
  gensysToModelica,
  lintGensysModel,
  lowerGensysToDae,
  parseGensysDeck,
  solveFastsim,
} from "@modelscript/gensys";

const deckSource = `
body carbody 32000 56800 1970000 1970000 0 0 -1.8
body bogie1  2615  1722  1476    3067    9.5 0 -0.6
wheelset ax1 1813  1.435 0.46    0.15
spring sec_z1 carbody bogie1 430000 20000
spring pri_z1 bogie1  ax1    1220000 4000
`;

// 1. Parse GENSYS deck and run G1001-G1006 pre-flight linter
const model = parseGensysDeck(deckSource, "ManchesterPassengerCar");
const diagnostics = lintGensysModel(model);

// 2. Solve Kalker FASTSIM tangential wheel-rail creep forces
const contact = solveFastsim({
  semiAxisA: 0.0065,
  semiAxisB: 0.0045,
  normalForceN: 80000,
  frictionCoeff: 0.35,
  shearModulusPa: 8.1e10,
  poissonRatio: 0.28,
  creepVx: -0.0012,
  creepVy: 0.0008,
  creepPhi: 0.05,
});
console.log(contact.fx, contact.fy, contact.mz);

// 3. Evaluate EN 14363 safety criteria and lower vehicle model to DAEBuilder
const en14363 = evaluateEn14363({
  lateralForceY: 24.0,
  verticalForceQ: 80.0,
  nominalAxleLoadQ0: 160.0,
});
const dae = lowerGensysToDae(model);
const modelicaCode = gensysToModelica(model);
```

---

## Scripts

| Command              | Description                                                                   |
| -------------------- | ----------------------------------------------------------------------------- |
| `npm run build`      | Build `contact.wasm` (`npm run build:wasm`) and compile TypeScript to `dist/` |
| `npm run build:wasm` | Compile AssemblyScript wheel-rail contact kernel (`assembly/contact.ts`)      |
| `npm test`           | Run deck parser, FASTSIM/Polach WASM, EN 14363, DAE, and diagram tests        |
| `npm run lint`       | Run ESLint across `src/` and `tests/`                                         |
| `npm run typecheck`  | Run `tsc --noEmit` type verification                                          |
| `npm run clean`      | Remove `dist/` build artifacts                                                |

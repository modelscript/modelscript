<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/simpack

Dassault Systèmes SIMPACK multibody systems (MBS), spatial 3D kinematics, Craig-Bampton flexible body dynamics, and non-linear elastomeric suspension package (`.spck`, `.sim`, `.mbs`) for ModelScript. Features `.spck` XML, `.sim` card deck, and `.fbi` Flexible Body Interface parsers (`parseSpckXml`, `parseSimDeck`, `parseFbi`), multi-file workspace indexing (`SimpackWorkspaceIndex`), an AssemblyScript WebAssembly spatial kinematics & cut-joint loop closure kernel (`assembly/kinematics.ts` → `dist/kinematics.wasm`), Grübler-Kutzbach mobility analysis (`analyzeMobility`), non-linear Berg elastomeric bushing dynamics (`evaluateBergBushing`), direct linear-memory `DAEBuilder` lowering (`lowerSimpackToDae`, `lowerFbiToDae`), 6 pre-flight kinematic lint rules (`K7001`–`K7006`), kinematic SVG diagram synthesis, and Modelica projections (`simpackToModelica`).

---

## Core Capabilities

- **SIMPACK `.spck` XML, `.sim` Deck & `.fbi` Flexible Body Parsers (`parseSpckXml`, `parseSimDeck`, `parseFbi`, `evaluateSubvarExpr`)**:
  - **`.spck` XML & `.sim` / `.mbs` Decks**: Parses rigid/flexible `$body` definitions (mass, center of gravity, inertia tensor $I_{xx}, I_{yy}, I_{zz}, I_{xy}, I_{xz}, I_{yz}$), `$marker` local coordinate frames and Tait-Bryan Euler orientations, `$joint` kinematic constraints (`revolute`, `prismatic`, `spherical`, `cylindrical`, `universal`, `planar`, `fixed`, `free`, `rail-wheel`), `$force` elements, and `subvar` parametric expressions.
  - **`.fbi` Flexible Body Interface (`parseFbi`)**: Parses Craig-Bampton modal condensation data (eigenfrequencies, generalized modal masses/stiffnesses, damping ratios, and boundary-node mode-shape matrices $\boldsymbol{\Phi}$).
- **In-WASM Spatial Kinematics & Cut-Joint Loop Closure Kernel (`assembly/kinematics.ts` → `dist/kinematics.wasm`, `solveKinematicLoops`)**:
  - Computes 3D Tait-Bryan Direction Cosine rotation matrices $\mathbf{R}(\alpha, \beta, \gamma) \in \text{SO}(3)$, marker world-frame spatial transformations, and algebraic joint constraint residuals $\boldsymbol{\Phi}(\mathbf{q}) = \mathbf{0}$ in zero-allocation WebAssembly linear memory.
  - Newton-Raphson cut-joint kinematic loop solver (`solveKinematicLoops`) for closed spatial four-bar, suspension, and pantograph mechanisms.
- **Grübler-Kutzbach Spatial Mobility Analyzer (`analyzeMobility`)**: Computes spatial degrees of freedom $M = 6(N - 1) - \sum_{i=1}^{J} c_i$, identifying overconstrained kinematic chains and redundant joint constraints.
- **Non-Linear Berg Elastomeric Bushing Model (`evaluateBergBushing`, `lowerBergBushingToDae`)**: Implements M. Berg's (1997/1998) rubber suspension model combining nonlinear elastic stiffness ($F_e = k_e x + k_{e3} x^3$), viscous damping ($F_v = c_v \dot{x}$), and rate-independent hysteresis friction state ($\dot{F}_{fr} = k_f \dot{x} [1 - \text{sgn}(\dot{x}) F_{fr} / F_{\max}]^\beta$).
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerSimpackToDae`, `lowerFbiToDae`)**: Lowers rigid-body Newton-Euler equations, Baumgarte-stabilized algebraic joint constraints ($\ddot{\boldsymbol{\Phi}} + 2\alpha \dot{\boldsymbol{\Phi}} + \beta^2 \boldsymbol{\Phi} = \mathbf{0}$), Berg bushing hysteresis states, and Craig-Bampton modal oscillators ($m_i \ddot{q}_i + c_i \dot{q}_i + k_i q_i = Q_i$) directly into ModelScript's zero-GC WebAssembly `DAEBuilder` struct-of-arrays arena.
- **6 Pre-Flight Multibody Kinematic Lint Rules (`K7001`–`K7006`, `lintSimpackModel`)**: Static verification of body mass positivity, parent body marker bindings, joint `from`/`to` marker references, Grübler-Kutzbach overconstrained mobility ($M < 0$), and Baumgarte stabilization parameter positivity ($\alpha, \beta > 0$).
- **Kinematic Diagram Synthesis & Modelica Projection (`renderSimpackSvg`, `simpackToModelica`)**: Generates interactive multibody topology SVG diagrams and translates SIMPACK models into `Modelica.Mechanics.MultiBody` models.

---

## Package Structure

| Path                                     | Description                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/index.ts`                           | Public package exports                                                                                             |
| `src/language.ts`                        | `simpackLanguage` grammar specification for `.spck`, `.sim`, and `.mbs` files                                      |
| `src/types.ts`                           | `SimpackModel`, `SimpackBody`, `SimpackMarker`, `SimpackJoint`, `SimpackForceElement`, and kinematic types         |
| `src/errors.ts`                          | `SimpackErrorCode` diagnostic registry (`K7001`–`K7006`)                                                           |
| `src/parser/sim-deck-parser.ts`          | `parseSimDeck` parser for SIMPACK `.sim` and `.mbs` card decks                                                     |
| `src/parser/spck-xml-parser.ts`          | `parseSpckXml` parser for SIMPACK `.spck` XML models                                                               |
| `src/parser/fbi-parser.ts`               | `parseFbi` parser for Craig-Bampton Flexible Body Interface (`.fbi`) modal files                                   |
| `src/parser/expr-eval.ts`                | `evaluateSubvarExpr` parametric `subvar` expression evaluator                                                      |
| `assembly/kinematics.ts`                 | AssemblyScript WebAssembly kernel (`kinematics.wasm`) for $\text{SO}(3)$ transforms and joint constraint residuals |
| `src/kinematics/transformations.ts`      | 3D Tait-Bryan rotation matrices and marker spatial coordinate transformations                                      |
| `src/kinematics/constraints.ts`          | Algebraic joint constraint residual evaluators                                                                     |
| `src/kinematics/loop-solver.ts`          | `solveKinematicLoops` Newton-Raphson cut-joint closed-loop kinematic solver                                        |
| `src/kinematics/mobility.ts`             | `analyzeMobility` Grübler-Kutzbach spatial degrees-of-freedom calculator                                           |
| `src/kinematics/wasm-bridge.ts`          | WebAssembly linear-memory bridge for batched marker and joint kinematics                                           |
| `src/bushing/berg-bushing.ts`            | `evaluateBergBushing` and `lowerBergBushingToDae` non-linear elastomeric hysteresis bushing model                  |
| `src/dae/simpack-to-dae.ts`              | `lowerSimpackToDae` direct lowering of rigid bodies, joints, and forces into `DAEBuilder` linear memory            |
| `src/dae/fbi-to-dae.ts`                  | `lowerFbiToDae` direct lowering of Craig-Bampton flexible body modal coordinates into `DAEBuilder`                 |
| `src/diagram/simpack-diagram.ts`         | `simpackToKinematicDiagram` and `renderSimpackSvg` multibody schematic generator                                   |
| `src/projections/simpack-to-modelica.ts` | `simpackToModelica` translator to `Modelica.Mechanics.MultiBody` models                                            |
| `src/lints/index.ts`                     | `lintSimpackModel` pre-flight multibody kinematic diagnostic engine                                                |
| `src/workspace-index.ts`                 | `SimpackWorkspaceIndex` implementing `IWorkspaceIndex` across `.spck`, `.sim`, and `.mbs` files                    |
| `src/lsp.ts`                             | LSP hover, completion, definition, and symbol providers                                                            |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                       | Severity  | Description                                                                                             |
| ------- | -------------------------- | --------- | ------------------------------------------------------------------------------------------------------- |
| `K7001` | `invalid-body-mass`        | `error`   | Body `'id'` has non-positive mass ($\le 0\text{ kg}$).                                                  |
| `K7002` | `dangling-body-reference`  | `error`   | Marker `'markerId'` references unknown parent body `'bodyId'`.                                          |
| `K7003` | `unknown-from-marker`      | `error`   | Joint `'jointId'` references unknown `from`-marker `'marker'`.                                          |
| `K7004` | `unknown-to-marker`        | `error`   | Joint `'jointId'` references unknown `to`-marker `'marker'`.                                            |
| `K7005` | `overconstrained-mobility` | `warning` | Mechanism is overconstrained according to the Grübler-Kutzbach criterion ($\text{Mobility} < 0$).       |
| `K7006` | `baumgarte-divergence`     | `warning` | Joint `'jointId'` Baumgarte stabilization parameter ($\alpha$ or $\beta$) is non-positive or divergent. |

---

## CLI & Programmatic Usage

### CLI Commands

```bash
# Run pre-flight multibody topology, marker, and Baumgarte stability checks (K7001-K7006)
npx msx simpack lint bogie.spck

# Compute Grübler-Kutzbach spatial degrees of freedom and joint constraint counts
npx msx simpack mobility bogie.spck

# Simulate SIMPACK multibody dynamics in the linear-memory DAE arena
npx msx simpack simulate bogie.spck --stop-time 5.0 --step 0.005 --out bogie_traj.csv

# Export SIMPACK model to Modelica.Mechanics.MultiBody or FMI 2.0 Co-Simulation FMU
npx msx simpack to-modelica bogie.spck --out BogieMultiBody.mo
npx msx simpack to-fmu bogie.spck --out BogieMultiBody.fmu
```

### Programmatic Usage

```typescript
import {
  analyzeMobility,
  evaluateBergBushing,
  lintSimpackModel,
  lowerSimpackToDae,
  parseSimDeck,
  simpackToModelica,
} from "@modelscript/simpack";

const simDeck = `
$body crank   CrankShaft 12.5 0.15 0.15 0.08
$body coupler ConRod     4.2  0.05 0.05 0.02
$marker m_gnd     ground  0.0 0.0 0.0
$marker m_crank1  crank   0.0 0.0 0.0
$marker m_crank2  crank   0.2 0.0 0.0
$marker m_coupl1  coupler 0.0 0.0 0.0
$joint j_rev1 revolute m_gnd    m_crank1
$joint j_rev2 revolute m_crank2 m_coupl1
`;

// 1. Parse SIMPACK deck (.sim / .spck) and run K7001-K7006 pre-flight linter
const model = parseSimDeck(simDeck, "SliderCrank");
const diagnostics = lintSimpackModel(model);

// 2. Analyze Grübler-Kutzbach spatial mobility and evaluate Berg elastomeric bushing
const mobility = analyzeMobility(model);
const bushing = evaluateBergBushing(
  { ke: 1.5e6, cv: 8000, kf: 4.0e6, fmax: 12000 },
  { fFriction: 0 },
  0.002,
  0.05,
  0.001,
);
console.log(mobility.calculatedMobility, bushing.fTotal);

// 3. Lower to DAEBuilder linear memory or export to Modelica.Mechanics.MultiBody
const dae = lowerSimpackToDae(model);
const modelicaCode = simpackToModelica(model);
```

---

## Scripts

| Command              | Description                                                                      |
| -------------------- | -------------------------------------------------------------------------------- |
| `npm run build`      | Build `kinematics.wasm` (`npm run build:wasm`) and compile TypeScript to `dist/` |
| `npm run build:wasm` | Compile AssemblyScript spatial kinematics kernel (`assembly/kinematics.ts`)      |
| `npm test`           | Run `.spck`/`.sim`/`.fbi` parser, WASM kinematics, Berg bushing, and DAE tests   |
| `npm run lint`       | Run ESLint across `src/` and `tests/`                                            |
| `npm run typecheck`  | Run `tsc --noEmit` type verification                                             |
| `npm run clean`      | Remove `dist/` build artifacts                                                   |

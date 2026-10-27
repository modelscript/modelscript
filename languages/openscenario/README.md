<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/openscenario

ASAM OpenSCENARIO 1.x/2.0 autonomous driving traffic scenario orchestration, Time-To-Collision (TTC), and Responsibility-Sensitive Safety (RSS) verification package (`.xosc`, `.osc`) for ModelScript. Features dual XML (`.xosc`) and DSL (`.osc`) parsers (`parseOpenScenario`), multi-file workspace indexing (`OpenScenarioWorkspaceIndex`), a traffic storyboard orchestrator with Mobileye RSS & TTC safety verification (`simulateScenario`), direct linear-memory `DAEBuilder` kinematic lowering (`lowerOpenScenarioToDae`), 10 pre-flight scenario & safety lint rules (`M8501`–`M8510`), Modelica 3.x vehicle kinematics projections (`openScenarioToModelica`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **ASAM OpenSCENARIO XML & DSL Parser (`parseOpenScenario`)**: Zero-regex parser supporting both OpenSCENARIO 1.x `.xosc` XML and OpenSCENARIO 2.0 `.osc` domain-specific syntax, extracting:
  - **`<FileHeader>` & `<ParameterDeclarations>`**: Schema revision, author metadata, and typed scenario parameters (`$EgoSpeed`, `$LeadDistance`).
  - **`<Entities>`**: `<ScenarioObject>` actors (`vehicle`, `pedestrian`, `miscObject`), `<BoundingBox>` dimensions, and `<Performance>` envelopes (`maxSpeed`, `maxAcceleration`, `maxDeceleration`).
  - **`<Storyboard>`**: `<Init>` longitudinal speed and `<WorldPosition>` / `<LanePosition>` actions, `<Story>` → `<Act>` → `<ManeuverGroup>` → `<Maneuver>` → `<Event>` hierarchies, `<LongitudinalAction>` / `<LateralAction>` dynamics, and `<StartTrigger>` (`SimulationTimeCondition`, `RelativeDistanceCondition`, `TimeToCollisionCondition`, `StoryboardElementStateCondition`).
- **Storyboard Orchestrator & Mobileye RSS / TTC Verifier (`simulateScenario`)**: Executes event-driven traffic maneuvers over time while continuously computing longitudinal inter-vehicle distance $\Delta x$, Time-To-Collision ($\text{TTC} = \frac{\Delta x}{v_{\text{ego}} - v_{\text{lead}}}$), and Mobileye Responsibility-Sensitive Safety (RSS) minimum safe longitudinal distance:
  $$d_{\min} = \max\left(0,\; v_r \rho + \frac{1}{2} a_{\max,\text{accel}} \rho^2 + \frac{(v_r + a_{\max,\text{accel}} \rho)^2}{2 a_{\min,\text{brake}}} - \frac{v_f^2}{2 a_{\max,\text{brake}}}\right)$$
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerOpenScenarioToDae`)**: Compiles multi-actor longitudinal/lateral kinematic state equations ($\dot{x}_i = v_i$, $\dot{v}_i = a_i$), relative headway distances, and RSS safety margin equations directly into ModelScript's zero-GC WebAssembly `DAEBuilder` struct-of-arrays arena.
- **10 Pre-Flight Autonomous Driving Scenario Lint Rules (`M8501`–`M8510`, `lintOpenScenario`)**: Static verification of actor entity references, unsatisfiable trigger thresholds, unreachable road/lane positions, circular `StoryboardElementStateCondition` event triggers, missing `ego` vehicle under test, negative target velocities, deceleration demands exceeding `<Performance>` physical limits, initial bounding-box collisions at $t = 0$, empty maneuver groups, and negative trigger delays.
- **Modelica 3.x Vehicle Kinematics Projection (`openScenarioToModelica`)**: Synthesizes standalone Modelica 3.x multi-vehicle longitudinal kinematics and RSS safety monitor models.
- **Multi-File Workspace Indexing & LSP (`OpenScenarioWorkspaceIndex`, `provideOpenScenarioHover`, `provideOpenScenarioCompletions`)**: Implements `IWorkspaceIndex` across `.xosc` and `.osc` scenario catalogs with entity/maneuver hover cards, tag completions, and AST writeback.

---

## Package Structure

| Path                                          | Description                                                                                                                                         |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                                | Public package exports                                                                                                                              |
| `src/language.ts`                             | `openScenarioLanguage` definition and LSP actions (`lint_openscenario`, `openscenario_simulate`, `openscenario_to_dae`, `openscenario_to_modelica`) |
| `src/types.ts`                                | `OpenScenarioDocument`, `ScenarioEntity`, `InitAction`, `ScenarioStory`, `ScenarioEvent`, `ScenarioCondition`, and range types                      |
| `src/errors.ts`                               | `OpenScenarioErrorCode` diagnostic registry (`M8501`–`M8510`)                                                                                       |
| `src/parser/openscenario-parser.ts`           | `parseOpenScenario` zero-regex parser for `.xosc` XML and `.osc` DSL files                                                                          |
| `src/parser/index.ts`                         | Parser barrel exports                                                                                                                               |
| `src/lints/openscenario-linter.ts`            | `lintOpenScenario` actor reference, trigger cycle, performance limit, and initial collision linter                                                  |
| `src/lints/index.ts`                          | Linter barrel exports                                                                                                                               |
| `src/solvers/scenario-orchestrator.ts`        | `simulateScenario` storyboard state machine, TTC, and Mobileye RSS safety verifier                                                                  |
| `src/solvers/index.ts`                        | Solver barrel exports                                                                                                                               |
| `src/dae/openscenario-to-dae.ts`              | `lowerOpenScenarioToDae` direct lowering of actor kinematics and RSS safety margins into `DAEBuilder` linear memory                                 |
| `src/dae/index.ts`                            | DAE lowering barrel exports                                                                                                                         |
| `src/projections/openscenario-to-modelica.ts` | `openScenarioToModelica` translator to Modelica 3.x multi-actor vehicle kinematics models                                                           |
| `src/projections/index.ts`                    | Projections barrel exports                                                                                                                          |
| `src/workspace-index.ts`                      | `OpenScenarioWorkspaceIndex` implementing `IWorkspaceIndex` across `.xosc` and `.osc` files                                                         |
| `src/lsp.ts`                                  | LSP hover, completion, and symbol providers                                                                                                         |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                               | Severity  | Description                                                                                                   |
| ------- | ---------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| `M8501` | `dangling-entity-reference`        | `error`   | Entity `'entityName'` referenced in `'contextName'` is not defined in the `Entities` catalog.                 |
| `M8502` | `unsatisfiable-trigger`            | `warning` | Trigger condition `'conditionName'` is unsatisfiable (e.g., non-positive TTC or negative distance threshold). |
| `M8503` | `unreachable-road-position`        | `error`   | Road position specifies an invalid road ID `'roadId'` or lane index `'laneId'`.                               |
| `M8504` | `cyclic-event-trigger`             | `error`   | Circular trigger dependency detected between event `'eventA'` and event `'eventB'`.                           |
| `M8505` | `missing-ego-entity`               | `error`   | Scenario does not define an autonomous vehicle under test (`'ego'` vehicle).                                  |
| `M8506` | `negative-speed-target`            | `error`   | Speed action `'actionName'` specifies a negative target velocity ($\text{m/s}$).                              |
| `M8507` | `excessive-deceleration`           | `warning` | Action demands deceleration ($\text{m/s}^2$) for `'entityName'` exceeding its `<Performance>` physical limit. |
| `M8508` | `imminent-collision-initial-state` | `error`   | Initial positions for `'entityA'` and `'entityB'` violate the bounding-box collision envelope at $t = 0$.     |
| `M8509` | `empty-maneuver-group`             | `warning` | Maneuver group `'groupName'` specifies no actors or no maneuvers.                                             |
| `M8510` | `invalid-condition-delay`          | `error`   | Trigger condition `'condName'` specifies a negative activation delay ($< 0\text{ s}$).                        |

---

## CLI & Programmatic Usage

### CLI Commands

```bash
# Inspect entities, initial actions, stories, acts, and maneuver groups
npx msx openscenario inspect cut_in.xosc

# Run pre-flight actor, trigger cycle, deceleration limit, and collision checks (M8501-M8510)
npx msx openscenario lint cut_in.xosc

# Simulate scenario storyboard and verify TTC and Mobileye RSS safety margins
npx msx openscenario simulate cut_in.xosc --duration 10.0

# Lower vehicle kinematics and RSS safety equations to DAEBuilder linear memory
npx msx openscenario to-dae cut_in.xosc

# Project OpenSCENARIO storyboard to a Modelica 3.x vehicle dynamics model
npx msx openscenario to-modelica cut_in.xosc -o CutInScenario.mo
```

### Programmatic Usage

```typescript
import {
  lintOpenScenario,
  lowerOpenScenarioToDae,
  openScenarioToModelica,
  parseOpenScenario,
  simulateScenario,
} from "@modelscript/openscenario";

const xoscText = `
<?xml version="1.0" encoding="UTF-8"?>
<OpenSCENARIO>
  <FileHeader revMajor="1" revMinor="2" description="Highway Emergency Braking" author="ModelScript"/>
  <Entities>
    <ScenarioObject name="Ego">
      <Vehicle name="EgoCar" vehicleCategory="car">
        <Performance maxSpeed="60.0" maxAcceleration="4.0" maxDeceleration="9.0"/>
      </Vehicle>
    </ScenarioObject>
    <ScenarioObject name="LeadVehicle">
      <Vehicle name="LeadCar" vehicleCategory="car">
        <Performance maxSpeed="50.0" maxAcceleration="3.5" maxDeceleration="8.0"/>
      </Vehicle>
    </ScenarioObject>
  </Entities>
  <Storyboard>
    <Init>
      <Actions>
        <Private entityRef="Ego">
          <PrivateAction><TeleportAction><Position><WorldPosition x="0.0" y="0.0"/></Position></TeleportAction></PrivateAction>
          <PrivateAction><LongitudinalAction><SpeedAction><SpeedActionTarget><AbsoluteTargetSpeed value="30.0"/></SpeedActionTarget></SpeedAction></LongitudinalAction></PrivateAction>
        </Private>
        <Private entityRef="LeadVehicle">
          <PrivateAction><TeleportAction><Position><WorldPosition x="45.0" y="0.0"/></Position></TeleportAction></PrivateAction>
          <PrivateAction><LongitudinalAction><SpeedAction><SpeedActionTarget><AbsoluteTargetSpeed value="25.0"/></SpeedActionTarget></SpeedAction></LongitudinalAction></PrivateAction>
        </Private>
      </Actions>
    </Init>
  </Storyboard>
</OpenSCENARIO>
`;

// 1. Parse OpenSCENARIO XML/DSL and run M8501-M8510 pre-flight diagnostics
const doc = parseOpenScenario(xoscText, "braking.xosc");
const diagnostics = lintOpenScenario(doc);

// 2. Simulate storyboard and evaluate minimum TTC and Mobileye RSS safety violations
const simResult = simulateScenario(doc, { duration: 10.0, stepSize: 0.1 });
console.log(simResult.minTtc, simResult.minDistance, simResult.hasCollision);

// 3. Lower to DAEBuilder linear memory or export to Modelica
const dae = lowerOpenScenarioToDae(doc);
const modelicaCode = openScenarioToModelica(doc);
```

---

## Scripts

| Command             | Description                                                                        |
| ------------------- | ---------------------------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                                                      |
| `npm test`          | Run `.xosc`/`.osc` parser, linter, TTC/RSS orchestrator, DAE, and projection tests |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                              |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                               |
| `npm run clean`     | Remove `dist/` build artifacts                                                     |

<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/jsbsim

JSBSim 2.0 6-DOF aircraft flight dynamics, aerodynamics, propulsion, and flight control system (FCS) engineering package (`.xml`) for ModelScript. Features a zero-regex XML `<fdm_config>` parser (`parseJsbsim`), multi-file workspace indexing (`JsbsimWorkspaceIndex`), a rigid-body 6-DOF flight dynamics & standard atmosphere integrator (`solveFlightDynamics`), direct linear-memory `DAEBuilder` lowering (`lowerJsbsimToDae`), 10 pre-flight airframe & aerodynamic lint rules (`M8901`–`M8910`), Modelica 3.x flight mechanics projections (`jsbsimToModelica`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **JSBSim `<fdm_config>` XML Parser (`parseJsbsim`)**: Zero-regex XML parser extracting JSBSim 2.0 aircraft configurations across:
  - **`<metrics>`**: Reference wing area (`<wingarea>`), wingspan (`<wingspan>`), mean aerodynamic chord (`<chord>`), horizontal/vertical tail areas (`<htailarea>`, `<vtailarea>`), and aerodynamic reference point (`AERORP`).
  - **`<mass_balance>`**: Empty weight (`<emptywt>`), moments and products of inertia (`<ixx>`, `<iyy>`, `<izz>`, `<ixz>`), center of gravity (`CG`), and point masses.
  - **`<ground_reactions>` & `<propulsion>`**: Landing gear bogies (`<contact>` spring/damping/brake group), engines/thrusters, and fuel tanks.
  - **`<flight_control>` & `<aerodynamics>`**: FCS control channels (`<channel>`, `<summer>`, `<aerosurface_scale>`, `<kinematic>`) and 6-axis aerodynamic force/moment functions (`LIFT`, `DRAG`, `SIDE`, `ROLL`, `PITCH`, `YAW` with `<product>` and `<tableData>` lookups).
- **6-DOF Rigid-Body Flight Dynamics Integrator (`solveFlightDynamics`)**: Integrates nonlinear 6-DOF translational ($u, v, w$) and rotational ($p, q, r$) body-frame equations of motion coupled with Euler attitude kinematics ($\phi, \theta, \psi$), ISA atmospheric density/speed-of-sound model ($\rho(h), a(h), \text{Mach}$), dynamic pressure $\bar{q} = \frac{1}{2}\rho V^2$, angle of attack $\alpha$, sideslip $\beta$, and aerodynamic/thrust forces.
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerJsbsimToDae`)**: Emits longitudinal and lateral-directional 6-DOF flight mechanics differential equations ($\dot{V}, \dot{\alpha}, \dot{q}, \dot{\theta}, \dot{h}$) and aerodynamic lift/drag/pitching-moment equations directly into ModelScript's zero-GC WebAssembly `DAEBuilder` struct-of-arrays arena.
- **10 Pre-Flight Airframe & Aerodynamics Lint Rules (`M8901`–`M8910`, `lintJsbsim`)**: Static verification of `<fdm_config>` aircraft naming, positive wing reference geometry ($S_{\text{ref}}, b, \bar{c} > 0$), empty weight and inertia tensor triangle inequalities ($I_{xx} + I_{yy} \ge I_{zz}$), `<aerodynamics>` axis definitions, landing gear presence, engine thrust positivity, FCS channel input bindings, and longitudinal static margin (`CG` vs. `AERORP`).
- **Modelica 3.x Flight Mechanics Projection (`jsbsimToModelica`)**: Synthesizes standalone Modelica 3.x 6-DOF aircraft flight dynamics models for multi-domain avionics, actuator, and thermal co-simulation.
- **Multi-File Workspace Indexing & LSP (`JsbsimWorkspaceIndex`, `provideJsbsimHover`, `provideJsbsimCompletions`)**: Implements `IWorkspaceIndex` for JSBSim aircraft definitions with hover documentation, XML tag/property completions, and AST writeback.

---

## Package Structure

| Path                                    | Description                                                                                                           |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                          | Public package exports                                                                                                |
| `src/language.ts`                       | `jsbsimLanguage` definition and LSP actions (`lint_jsbsim`, `jsbsim_simulate`, `jsbsim_to_dae`, `jsbsim_to_modelica`) |
| `src/types.ts`                          | `JsbsimDocument`, `JsbsimAircraftModel`, `JsbsimMetrics`, `JsbsimMassBalance`, `JsbsimAeroCoefficient`, and FCS types |
| `src/errors.ts`                         | `JsbsimErrorCode` diagnostic registry (`M8901`–`M8910`)                                                               |
| `src/parser/jsbsim-parser.ts`           | `parseJsbsim` zero-regex XML parser for JSBSim `<fdm_config>` aircraft files                                          |
| `src/parser/index.ts`                   | Parser barrel exports                                                                                                 |
| `src/lints/jsbsim-linter.ts`            | `lintJsbsim` airframe geometry, inertia tensor, FCS, and aerodynamic linter                                           |
| `src/lints/index.ts`                    | Linter barrel exports                                                                                                 |
| `src/solvers/flight-solver.ts`          | `solveFlightDynamics` 6-DOF rigid-body flight mechanics and ISA atmosphere integrator                                 |
| `src/solvers/index.ts`                  | Solver barrel exports                                                                                                 |
| `src/dae/jsbsim-to-dae.ts`              | `lowerJsbsimToDae` direct lowering of 6-DOF flight dynamics into `DAEBuilder` linear memory                           |
| `src/dae/index.ts`                      | DAE lowering barrel exports                                                                                           |
| `src/projections/jsbsim-to-modelica.ts` | `jsbsimToModelica` translator to Modelica 3.x aircraft flight dynamics models                                         |
| `src/projections/index.ts`              | Projections barrel exports                                                                                            |
| `src/workspace-index.ts`                | `JsbsimWorkspaceIndex` implementing `IWorkspaceIndex` across JSBSim `.xml` models                                     |
| `src/lsp.ts`                            | LSP hover, completion, and symbol providers                                                                           |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                           | Severity  | Description                                                                                                         |
| ------- | ------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------- |
| `M8901` | `missing-aircraft-name`        | `error`   | JSBSim `<fdm_config>` element is missing the required `'name'` attribute.                                           |
| `M8902` | `non-positive-reference-area`  | `error`   | Wing reference area (`<wingarea>`) must be strictly positive ($> 0\text{ ft}^2$).                                   |
| `M8903` | `non-positive-wingspan-chord`  | `error`   | Wing metric (`'wingspan'` or `'chord'`) must be strictly positive ($> 0\text{ ft}$).                                |
| `M8904` | `non-positive-empty-weight`    | `error`   | Aircraft empty weight (`<emptywt>`) must be strictly positive ($> 0\text{ lbs}$).                                   |
| `M8905` | `invalid-inertia-tensor`       | `error`   | Moments of inertia tensor (`<ixx>`, `<iyy>`, `<izz>`) is non-positive or violates triangle inequalities.            |
| `M8906` | `missing-aerodynamics-section` | `error`   | Aircraft model does not define any aerodynamic force/moment coefficients in `<aerodynamics>`.                       |
| `M8907` | `missing-landing-gear`         | `warning` | Aircraft model defines no landing gear bogies in `<ground_reactions>`; ground interaction is disabled.              |
| `M8908` | `negative-engine-thrust`       | `error`   | Engine `'engineName'` specifies negative maximum thrust.                                                            |
| `M8909` | `undefined-fcs-input`          | `warning` | FCS channel `'channelName'` references an unrecognized or unbound input property `'inputProperty'`.                 |
| `M8910` | `unrealistic-cg-location`      | `warning` | Center of gravity (`CG`) is significantly far from aerodynamic center (`AERORP`), risking severe pitch instability. |

---

## CLI & Programmatic Usage

### CLI Commands

```bash
# Inspect airframe metrics, inertia tensor, landing gear, and aerodynamic axes
npx msx jsbsim inspect c172x.xml

# Run pre-flight airframe, inertia tensor, and aerodynamic checks (M8901-M8910)
npx msx jsbsim lint c172x.xml

# Simulate 6-DOF rigid-body flight dynamics at 5000 ft and 180 ft/s
npx msx jsbsim simulate c172x.xml --duration 10.0 --speed 180.0 --altitude 5000.0

# Lower 6-DOF flight dynamics equations of motion to DAEBuilder linear memory
npx msx jsbsim to-dae c172x.xml

# Project JSBSim aircraft configuration to a Modelica 3.x flight dynamics model
npx msx jsbsim to-modelica c172x.xml -o Cessna172.mo
```

### Programmatic Usage

```typescript
import { jsbsimToModelica, lintJsbsim, lowerJsbsimToDae, parseJsbsim, solveFlightDynamics } from "@modelscript/jsbsim";

const fdmXml = `
<?xml version="1.0"?>
<fdm_config name="Cessna172P" version="2.0">
  <metrics>
    <wingarea unit="FT2">174.0</wingarea>
    <wingspan unit="FT">35.8</wingspan>
    <chord unit="FT">4.9</chord>
    <location name="AERORP" unit="IN"><x>43.2</x><y>0</y><z>59.4</z></location>
  </metrics>
  <mass_balance>
    <emptywt unit="LBS">1600.0</emptywt>
    <ixx unit="SLUG*FT2">948.0</ixx>
    <iyy unit="SLUG*FT2">1346.0</iyy>
    <izz unit="SLUG*FT2">1967.0</izz>
    <location name="CG" unit="IN"><x>41.0</x><y>0</y><z>36.5</z></location>
  </mass_balance>
  <ground_reactions>
    <contact type="BOGEY" name="NOSE_LG"><spring_coeff>1800</spring_coeff></contact>
  </ground_reactions>
  <aerodynamics>
    <axis name="LIFT">
      <function name="aero/coefficient/CLalpha"><value>5.14</value></function>
    </axis>
    <axis name="DRAG">
      <function name="aero/coefficient/CD0"><value>0.031</value></function>
    </axis>
  </aerodynamics>
</fdm_config>
`;

// 1. Parse JSBSim XML and run M8901-M8910 pre-flight diagnostics
const doc = parseJsbsim(fdmXml, "c172p.xml");
const diagnostics = lintJsbsim(doc);

// 2. Simulate 6-DOF flight dynamics trajectory
const simResult = solveFlightDynamics(doc, {
  duration: 10.0,
  timeStep: 0.02,
  initialSpeedFps: 185.0,
  initialAltitudeFt: 5000.0,
});
console.log(simResult.finalAltitude, simResult.finalSpeed);

// 3. Lower to DAEBuilder linear memory or export to Modelica
const dae = lowerJsbsimToDae(doc);
const modelicaCode = jsbsimToModelica(doc);
```

---

## Scripts

| Command             | Description                                                                   |
| ------------------- | ----------------------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                                                 |
| `npm test`          | Run JSBSim XML parser, linter, 6-DOF flight solver, DAE, and projection tests |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                         |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                          |
| `npm run clean`     | Remove `dist/` build artifacts                                                |

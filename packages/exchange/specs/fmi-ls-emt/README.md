# FMI 3.0 Layered Standard for Electromagnetic Transients (`fmi-ls-emt`)

- **Standard Identifier:** `org.fmi-standard.fmi-ls-emt`
- **Version:** `1.0`
- **Status:** Internal Draft Specification (ModelScript / `@modelscript/exchange`)
- **Base Standard:** FMI 3.0 (`modelDescription.xml`, `terminalsAndIcons.xml`, Co-Simulation / Scheduled Execution)

---

## 1. Scope and Motivation

Standard FMI Co-Simulation exchanges explicit inputs and outputs between FMUs at communication step boundaries (`fmi3DoStep`). In Electromagnetic Transient (EMT) power-system solvers using Dommel's nodal method ($G \cdot v = I_{\text{hist}}$), explicit current-injection or voltage-feedback coupling introduces a **one-timestep ($\Delta t$) artificial delay**, which causes numerical instability or non-physical oscillations when coupling stiff switching devices, transmission lines, or inverter-based resources (IBRs).

`fmi-ls-emt` defines a non-breaking FMI 3.0 layered standard via `<Annotation type="org.fmi-standard.fmi-ls-emt">` in `modelDescription.xml` that allows an FMU (or WebAssembly companion module) to expose a **Norton-companion nodal stamp** $(G_{\text{eq}}, I_{\text{hist}})$ **before** the global nodal solve, and advance its internal state **after** the solved terminal voltages $v_{\text{node}}$ are available—eliminating the 1-step co-simulation delay.

---

## 2. Manifest Schema (`modelDescription.xml`)

An `fmi-ls-emt` compliant FMU declares its EMT companion capabilities inside `<fmiModelDescription><VendorAnnotations>` (or `<Annotations>`) using the annotation type `org.fmi-standard.fmi-ls-emt`:

```xml
<Annotation type="org.fmi-standard.fmi-ls-emt">
  <EmtCompanion version="1.0" supportsHalfStepCda="true" supportsNewtonIteration="false">
    <EmtTerminal
      terminalName="AC_3ph"
      phases="3"
      vNodeVar="v_node"
      gEqVar="G_eq"
      iHistVar="I_hist"/>
  </EmtCompanion>
</Annotation>
```

### 2.1 `<EmtCompanion>` Attributes

| Attribute                 | Type      | Required | Default | Description                                                                                              |
| :------------------------ | :-------- | :------- | :------ | :------------------------------------------------------------------------------------------------------- |
| `version`                 | `string`  | Yes      | `"1.0"` | Specification version (`"1.0"`).                                                                         |
| `supportsHalfStepCda`     | `boolean` | No       | `false` | `true` if the companion supports $\Delta t / 2$ Backward-Euler steps during Critical Damping Adjustment. |
| `supportsNewtonIteration` | `boolean` | No       | `false` | `true` if the companion supports nonlinear sub-iterations within a single timestep $\Delta t$.           |

### 2.2 `<EmtTerminal>` Attributes

| Attribute      | Type     | Required | Default    | Description                                                                                   |
| :------------- | :------- | :------- | :--------- | :-------------------------------------------------------------------------------------------- |
| `terminalName` | `string` | Yes      | `"Term"`   | Terminal name matching `terminalsAndIcons.xml` `<Terminal name="...">`.                       |
| `phases`       | `int`    | No       | `3`        | Number of electrical phases/nodes ($1$ for single-phase, $3$ for 3-phase).                    |
| `vNodeVar`     | `string` | No       | `"v_node"` | FMI input variable name (array of length `phases`, Volts) receiving solved terminal voltages. |
| `gEqVar`       | `string` | No       | `"G_eq"`   | FMI output variable name (`phases x phases` row-major matrix, Siemens) for conductance stamp. |
| `iHistVar`     | `string` | No       | `"I_hist"` | FMI output variable name (array of length `phases`, Amperes) for Norton history current.      |

---

## 3. Two-Phase Execution Protocol

For each global EMT timestep $t \to t + \Delta t$:

1. **Phase 1 — Pre-Solve Stamp (`stampCompanion(tSec, dtSec)`):**
   - The importer queries `gEq` (`phases x phases` row-major, in Siemens) and `iHist` (`phases`, in Amperes).
   - The importer stamps $G_{\text{eq}}$ into the global nodal conductance matrix $G$ and injects $I_{\text{hist}}$ into the global RHS vector $I$.
2. **Global Nodal Solve:**
   - The EMT solver solves $G \cdot v(t) = I$ simultaneously across all network buses and `fmi-ls-emt` companions.
3. **Phase 2 — Post-Solve State Advance (`doStep(tSec, dtSec, vNode)`):**
   - The importer writes the solved terminal voltages `vNode` (in Volts) to `vNodeVar` and advances the companion's internal states (trapezoidal history currents, integrator states, switching status) for the next step.

### 3.1 Critical Damping Adjustment (CDA)

When a switching event occurs and `supportsHalfStepCda="true"`, the importer may invoke two consecutive half-steps with `dtSec = dt / 2` (Backward-Euler damping) to suppress numerical trapezoidal ringing without restarting the FMU.

---

## 4. WebAssembly Companion ABI (`runtime.wasm`)

For zero-overhead in-browser and Node.js execution, `fmi-ls-emt` companions may be compiled to WebAssembly (`memory` exported, `f64` IEEE-754 little-endian):

| Exported Symbol         | Signature                                             | Description                                                                                        |
| :---------------------- | :---------------------------------------------------- | :------------------------------------------------------------------------------------------------- |
| `<name>_init`           | `(paramsPtr: usize, count: i32) -> void`              | Optional. Reads `count` `f64` parameters from `paramsPtr` (`[R, L, C, Vref, Kp, Ki]`).             |
| `<name>_stampCompanion` | `(t: f64, dt: f64, gPtr: usize, iPtr: usize) -> void` | Writes `phases*phases` `f64` conductances to `gPtr` and `phases` `f64` history currents to `iPtr`. |
| `<name>_doStep`         | `(t: f64, dt: f64, vPtr: usize) -> void`              | Reads `phases` `f64` solved terminal voltages from `vPtr` and updates internal companion state.    |

If component-prefixed symbols (`<name>_*`) are not present, the loader falls back to unprefixed `init`, `stampCompanion`, and `doStep`.

---

## 5. Reference Implementation

- **Manifest Parser & XML Generator:** `packages/exchange/src/fmu/fmi-ls-emt.ts` (`FMI_LS_EMT_ANNOTATION_TYPE`, `parseFmiLsEmtAnnotations`, `generateFmiLsEmtAnnotationXml`, `FmiLsEmtCompanionInstance`)
- **WASM Companion Loader & Browser/Worker Compiler:** `languages/pscad/src/catalog/wasm-companion-loader.ts` (`instantiateWasmCompanionsForNetlist`, `compileAssemblyScriptCompanion`, `compileAssemblyScriptInWorker`)
- **EMT Solver Integration:** `languages/pscad/src/solver/emt-solver.ts` (`EmtSolver`)

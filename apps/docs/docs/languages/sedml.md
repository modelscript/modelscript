---
title: COMBINE SED-ML (.sedml)
description: Compiler reference for COMBINE SED-ML reproducible simulation experiment protocols, KiSAO solver mappings, DataGenerator post-processing, DAEBuilder lowering, and Modelica projections.
---

# COMBINE SED-ML Simulation Experiments (`.sedml`)

`@modelscript/sedml` (`languages/sedml`) provides native WebAssembly parsing, KiSAO solver algorithm validation, multi-task simulation protocol execution (`UniformTimeCourse`, `OneStep`, `SteadyState`, `RepeatedTask`), `DataGenerator` post-processing, `DAEBuilder` lowering, and Modelica experiment projection for **Simulation Experiment Description Markup Language (SED-ML Level 1 Version 3/4)** reproducible simulation studies.

---

## Supported Extensions & Standards

| Extension        | Format         | Description                                                                                                          |
| :--------------- | :------------- | :------------------------------------------------------------------------------------------------------------------- |
| `.sedml`, `.xml` | COMBINE SED-ML | XML specification of `listOfModels`, `listOfSimulations`, `listOfTasks`, `listOfDataGenerators`, and `listOfOutputs` |

---

## Governing Mathematical Formulation

### 1. Uniform Time-Course Discretization & KiSAO Solver Mapping

A SED-ML `uniformTimeCourse` specifies an initial integration start time $t_0 = t_{\text{initial}}$, an output recording window $[t_{\text{start}}, t_{\text{end}}]$ with $t_0 \le t_{\text{start}} < t_{\text{end}}$, and $N_{\text{pts}} = \text{numberOfPoints}$ uniform sampling intervals of step size:

$$
\Delta t = \frac{t_{\text{end}} - t_{\text{start}}}{N_{\text{pts}}}, \qquad t_k = t_{\text{start}} + k\,\Delta t \quad (k = 0, 1, \dots, N_{\text{pts}})
$$

Each `algorithm` element references an ontology term from the **Kinetic Simulation Algorithm Ontology (KiSAO)**alongside `algorithmParameter` tolerances (`KISAO:0000209` relative tolerance $\varepsilon_{\text{rel}}$, `KISAO:0000211` absolute tolerance $\varepsilon_{\text{abs}}$):

| KiSAO Term      | Algorithm Name                               | `@modelscript/simulate` Target |
| :-------------- | :------------------------------------------- | :----------------------------- |
| `KISAO:0000019` | CVODE (Variable-order BDF / Adams-Moulton)   | `cvode` / `bdf`                |
| `KISAO:0000283` | IDA (Implicit Differential-Algebraic solver) | `ida`                          |
| `KISAO:0000032` | Explicit 4th-order Runge-Kutta (RK4)         | `rk4`                          |
| `KISAO:0000086` | Fehlberg / Dormand-Prince adaptive RK45      | `dopri5`                       |
| `KISAO:0000304` | Radau IIA 5th-order implicit Runge-Kutta     | `radau5`                       |
| `KISAO:0000029` | Gillespie Direct Stochastic Simulation (SSA) | Stochastic ensemble kernel     |

### 2. Model Pre-Processing (`changeAttribute` & `computeChange`) and `DataGenerator` Normalization

Before task execution, `computeChange` evaluates a functional parameter override $p_{\text{new}} = g(\mathbf{p}_0)$ over XPath/SBML target identifiers. After trajectory integration $\mathbf{x}(t_k)$, each `dataGenerator` $d_j$ evaluates a post-processing functional over raw model variables $v_i(t_k)$:

$$
y_j(t_k) = f_j\!\left(v_1(t_k), \dots, v_m(t_k), \mathbf{c}_j\right), \qquad \tilde{y}_j(t_k) = \frac{y_j(t_k) - \min_k y_j(t_k)}{\max_k y_j(t_k) - \min_k y_j(t_k)}
$$

---

## `DAEBuilder` Arena Lowering & Cross-Language Projections

- **Direct `DAEBuilder` Lowering (`lowerSedmlToDae`)**: Simulation horizon parameters (`tInitial`, `outputStartTime`, `outputEndTime`, `numberOfPoints`), model attribute overrides (`changeAttribute`), and algebraic `dataGenerator` observable equations are lowered directly into contiguous `DAEBuilder` parameter and equation slots.
- **Modelica Experiment Projection (`sedmlToModelica`)**: Translates SED-ML tasks and parameter sweeps into executable Modelica 3.x models carrying standard `annotation(experiment(StartTime = ..., StopTime = ..., Interval = ..., Tolerance = ...))` metadata.
- **SBML / CellML / COMBINE Archive Coupling**: Resolves `model[@source]` URIs against companion [SBML](./sbml.md) and [CellML](./cellml.md) models in the unified `WorkspaceIndex`.

---

## Pre-Flight Diagnostics

<LintRules lang="sedml" />

---

## CLI Usage

```bash
# Validate time-course bounds, KiSAO IDs, and model/task/dataGenerator references
msx lint OscillatoryProtocol.sedml

# Parse and inspect SED-ML simulation experiment definitions
msx parse OscillatoryProtocol.sedml

# Execute domain actions via msx domain
msx domain sedml inspect OscillatoryProtocol.sedml
```

---

## Programmatic TypeScript SDK

```typescript
import { executeSedml, lintSedml, lowerSedmlToDae, parseSedml, sedmlToModelica } from "@modelscript/sedml";

const doc = parseSedml(sedmlXmlText);
const diagnostics = lintSedml(doc);
const result = executeSedml(doc);
const dae = lowerSedmlToDae(doc);
const modelicaSource = sedmlToModelica(doc);
```

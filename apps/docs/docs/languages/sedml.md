# COMBINE SED-ML Simulation Experiments (`.sedml`)

`@modelscript/sedml` (`languages/sedml`) provides native WebAssembly parsing, KiSAO solver algorithm validation, multi-task simulation protocol execution (`UniformTimeCourse`, `OneStep`, `SteadyState`, `RepeatedTask`), `DataGenerator` post-processing, `DAEBuilder` lowering, and Modelica experiment projection for **Simulation Experiment Description Markup Language (SED-ML Level 1 Version 3/4)** reproducible simulation studies.

---

## Supported Extensions & Standards

| Extension        | Format         | Description                                                                                                          |
| :--------------- | :------------- | :------------------------------------------------------------------------------------------------------------------- |
| `.sedml`, `.xml` | COMBINE SED-ML | XML specification of `listOfModels`, `listOfSimulations`, `listOfTasks`, `listOfDataGenerators`, and `listOfOutputs` |

---

## Key Capabilities

### 1. Reproducible Simulation Protocols & KiSAO Solvers

- Parses SED-ML elements:
  - **Models & Changes (`model`, `changeAttribute`, `computeChange`)**: Base model references (SBML, CellML, Modelica) and parameter overrides.
  - **Simulations (`uniformTimeCourse`, `oneStep`, `steadyState`)**: Initial time, output start/end times, number of points, and **KiSAO** algorithm identifiers (`KISAO:0000019` CVODE, `KISAO:0000032` RK4, `KISAO:0000029` Gillespie SSA).
  - **Tasks & Data Generators (`task`, `repeatedTask`, `dataGenerator`)**: MathML/infix normalization and scaling of raw simulation variables for `plot2D`, `plot3D`, and `report` outputs.

### 2. Protocol Execution & Modelica Experiment Projection

- Executes time-course and parameter-sweep tasks (`executeSedml`), lowers the experiment schedule into `@modelscript/runtime`'s `DAEBuilder` arena, and generates Modelica models annotated with `annotation(experiment(StartTime=..., StopTime=..., NumberOfIntervals=..., Tolerance=...))` (`sedmlToModelica`).

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
```

<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/sedml

Simulation Experiment Description Markup Language (SED-ML Level 1 Version 3 / Version 4, COMBINE standard) simulation protocol, algorithm parameterization, parameter sweep, and post-processing package (`.sedml`, `.xml`) for ModelScript. Features a true zero-regex character-by-character XML & Content MathML parser (`parseSedml`, `serializeSedml`), multi-file workspace indexing (`SedmlWorkspaceIndex`), a deterministic simulation experiment runner (`executeSedmlExperiment`), direct linear-memory `DAEBuilder` experiment lowering (`lowerSedmlToDae`), 10 pre-flight simulation protocol & cross-reference lint rules (`M9151`–`M9160`), Modelica 3.x simulation experiment projections (`sedmlToModelica`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **Zero-Regex SED-ML L1V3/L1V4 & Content MathML Parser (`parseSedml`, `serializeSedml`)**: Character-by-character XML scanner and AST builder supporting:
  - **`<listOfSimulations>`**: `<uniformTimeCourse>` (`initialTime`, `outputStartTime`, `outputEndTime`, `numberOfSteps`), `<oneStep>` (`step`), `<steadyState>`, and `<algorithm kisaoID="KISAO:xxxxxxx">` with `<listOfAlgorithmParameters>`.
  - **`<listOfModels>`**: `<model>` references (`language`, `source`) and pre-processing `<listOfChanges>` (`<changeAttribute>`, `<computeChange>` with local variables/parameters/MathML, `<addXML>`, `<changeXML>`, `<removeXML>`).
  - **`<listOfTasks>`**: `<task>` (`modelReference`, `simulationReference`) and `<repeatedTask>` (`<listOfRanges>` with `<uniformRange>`, `<vectorRange>`, `<functionalRange>`, `<listOfChanges>` with `<setValue>`, and `<listOfSubTasks>`).
  - **`<listOfDataGenerators>` & `<listOfOutputs>`**: `<dataGenerator>` MathML post-processing formulas (`<apply>`, `<plus/>`, `<minus/>`, `<times/>`, `<divide/>`, `<power/>`, `<ci>`, `<cn>`), `<plot2D>` (`<listOfCurves>`), `<plot3D>` (`<listOfSurfaces>`), and `<report>` (`<listOfDataSets>`).
- **Simulation Experiment Runner (`executeSedmlExperiment`)**: Resolves model inheritance chains, applies `<changeAttribute>` and `<computeChange>` parameter/state overrides, integrates uniform time courses and repeated task parameter sweeps using RK4 (`KISAO:0000019` / `KISAO:0000032`) or Forward Euler (`KISAO:0000030`), evaluates post-processing `<dataGenerator>` expressions via a zero-eval recursive-descent compiler, and generates 2D/3D curve trajectories and tabular report datasets.
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerSedmlToDae`)**: Compiles simulation time-course parameters, model state/parameter overrides, state ODE balances, and post-processing `<dataGenerator>` algebraic equations directly into ModelScript's zero-GC WebAssembly `DAEBuilder` arena (`N_vars == N_eqs`).
- **10 Pre-Flight SED-ML Lint Rules (`M9151`–`M9160`, `lintSedml`)**: Static verification of time-course bounds, KiSAO ontology identifiers (`KISAO:xxxxxxx`), model/simulation/task/dataGenerator cross-references, circular model source chains, undefined `<dataGenerator>` math identifiers, empty experiments, and duplicate SId declarations.
- **Modelica 3.x Simulation Experiment Projection (`sedmlToModelica`)**: Synthesizes standalone Modelica 3.x simulation experiment models with `annotation(experiment(StartTime=..., StopTime=..., NumberOfIntervals=...))`.
- **Multi-File Workspace Indexing & LSP (`SedmlWorkspaceIndex`, `validateSedml`, `getSedmlDocumentSymbols`, `getSedmlHover`)**: Implements `IWorkspaceIndex` across `.sedml` and `.xml` files with document symbol hierarchy, hover cards, and AST writeback.

---

## Package Structure

| Path                                   | Description                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/index.ts`                         | Public package exports                                                                                                   |
| `src/language.ts`                      | `sedmlLanguage` definition and LSP actions (`lint_sedml`, `sedml_simulate`, `sedml_to_dae`, `sedml_to_modelica`)         |
| `src/types.ts`                         | `SedmlDocument`, `SedmlSimulation`, `SedmlModel`, `SedmlTask`, `SedmlDataGenerator`, `SedmlOutput`, and range types      |
| `src/errors.ts`                        | `SedmlErrorCode` diagnostic registry (`M9151`–`M9160`)                                                                   |
| `src/parser/sedml-parser.ts`           | `parseSedml` and `serializeSedml` zero-regex character-by-character XML and Content MathML parser                        |
| `src/parser/index.ts`                  | Parser barrel exports                                                                                                    |
| `src/lints/sedml-linter.ts`            | `lintSedml` time-course, KiSAO, reference integrity, and MathML variable diagnostic engine                               |
| `src/lints/index.ts`                   | Linter barrel exports                                                                                                    |
| `src/solvers/sedml-runner.ts`          | `executeSedmlExperiment` time-course integrator, model change processor, and post-processing `<dataGenerator>` evaluator |
| `src/solvers/index.ts`                 | Solver barrel exports                                                                                                    |
| `src/dae/sedml-to-dae.ts`              | `lowerSedmlToDae` direct lowering of experiment parameters, overrides, and data generators into `DAEBuilder`             |
| `src/dae/index.ts`                     | DAE lowering barrel exports                                                                                              |
| `src/projections/sedml-to-modelica.ts` | `sedmlToModelica` translator to Modelica 3.x simulation experiment models with `annotation(experiment(...))`             |
| `src/projections/index.ts`             | Projections barrel exports                                                                                               |
| `src/workspace-index.ts`               | `SedmlWorkspaceIndex` implementing `IWorkspaceIndex` across `.sedml` and `.xml` files                                    |
| `src/lsp.ts`                           | LSP diagnostics, document symbols, hover, and action execution providers                                                 |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                                     | Severity  | Description                                                                                                                                         |
| ------- | ---------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `M9151` | `invalid-time-course-bounds`             | `error`   | UniformTimeCourse simulation defines invalid bounds (`outputStartTime < initialTime`, `outputEndTime <= outputStartTime`, or `numberOfSteps <= 0`). |
| `M9152` | `invalid-kisao-id`                       | `error`   | Simulation specifies a missing or malformed algorithm KiSAO identifier (expected `'KISAO:xxxxxxx'`).                                                |
| `M9153` | `unresolved-model-reference`             | `error`   | Task `modelReference` or internal model `source` references an undefined `<model>` ID.                                                              |
| `M9154` | `unresolved-simulation-reference`        | `error`   | Task `simulationReference` references an undefined `<uniformTimeCourse>`, `<oneStep>`, or `<steadyState>` ID.                                       |
| `M9155` | `unresolved-task-reference`              | `error`   | DataGenerator `<variable>` or RepeatedTask `<subTask>` references an undefined `<task>` ID.                                                         |
| `M9156` | `unresolved-data-generator-reference`    | `error`   | Output `<curve>` (`xDataReference`/`yDataReference`) or `<dataSet>` (`dataReference`) references an undefined `<dataGenerator>` ID.                 |
| `M9157` | `circular-model-source`                  | `error`   | Model `source` reference chain forms a circular dependency.                                                                                         |
| `M9158` | `undefined-data-generator-math-variable` | `warning` | DataGenerator `<math>` expression references an identifier not declared in `<listOfVariables>` or `<listOfParameters>`.                             |
| `M9159` | `empty-sedml-experiment`                 | `warning` | SED-ML document defines an empty experiment with no simulations or no tasks.                                                                        |
| `M9160` | `duplicate-sedml-id`                     | `error`   | SED-ML identifier `id` is declared multiple times within the document.                                                                              |

---

## Programmatic Usage

```typescript
import { executeSedmlExperiment, lintSedml, lowerSedmlToDae, parseSedml, sedmlToModelica } from "@modelscript/sedml";

const sedmlXml = `<?xml version="1.0" encoding="UTF-8"?>
<sedML xmlns="http://sed-ml.org/sed-ml/level1/version4" level="1" version="4">
  <listOfSimulations>
    <uniformTimeCourse id="sim1" initialTime="0" outputStartTime="0" outputEndTime="10" numberOfSteps="50">
      <algorithm kisaoID="KISAO:0000019"/>
    </uniformTimeCourse>
  </listOfSimulations>
  <listOfModels>
    <model id="model_base" language="urn:sedml:language:sbml" source="enzyme.xml"/>
    <model id="model_perturbed" language="urn:sedml:language:sbml" source="model_base">
      <listOfChanges>
        <changeAttribute target="/sbml:sbml/sbml:model/sbml:listOfSpecies/sbml:species[@id='S']/@initialConcentration" newValue="20.0"/>
        <changeAttribute target="/sbml:sbml/sbml:model/sbml:listOfParameters/sbml:parameter[@id='k1']/@value" newValue="0.4"/>
      </listOfChanges>
    </model>
  </listOfModels>
  <listOfTasks>
    <task id="task1" modelReference="model_perturbed" simulationReference="sim1"/>
  </listOfTasks>
  <listOfDataGenerators>
    <dataGenerator id="dg_time" name="Time">
      <listOfVariables>
        <variable id="time" symbol="urn:sedml:symbol:time" taskReference="task1"/>
      </listOfVariables>
      <math xmlns="http://www.w3.org/1998/Math/MathML"><ci>time</ci></math>
    </dataGenerator>
    <dataGenerator id="dg_S_scaled" name="Normalized Substrate">
      <listOfVariables>
        <variable id="S" target="/sbml:sbml/sbml:model/sbml:listOfSpecies/sbml:species[@id='S']" taskReference="task1"/>
      </listOfVariables>
      <listOfParameters>
        <parameter id="scale" value="0.05"/>
      </listOfParameters>
      <math xmlns="http://www.w3.org/1998/Math/MathML">
        <apply><times/><ci>S</ci><ci>scale</ci></apply>
      </math>
    </dataGenerator>
  </listOfDataGenerators>
  <listOfOutputs>
    <plot2D id="plot1" name="Substrate Decay">
      <listOfCurves>
        <curve id="c1" logX="false" logY="false" xDataReference="dg_time" yDataReference="dg_S_scaled"/>
      </listOfCurves>
    </plot2D>
    <report id="report1" name="Time Course Report">
      <listOfDataSets>
        <dataSet id="ds_t" label="Time" dataReference="dg_time"/>
        <dataSet id="ds_s" label="Normalized_S" dataReference="dg_S_scaled"/>
      </listOfDataSets>
    </report>
  </listOfOutputs>
</sedML>`;

// 1. Parse SED-ML document and run M9151-M9160 pre-flight diagnostics
const doc = parseSedml(sedmlXml, "experiment.sedml");
const diagnostics = lintSedml(doc);

// 2. Execute simulation experiment, model changes, and data generators
const result = executeSedmlExperiment(doc);
console.log(result.plots.plot1?.curves[0]?.points.length);
console.log(result.reports.report1?.table.Normalized_S);

// 3. Lower to DAEBuilder linear memory or project to Modelica 3.x
const dae = lowerSedmlToDae(doc);
const modelicaCode = sedmlToModelica(doc, "EnzymeExperiment");
```

---

## Scripts

| Command             | Description                                                                            |
| ------------------- | -------------------------------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                                                          |
| `npm test`          | Run SED-ML parser, serializer, linter (M9151–M9160), runner, DAE, and projection tests |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                                  |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                                   |
| `npm run clean`     | Remove `dist/` build artifacts                                                         |

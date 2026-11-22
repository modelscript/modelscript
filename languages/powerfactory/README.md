<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/powerfactory

**Maturity:** Beta · **Extensions:** `.dz`, `.pfd`, `.dsl` · **Docs:** [modelscript.org/languages/powerfactory](https://modelscript.org/languages/powerfactory)

DIgSILENT PowerFactory Project Archive (`.dz`), Project Database (`.pfd`), Data Exchange XML, and DIgSILENT Simulation Language (`.dsl`) package for ModelScript.

## Features

- **Archive & XML Ingestion (`parsePowerFactoryFile`, `parsePowerFactoryXml`)**: Unpacks `.dz` zip containers and parses PowerFactory XML object models (`ElmNet`, `ElmSubstat`, `ElmTerm`, `ElmLne`, `ElmTr2`, `ElmTr3`, `ElmSym`, `ElmGenstat`, `ElmLod`, `ElmShnt`, `StaSwitch`, `SetDesktop`, `IntGrf`).
- **Node-Breaker Topology Processor (`processPowerFactoryTopology`)**: Union-find disjoint-set reduction resolving open/closed breakers and isolators into bus-branch topologies.
- **Cross-Projections (`powerFactoryToPsse`, `powerFactoryToModelica`)**: Seamlessly projects PowerFactory grids into IEEE/PSS/E v33 `.raw` models (`@modelscript/psse`) and OpenIPSL Modelica 3.x models (`@modelscript/modelica`).
- **DIgSILENT Simulation Language Compiler (`parseDsl`, `transpileDslToModelica`)**: Parses `.dsl` transfer functions and differential equations, lowering them into OpenIPSL Modelica blocks and `DAEBuilder` nodes.
- **Python Automation Shim (`PowerFactorySession`, `executePythonPowerFactoryScript`)**: In-memory Python automation bridge compatible with `import powerfactory as pf`.
- **Pre-Flight Grid Linter (`lintPowerFactoryModel`)**: Pre-flight checks (`PF1001`–`PF1008`) for floating terminals, disconnected substations, impedance parameter bounds, and transformer vector group definitions.
- **Power System Solvers & IEC 61850**: Includes IEC 60909 short-circuit corrections, cable ampacity/impedance, OPF, reliability, phasor co-simulation participant, and IEC 61850 SCL/GOOSE validation.

## Package Structure

| File                                          | Responsibility                                                               |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| `src/language.ts`                             | `@modelscript/dsl` language registration (`.dz`, `.pfd`, `.dsl`)             |
| `src/parser/powerfactory-parser.ts`           | `.dz` archive, `.pfd`, and PowerFactory XML object model parser              |
| `src/dsl/dsl-parser.ts`                       | DIgSILENT Simulation Language (`.dsl`) parser                                |
| `src/dsl/dsl-transpiler.ts`                   | `transpileDslToModelica` `.dsl` to Modelica / OpenIPSL transpiler            |
| `src/topology/topology-processor.ts`          | `processPowerFactoryTopology` node-breaker to bus-branch topology reducer    |
| `src/dae/powerfactory-to-dae.ts`              | Linear-memory `DAEBuilder` lowering for PowerFactory networks and DSL blocks |
| `src/projections/powerfactory-to-psse.ts`     | `powerFactoryToPsse` projection to PSS/E v33 `.raw`                          |
| `src/projections/powerfactory-to-modelica.ts` | `powerFactoryToModelica` projection to OpenIPSL Modelica 3.x                 |
| `src/solvers/iec60909-corrections.ts`         | IEC 60909 short-circuit correction factors and fault analysis                |
| `src/solvers/powerfactory-opf.ts`             | Optimal Power Flow (OPF) solver integration                                  |
| `src/iec61850/goose-validator.ts`             | IEC 61850 SCL/GOOSE substation protection validator                          |
| `src/powerfactory-shim.ts`                    | `PowerFactorySession` Python automation compatibility shim                   |
| `src/lints/index.ts`                          | `lintPowerFactoryModel` pre-flight grid linter (`PF1001`–`PF1008`)           |
| `src/lsp.ts`                                  | Language Server Protocol hover, symbols, and diagnostics                     |
| `src/index.ts`                                | Public package entry point and barrel exports                                |

## Scripts

```bash
pnpm --filter @modelscript/powerfactory build
pnpm --filter @modelscript/powerfactory test
pnpm --filter @modelscript/powerfactory lint
pnpm --filter @modelscript/powerfactory typecheck
```

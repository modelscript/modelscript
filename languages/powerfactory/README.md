<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/powerfactory

DIgSILENT PowerFactory Project Archive (`.dz`), Project Database (`.pfd`), Data Exchange XML, and DIgSILENT Simulation Language (`.dsl`) package for ModelScript.

## Features

- **Archive & XML Ingestion (`parsePowerFactoryFile`, `parsePowerFactoryXml`)**: Unpacks `.dz` zip containers and parses PowerFactory XML object models (`ElmNet`, `ElmSubstat`, `ElmTerm`, `ElmLne`, `ElmTr2`, `ElmTr3`, `ElmSym`, `ElmGenstat`, `ElmLod`, `ElmShnt`, `StaSwitch`, `SetDesktop`, `IntGrf`).
- **Node-Breaker Topology Processor (`processPowerFactoryTopology`)**: Union-find disjoint-set reduction resolving open/closed breakers and isolators into bus-branch topologies.
- **Cross-Projections (`powerFactoryToPsse`, `powerFactoryToModelica`)**: Seamlessly projects PowerFactory grids into IEEE/PSS/E v33 `.raw` models (`@modelscript/psse`) and OpenIPSL Modelica 3.x models (`@modelscript/modelica`).
- **DIgSILENT Simulation Language Compiler (`parseDsl`, `transpileDslToModelica`)**: Parses `.dsl` transfer functions and differential equations, lowering them into OpenIPSL Modelica blocks and `DAEBuilder` nodes.
- **Python Automation Shim (`PowerFactorySession`, `executePythonPowerFactoryScript`)**: In-memory Python automation bridge compatible with `import powerfactory as pf`.
- **Pre-Flight Grid Linter (`lintPowerFactoryModel`)**: Pre-flight checks (`PF1001`–`PF1008`) for floating terminals, disconnected substations, impedance parameter bounds, and transformer vector group definitions.

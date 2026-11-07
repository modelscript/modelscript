---
title: "IEC 62714 AutomationML & CAEX Plant Topology (.aml, .caex, .amlx)"
description: "@modelscript/automationml (languages/automationml) provides native WebAssembly parsing, CAEX 2.15 / 3.0 hierarchy and InternalLink validation, discrete-event virtual commissioning simulation, DAEBu..."
---

# IEC 62714 AutomationML & CAEX Plant Topology (`.aml`, `.caex`, `.amlx`)

`@modelscript/automationml` (`languages/automationml`) provides native WebAssembly parsing, CAEX 2.15 / 3.0 hierarchy and `InternalLink` validation, discrete-event virtual commissioning simulation, `DAEBuilder` lowering, and SSP / SysML v2 / Modelica projections for **IEC 62714 AutomationML** industrial automation and mechatronic plant engineering models.

---

## Supported Extensions & Standards

| Extension | Format                 | Description                                                                                                    |
| :-------- | :--------------------- | :------------------------------------------------------------------------------------------------------------- |
| `.aml`    | IEC 62714 AutomationML | XML document combining CAEX plant topology, COLLADA 3D geometry/kinematics references, and PLCopen logic links |
| `.caex`   | IEC 62424 CAEX         | Computer Aided Engineering Exchange XML (CAEX 2.15 & 3.0)                                                      |
| `.amlx`   | AutomationML Container | Packaged AutomationML archive bundling `.aml` topologies with referenced `.dae` and `.plcxml` artifacts        |

---

## Key Capabilities

### 1. Four-Pillar CAEX Plant Architecture

- Parses and validates all four CAEX object-oriented libraries inside `CAEXFile`:
  - **`InstanceHierarchy`**: Concrete plant cells, robots, conveyors, sensors, and PLC controllers (`InternalElement`).
  - **`SystemUnitClassLib`**: Reusable mechatronic equipment templates and vendor device catalogs.
  - **`RoleClassLib`**: Semantic engineering roles (`Resource`, `Product`, `Process`, `MechatronicAssembly`).
  - **`InterfaceClassLib`**: Typed external connectors (`ExternalInterface`: `COLLADAInterface`, `PLCopenXmlInterface`, `SignalInterface`, `Order`).

### 2. Virtual Commissioning & Scan-Cycle Simulation

- Executes deterministic discrete-time scan-cycle virtual commissioning (`runAmlVirtualCommissioning`) across linked actuators, sensors, and controller interfaces.
- Lowers continuous and discrete mechatronic state equations directly into `@modelscript/runtime`'s `DAEBuilder` linear memory arena.

### 3. Multi-Domain Projections (SSP, SysML v2, Modelica)

- **SSP 1.0 (`amlToSsp`)**: Generates `SystemStructure.ssd` co-simulation topologies from AutomationML `InstanceHierarchy` and `InternalLink` connections.
- **OMG SysML v2 (`amlToSysML2`)**: Maps `InternalElement` hierarchies and `ExternalInterface` ports to SysML v2 `part` and `port` usages.
- **Modelica 3.x (`amlToModelica`)**: Synthesizes connected acausal Modelica plant models.

---

## Pre-Flight Diagnostics

<LintRules lang="automationml" />

---

## CLI Usage

```bash
# Inspect CAEX instance hierarchies, role libraries, and interfaces
msx aml inspect RoboticAssemblyCell.aml

# Run pre-flightIEC 62714 / CAEX linting and link validation
msx aml lint RoboticAssemblyCell.aml

# Run scan-cycle virtual commissioning simulation
msx aml commission RoboticAssemblyCell.aml --cycles=50 --dt=10

# Project plant topology to SSP 1.0, SysML v2, or Modelica
msx aml to-ssp RoboticAssemblyCell.aml -o SystemStructure.ssd
msx aml to-sysml RoboticAssemblyCell.aml -o PlantArchitecture.sysml
msx aml to-modelica RoboticAssemblyCell.aml -o PlantModel.mo
```

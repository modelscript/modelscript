---
title: AUTOSAR Automotive Software Architecture & Virtual RTE
description: Native compiler support for AUTOSAR Classic and Adaptive ARXML software components, Virtual Run-Time Environment (RTE) scheduling, automotive linters, and Modelica/SysML v2 projections in ModelScript.
---

# AUTOSAR Classic & Adaptive Architecture

ModelScript delivers native, high-performance compiler support for **AUTOSAR** (`.arxml`), the international standard for automotive electronic control unit (ECU) software architectures. Engineers can parse, validate, simulate event-triggered and periodic runnables, and bridge automotive software components (SWCs) directly into continuous plant models and SysML v2 systems requirements.

---

## Capabilities & Supported Formats

| Format                     | Extension        | Description                                                                                                                                                                                                   |
| :------------------------- | :--------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AUTOSAR ARXML Document** | `.arxml`, `.xml` | XML schema defining packages, software component types (`ApplicationSwComponentType`, `SensorActuatorSwComponentType`), internal behaviors, runnables, timing events, interfaces, and ECU network topologies. |

### Key Architectural Pillars

- **High-Throughput ARXML Ingestion:**
  - Robust XML extraction parsing software component definitions, client-server and sender-receiver interfaces, port prototypes, variable access definitions, runnable entities, and timing events via `parseArxml()`.
- **In-Memory Virtual RTE Simulation Engine:**
  - Implements an event-driven and periodic discrete scheduler (`VirtualRte`) reproducing AUTOSAR RTE semantics (`Rte_Read`, `Rte_Write`).
  - Routes signals across hierarchical assembly connectors (`AssemblySwConnector`) between provider P-ports and requester R-ports.
- **Automotive Static Linters (`M7401`–`M7408`):**
  - Detects unconnected required ports, interface signature mismatches, Worst-Case Execution Time (WCET) budget overruns against event periods, overlapping signal allocations in CAN/LIN PDUs, and cyclic runnable dependencies.
- **Dual Architectural Projections:**
  - **Modelica Standard Blocks:** Translates SWCs into acausal discrete blocks for Hardware-in-the-Loop (HIL) and Software-in-the-Loop (SIL) co-simulation with 1D vehicle plant dynamics.
  - **SysML v2 Systems Architecture:** Generates formal OMG SysML v2 `part def` hierarchies, connection usages, and port definitions for digital thread traceability.
- **Continuous/Discrete DAE Lowering:**
  - Compiles SWC states, calibrated calibration parameters, and discrete runnable step functions into the `DAEBuilder` SoA linear memory arena.

---

## Command Line Interface (`msx autosar`)

ModelScript CLI provides turnkey subcommands for automotive ECU engineering:

```bash
msx autosar <action> [files...] [options]
```

| Action             | Description                                                                                   | Key Options                                             |
| :----------------- | :-------------------------------------------------------------------------------------------- | :------------------------------------------------------ |
| **`inspect`**      | Dumps package hierarchy, SWC components, runnable entities, timing events, and network PDUs.  | —                                                       |
| **`lint`**         | Runs pre-flight automotive semantic checks, interface compatibility, and scheduling analysis. | —                                                       |
| **`to-modelica`**  | Generates Modelica standard blocks representing SWC interfaces and communication buses.       | `--out=<file.mo>`                                       |
| **`to-sysml`**     | Projects AUTOSAR composition architecture to formal OMG SysML v2 code.                        | `--out=<file.sysml>`                                    |
| **`to-dae`**       | Lowers software architecture into ModelScript linear-memory DAE arena and prints statistics.  | —                                                       |
| **`simulate-rte`** | Executes the Virtual RTE discrete event scheduler over a configured time window.              | `--duration=<sec>`, `--step=<sec>`, `--out=<file.json>` |

### Examples

```bash
# Inspect automotive software components and timing events
msx autosar inspect PowertrainArchitecture.arxml

# Lint for unconnected R-ports, timing budget overflows, or PDU collisions
msx autosar lint BrakeController.arxml

# Project software component architecture to SysML v2 part definitions
msx autosar to-sysml SteeringSystem.arxml --out=SteeringArchitecture.sysml

# Simulate periodic runnable execution and signal routing through Virtual RTE
msx autosar simulate-rte PowertrainSystem.arxml --duration=0.5 --step=0.01 --out=rte_log.json
```

---

## Automotive Pre-Flight Linters & Diagnostic Rules

<LintRules lang="autosar" />

---

## Language Server Protocol & Registry Integration

AUTOSAR `.arxml` documents enjoy full language intelligence through `@modelscript/lsp`:

```typescript
import { parseArxml, lintAutosarModel, VirtualRte, autosarToModelica, autosarToSysml } from "@modelscript/autosar";

// Parse ARXML text
const model = parseArxml(arxmlText);

// Pre-flight static checking
const diagnostics = lintAutosarModel(model);

// Virtual RTE Execution
const rte = new VirtualRte(model);
rte.registerRunnable("PedalSensor", "RE_ReadPedal", (ctx) => {
  ctx.write("PedalOut", "Pos", 0.75);
});
rte.registerRunnable("EngineECU", "RE_ComputeThrottle", (ctx) => {
  const pedal = Number(ctx.read("PedalIn", "Pos"));
  ctx.write("ThrottleOut", "Cmd", pedal * 0.9);
});

// Advance 50 ms in 10 ms steps
const executionLog = rte.runUntil(0.05, 0.01);
```

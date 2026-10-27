---
title: MATLAB Simulink Modeling & DAE Lowering
description: Native compiler support for MATLAB Simulink (.slx, .mdl) block diagrams, algebraic loop detection, continuous and discrete DAE lowering, and Modelica standard block projections in ModelScript.
---

# MATLAB Simulink Control Systems

ModelScript provides first-class, polyglot compiler support for **MATLAB Simulink** (`.slx`, `.mdl`) control models and dynamic block diagrams. Engineers can author, inspect, lint, formally lower to differential-algebraic equations (DAEs), and project Simulink systems into standard Modelica blocks without requiring a MATLAB license or desktop installation.

---

## Capabilities & Supported Formats

| Format                           | Extension | Description                                                                                                |
| :------------------------------- | :-------- | :--------------------------------------------------------------------------------------------------------- |
| **Simulink Modern Zip Package**  | `.slx`    | Modern OPC XML archive packaging block hierarchy, solver configuration, and state routing.                 |
| **Simulink Classic ASCII Model** | `.mdl`    | Classic structured text block diagram specification with hierarchical `System`, `Block`, and `Line` trees. |

### Core Architectural Features

- **Native Binary & Text Parser:**
  - Fast, streaming unpacker and XML reader for `.slx` packages via `parseSlx()`.
  - Recursive descent structured parser and lossless roundtrip serializer for `.mdl` text files via `parseMdl()`.
- **Pre-Flight Control System Linters (`M7201`–`M7210`):**
  - Graph-theoretic algebraic loop detection via Tarjan's Strongly Connected Components (SCC) algorithm across direct-feedthrough blocks (`Gain`, `Sum`, `Product`).
  - Unconnected input ports, division-by-zero risks, port index mismatches, and multi-rate sample time conflicts.
- **Continuous & Discrete DAE Lowering:**
  - Directly maps standard block types (`Integrator`, `Gain`, `Sum`, `Constant`, `TransferFcn`, `UnitDelay`, `Saturation`) into `DAEBuilder` SoA linear memory arena.
  - Automatically transforms high-order continuous transfer functions $G(s) = \frac{N(s)}{D(s)}$ into Controllable Canonical Form (state-space realization).
  - Handles discrete sample-and-hold states for synchronous multirate execution.
- **Modelica Projection:**
  - Synthesizes idiomatic `Modelica.Blocks` continuous and discrete acausal models preserving block hierarchy, signal dimensions, and parameter arithmetic.
- **Language Server Protocol (LSP):**
  - Real-time diagnostic publication, hierarchical document outline (`DocumentSymbol`), contextual hover documentation, and quick-fixes in VS Code and web editors.

---

## Command Line Interface (`msx simulink`)

ModelScript CLI exposes turnkey subcommands for headless CI/CD and automation workflows:

```bash
msx simulink <action> [files...] [options]
```

| Action            | Description                                                                              | Key Options       |
| :---------------- | :--------------------------------------------------------------------------------------- | :---------------- |
| **`inspect`**     | Dumps block diagram hierarchy, solver settings, block counts, and connection topologies. | —                 |
| **`lint`**        | Runs pre-flight static analysis, algebraic loop detection, and semantic checks.          | —                 |
| **`to-modelica`** | Generates standard `Modelica.Blocks` source code.                                        | `--out=<file.mo>` |
| **`to-dae`**      | Compiles block diagram into ModelScript linear-memory DAE arena and prints statistics.   | —                 |

### Examples

```bash
# Inspect model parameters, sample times, and block topology
msx simulink inspect CruiseControl.slx

# Check for unconnected inputs, algebraic loops, or division-by-zero risks
msx simulink lint EngineGovernor.mdl

# Convert a Simulink controller into standard Modelica 3.x blocks
msx simulink to-modelica SuspensionControl.slx --out=SuspensionControl.mo

# Lower continuous and discrete equations into DAEBuilder arena
msx simulink to-dae FlightGuidance.mdl
```

---

## Control-Theoretic Linters & Diagnostic Rules

<LintRules lang="simulink" />

> [!TIP]
> Algebraic loops detected by `M7202` can often be broken without physical fidelity loss by inserting a `UnitDelay` (discrete) or by modeling small actuator/sensor inertia via a first-order lag `TransferFcn` (continuous).

---

## Language Server Protocol & Registry Integration

Simulink is fully integrated with `@modelscript/lsp` via `SimulinkWorkspaceIndex`:

```typescript
import { parseSimulink, lintSimulinkModel, simulinkToModelica, lowerSimulinkToDae } from "@modelscript/simulink";

// Parse .mdl or .slx buffer
const model = parseSimulink(fileContent);

// Run static linting
const diagnostics = lintSimulinkModel(model);

// Project to Modelica standard blocks
const modelicaCode = simulinkToModelica(model);

// Lower directly to linear-memory DAE arena
const dae = lowerSimulinkToDae(model);
console.log(`Variables: ${dae.varCount}, Equations: ${dae.eqCount}`);
```

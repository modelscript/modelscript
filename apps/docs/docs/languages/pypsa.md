---
title: "PyPSA Python for Power System Analysis (.pypsa, .pypsa.json)"
description: "The @modelscript/pypsa package provides native parsing, static diagnostics, DAE lowering, AMPL optimization projection, SLD diagram input generation, and TGG synchronization for PyPSA energy system networks."
---

# PyPSA — Python for Power System Analysis (`.pypsa`, `.pypsa.json`)

The `@modelscript/pypsa` package (`languages/pypsa`) provides native support for **PyPSA** (Python for Power System Analysis) multi-carrier energy and power network definitions (`.pypsa`, `.pypsa.json`). It parses buses, lines, links, generators, storage units, and loads, lowers networks to `DAEBuilder`, and projects capacity-expansion and dispatch problems directly to **AMPL (`.mod`)**.

---

## Supported File Formats

| Extension     | Format              | Description                                                                                                    |
| :------------ | :------------------ | :------------------------------------------------------------------------------------------------------------- |
| `.pypsa`      | PyPSA Network Model | Declarative power & sector-coupled energy network components (buses, lines, generators, loads, storage, links) |
| `.pypsa.json` | PyPSA JSON Snapshot | Structured JSON export of PyPSA network tables and snapshot parameters                                         |

---

## Capabilities

- **Network Parser (`parsePypsa`)**: Parses PyPSA buses (`v_nom`), AC lines (`r`, `x`, `b`, `s_nom`), DC/sector-coupling links, generators (`p_nom`, marginal costs), storage units, and loads.
- **Static Diagnostics (`lintPypsaNetwork`)**: Validates network structure (`PYPSA1001`), duplicate or dangling bus references (`PYPSA2001`, `PYPSA2002`), and physical/economic parameter bounds (`PYPSA3001`–`PYPSA3004`).
- **DAE Arena Lowering (`lowerPypsaToDae`)**: Lowers PyPSA nodal power balances and branch flows directly into linear-memory `DAEBuilder` equations.
- **AMPL Projection (`projectPypsaToAmpl`)**: Projects PyPSA linear optimal power flow (LOPF) and generation expansion models into executable AMPL optimization scripts.
- **Diagram Input, LSP & TGG (`buildPypsaDiagramInput`, `lsp.ts`, `tgg/`)**: Synthesizes single-line diagram inputs for `@modelscript/diagram`, provides LSP symbols/diagnostics, and supports bidirectional TGG rules.

---

## Programmatic TypeScript API

```typescript
import { lintPypsaNetwork, lowerPypsaToDae, parsePypsa, projectPypsaToAmpl } from "@modelscript/pypsa";

const network = parsePypsa(sourceText);
const diagnostics = lintPypsaNetwork(network);
const dae = lowerPypsaToDae(network);
const amplModel = projectPypsaToAmpl(network);
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="pypsa" />

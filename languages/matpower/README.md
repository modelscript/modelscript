<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/matpower`

MATPOWER power flow, optimal power flow (OPF), and transmission network simulation package for ModelScript.

## Overview

MATPOWER is the standard benchmark format used across academic power systems research, national laboratories, and open-source power system tools (e.g. PyPSA, pandapower, PowerModels.jl). This package provides:

- High-throughput parser for MATPOWER case files (`.m`).
- Bi-directional projection between MATPOWER case arrays and `@modelscript/psse` RAW records.
- Direct compilation to ModelScript's WebAssembly linear-memory `DAEBuilder` arena.
- Steady-state AC Newton-Raphson power flow solver integration.
- Electrical, topological, and limit diagnostics matching industry standards.
- Language Server Protocol (LSP) document symbols, outline navigation, and linter reporting.

## Feature Matrix

| Feature          | Supported | Description                                                        |
| :--------------- | :-------- | :----------------------------------------------------------------- |
| Case Parsing     | Yes       | Full support for `mpc.bus`, `mpc.gen`, `mpc.branch`, `mpc.gencost` |
| PSS/E Projection | Yes       | Lossless bidirectional mapping to `@modelscript/psse` RAW formats  |
| DAE Lowering     | Yes       | Direct zero-GC compilation into `DAEBuilder` linear memory         |
| AC Power Flow    | Yes       | Full Newton-Raphson and Fast Decoupled AC power flow solving       |
| Diagnostics      | Yes       | Nodal connectivity, slack bus validation, impedance checks         |
| LSP Services     | Yes       | Outline symbols, diagnostics, and hover integration                |

## Usage

```typescript
import { parseMatpowerCase, solvePowerFlow, matpowerToPsseRaw } from "@modelscript/matpower";

const mpc = parseMatpowerCase(sourceMFile);
const psseCase = matpowerToPsseRaw(mpc);
const solution = solvePowerFlow(psseCase);
console.log(`Converged in ${solution.iterations} iterations.`);
```

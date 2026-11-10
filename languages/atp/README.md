<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/atp`

Alternative Transients Program (ATP-EMTP) card-deck compiler, Dommel companion-matrix trapezoidal transient integration solver, switch timing verification, and zero-GC linear-memory `DAEBuilder` arena lowering for ModelScript.

Supports high-voltage power transmission, substation insulation coordination, capacitor switching surges, lightning strikes, and protective relay transient testing.

---

## Features

| Feature                  | Description                                                                                                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Standards Compliance** | Ingestion and serialization of standard 80-column and free-format ATP-EMTP simulation decks (`.atp`, `.dat`).                                                              |
| **Circuit Elements**     | RLC lumped branches, distributed parameter lines, time-controlled switches, and cosinusoidal AC/DC sources.                                                                |
| **Dommel Solver**        | Companion-network trapezoidal integration tracking history currents, residual norms, and numerical convergence.                                                            |
| **DAE Arena Lowering**   | Direct translation of high-voltage network topologies into linear-memory `@modelscript/runtime` `DAEBuilder` arena.                                                        |
| **Diagnostic Linter**    | Validates simulation control parameters (`ATP1001`), dangling/isolated buses (`ATP2001`), negative branch parameters (`ATP3001`), and switch timing conflicts (`ATP4001`). |
| **LSP Integration**      | Full document outline of network branches, breaker switches, and injection sources with real-time diagnostics.                                                             |

---

## Installation

```bash
npm install @modelscript/atp
```

---

## Quick Start

```typescript
import { parseAtp, simulateAtpCase, lowerAtpToDae } from "@modelscript/atp";

// 1. Ingest an ATP-EMTP card deck (.atp)
const atpCase = parseAtp(atpDeckText);
console.log(`Loaded: ${atpCase.title}, Branches: ${atpCase.branches.length}`);

// 2. Simulate electromagnetic transients using Dommel's method
const result = simulateAtpCase(atpCase, { tolerance: 1e-4 });
console.log(
  `Simulated ${result.stepCount} steps, converged: ${result.converged}, RMSE: ${result.rmse.toExponential(3)}`,
);

// 3. Lower into zero-GC DAE arena
const dae = lowerAtpToDae(atpCase);
console.log(`DAE arena: ${dae.varCount} variables, ${dae.eqCount} equations`);
```

---

## License

AGPL-3.0-or-later

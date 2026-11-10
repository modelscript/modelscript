<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/sel

ModelScript package providing first-class support for **Schweitzer Engineering Laboratories (SEL) Relay Settings & SELogic Control Equations** (`.rdb`, `.rcf`, `.sel`, `.txt`).

## Overview

Schweitzer Engineering Laboratories (SEL) digital protective relays are the utility standard across North America and global power grids for transmission line protection, distribution automation, substation control, and transformer management (e.g. SEL-311, SEL-411, SEL-751, SEL-700 series).

`@modelscript/sel` provides:

- **Parser & Serializer**: Ingests and generates SEL ASCII settings dumps (`.rcf`, `.sel`, `.txt`) and structured database/JSON formats (`.rdb`, `.json`).
- **SELogic Evaluation Engine**: Evaluates boolean SELogic equations (AND, OR, NOT, parentheses), internal Word Bits (`SV01`..`SV16`, `LT01`..`LT16`, `TRIP`, `CLOSE`), and input/output contacts (`IN101`..`IN108`, `OUT101`..`OUT108`).
- **Protection Elements**: Simulates IEEE C37.112 / US curves (U1–U5) and IEC curves (C1–C5) for phase and ground time-overcurrent (51P/51G), instantaneous overcurrent (50P/50G), and multi-zone distance elements (Z1P/Z2P/Z3P).
- **Linear-Memory DAE Arena Lowering**: Compiles relay parameters, pickup thresholds, and logic equations directly into ModelScript's zero-GC `DAEBuilder` arena for hardware-in-the-loop protection co-simulation.
- **Diagnostics (`SEL1001`–`SEL4001`)**: Validates relay identity, detects inverted pickup and distance reach coordination, flags undeclared Word Bits, and identifies circular SELogic equation dependencies.
- **Language Server Protocol (LSP)**: Real-time document symbols, diagnostics, formatting, and interactive language actions.

## Installation

```bash
npm install @modelscript/sel
```

## Quick Start

```typescript
import { parseSELSettings, evaluateRelayProtection, lowerSELToDae } from "@modelscript/sel";

const settingsContent = `
RELAY="SEL-411L"
RID="SUB_NORTH_LINE1"
TID="SEL-411L FEEDER 1"
GROUP 1
50P1P=15.00
51P1P=5.00
51P1C=U3
51P1TD=2.00
Z1P=3.00
Z2P=12.00
TRIP=50P1P OR 51P1 OR Z1P
CLOSE=!51P1 AND IN101
OUT101=TRIP
`;

// Parse settings
const settings = parseSELSettings(settingsContent);

// Evaluate protection response during a 20A fault
const result = evaluateRelayProtection(settings, {
  phaseCurrentA: 20.0,
});

console.log(`Trip status: ${result.tripped}`); // true
console.log(`Trip time: ${result.overcurrentTripTimeSeconds.toFixed(3)}s`);

// Lower directly to ModelScript DAE linear memory
const dae = lowerSELToDae(settings);
console.log(`DAE Variables: ${dae.varCount}, Equations: ${dae.eqCount}`);
```

## License

AGPL-3.0-or-later

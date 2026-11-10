<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/oneliner`

ASPEN OneLiner / CAPE transmission short-circuit analysis, symmetrical component sequence network assembly ($Z_1, Z_0, Z_{0m}$ mutuals), IEEE C37.112 Time-Overcurrent (TOC) protection coordination, and zero-GC linear-memory `DAEBuilder` arena lowering for ModelScript.

Supports electric utility short-circuit studies, breaker interrupting rating checks, relay trip time evaluation, and NERC PRC-027 protection coordination compliance.

---

## Features

| Feature                  | Description                                                                                                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Standards Compliance** | Ingestion and serialization of ASPEN OneLiner / CAPE text formats (`.dxt`, `.olx`).                                                                                     |
| **Sequence Networks**    | Complete positive ($Z_1$) and zero-sequence ($Z_0$) network assembly with zero-sequence parallel line mutuals ($Z_{0m}$).                                               |
| **Fault Calculation**    | Solves 3-phase and single line-to-ground (SLG) fault currents and Thevenin driving-point impedances.                                                                    |
| **Relay Curves**         | Evaluates ANSI 50/51 Time-Overcurrent tripping times across IEEE, US, and IEC standard inverse curves with instantaneous high-set elements.                             |
| **DAE Arena Lowering**   | Direct compilation of bus voltages, line currents, and relay pickup parameters into linear-memory `@modelscript/runtime` `DAEBuilder` arena.                            |
| **Diagnostic Linter**    | Validates duplicate bus/branch identifiers (`OLX1001`), missing terminal busses (`OLX2001`), non-positive reactances (`OLX3001`), and relay setting errors (`OLX4001`). |
| **LSP Integration**      | Full hierarchical outline of busses, transmission lines, generators, and protective relays with real-time diagnostics.                                                  |

---

## Installation

```bash
npm install @modelscript/oneliner
```

---

## Quick Start

```typescript
import {
  parseOneLiner,
  calculateBusFaultCurrents,
  calculateOvercurrentTripTime,
  lowerOneLinerToDae,
} from "@modelscript/oneliner";

// 1. Ingest an ASPEN OneLiner model (.dxt / .olx)
const c = parseOneLiner(onelinerDxtText);
console.log(`Loaded case: ${c.title} with ${c.busses.length} busses and ${c.branches.length} branches`);

// 2. Compute short-circuit fault currents at a bus
const fault = calculateBusFaultCurrents(c, "BUS101");
console.log(`3-Phase Fault Current: ${fault.i3PhaseA.toFixed(1)} A, SLG Fault Current: ${fault.iSlgA.toFixed(1)} A`);

// 3. Evaluate protective relay trip time
if (c.overcurrentRelays.length > 0) {
  const trip = calculateOvercurrentTripTime(c.overcurrentRelays[0]!, fault.i3PhaseA);
  console.log(
    `Relay ${trip.relayId} trips in ${trip.tripTimeSec.toFixed(3)} s (M=${trip.multipleOfPickup.toFixed(1)}x)`,
  );
}

// 4. Lower into zero-GC DAE arena
const dae = lowerOneLinerToDae(c);
console.log(`DAE arena: ${dae.varCount} variables, ${dae.eqCount} equations`);
```

---

## License

AGPL-3.0-or-later

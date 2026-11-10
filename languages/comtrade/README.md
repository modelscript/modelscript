<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/comtrade`

IEEE C37.111 / IEC 60255-24 COMTRADE (Common Format for Transient Data Exchange) language engine for ModelScript.

Supports high-speed digital fault recording (DFR), phasor measurement unit (PMU), digital protection relay event playback, dynamic DFT phasor extraction, and zero-GC linear memory `DAEBuilder` arena simulation replay.

---

## Features

| Feature                    | Description                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Standards Compliance**   | Full support for IEEE C37.111-1991, 1999, and 2013 / IEC 60255-24 standards.                                                                                        |
| **Containers & Encodings** | Separate `.cfg` + `.dat` or single-file `.cff` container; ASCII, BINARY 16-bit, BINARY32, and FLOAT32 encodings.                                                    |
| **Phasor Extraction**      | Sliding 1-cycle Discrete Fourier Transform (DFT) with Hann windowing for dynamic RMS magnitude and phase angle.                                                     |
| **DAE Arena Lowering**     | Lowers recorded disturbance waveforms directly into linear-memory `@modelscript/runtime` `DAEBuilder` for closed-loop hardware-in-the-loop (HIL) simulation replay. |
| **Diagnostic Linter**      | Validates schema conformance (`CT1001`), timestamp monotonicity (`CT2001`), channel count mismatch (`CT3001`), and sample rate consistency (`CT4001`).              |
| **LSP Integration**        | Channel hierarchy outlines, channel detail hover cards, and real-time diagnostics.                                                                                  |

---

## Installation

```bash
npm install @modelscript/comtrade
```

---

## Quick Start

```typescript
import { parseComtradeCff, extractPhasorSeries, lowerComtradeToDae } from "@modelscript/comtrade";

// Parse a single-file IEEE C37.111-2013 CFF record
const record = parseComtradeCff(cffContent);

// Extract RMS phasor trajectory for Phase A current (channel 0)
const phasors = extractPhasorSeries(record, 0, 60.0);
console.log(`Peak RMS current: ${Math.max(...phasors.map((p) => p.magnitudeRms))} A`);

// Lower recorded fault waveforms into zero-GC linear memory DAE arena
const dae = lowerComtradeToDae(record);
console.log(`Replay DAE instantiated: ${dae.varCount} variables, ${dae.eqCount} equations`);
```

---

## License

AGPL-3.0-or-later

<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/dnp3`

IEEE 1815 / DNP3 SCADA device profile compiler, deadband telemetry event filtering, engineering unit scaling, and zero-GC linear-memory `DAEBuilder` arena lowering for ModelScript.

Supports electric power substations, distribution automation, water treatment plants, municipal pumping stations, and SCADA digital twin co-simulation.

---

## Features

| Feature                  | Description                                                                                                                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Standards Compliance** | Ingestion and serialization of IEEE Std 1815-2012 XML Device Profiles and JSON SCADA point maps.                                                                                                            |
| **Point Groups**         | Binary Inputs (breaker/pump states), Binary Outputs (trip/close controls), Analog Inputs (voltages, currents, flows, pressures), Analog Outputs (setpoints), and Counters (energy, totalized water volume). |
| **Telemetry Processor**  | Analog event generation with deadband thresholding, engineering unit transformation ($y = a \cdot x + b$), signal reconstruction, and residual tracking.                                                    |
| **DAE Arena Lowering**   | Direct translation of SCADA points and deadband parameters into linear-memory `@modelscript/runtime` `DAEBuilder` arena.                                                                                    |
| **Diagnostic Linter**    | Validates point index uniqueness (`DNP1001`), outstation/master link addressing (`DNP2001`), deadband/scaling sanity (`DNP3001`), and inverted limits (`DNP4001`).                                          |
| **LSP Integration**      | Hierarchical document outline of SCADA point lists and telemetry parameters with real-time diagnostics.                                                                                                     |

---

## Installation

```bash
npm install @modelscript/dnp3
```

---

## Quick Start

```typescript
import { parseDnp3, processTelemetryStream, lowerDnp3ToDae } from "@modelscript/dnp3";

// 1. Ingest an IEEE 1815 XML Device Profile
const profile = parseDnp3(xmlText);
console.log(`Device: ${profile.deviceName}, Analog Inputs: ${profile.analogInputs.length}`);

// 2. Process telemetry stream through DNP3 deadband filter
const result = processTelemetryStream([100, 101, 102, 108, 110], profile.analogInputs[0]!);
console.log(`Reported events: ${result.reportedEventCount}, RMSE: ${result.rmse.toFixed(3)}`);

// 3. Lower SCADA point map into zero-GC DAE arena
const dae = lowerDnp3ToDae(profile);
console.log(`DAE arena: ${dae.varCount} variables, ${dae.eqCount} equations`);
```

---

## License

AGPL-3.0-or-later

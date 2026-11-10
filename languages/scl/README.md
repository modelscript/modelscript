<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/scl`

IEC 61850 Substation Configuration Language (SCL) parser, GOOSE communication stream validator, Single-Line Diagram (SLD) topology projector, and zero-GC linear-memory `DAEBuilder` arena lowering engine for ModelScript.

Supports substation automation architectures specified in IEC 61850-6 (Ed. 2.1) across Substation Configuration Description (`.scd`), Configured IED Description (`.cid`), IED Capability Description (`.icd`), System Specification Description (`.ssd`), and Instantiated IED Description (`.iid`) files.

---

## Features

| Feature                       | Description                                                                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Standards Compliance**      | Full support for IEC 61850-6, IEC 61850-7-2, IEC 61850-7-3, and IEC 61850-7-4 Ed. 2.1 substation models.                                                                    |
| **Complete Schema Parsing**   | Ingests `<Header>`, `<Substation>`, `<VoltageLevel>`, `<Bay>`, `<ConductingEquipment>`, `<Communication>`, `<IED>`, and `<DataTypeTemplates>`.                              |
| **GOOSE & SV Validator**      | Audits publisher-to-subscriber dataflow integrity (FCDA $\leftrightarrow$ ExtRef matching) and verifies IEC 61850-5 Type 1A trip latency performance ($\le 4\text{ ms}$).   |
| **Single-Line Diagram (SLD)** | Synthesizes node-breaker electrical bus-branch topologies directly from Substation and Bay conducting equipment.                                                            |
| **DAE Arena Lowering**        | Compiles breaker states (`XCBR`), trip relays (`PTRC`, `PTOC`, `PDIS`), and 3-phase merging unit measurements (`MMXU`) into zero-GC linear-memory `DAEBuilder` arena.       |
| **Diagnostic Linter**         | Validates schema conformance (`SCL1001`), mandatory LLN0 nodes (`SCL2001`), unbound datasets (`SCL2002`), subnet addresses (`SCL3001`), and latency violations (`SCL3002`). |
| **LSP Integration**           | Multi-level outline trees for Substation bays and IED logical devices, plus real-time diagnostics.                                                                          |

---

## Installation

```bash
npm install @modelscript/scl
```

---

## Quick Start

```typescript
import { parseSclXml, validateGooseStreams, lowerSclToDae } from "@modelscript/scl";

// 1. Ingest an IEC 61850 Substation Configuration Description (.scd)
const doc = parseSclXml(scdXmlContent);
console.log(`Substation: ${doc.substation?.name}, IEDs: ${doc.ieds.size}`);

// 2. Validate real-time GOOSE trip communication streams
const gooseReport = validateGooseStreams(doc);
console.log(`GOOSE streams: ${gooseReport.totalGooseStreams}, Valid: ${gooseReport.isValid}`);

// 3. Lower breaker states and protection trip logic to zero-GC linear-memory DAE arena
const dae = lowerSclToDae(doc);
console.log(`Substation DAE arena: ${dae.varCount} variables, ${dae.eqCount} equations`);
```

---

## License

AGPL-3.0-or-later

---
title: "ARINC 429 (.a429)"
description: "Commercial avionics 32-bit BNR/BCD bus codec & PFD instrument viewer"
---

# ARINC 429 (`.a429`)

**Package:** `@modelscript/arinc429` · **Maturity:** `Beta` · **Extensions:** `.a429`

**Maturity:** Beta · **Extensions:** `.a429`, `.arinc429`, `.429` · **Docs:** [modelscript.org/languages/arinc429](https://modelscript.org/languages/arinc429)

Native **ARINC 429 (Mark 33 Digital Information Transfer System, 1977)** commercial avionics data bus schema, 32-bit binary word codec, flight-state kinematic DAE lowering, and Primary Flight Display (PFD) visualization package for ModelScript.

---

## Core Capabilities

- **WASM GLR Parser (`arinc429Language`)**: Declarative `@modelscript/dsl` grammar compiled to WebAssembly (`dist/parser.wasm`) for ARINC 429 bus schema and trace files (`BUS`, `RATE HIGH|LOW`, `LABEL` octal `001`–`377`, `SDI`, `ENCODING BNR|BCD|DISCRETE`, `RANGE`, `RESOLUTION`, `UNITS`, `FRAME`/`WORD` hex 32-bit words, `#` comments).
- **Exact 32-Bit ARINC 429 Word Codec (`encodeArinc429Word`, `decodeArinc429Word`)**:
  - **Bits 1–8**: 8-bit bit-reversed octal label (`001`–`377`)
  - **Bits 9–10**: 2-bit Source/Destination Identifier (`SDI`, `0..3`)
  - **Bits 11–29**: 19-bit two's-complement `BNR`, 5-digit `BCD` (3+4+4+4+4 bits), or `DISCRETE` payload
  - **Bits 30–31**: 2-bit Sign/Status Matrix (`SSM`)
  - **Bit 32**: Odd parity bit across all 32 bits
- **Avionics Bus Linter (`lintArinc429`, `Arinc429ErrorCode`)**: Diagnostics `A4291001`–`A4295006` verifying syntax, odd parity, octal label bounds, BCD nibble validity, SSM Failure Warning (`00`) / No Computed Data (`01`), duplicate label definitions, and bus bandwidth utilization against 12.5 kbps (LOW) or 100 kbps (HIGH) including the 4-bit inter-word gap (36 bit-times/word).
- **Flight-State Decoding & Bus Utilization Solver (`decodeFlightState`, `analyzeBusUtilization`)**: Decodes standard Air Data Computer (`203`, `205`, `206`, `211`), Inertial Reference System (`310`, `311`, `314`, `324`, `325`), and Radio Altimeter (`164`) telemetry and computes bus throughput and timing margins.
- **Direct Linear-Memory DAE Lowering (`arinc429ToDae`, `lowerArinc429ToDae`)**: Lowers 3D flight-state kinematic equations directly into `@modelscript/runtime`'s `DAEBuilder`.
- **Telemetry Projections (`arinc429ToCsv`, `arinc429ToJsbsimTelemetry`)**: Exports decoded traces to CSV and JSBSim telemetry property format.
- **Interactive SVG & React Panel (`renderArinc429Svg`, `renderArinc429WordSvg`, `renderArinc429PfdSvg`, `Arinc429Panel`)**: Pure SVG 32-bit bit-field inspector and Primary Flight Display (artificial horizon, airspeed tape, altitude tape, heading strip) integrated with `@modelscript/design-tokens/panel`.

---

## 32-Bit ARINC 429 Word Bit Layout

| Bit(s) (1-indexed) | Width | Field  | Description                                                      |
| :----------------- | :---- | :----- | :--------------------------------------------------------------- |
| `32`               | 1     | `P`    | Odd parity bit (total 1-bits across all 32 bits must be odd)     |
| `31..30`           | 2     | `SSM`  | Sign/Status Matrix (`00` FW, `01` NCD, `10` FT, `11` Normal BNR) |
| `29..11`           | 19    | `DATA` | 19-bit two's-complement BNR, 5-digit BCD, or Discrete bitmask    |
| `10..9`            | 2     | `SDI`  | Source/Destination Identifier (`00`, `01`, `10`, `11`)           |
| `8..1`             | 8     | `LBL`  | Bit-reversed octal label (`001`–`377`, transmitted MSB-first)    |

---

## Diagnostic Codes (`A4291001`–`A4295006`)

| Code       | Rule                     | Severity  | Description                                                    |
| :--------- | :----------------------- | :-------- | :------------------------------------------------------------- |
| `A4291001` | `syntax-error`           | `error`   | Syntax error in ARINC 429 bus schema or trace file.            |
| `A4292001` | `invalid-octal-label`    | `error`   | Label is not a valid 3-digit octal identifier in `001`–`377`.  |
| `A4292002` | `duplicate-label`        | `error`   | Duplicate label/SDI definition on the same bus.                |
| `A4293001` | `parity-error`           | `error`   | 32-bit ARINC 429 word violates odd-parity check (bit 32).      |
| `A4293002` | `invalid-bcd-nibble`     | `error`   | BCD data field contains a nibble greater than 9 (`0xA`–`0xF`). |
| `A4294001` | `ssm-failure-warning`    | `warning` | SSM indicates Failure Warning (`00` BNR / `11` DISCRETE).      |
| `A4294002` | `ssm-no-computed-data`   | `warning` | SSM indicates No Computed Data (`01`).                         |
| `A4295001` | `bus-bandwidth-exceeded` | `error`   | Scheduled bus bandwidth exceeds 100% of bus capacity.          |
| `A4295002` | `bus-bandwidth-high`     | `warning` | Scheduled bus bandwidth exceeds 80% engineering safety margin. |
| `A4295003` | `unknown-word-label`     | `warning` | Trace word references a label not declared in the bus schema.  |
| `A4295004` | `range-exceeded`         | `warning` | Decoded value exceeds declared label engineering range.        |
| `A4295005` | `invalid-sdi`            | `error`   | SDI value is outside the valid 2-bit range (`0`–`3`).          |
| `A4295006` | `missing-bus-rate`       | `warning` | Bus rate not specified; defaulting to `LOW` (12.5 kbps).       |

---

## Programmatic Usage

```typescript
import {
  parseArinc429,
  encodeArinc429Word,
  decodeArinc429Word,
  lintArinc429,
  decodeFlightState,
  analyzeBusUtilization,
  arinc429ToDae,
  renderArinc429Svg,
} from "@modelscript/arinc429";

const doc = parseArinc429(`
BUS ADC_BUS_1
RATE HIGH
LABEL 203 ALTITUDE ENCODING BNR SDI 0 RANGE 131072 RESOLUTION 0.5 UNITS ft RATE 20
FRAME 0.000 WORD 0xE0C350C1
`);

const diagnostics = lintArinc429(doc);
const flight = decodeFlightState(doc);
const utilization = analyzeBusUtilization(doc);
const dae = arinc429ToDae(doc);
const svg = renderArinc429Svg(doc);
```

---

## CLI & Toolchain Integration

```bash
# Validate and lint ARINC 429 files
msx lint sample.a429

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/arinc429 test
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="arinc429" />

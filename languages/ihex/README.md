<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/ihex

**Maturity:** Beta · **Extensions:** `.hex`, `.ihx`, `.ihex`, `.h86`, `.mcs` · **Docs:** [modelscript.org/languages/ihex](https://modelscript.org/languages/ihex)

Native **Intel HEX (I8HEX / I16HEX / I32HEX)** microcontroller & EPROM firmware memory image format (1973) package for ModelScript. Features a WebAssembly GLR parser, full I8HEX/I16HEX/I32HEX codec (`parseIhex`, `encodeIhex`), 32-bit linear/segmented memory segment coalescing, flat ROM binary generation (`0xFF` erase fill), IEEE 802.3 CRC-32 & Fletcher-16 integrity verification, 17 domain lint rules (`IHEX1001`–`IHEX5006`), direct linear-memory `DAEBuilder` lowering, projections to Motorola S-Record / Verilog `$readmemh` / C byte arrays, pure SVG memory-map diagrams, and an interactive React `IhexPanel` viewer.

---

## Core Capabilities

- **WASM GLR Parser & Intel HEX Codec (`parseIhex`, `encodeIhex`, `computeIhexChecksum`)**:
  - Supports all six standard Intel HEX record types (`00` Data, `01` EOF, `02` Extended Segment Address, `03` Start Segment Address, `04` Extended Linear Address, `05` Start Linear Address)
  - Full I8HEX (16-bit), I16HEX (20-bit segmented), and I32HEX (32-bit linear) decoding and encoding
  - Exact 2's-complement checksum computation and verification on every record.
- **Memory-Map & Integrity Solver (`coalesceIhexMemoryMap`, `toBinaryRomImage`, `computeCrc32`, `computeFletcher16`, `solveIhexImage`)**:
  - Coalesces contiguous 32-bit memory regions into sorted segments with gap and overlap accounting
  - Generates contiguous flat ROM binary images with configurable erased-flash fill byte (`0xFF`)
  - Computes IEEE 802.3 CRC-32 and Fletcher-16 checksums per segment and across the full image, plus flash utilization statistics.
- **Direct Linear-Memory DAE Arena Lowering (`ihexToDae`, `lowerIhexToDae`)**:
  - Lowers ROM memory-footprint, segment address span, gap balance, flash utilization, and checksum verification equations directly into `@modelscript/runtime`'s `IDaeBuilder`.
- **Firmware Integrity Linter (`lintIhex`, `IhexErrorCode`)**:
  - 17 diagnostics (`IHEX1001`–`IHEX5006`) detecting missing `:` start codes, malformed hex, truncated records, 2's-complement checksum mismatches, byte-count mismatches, unsupported record types, invalid control payload lengths, missing/duplicate/trailing EOF records, overlapping addresses, large uninitialized gaps, and unaligned entry points.
- **Polyglot Projections (`ihexToSrec`, `ihexToVerilogMem`, `ihexToCArray`)**:
  - Projects Intel HEX images to Motorola S-Record (`S0`/`S1`/`S2`/`S3`/`S7`/`S8`/`S9`), Verilog `$readmemh` `.mem`, and C `const uint8_t` arrays.
- **Memory-Map SVG & Interactive React Panel (`renderIhexMemoryMapSvg`, `IhexPanel`)**:
  - Generates vector SVG memory-map segment layout bars and address-range diagrams
  - Interactive React panel with Memory Map SVG, Hex/ASCII Dump table, Segments summary, and Lints tabs.

---

## Package Structure

| Path                                | Description                                                               |
| :---------------------------------- | :------------------------------------------------------------------------ |
| `src/index.ts`                      | Public package exports                                                    |
| `src/language.ts`                   | `ihexLanguage` WASM GLR grammar, extensions, and `IhexPanel` registration |
| `src/types.ts`                      | Core Intel HEX types (`IhexRecord`, `IhexModel`, `IhexMemoryMap`, etc.)   |
| `src/errors.ts`                     | `IhexErrorCode` diagnostic definitions (`IHEX1001`–`IHEX5006`)            |
| `src/parser/index.ts`               | `parseIhex`, `encodeIhex`, `computeIhexChecksum`                          |
| `src/lints/index.ts`                | `lintIhex` firmware image integrity linter                                |
| `src/solver/index.ts`               | Memory coalescer, ROM image generator, IEEE CRC-32, Fletcher-16           |
| `src/dae/index.ts`                  | `ihexToDae` and `lowerIhexToDae` linear-memory DAE lowering               |
| `src/projections/index.ts`          | `ihexToSrec`, `ihexToVerilogMem`, `ihexToCArray`                          |
| `src/diagram/index.ts`              | `renderIhexMemoryMapSvg` pure SVG memory-map diagram renderer             |
| `src/ui/IhexPanel.tsx`              | Interactive React Memory Map, Hex/ASCII Dump, Segments, and Lints panel   |
| `src/catalog/ihex-std-schemas.ts`   | Cleanroom schemas for Intel HEX record types (`00`–`05`) & MCU layouts    |
| `assets/ihex-std-lib/src/models.ts` | AssemblyScript WASM cleanroom stdlib runtime                              |
| `src/indexing.ts`                   | UnifiedWorkspace indexer for Intel HEX files                              |
| `src/lsp.ts`                        | LSP validation, document symbols, hover, and completions                  |

---

## Lint Rules

| Code       | Rule                      | Severity | Description                                                |
| :--------- | :------------------------ | :------- | :--------------------------------------------------------- |
| `IHEX1001` | `missing-start-code`      | error    | Record line does not begin with `':'` start code           |
| `IHEX1002` | `invalid-hex-syntax`      | error    | Non-hexadecimal characters or odd hex digit count          |
| `IHEX1003` | `truncated-record`        | error    | Record shorter than minimum 11-character frame             |
| `IHEX2001` | `checksum-mismatch`       | error    | 2's-complement checksum byte does not match computed value |
| `IHEX2002` | `byte-count-mismatch`     | error    | Byte count `LL` does not match payload byte length         |
| `IHEX3001` | `unsupported-record-type` | error    | Record type outside standard range `00`–`05`               |
| `IHEX3002` | `invalid-payload-length`  | error    | Control record (`01`–`05`) has wrong payload byte count    |
| `IHEX3003` | `nonzero-control-address` | warning  | Control record (`01`–`05`) has non-zero address field      |
| `IHEX4001` | `missing-eof-record`      | error    | Image is missing terminating `01` End-Of-File record       |
| `IHEX4002` | `records-after-eof`       | warning  | Records appear after `01` End-Of-File record               |
| `IHEX4003` | `duplicate-eof-record`    | warning  | Multiple `01` End-Of-File records found                    |
| `IHEX5001` | `overlapping-address`     | error    | Overlapping address bytes written by multiple data records |
| `IHEX5002` | `large-uninitialized-gap` | warning  | Large uninitialized memory gap between segments            |
| `IHEX5003` | `empty-image`             | warning  | Image contains no `00` Data records                        |
| `IHEX5004` | `address-wraparound`      | warning  | Data record crosses 16-bit `0xFFFF` address boundary       |
| `IHEX5005` | `mixed-addressing-modes`  | warning  | Image mixes I16HEX (`02`/`03`) and I32HEX (`04`/`05`)      |
| `IHEX5006` | `unaligned-entry-point`   | info     | Start address does not point inside any defined segment    |

---

## Development

```bash
npm run build       # Build cleanroom stdlib, WASM GLR parser, and TypeScript
npm run typecheck   # Type-check without emitting
npm run lint        # Run ESLint on src and tests
npm test            # Run full test suite
```

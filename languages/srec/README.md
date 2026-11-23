<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/srec

**Maturity:** Beta · **Extensions:** `.srec`, `.s19`, `.s28`, `.s37`, `.mot`, `.sre`, `.sx` · **Docs:** [modelscript.org/languages/srec](https://modelscript.org/languages/srec)

Native **Motorola S-Record (SREC)** firmware memory image format parser, encoder, verifier, DAE footprint lowerer, and interactive memory-map/hex viewer (`.srec`, `.s19`, `.s28`, `.s37`, `.mot`) for ModelScript. Supports all standard Motorola S-Record types (`S0` header, `S1`/`S2`/`S3` 16/24/32-bit data, `S5`/`S6` 16/24-bit record counts, `S7`/`S8`/`S9` 32/24/16-bit start address termination), 1's-complement checksum validation, contiguous memory-region coalescing, IEEE 802.3 CRC-32 verification, direct linear-memory `DAEBuilder` lowering, polyglot projections (Intel HEX, Verilog `$readmemh`, C `uint8_t[]`), and an interactive React + SVG memory-region & hex dump viewer (`SrecPanel`).

---

## Core Capabilities

- **WASM GLR Parser & SREC Codec (`srecLanguage`, `parseSrec`, `encodeSrec`)**: Declarative `@modelscript/dsl` grammar compiled to WebAssembly GLR (`dist/parser.wasm`) plus lossless round-trip parser and encoder for 16-bit (`S1`/`S9`), 24-bit (`S2`/`S8`), and 32-bit (`S3`/`S7`) Motorola S-Record images.
- **Firmware Integrity Linter (`lintSrec`, `SrecErrorCode`)**: Validates `SREC1001`–`SREC5006` rules including syntax errors, 1's-complement checksums, byte count consistency, reserved `S4` rejection, `S5`/`S6` data record count verification, missing termination records, address-width mismatches between data and terminator records, overlapping address bytes, and missing `S0` header warnings.
- **Memory-Region Solver & Binary Image Builder (`solveSrecMemory`, `coalesceMemoryRegions`, `buildBinaryImage`, `computeCrc32`)**: Coalesces scattered records into sorted contiguous memory segments, builds flat binary images with configurable fill bytes, computes IEEE 802.3 CRC-32 checksums, and validates entry-point addresses.
- **Direct Linear-Memory DAE Lowering (`srecToDae`, `lowerSrecToDae`)**: Lowers firmware footprint, address span, utilization, record count, and per-region layout equations directly into `@modelscript/runtime`'s `IDaeBuilder`.
- **Polyglot Projections (`srecToIntelHex`, `srecToVerilogReadmemh`, `srecToCArray`)**: Converts Motorola S-Record images into Intel HEX (with Extended Linear Address `04` records), Verilog `$readmemh` memory initialization files, and C `const uint8_t[]` header/source arrays.
- **Cleanroom Stdlib (`@modelscript/srec-std-lib`)**: Declarative schemas and AssemblyScript WASM runtime for `S0`–`S9` record types and classic Motorola 6800, 68000, ColdFire, and PowerPC memory map presets.
- **Interactive SVG Memory Map & React Panel (`renderSrecMemoryMapSvg`, `SrecPanel`)**: Pure SVG memory-region layout bar with entry-point indicator and a 4-tab React panel (Memory Map SVG, Hex/ASCII Dump, Records, and Lints).

---

## Package Structure

| Path                              | Description                                                                                  |
| :-------------------------------- | :------------------------------------------------------------------------------------------- |
| `src/index.ts`                    | Public package exports                                                                       |
| `src/language.ts`                 | `srecLanguage` WASM GLR grammar, extensions, and `SrecPanel` UI registration                 |
| `src/types.ts`                    | Core TypeScript interfaces (`SrecFile`, `SrecRecord`, `SrecMemoryRegion`, `SrecBinaryImage`) |
| `src/errors.ts`                   | Diagnostic catalog `SrecErrorCode` (`SREC1001`–`SREC5006`)                                   |
| `src/parser/index.ts`             | `parseSrec`, `encodeSrec`, `computeSrecChecksum`, `decodeHeaderAscii`                        |
| `src/lints/index.ts`              | `lintSrec` firmware integrity checker                                                        |
| `src/solver/index.ts`             | Contiguous region coalescer, binary image builder, IEEE CRC-32 & entry-point validator       |
| `src/dae/index.ts`                | `lowerSrecToDae` and `srecToDae` linear-memory DAE arena lowering                            |
| `src/projections/index.ts`        | `srecToIntelHex`, `srecToVerilogReadmemh`, `srecToCArray`                                    |
| `src/catalog/srec-std-schemas.ts` | Cleanroom schemas for `S0`–`S9` record types & Motorola 6800/68000/ColdFire/PowerPC presets  |
| `src/diagram/index.ts`            | `renderSrecMemoryMapSvg` and `buildSrecDiagramData`                                          |
| `src/ui/SrecPanel.tsx`            | Interactive React + SVG memory-region & hex dump viewer panel                                |
| `src/indexing.ts`                 | UnifiedWorkspace declarative indexer (`srecIndexing`)                                        |
| `src/lsp.ts`                      | `validateSrec`, `getSrecDocumentSymbols`, `getSrecHover`, `getSrecCompletions`               |

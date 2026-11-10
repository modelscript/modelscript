<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/optical

Telcordia/Bellcore Standard Optical Report (`.sor`), OpenROADM, and physical-layer optical transport package for ModelScript. Features high-performance binary `.sor` OTDR trace parsing and serialization, OpenROADM MSA network topology ingestion, optical multi-span power budget and GSNR calculations, and fiber fault event localization.

---

## Core Capabilities

- **Bellcore / Telcordia `.sor` Binary Codec (`parseSor`, `writeSor`)**: Binary parser and serializer for OTDR optical time-domain reflectometry traces following GR-196-CORE and SR-4731 standards. Parses `GenParams`, `SupParams`, `FxdParams`, `DataPts`, and `KeyEvents` blocks with micro-decibel loss precision and event table reconstruction.
- **OpenROADM & GNPy Optical Network Ingestion (`parseOpenRoadmTopology`, `parseGnpyTopology`)**: Parses optical cross-connects (ROADM nodes, degree interfaces, add/drop banks), in-line amplifiers (EDFA, Raman), and multi-channel DWDM transmission spans, supporting incoherent Gaussian Noise (GN) model ASE + NLI OSNR/GSNR and Shannon capacity evaluation.
- **Multi-File Workspace Indexing & MCP Tools (`OpticalWorkspaceIndex`)**: Indexes `.sor` trace files and optical network topology manifests with diagnostic and telemetry inspection, and exposes `optical_parse_otdr` and `optical_solve_osnr` MCP tools.

---

## Package Structure

| Path                                 | Description                                                    |
| :----------------------------------- | :------------------------------------------------------------- |
| `src/index.ts`                       | Public package exports                                         |
| `src/language.ts`                    | `opticalLanguage` declarative specification and lint rules     |
| `src/types.ts`                       | Core optical network and transmission interfaces               |
| `src/sor/sor-types.ts`               | Telcordia GR-196 / SR-4731 `.sor` typed structures             |
| `src/sor/sor-parser.ts`              | `parseSor` binary OTDR trace reader                            |
| `src/sor/sor-writer.ts`              | `writeSor` binary OTDR trace writer                            |
| `src/parser/openroadm-parser.ts`     | OpenROADM MSA and GNPy network topology parser                 |
| `src/workspace-index.ts`             | `OpticalWorkspaceIndex` multi-file symbol and artifact indexer |
| `tests/optical-benchmark-runner.ts`  | Telcordia `.sor` OTDR and DWDM GSNR benchmark runner           |

---

## Scripts

| Command             | Description                           |
| :------------------ | :------------------------------------ |
| `npm run build`     | Compile TypeScript to `dist/`         |
| `npm test`          | Run test suite via `test-runner.js`   |
| `npm run lint`      | Run ESLint across `src/` and `tests/` |
| `npm run typecheck` | Run `tsc --noEmit` type verification  |
| `npm run clean`     | Remove `dist/` build artifacts        |

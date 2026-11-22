<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/kicad

**Maturity:** Beta · **Extensions:** `.kicad_pcb`, `.kicad_sch`, `.kicad_sym`, `.kicad_mod` · **Docs:** [modelscript.org/languages/kicad](https://modelscript.org/languages/kicad)

KiCad 6/7/8/9 ECAD language package (`.kicad_pcb`, `.kicad_sch`, `.kicad_sym`, `.kicad_mod`) for ModelScript.

## Capabilities

- **Native WebAssembly GLR Parser (`dist/parser.wasm`):** Unified S-expression grammar compiled via `@modelscript/dsl`.
- **`.kicad_pcb` & `.kicad_sch` Parser:** Extracts layers, dielectric stackup, nets, footprints (with rotated pad-to-board coordinate transforms), traces, arcs, vias, copper zones, `Edge.Cuts` outlines, and schematic symbols/wires/labels.
- **`@modelscript/cad` Bridge (`kicadBoardToPcbLayout`):** Lowers parsed KiCad boards directly into ModelScript's canonical `PCBLayout` + `NetlistGraph`, enabling `runDRC()`, 3D PCBA enclosure clearance, and manufacturing export (Gerber, ODB++, IPC-2581C).
- **Round-Trip Exporter (`exportToKiCadPcb`):** Emits valid KiCad 8 `.kicad_pcb` S-expressions from `PCBLayout`.
- **Geometric Schematic Netlist & ERC (`extractSchematicNetlist`, `lintKiCadSchematic`):** Resolves `.kicad_sch` `lib_symbols`, wires, junctions, labels, and power symbols into `NetlistGraph` with ERC checks (`K2002`–`K4003`).
- **Direct MNA `DAEBuilder` Lowering (`lowerKiCadSchematicToDAE`):** Lowers resistors, capacitors, inductors, and DC sources directly into ModelScript's linear-memory `DAEBuilder`.
- **Layout-Aware RLGC & Impedance (`extractBoardParasitics`):** Computes DC resistance, Hammerstad-Jensen microstrip/stripline $Z_0$, lumped $L/C$, propagation delay, and IPC-2221 ampacity from board stackup and trace geometry.
- **Schematic ↔ PCB Consistency & Cross-File LSP (`verifySchematicPcbConsistency`, `resolveKiCadHover`, `findCrossFileDefinition`):** Detects missing/orphan components, value/footprint drift, and pin-net mismatches (`K2010`–`K2014`), plus cross-file navigation and parasitic-enriched hover.

## Package Structure

| File                           | Responsibility                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `src/language.ts`              | `@modelscript/dsl` language registration (`.kicad_pcb`, `.kicad_sch`, `.kicad_sym`, `.kicad_mod`) |
| `src/grammar/kicad-grammar.ts` | Unified KiCad S-expression grammar for WASM GLR parser generation                                 |
| `src/parser/kicad-parser.ts`   | KiCad board, schematic, symbol, and footprint S-expression parser                                 |
| `src/cad-bridge.ts`            | `kicadBoardToPcbLayout` lowering into `@modelscript/cad` `PCBLayout`                              |
| `src/export.ts`                | `exportToKiCadPcb` round-trip KiCad 8 `.kicad_pcb` exporter                                       |
| `src/schematic-netlist.ts`     | `extractSchematicNetlist` geometric wire/junction/label netlist extractor                         |
| `src/hierarchy.ts`             | Hierarchical multi-sheet schematic resolver                                                       |
| `src/parasitics.ts`            | `extractBoardParasitics` RLGC, microstrip/stripline $Z_0$, and IPC-2221 ampacity engine           |
| `src/consistency.ts`           | `verifySchematicPcbConsistency` schematic-to-PCB drift & pin-net checker                          |
| `src/dae/dae-lower.ts`         | `lowerKiCadSchematicToDAE` direct MNA lowering into `DAEBuilder`                                  |
| `src/lints/index.ts`           | `lintKiCadSchematic` ERC and consistency lint rules (`K2002`–`K4003`)                             |
| `src/lsp.ts`                   | Cross-file LSP hover, go-to-definition, and diagnostics                                           |
| `src/indexing.ts`              | Workspace symbol indexing across KiCad schematics and boards                                      |
| `src/index.ts`                 | Public package entry point and barrel exports                                                     |

## Scripts

```bash
pnpm --filter @modelscript/kicad build
pnpm --filter @modelscript/kicad test
pnpm --filter @modelscript/kicad lint
pnpm --filter @modelscript/kicad typecheck
```

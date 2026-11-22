---
title: "KiCad ECAD Schematics & PCB Layouts (.kicad_pcb, .kicad_sch, .kicad_sym, .kicad_mod)"
description: "The @modelscript/kicad package provides native S-expression parsing, hierarchical netlist extraction, trace parasitic extraction, schematic-to-PCB consistency checking, SPICE export, and DAE lowering for KiCad ECAD designs."
---

# KiCad ECAD Schematics & PCB Layouts (`.kicad_pcb`, `.kicad_sch`, `.kicad_sym`, `.kicad_mod`)

The `@modelscript/kicad` package (`languages/kicad`) provides native support for **KiCad 6/7/8+** S-expression schematic, PCB layout, symbol library, and footprint files. It bridges ECAD schematics and physical board geometry with ModelScript's `DAEBuilder` circuit simulator, SPICE export, and `@modelscript/cad` PCB DRC/routing engines.

---

## Supported File Formats

| Extension    | Format                 | Description                                                                             |
| :----------- | :--------------------- | :-------------------------------------------------------------------------------------- |
| `.kicad_pcb` | KiCad PCB Layout       | Copper layers, tracks, vias, footprints, zones, net classes, and board outline geometry |
| `.kicad_sch` | KiCad Schematic        | Hierarchical schematic sheets, component symbols, wires, buses, labels, and power flags |
| `.kicad_sym` | KiCad Symbol Library   | Reusable schematic symbol definitions, pin electrical types, and graphical primitives   |
| `.kicad_mod` | KiCad Footprint Module | Physical padstacks, courtyard/silkscreen shapes, and 3D model references                |

---

## Capabilities

- **S-Expression Parser & Workspace Indexing**: Parses `.kicad_pcb`, `.kicad_sch`, `.kicad_sym`, and `.kicad_mod` files directly and indexes symbols, nets, and footprints into `WorkspaceIndex`.
- **Hierarchical Schematic Netlist Extraction (`extractSheetRefs`, `extractHierarchicalNetlist`)**: Traverses multi-sheet KiCad hierarchies, resolving global, local, and hierarchical labels into a unified connectivity graph.
- **DAE Lowering & SPICE Export (`lowerKiCadSchematicToDAE`, `lowerKiCadSchematicWithParasitics`, `exportKiCadSchematicToSpice`)**: Parses engineering values (`parseEngineeringValue`) and lowers schematic circuits directly into linear-memory `DAEBuilder` MNA equations or SPICE netlists, optionally back-annotating extracted PCB trace resistance, inductance, and capacitance (`parasitics.ts`).
- **CAD & ECAD Bridge (`cad-bridge.ts`, `consistency.ts`)**: Bridges KiCad PCB layouts to `@modelscript/cad` for DRC, Gerber generation, and 3D clearance checks, and verifies schematic-to-PCB netlist consistency.
- **Static Diagnostics (`lintKiCadBoard`, `lintKiCadSchematic`)**: Detects unresolved references (`K2001`–`K2003`), electrical/value errors (`K3001`, `K3003`), structural/layout violations (`K4001`–`K4003`), and board-level checks (`K5001`).

---

## Programmatic TypeScript API

```typescript
import {
  exportKiCadSchematicToSpice,
  lintKiCadSchematic,
  lowerKiCadSchematicToDAE,
  parseKiCadSchematic,
} from "@modelscript/kicad";

const sch = parseKiCadSchematic(sourceText);
const diagnostics = lintKiCadSchematic(sch);
const dae = lowerKiCadSchematicToDAE(sch);
const spiceNetlist = exportKiCadSchematicToSpice(sch);
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="kicad" />

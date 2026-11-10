// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for ASM wastewater plant models.
 */

import { lintAsmPlant } from "./lints/index.js";
import { parseAsmPlant } from "./parser/asm-parser.js";
import type { AsmPlantModel } from "./types.js";

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export enum LspSymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26,
}

export interface LspDocumentSymbol {
  name: string;
  detail?: string | undefined;
  kind: LspSymbolKind;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[] | undefined;
}

export interface LspDiagnosticItem {
  range: LspRange;
  severity: 1 | 2 | 3;
  code?: string | number | undefined;
  source: string;
  message: string;
}

export function getAsmDocumentSymbols(content: string): LspDocumentSymbol[] {
  let plant: AsmPlantModel;
  try {
    plant = parseAsmPlant(content);
  } catch {
    return [];
  }

  const lines = content.split(/\r?\n/);
  const totalLines = lines.length;
  const defaultRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: Math.max(0, totalLines - 1), character: (lines[totalLines - 1] ?? "").length },
  };

  const rootSymbol: LspDocumentSymbol = {
    name: plant.name,
    detail: `Wastewater Treatment Plant (${plant.modelType})`,
    kind: LspSymbolKind.Class,
    range: defaultRange,
    selectionRange: defaultRange,
    children: [],
  };

  // Bioreactors group
  if (plant.reactors.length > 0) {
    const reactorSymbols: LspDocumentSymbol[] = plant.reactors.map((r) => ({
      name: `${r.name} (${r.type})`,
      detail: `Volume: ${r.volumeM3} m3${r.klaHr ? ` | kla: ${r.klaHr}/hr` : ""}`,
      kind: LspSymbolKind.Module,
      range: defaultRange,
      selectionRange: defaultRange,
    }));

    rootSymbol.children?.push({
      name: `Bioreactors (${plant.reactors.length})`,
      detail: "Biological Treatment Tanks",
      kind: LspSymbolKind.Namespace,
      range: defaultRange,
      selectionRange: defaultRange,
      children: reactorSymbols,
    });
  }

  // Clarifiers group
  if (plant.clarifiers.length > 0) {
    const clarifierSymbols: LspDocumentSymbol[] = plant.clarifiers.map((c) => ({
      name: c.name,
      detail: `Area: ${c.surfaceAreaM2} m2 | Depth: ${c.heightM} m (${c.layers} layers)`,
      kind: LspSymbolKind.Struct,
      range: defaultRange,
      selectionRange: defaultRange,
    }));

    rootSymbol.children?.push({
      name: `Secondary Clarifiers (${plant.clarifiers.length})`,
      detail: "1D Takács Sedimentation & Thickening",
      kind: LspSymbolKind.Namespace,
      range: defaultRange,
      selectionRange: defaultRange,
      children: clarifierSymbols,
    });
  }

  return [rootSymbol];
}

export function getAsmDiagnostics(content: string): LspDiagnosticItem[] {
  if (!content.includes("plant ") && !content.includes("bioreactor ")) {
    return [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        severity: 1,
        code: "ASM1001",
        source: "asm-lint",
        message: "Invalid ASM file: missing 'plant <Name>' block.",
      },
    ];
  }

  let plant: AsmPlantModel;
  try {
    plant = parseAsmPlant(content);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        severity: 1,
        code: "ASM1001",
        source: "asm-lint",
        message: `ASM parse error: ${msg}`,
      },
    ];
  }

  const diags = lintAsmPlant(plant);
  return diags.map((d) => ({
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 80 } },
    severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
    code: d.code,
    source: "asm-lint",
    message: d.message,
  }));
}

// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * @modelscript/energyplus — Language Server Protocol (LSP) Service Integration.
 */

import { lowerEnergyPlusToDae } from "./dae/energyplus-to-dae.js";
import { lintEnergyPlus } from "./lints/rules.js";
import { parseEnergyPlus } from "./parser/index.js";
import { energyPlusToModelica } from "./projections/energyplus-to-modelica.js";
import type { EnergyPlusDocument } from "./types.js";

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

export interface LspDiagnostic {
  range: LspRange;
  severity: 1 | 2 | 3 | 4; // 1 = Error, 2 = Warning, 3 = Info, 4 = Hint
  code: string | number;
  source: string;
  message: string;
}

export interface LspHover {
  contents: {
    kind: "markdown" | "plaintext";
    value: string;
  };
  range?: LspRange | undefined;
}

export function validateEnergyPlus(content: string): LspDiagnostic[] {
  let doc: EnergyPlusDocument;
  try {
    doc = parseEnergyPlus(content);
  } catch (err: any) {
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        code: "M7900",
        source: "energyplus-parser",
        message: `Parse error: ${err.message}`,
      },
    ];
  }

  const rawDiags = lintEnergyPlus(doc);
  return rawDiags.map((d) => {
    let sev: 1 | 2 | 3 | 4 = 1;
    if (d.severity === "warning") sev = 2;
    else if (d.severity === "info") sev = 3;

    return {
      range: {
        start: {
          line: Math.max(0, d.range.startLine - 1),
          character: Math.max(0, d.range.startColumn - 1),
        },
        end: {
          line: Math.max(0, d.range.endLine - 1),
          character: Math.max(0, d.range.endColumn - 1),
        },
      },
      severity: sev,
      code: d.code,
      source: "energyplus-linter",
      message: d.message,
    };
  });
}

export function getEnergyPlusDocumentSymbols(content: string): LspDocumentSymbol[] {
  let doc: EnergyPlusDocument;
  try {
    doc = parseEnergyPlus(content);
  } catch {
    return [];
  }

  const symbols: LspDocumentSymbol[] = [];

  // Building
  if (doc.building) {
    const bRange: LspRange = {
      start: { line: Math.max(0, doc.building.range.startLine - 1), character: 0 },
      end: { line: Math.max(0, doc.building.range.endLine - 1), character: 0 },
    };
    symbols.push({
      name: `Building: ${doc.building.name}`,
      detail: `terrain=${doc.building.terrain ?? "Suburbs"}, north=${doc.building.northAxis ?? 0}°`,
      kind: LspSymbolKind.Class,
      range: bRange,
      selectionRange: bRange,
    });
  }

  // Zones
  for (const zone of doc.zones) {
    const zRange: LspRange = {
      start: { line: Math.max(0, zone.range.startLine - 1), character: 0 },
      end: { line: Math.max(0, zone.range.endLine - 1), character: 0 },
    };

    const zoneSurfaces = doc.surfaces.filter((s) => s.zoneName.toLowerCase() === zone.name.toLowerCase());
    const surfChildren: LspDocumentSymbol[] = zoneSurfaces.map((s) => {
      const sRange: LspRange = {
        start: { line: Math.max(0, s.range.startLine - 1), character: 0 },
        end: { line: Math.max(0, s.range.endLine - 1), character: 0 },
      };
      return {
        name: `Surface: ${s.name} (${s.surfaceType})`,
        detail: `construction=${s.constructionName}, bc=${s.boundaryCondition}`,
        kind: LspSymbolKind.Field,
        range: sRange,
        selectionRange: sRange,
      };
    });

    symbols.push({
      name: `Zone: ${zone.name}`,
      detail: `vol=${zone.volume ?? "calc"} m³, floor=${zone.floorArea ?? "calc"} m²`,
      kind: LspSymbolKind.Namespace,
      range: zRange,
      selectionRange: zRange,
      children: surfChildren,
    });
  }

  // Materials
  for (const mat of doc.materials) {
    const mRange: LspRange = {
      start: { line: Math.max(0, mat.range.startLine - 1), character: 0 },
      end: { line: Math.max(0, mat.range.endLine - 1), character: 0 },
    };
    symbols.push({
      name: `Material: ${mat.name}`,
      detail: `k=${mat.conductivity} W/m-K, thick=${mat.thickness}m`,
      kind: LspSymbolKind.Struct,
      range: mRange,
      selectionRange: mRange,
    });
  }

  // Constructions
  for (const c of doc.constructions) {
    const cRange: LspRange = {
      start: { line: Math.max(0, c.range.startLine - 1), character: 0 },
      end: { line: Math.max(0, c.range.endLine - 1), character: 0 },
    };
    symbols.push({
      name: `Construction: ${c.name}`,
      detail: `layers=[${c.layers.join(" -> ")}]`,
      kind: LspSymbolKind.Interface,
      range: cRange,
      selectionRange: cRange,
    });
  }

  return symbols;
}

export function getEnergyPlusHover(content: string, offset: number): LspHover | null {
  let doc: EnergyPlusDocument;
  try {
    doc = parseEnergyPlus(content);
  } catch {
    return null;
  }

  // Hover over zone
  for (const zone of doc.zones) {
    if (offset >= zone.range.startOffset && offset <= zone.range.endOffset) {
      const vol = zone.volume ?? (zone.floorArea ?? 40.0) * (zone.ceilingHeight ?? 2.8);
      return {
        contents: {
          kind: "markdown",
          value: [
            `### EnergyPlus Thermal Zone: **${zone.name}**`,
            `* **Volume:** \`${vol.toFixed(1)} m³\``,
            `* **Floor Area:** \`${(zone.floorArea ?? 40.0).toFixed(1)} m²\``,
            `* **Ceiling Height:** \`${(zone.ceilingHeight ?? 2.8).toFixed(1)} m\``,
            `* **Multiplier:** \`${zone.multiplier ?? 1}\``,
          ].join("\n"),
        },
      };
    }
  }

  // Hover over material
  for (const mat of doc.materials) {
    if (offset >= mat.range.startOffset && offset <= mat.range.endOffset) {
      const rVal = mat.conductivity > 0 ? (mat.thickness / mat.conductivity).toFixed(3) : "N/A";
      return {
        contents: {
          kind: "markdown",
          value: [
            `### EnergyPlus Material: **${mat.name}**`,
            `* **Thickness:** \`${mat.thickness.toFixed(4)} m\``,
            `* **Conductivity (k):** \`${mat.conductivity.toFixed(3)} W/(m·K)\``,
            `* **Density (ρ):** \`${mat.density.toFixed(1)} kg/m³\``,
            `* **Specific Heat (c_p):** \`${mat.specificHeat.toFixed(1)} J/(kg·K)\``,
            `* **Thermal Resistance (R):** \`${rVal} m²·K/W\``,
          ].join("\n"),
        },
      };
    }
  }

  return null;
}

export function executeEnergyPlusAction(action: string, content: string, params?: any): any {
  const doc = parseEnergyPlus(content);

  switch (action) {
    case "energyplus.toModelica":
      return { modelica: energyPlusToModelica(doc) };
    case "energyplus.toDae": {
      const arena = lowerEnergyPlusToDae(doc, params?.title);
      return {
        variables: arena.getVarCount(),
        equations: arena.getEqCount(),
      };
    }
    case "energyplus.summary":
      return {
        building: doc.building?.name,
        zones: doc.zones.length,
        surfaces: doc.surfaces.length,
        materials: doc.materials.length,
        constructions: doc.constructions.length,
      };
    default:
      throw new Error(`Unknown EnergyPlus LSP action: ${action}`);
  }
}

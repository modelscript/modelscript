// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for ASM wastewater plant models.
 */

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { cstLineText, groupAllCstTokensByLine, type CstNodeLike } from "@modelscript/runtime";
import { createWasmParserSync } from "../src-gen/bindings.js";
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

interface AsmCstIndex {
  hasPlantOrReactor: boolean;
  firstToken: LspRange;
  fullRange: LspRange;
  plantRange?: LspRange;
  reactors: Map<string, { range: LspRange; selectionRange: LspRange }>;
  clarifiers: Map<string, { range: LspRange; selectionRange: LspRange }>;
  influentComponents: Map<string, LspRange>;
}

function buildAsmCstIndex(content: string, cstTree?: { rootNode?: unknown } | null): AsmCstIndex {
  const reactors = new Map<string, { range: LspRange; selectionRange: LspRange }>();
  const clarifiers = new Map<string, { range: LspRange; selectionRange: LspRange }>();
  const influentComponents = new Map<string, LspRange>();

  let lineEntries: Array<{ row: number; text: string; startCol: number; endCol: number; firstTokEnd: number }> = [];
  let rootNode: unknown = cstTree?.rootNode ?? null;
  if (!rootNode) {
    try {
      rootNode =
        getOrLoadLanguageWasmParser("asm", import.meta.url, createWasmParserSync).parse(content)?.rootNode ?? null;
    } catch {
      rootNode = null;
    }
  }

  if (rootNode) {
    const grouped = groupAllCstTokensByLine(rootNode as CstNodeLike);
    lineEntries = grouped.map(({ row, tokens }) => {
      const text = cstLineText(content, tokens);
      const first = tokens[0] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const last = tokens[tokens.length - 1] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const startCol = first?.startPosition?.column ?? 0;
      const endCol = last?.endPosition?.column ?? startCol + text.length;
      const firstTokEnd = first?.endPosition?.column ?? startCol + Math.max(1, first?.text?.length ?? 1);
      return { row, text, startCol, endCol, firstTokEnd };
    });
  } else {
    const rawLines = content.split(/\r?\n/);
    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i] ?? "";
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const startCol = raw.search(/\S/);
      const firstTok = trimmed.match(/^\S+/)?.[0] ?? "";
      lineEntries.push({
        row: i,
        text: trimmed,
        startCol: Math.max(0, startCol),
        endCol: Math.max(0, startCol) + trimmed.length,
        firstTokEnd: Math.max(0, startCol) + Math.max(1, firstTok.length),
      });
    }
  }

  const firstEntry = lineEntries[0];
  const lastEntry = lineEntries[lineEntries.length - 1];
  const firstToken: LspRange = firstEntry
    ? {
        start: { line: firstEntry.row, character: firstEntry.startCol },
        end: { line: firstEntry.row, character: Math.max(firstEntry.startCol + 1, firstEntry.firstTokEnd) },
      }
    : { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
  const fullRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: lastEntry?.row ?? 0, character: lastEntry?.endCol ?? 0 },
  };

  let hasPlantOrReactor = false;
  let plantRange: LspRange | undefined;
  let activeBlock: {
    kind: "reactor" | "clarifier" | "influent";
    name: string;
    startRow: number;
    startCol: number;
    selRange: LspRange;
    depth: number;
  } | null = null;

  for (const entry of lineEntries) {
    const trimmed = entry.text.trim();
    const selRange: LspRange = {
      start: { line: entry.row, character: entry.startCol },
      end: { line: entry.row, character: entry.endCol },
    };

    if (/^plant\b/i.test(trimmed)) {
      hasPlantOrReactor = true;
      plantRange = selRange;
    } else if (/^bioreactor\s+([a-zA-Z0-9_]+)/i.test(trimmed)) {
      hasPlantOrReactor = true;
      const name = /^bioreactor\s+([a-zA-Z0-9_]+)/i.exec(trimmed)![1]!;
      const opens = (trimmed.match(/\{/g) ?? []).length;
      const closes = (trimmed.match(/\}/g) ?? []).length;
      activeBlock = {
        kind: "reactor",
        name,
        startRow: entry.row,
        startCol: entry.startCol,
        selRange,
        depth: opens - closes,
      };
      if (activeBlock.depth <= 0 && opens > 0) {
        reactors.set(name, { range: selRange, selectionRange: selRange });
        activeBlock = null;
      }
      continue;
    } else if (/^clarifier\s+([a-zA-Z0-9_]+)/i.test(trimmed)) {
      const name = /^clarifier\s+([a-zA-Z0-9_]+)/i.exec(trimmed)![1]!;
      const opens = (trimmed.match(/\{/g) ?? []).length;
      const closes = (trimmed.match(/\}/g) ?? []).length;
      activeBlock = {
        kind: "clarifier",
        name,
        startRow: entry.row,
        startCol: entry.startCol,
        selRange,
        depth: opens - closes,
      };
      if (activeBlock.depth <= 0 && opens > 0) {
        clarifiers.set(name, { range: selRange, selectionRange: selRange });
        activeBlock = null;
      }
      continue;
    } else if (/^influent\b/i.test(trimmed)) {
      const opens = (trimmed.match(/\{/g) ?? []).length;
      const closes = (trimmed.match(/\}/g) ?? []).length;
      activeBlock = {
        kind: "influent",
        name: "influent",
        startRow: entry.row,
        startCol: entry.startCol,
        selRange,
        depth: opens - closes,
      };
      if (activeBlock.depth <= 0 && opens > 0) activeBlock = null;
      continue;
    }

    if (activeBlock) {
      if (activeBlock.kind === "influent") {
        const compMatch = /^([a-zA-Z0-9_]+)\s*:/.exec(trimmed);
        if (compMatch && compMatch[1]) {
          influentComponents.set(compMatch[1], selRange);
        }
      }
      const opens = (trimmed.match(/\{/g) ?? []).length;
      const closes = (trimmed.match(/\}/g) ?? []).length;
      activeBlock.depth += opens - closes;
      if (activeBlock.depth <= 0 && (opens > 0 || closes > 0)) {
        const blockRange: LspRange = {
          start: { line: activeBlock.startRow, character: activeBlock.startCol },
          end: { line: entry.row, character: entry.endCol },
        };
        if (activeBlock.kind === "reactor") {
          reactors.set(activeBlock.name, { range: blockRange, selectionRange: activeBlock.selRange });
        } else if (activeBlock.kind === "clarifier") {
          clarifiers.set(activeBlock.name, { range: blockRange, selectionRange: activeBlock.selRange });
        }
        activeBlock = null;
      }
    }
  }

  return {
    hasPlantOrReactor,
    firstToken,
    fullRange,
    ...(plantRange ? { plantRange } : {}),
    reactors,
    clarifiers,
    influentComponents,
  };
}

export function getAsmDocumentSymbols(content: string, cstTree?: { rootNode?: unknown } | null): LspDocumentSymbol[] {
  let plant: AsmPlantModel;
  try {
    plant = parseAsmPlant(content);
  } catch {
    return [];
  }

  const cstIndex = buildAsmCstIndex(content, cstTree);
  const defaultRange = cstIndex.fullRange;

  const rootSymbol: LspDocumentSymbol = {
    name: plant.name,
    detail: `Wastewater Treatment Plant (${plant.modelType})`,
    kind: LspSymbolKind.Class,
    range: defaultRange,
    selectionRange: cstIndex.plantRange ?? defaultRange,
    children: [],
  };

  // Bioreactors group
  if (plant.reactors.length > 0) {
    const reactorSymbols: LspDocumentSymbol[] = plant.reactors.map((r) => {
      const loc = cstIndex.reactors.get(r.name);
      return {
        name: `${r.name} (${r.type})`,
        detail: `Volume: ${r.volumeM3} m3${r.klaHr ? ` | kla: ${r.klaHr}/hr` : ""}`,
        kind: LspSymbolKind.Module,
        range: loc?.range ?? defaultRange,
        selectionRange: loc?.selectionRange ?? defaultRange,
      };
    });

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
    const clarifierSymbols: LspDocumentSymbol[] = plant.clarifiers.map((c) => {
      const loc = cstIndex.clarifiers.get(c.name);
      return {
        name: c.name,
        detail: `Area: ${c.surfaceAreaM2} m2 | Depth: ${c.heightM} m (${c.layers} layers)`,
        kind: LspSymbolKind.Struct,
        range: loc?.range ?? defaultRange,
        selectionRange: loc?.selectionRange ?? defaultRange,
      };
    });

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

export function getAsmDiagnostics(content: string, cstTree?: { rootNode?: unknown } | null): LspDiagnosticItem[] {
  const cstIndex = buildAsmCstIndex(content, cstTree);

  if (!cstIndex.hasPlantOrReactor) {
    return [
      {
        range: cstIndex.firstToken,
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
        range: cstIndex.firstToken,
        severity: 1,
        code: "ASM1001",
        source: "asm-lint",
        message: `ASM parse error: ${msg}`,
      },
    ];
  }

  const diags = lintAsmPlant(plant);
  return diags.map((d) => {
    let range = cstIndex.plantRange ?? cstIndex.firstToken;
    if (d.reactorName && cstIndex.reactors.has(d.reactorName)) {
      range = cstIndex.reactors.get(d.reactorName)!.selectionRange;
    } else if (d.componentName && cstIndex.influentComponents.has(d.componentName)) {
      range = cstIndex.influentComponents.get(d.componentName)!;
    } else {
      for (const [cName, loc] of cstIndex.clarifiers) {
        if (d.message.includes(`'${cName}'`)) {
          range = loc.selectionRange;
          break;
        }
      }
    }
    return {
      range,
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.code,
      source: "asm-lint",
      message: d.message,
    };
  });
}

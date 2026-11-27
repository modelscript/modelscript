// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/scale — Language Server Protocol (LSP) Services.
 */

import { collectWasmSyntaxErrors } from "@modelscript/dsl";
import {
  cstLineText,
  groupAllCstTokensByLine,
  LspSymbolKind,
  type CstNodeLike,
  type LspDiagnostic,
  type LspDocumentSymbol,
  type LspHover,
  type LspPosition,
  type LspRange,
} from "@modelscript/runtime";
import { buildKenoCadAssembly } from "./cad/keno-geometry.js";
import { normalizeNuclideId, SCALE_NUCLIDE_DATA, SCALE_STANDARD_COMPOSITIONS } from "./catalog/scale-std-schemas.js";
import { lowerScaleToDae } from "./dae/scale-to-dae.js";
import { lintScale } from "./lints/index.js";
import { parseScale } from "./parser/scale-parser.js";
import { getScaleWasmParser } from "./parser/wasm-loader.js";
import { scaleToMcnp } from "./projections/scale-to-mcnp.js";
import { scaleToModelica } from "./projections/scale-to-modelica.js";
import { solveScaleDeck, type BatemanMethod } from "./solver/bateman-solver.js";

export { LspSymbolKind, type LspDiagnostic, type LspDocumentSymbol, type LspHover, type LspPosition, type LspRange };

export function validateScale(text: string): LspDiagnostic[] {
  try {
    const syntaxDiags: LspDiagnostic[] = [];
    try {
      const cstTree = getScaleWasmParser().parse(text);
      for (const err of collectWasmSyntaxErrors(cstTree?.rootNode)) {
        syntaxDiags.push({
          range: {
            start: { line: Math.max(0, err.startLine - 1), character: Math.max(0, err.startColumn - 1) },
            end: { line: Math.max(0, err.endLine - 1), character: Math.max(0, err.endColumn - 1) },
          },
          severity: 1,
          code: "SCL1001",
          source: "scale-parser",
          message: err.message,
        });
      }
    } catch {
      // Fallback to semantic parser diagnostics if WASM parser unavailable
    }

    const deck = parseScale(text);
    const semanticDiags: LspDiagnostic[] = lintScale(deck).map((d) => {
      const line = d.range ? Math.max(0, d.range.startLine - 1) : 0;
      const col = d.range ? Math.max(0, d.range.startColumn - 1) : 0;
      const endLine = d.range ? Math.max(0, d.range.endLine - 1) : line;
      const endCol = d.range ? Math.max(0, d.range.endColumn - 1) : col + 10;

      let sev: 1 | 2 | 3 = 1;
      if (d.severity === "warning") sev = 2;
      if (d.severity === "info") sev = 3;

      return {
        range: {
          start: { line, character: col },
          end: { line: endLine, character: endCol },
        },
        severity: sev,
        code: d.code,
        source: "scale-linter",
        message: d.message,
      };
    });

    return [...syntaxDiags, ...semanticDiags];
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        severity: 1,
        code: "SCL1001",
        source: "scale-parser",
        message: `SCALE parse error: ${errMsg}`,
      },
    ];
  }
}

interface ScaleCstLine {
  row: number;
  text: string;
  colLine: string;
  startCol: number;
  endCol: number;
}

interface ScaleCstIndex {
  byRow: Map<number, ScaleCstLine>;
  lastRow: number;
  lastEndCol: number;
}

function buildScaleCstIndex(text: string): ScaleCstIndex {
  const byRow = new Map<number, ScaleCstLine>();
  let lastRow = 0;
  let lastEndCol = 0;

  let rootNode: CstNodeLike | null = null;
  try {
    rootNode = (getScaleWasmParser().parse(text)?.rootNode as CstNodeLike | undefined) ?? null;
  } catch {
    rootNode = null;
  }

  if (rootNode) {
    for (const { row, tokens } of groupAllCstTokensByLine(rootNode)) {
      const lineText = cstLineText(text, tokens);
      const first = tokens[0] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const last = tokens[tokens.length - 1] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const startCol = first?.startPosition?.column ?? 0;
      const endCol = last?.endPosition?.column ?? startCol + lineText.length;
      const colLine = startCol > 0 ? " ".repeat(startCol) + lineText : lineText;
      byRow.set(row, { row, text: lineText, colLine, startCol, endCol });
      if (row >= lastRow) {
        lastRow = row;
        lastEndCol = endCol;
      }
    }
  } else {
    const rawLines = text.split(/\r?\n/);
    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i] ?? "";
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const startCol = Math.max(0, raw.search(/\S/));
      const endCol = startCol + trimmed.length;
      byRow.set(i, { row: i, text: trimmed, colLine: raw, startCol, endCol });
      lastRow = i;
      lastEndCol = endCol;
    }
  }

  return { byRow, lastRow, lastEndCol };
}

export function getScaleDocumentSymbols(text: string): LspDocumentSymbol[] {
  const deck = parseScale(text);
  const cstIndex = buildScaleCstIndex(text);
  const rootRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: cstIndex.lastRow + 1, character: 0 },
  };
  const mkRange = (r?: { startLine: number; endLine: number }): LspRange => {
    const startLine = r ? Math.max(0, r.startLine - 1) : 0;
    const endLine = r ? Math.max(0, r.endLine - 1) : startLine;
    const startEntry = cstIndex.byRow.get(startLine);
    const endEntry = cstIndex.byRow.get(endLine);
    return {
      start: { line: startLine, character: startEntry?.startCol ?? 0 },
      end: { line: endLine, character: endEntry?.endCol ?? Math.max(1, startEntry?.endCol ?? 1) },
    };
  };

  const children: LspDocumentSymbol[] = [];

  for (const comp of deck.compositions) {
    const r = mkRange(comp.range);
    children.push({
      name: `Mix ${comp.mixtureId}: ${comp.materialName.toUpperCase()}`,
      detail: [
        comp.density !== undefined ? `den=${comp.density} g/cm³` : null,
        comp.temperature !== undefined ? `T=${comp.temperature} K` : null,
        comp.enrichment !== undefined ? `enrich=${comp.enrichment}%` : null,
      ]
        .filter(Boolean)
        .join(", "),
      kind: LspSymbolKind.Constant,
      range: r,
      selectionRange: r,
    });
  }

  for (const unit of deck.units.values()) {
    const r = mkRange(unit.range);
    children.push({
      name: unit.isGlobal ? `Global Unit ${unit.id}` : `Unit ${unit.id}`,
      detail: `${unit.bodies.length} bodies, ${unit.media.length} media regions`,
      kind: LspSymbolKind.Class,
      range: r,
      selectionRange: r,
    });
  }

  for (const arr of deck.arrays.values()) {
    const r = mkRange(arr.range);
    children.push({
      name: `Array ${arr.id}`,
      detail: `${arr.nux}x${arr.nuy}x${arr.nuz} lattice (${arr.fill.length} entries)`,
      kind: LspSymbolKind.Struct,
      range: r,
      selectionRange: r,
    });
  }

  for (const oc of deck.origenCases) {
    const r = mkRange(oc.range);
    children.push({
      name: `ORIGEN Case ${oc.id}`,
      detail: `${oc.nuclides.length} nuclides, ${oc.time?.values.length ?? 0} time steps`,
      kind: LspSymbolKind.Module,
      range: r,
      selectionRange: r,
    });
  }

  return [
    {
      name: deck.title,
      detail: `SCALE =${deck.sequence || "unknown"} (${deck.compositions.length} comps, ${deck.units.size} units, ${deck.origenCases.length} ORIGEN cases)`,
      kind: LspSymbolKind.Package,
      range: rootRange,
      selectionRange: rootRange,
      children,
    },
  ];
}

export function getScaleHover(text: string, position: LspPosition): LspHover | null {
  const cstIndex = buildScaleCstIndex(text);
  const lineText = cstIndex.byRow.get(position.line)?.colLine ?? "";
  const deck = parseScale(text);

  // Hover on sequence directive (must be at start of line)
  const seqM = /^\s*=\s*([a-zA-Z0-9_-]+)/.exec(lineText);
  if (seqM) {
    const seq = seqM[1]!.toLowerCase();
    return {
      contents: {
        kind: "markdown",
        value: [
          `### ORNL SCALE Sequence: \`=${seq}\``,
          `- **Title:** ${deck.title}`,
          `- **Cross-Section Library:** ${deck.crossSectionLib ?? "default"}`,
          `- **Compositions:** ${deck.compositions.length} | **KENO Units:** ${deck.units.size} | **ORIGEN Cases:** ${deck.origenCases.length}`,
        ].join("\n"),
      },
    };
  }

  // Hover on standard composition names (UO2, H2O, ZIRC4, SS304, B4C, MOX)
  for (const [name, std] of Object.entries(SCALE_STANDARD_COMPOSITIONS)) {
    if (new RegExp(`\\b${name}\\b`, "i").test(lineText)) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### SCALE Standard Composition: **${std.name}**`,
            `- **Formula:** \`${std.formula}\``,
            `- **Theoretical Density:** ${std.defaultDensity} g/cm³`,
            `- **Reference Temperature:** ${std.defaultTemperature} K`,
            `- **Description:** ${std.description}`,
          ].join("\n"),
        },
      };
    }
  }

  // Hover on nuclide identifiers
  const tokens = lineText.split(/[^a-zA-Z0-9-]+/).filter(Boolean);
  for (const tok of tokens) {
    const norm = normalizeNuclideId(tok);
    const rec = SCALE_NUCLIDE_DATA[norm];
    if (rec) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### ORIGEN Nuclide: **${rec.id}** (ZAID: ${rec.zaid})`,
            `- **Half-life:** ${rec.halfLifeSec.toExponential(3)} s ($\\lambda = ${rec.decayConstant.toExponential(3)}\\text{ s}^{-1}$)`,
            `- **Thermal $\\sigma_a$:** ${rec.sigmaAbsorptionBarns} b | **$\\sigma_f$:** ${rec.sigmaFissionBarns} b`,
            `- **Decay Energy:** ${rec.decayEnergyMeV} MeV`,
            rec.decayDaughter ? `- **Decay Daughter:** \`${rec.decayDaughter}\`` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      };
    }
  }

  // Hover on KENO unit
  const unitM = /\b(?:global\s+)?unit\s+(\d+)\b/i.exec(lineText);
  if (unitM) {
    const uId = Number.parseInt(unitM[1]!, 10);
    const unit = deck.units.get(uId);
    if (unit) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### KENO ${unit.isGlobal ? "Global " : ""}Unit **${unit.id}**`,
            `- **Bodies:** ${unit.bodies.length}`,
            `- **Media Regions:** ${unit.media.length}`,
            `- **Holes:** ${unit.holes.length}`,
            `- **Boundary Body:** ${unit.boundaryBodyId ?? "auto"}`,
          ].join("\n"),
        },
      };
    }
  }

  return null;
}

export interface ScaleActionParams {
  method?: BatemanMethod | undefined;
  modelName?: string | undefined;
}

export async function executeScaleAction(action: string, text: string, params?: ScaleActionParams): Promise<unknown> {
  const deck = parseScale(text);

  switch (action) {
    case "lint_scale":
      return lintScale(deck);
    case "scale_solve_bateman":
      return solveScaleDeck(deck, params?.method ?? "expm");
    case "scale_to_dae": {
      const dae = lowerScaleToDae(deck, { modelName: params?.modelName });
      return {
        modelName: deck.title || "ScaleBatemanDepletion",
        variableCount: dae.variables().length,
        equationCount: dae.equations().length,
      };
    }
    case "scale_build_keno_cad":
      return buildKenoCadAssembly(deck);
    case "scale_to_modelica":
      return scaleToModelica(deck, params?.modelName);
    case "scale_to_mcnp":
      return scaleToMcnp(deck);
    default:
      throw new Error(`Unknown SCALE action: ${action}`);
  }
}

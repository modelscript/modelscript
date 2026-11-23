// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/melcor — Language Server Protocol (LSP) Services.
 *
 * Provides diagnostics (syntax + MEL1001–MEL5006 semantic lints), document symbols,
 * hover documentation, and keyword/package completions for MELCOR decks.
 */

import { collectWasmSyntaxErrors } from "@modelscript/dsl";
import {
  LspSymbolKind,
  type LspDiagnostic,
  type LspDocumentSymbol,
  type LspHover,
  type LspPosition,
  type LspRange,
} from "@modelscript/runtime";
import { lookupMelcorModelSchema } from "./catalog/library-package-adapter.js";
import { lintMelcor } from "./lints/index.js";
import { getMelcorWasmParser, parseMelcor } from "./parser/melcor-parser.js";

export { LspSymbolKind, type LspDiagnostic, type LspDocumentSymbol, type LspHover, type LspPosition, type LspRange };

export interface MelcorCompletionItem {
  label: string;
  detail: string;
  documentation: string;
}

const KEYWORD_DOCS: Record<string, { detail: string; doc: string }> = {
  MELGEN_INPUT: { detail: "Deck phase header", doc: "Begins MELGEN initial-condition & geometry generation input." },
  MELCOR_INPUT: { detail: "Deck phase header", doc: "Begins MELCOR transient execution input." },
  TITLE: { detail: "Deck title", doc: "Declares the problem title string." },
  EXEC_INPUT: { detail: "Execution control package", doc: "Configures transient time bounds and time-step controls." },
  EXEC_TEND: { detail: "End time [s]", doc: "Specifies problem termination time in seconds." },
  EXEC_DTMAX: { detail: "Max time step [s]", doc: "Maximum allowed integration time step." },
  EXEC_DTMIN: { detail: "Min time step [s]", doc: "Minimum allowed integration time step." },
  CVH_INPUT: { detail: "Control Volume Hydrodynamics", doc: "Defines thermodynamic control volumes (CVH package)." },
  CV_ID: {
    detail: "Control volume ID",
    doc: "Declares a control volume: `CV_ID '<name>' <id> [NORMAL|TIME_INDEPENDENT]`.",
  },
  CV_THR: {
    detail: "CV initial thermodynamics",
    doc: "Sets initial pressure [Pa] and temperature [K]: `CV_THR <P> <T> [poolFrac] [steamFrac]`.",
  },
  CV_PAS: {
    detail: "CV volume & elevation",
    doc: "Sets volume [m^3], elevation [m], and height [m]: `CV_PAS <V> [elev] [height]`.",
  },
  FL_INPUT: { detail: "Flow Path package", doc: "Defines hydrodynamic flow paths connecting control volumes." },
  FL_ID: { detail: "Flow path ID", doc: "Declares a flow path: `FL_ID '<name>' <id>`." },
  FL_FT: {
    detail: "Flow path from/to CVs",
    doc: "Connects two control volumes: `FL_FT <fromCv> <toCv> [fromElev] [toElev]`.",
  },
  FL_GEO: {
    detail: "Flow path geometry",
    doc: "Sets flow area [m^2], length [m], and open fraction: `FL_GEO <A> <L> [openFrac]`.",
  },
  FL_USL: { detail: "Flow path form loss", doc: "Sets forward and reverse form loss K: `FL_USL <kFwd> [kRev]`." },
  HS_INPUT: { detail: "Heat Structure package", doc: "Defines 1D conducting heat structures coupled to CVH volumes." },
  HS_ID: {
    detail: "Heat structure ID",
    doc: "Declares a heat structure: `HS_ID '<name>' <id> [RECTANGULAR|CYLINDRICAL|SPHERICAL]`.",
  },
  HS_GD: { detail: "Heat structure geometry", doc: "Sets thickness [m], surface area [m^2], mass [kg], k, cp, rho." },
  HS_LB: { detail: "HS left boundary CV", doc: "Couples left boundary to a CV: `HS_LB <cvId> [htc]`." },
  HS_RB: { detail: "HS right boundary CV", doc: "Couples right boundary to a CV: `HS_RB <cvId> [htc]`." },
  COR_INPUT: {
    detail: "Core degradation package",
    doc: "Defines reactor core rings/levels, decay heat, and Zircaloy-steam oxidation.",
  },
  COR_RP: {
    detail: "Core nodalization",
    doc: "Sets radial rings, axial levels, and rated power [W]: `COR_RP <rings> <levels> [powerW]`.",
  },
  COR_ZDF: {
    detail: "Core thermal & Zr mass",
    doc: "Sets core mass [kg], cp [J/(kg*K)], T0 [K], clad area [m^2], Zr mass [kg].",
  },
  COR_PWR: {
    detail: "Core decay heat power",
    doc: "Sets decay heat [W] and rated power [W]: `COR_PWR <decayW> [ratedW]`.",
  },
  COR_OX: {
    detail: "Zircaloy oxidation kinetics",
    doc: "Enables parabolic oxidation: `COR_OX ON [URBANIC_HEIDRICK|CATHCART_PAWEL] [area] [zrMass]`.",
  },
  RN1_INPUT: { detail: "Radionuclide package", doc: "Defines fission product classes and aerosol release parameters." },
  CF_INPUT: { detail: "Control Function package", doc: "Defines algebraic/logical control functions." },
  CF_ID: { detail: "Control function ID", doc: "Declares a control function: `CF_ID '<name>' <id> <type>`." },
  CF_ARG: {
    detail: "Control function argument",
    doc: "Adds an argument to active CF: `CF_ARG <CF|CVH|FL|TF|CONST> <targetId>`.",
  },
  TF_INPUT: { detail: "Tabular Function package", doc: "Defines piecewise-linear tabular functions." },
  TF_ID: { detail: "Tabular function ID", doc: "Declares a tabular function: `TF_ID '<name>' <id> [scale] [add]`." },
  MP_INPUT: {
    detail: "Material Properties package",
    doc: "Defines solid/molten material property overrides (UO2, Zircaloy-4, SS304).",
  },
  NCG_INPUT: { detail: "Non-Condensable Gas package", doc: "Defines non-condensable gas species (H2, N2, H2O)." },
  END: { detail: "Block / deck terminator", doc: "Terminates the MELCOR input deck." },
};

export function validateMelcor(text: string): LspDiagnostic[] {
  try {
    const cstTree = getMelcorWasmParser().parse(text);
    const syntaxDiags: LspDiagnostic[] = collectWasmSyntaxErrors(cstTree?.rootNode).map((err) => ({
      range: {
        start: { line: Math.max(0, err.startLine - 1), character: Math.max(0, err.startColumn - 1) },
        end: { line: Math.max(0, err.endLine - 1), character: Math.max(0, err.endColumn - 1) },
      },
      severity: 1,
      code: "MEL1001",
      source: "melcor-parser",
      message: err.message,
    }));

    const deck = parseMelcor(text);
    const semanticDiags: LspDiagnostic[] = lintMelcor(deck).map((d) => {
      const line = d.range ? Math.max(0, d.range.startLine - 1) : 0;
      const col = d.range ? Math.max(0, d.range.startColumn - 1) : 0;
      const endLine = d.range ? Math.max(0, d.range.endLine - 1) : line;
      const endCol = d.range ? Math.max(0, d.range.endColumn - 1) : col + 10;
      const sev: 1 | 2 | 3 = d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3;
      return {
        range: {
          start: { line, character: col },
          end: { line: endLine, character: endCol },
        },
        severity: sev,
        code: d.code,
        source: "melcor-linter",
        message: d.message,
      };
    });

    return [...syntaxDiags, ...semanticDiags];
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        severity: 1,
        code: "MEL1001",
        source: "melcor-parser",
        message: `MELCOR parse error: ${msg}`,
      },
    ];
  }
}

export function getMelcorDocumentSymbols(text: string): LspDocumentSymbol[] {
  const deck = parseMelcor(text);
  const children: LspDocumentSymbol[] = [];

  const mkRange = (r?: { startLine: number; endLine: number }): LspRange => {
    const sl = r ? Math.max(0, r.startLine - 1) : 0;
    const el = r ? Math.max(0, r.endLine - 1) : sl;
    return { start: { line: sl, character: 0 }, end: { line: el, character: 60 } };
  };

  for (const cv of deck.controlVolumes.values()) {
    const range = mkRange(cv.range);
    children.push({
      name: `${cv.name} (CV ${cv.id})`,
      detail: `V=${cv.volume} m^3, P=${(cv.pressure / 1e6).toFixed(2)} MPa, T=${cv.temperature.toFixed(1)} K`,
      kind: LspSymbolKind.Class,
      range,
      selectionRange: range,
    });
  }

  for (const fl of deck.flowPaths.values()) {
    const range = mkRange(fl.range);
    children.push({
      name: `${fl.name} (FL ${fl.id})`,
      detail: `CV ${fl.fromCv} -> CV ${fl.toCv}, A=${fl.area} m^2`,
      kind: LspSymbolKind.Interface,
      range,
      selectionRange: range,
    });
  }

  for (const hs of deck.heatStructures.values()) {
    const range = mkRange(hs.range);
    children.push({
      name: `${hs.name} (HS ${hs.id})`,
      detail: `${hs.geometry}, A=${hs.surfaceArea} m^2, T0=${hs.initialTemperature} K`,
      kind: LspSymbolKind.Struct,
      range,
      selectionRange: range,
    });
  }

  if (deck.core?.present) {
    const range = mkRange(deck.core.range);
    children.push({
      name: "COR Core Package",
      detail: `${deck.core.radialRings}x${deck.core.axialLevels}, Q_decay=${(deck.core.decayHeatW / 1e6).toFixed(2)} MW`,
      kind: LspSymbolKind.Module,
      range,
      selectionRange: range,
    });
  }

  for (const cf of deck.controlFunctions.values()) {
    const range = mkRange(cf.range);
    children.push({
      name: `${cf.name} (CF ${cf.id})`,
      detail: `${cf.cfType} (${cf.arguments.length} args)`,
      kind: LspSymbolKind.Function,
      range,
      selectionRange: range,
    });
  }

  for (const tf of deck.tabularFunctions.values()) {
    const range = mkRange(tf.range);
    children.push({
      name: `${tf.name} (TF ${tf.id})`,
      detail: `${tf.points.length} points`,
      kind: LspSymbolKind.Function,
      range,
      selectionRange: range,
    });
  }

  const rootRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: Math.max(0, text.split("\n").length - 1), character: 0 },
  };

  return [
    {
      name: deck.title,
      detail: `MELCOR (${deck.inputPhase})`,
      kind: LspSymbolKind.Package,
      range: rootRange,
      selectionRange: rootRange,
      children,
    },
  ];
}

export function getMelcorHover(text: string, position: LspPosition): LspHover | null {
  const lines = text.split("\n");
  const line = lines[position.line];
  if (!line) return null;

  // Find word under cursor
  let start = position.character;
  let end = position.character;
  while (start > 0 && /[A-Za-z0-9_-]/.test(line[start - 1] ?? "")) start--;
  while (end < line.length && /[A-Za-z0-9_-]/.test(line[end] ?? "")) end++;
  const word = line.slice(start, end).toUpperCase();
  if (!word) return null;

  const kwDoc = KEYWORD_DOCS[word];
  if (kwDoc) {
    return {
      contents: {
        kind: "markdown",
        value: `**\`${word}\`** — *${kwDoc.detail}*\n\n${kwDoc.doc}`,
      },
      range: {
        start: { line: position.line, character: start },
        end: { line: position.line, character: end },
      },
    };
  }

  const schema = lookupMelcorModelSchema(word);
  if (schema) {
    return {
      contents: {
        kind: "markdown",
        value: `**\`${schema.name}\`** (${schema.category})\n\n${schema.description}\n\n*Provenance:* ${schema.provenance}`,
      },
      range: {
        start: { line: position.line, character: start },
        end: { line: position.line, character: end },
      },
    };
  }

  return null;
}

export function getMelcorCompletions(prefix = ""): MelcorCompletionItem[] {
  const upper = prefix.trim().toUpperCase();
  return Object.entries(KEYWORD_DOCS)
    .filter(([kw]) => upper.length === 0 || kw.startsWith(upper))
    .map(([label, info]) => ({
      label,
      detail: info.detail,
      documentation: info.doc,
    }));
}

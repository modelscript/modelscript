// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for Gerber RS-274-D & RS-274X:
 * diagnostics, document symbols, hover documentation, and completions.
 */

import { unitToMm } from "./cad/geometry.js";
import { lintGerber, type GerberLintOptions } from "./lints/index.js";
import { parseGerber } from "./parser/gerber-parser.js";

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
  Struct = 23,
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
  severity: 1 | 2 | 3 | 4;
  code: string;
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

export interface LspCompletionItem {
  label: string;
  detail: string;
  insertText: string;
}

const DEFAULT_RANGE: LspRange = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 1 },
};

const GERBER_COMMAND_DOCS: Record<string, string> = {
  G01: "**G01** — Linear interpolation mode (straight line segments).",
  G02: "**G02** — Clockwise (CW) circular arc interpolation mode.",
  G03: "**G03** — Counter-clockwise (CCW) circular arc interpolation mode.",
  G04: "**G04** — Comment command (ignored by photoplotter).",
  G36: "**G36** — Begin filled region contour (`G36*` ... `G37*`).",
  G37: "**G37** — End filled region contour.",
  G70: "**G70** — Legacy RS-274-D unit mode: Inches (prefer `%MOIN*%`).",
  G71: "**G71** — Legacy RS-274-D unit mode: Millimeters (prefer `%MOMM*%`).",
  G74: "**G74** — Single-quadrant circular arc interpolation mode (max 90 deg).",
  G75: "**G75** — Multi-quadrant circular arc interpolation mode (up to 360 deg).",
  G90: "**G90** — Absolute coordinate notation (RS-274-D).",
  G91: "**G91** — Incremental coordinate notation (deprecated RS-274-D).",
  D01: "**D01** — Interpolate / Draw operation (shutter open).",
  D02: "**D02** — Move operation (shutter closed, no exposure).",
  D03: "**D03** — Flash operation (expose active aperture at coordinates).",
  M02: "**M02** — End of Gerber file.",
  FS: "**%FS** — Format Specification (zero omission `L`/`T`, notation `A`/`I`, `X<int><dec>Y<int><dec>`).",
  MO: "**%MO** — Unit Mode (`%MOIN*%` for inches, `%MOMM*%` for millimeters).",
  AD: "**%AD** — Aperture Definition (`C` Circle, `R` Rectangle, `O` Obround, `P` Polygon, or macro).",
  AM: "**%AM** — Aperture Macro custom primitive definition.",
  LP: "**%LP** — Load Polarity (`%LPD*%` Dark copper, `%LPC*%` Clear polarity).",
  SR: "**%SR** — Step and Repeat panelization array (`%SRX<n>Y<m>I<dx>J<dy>*%`).",
  TF: "**%TF** — Gerber X2 File Attribute.",
  TA: "**%TA** — Gerber X2 Aperture Attribute.",
};

/**
 * Validates a Gerber RS-274-D / RS-274X file and returns LSP diagnostics.
 */
export function validateGerber(
  content: string,
  uri: string = "layer.gbr",
  options?: GerberLintOptions,
): LspDiagnostic[] {
  try {
    const doc = parseGerber(content, uri);
    const diags = lintGerber(doc, options);
    const lines = content.split(/\r?\n/);

    return diags.map((d) => {
      const lineIdx = d.line ? Math.max(0, d.line - 1) : 0;
      const lineText = lines[lineIdx] ?? "";
      const startChar = d.column ? Math.max(0, d.column - 1) : 0;
      const endChar = Math.max(startChar + 1, lineText.length);
      return {
        range: {
          start: { line: lineIdx, character: startChar },
          end: { line: lineIdx, character: endChar },
        },
        severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
        code: d.id,
        source: "modelscript-gerber",
        message: d.message,
      };
    });
  } catch (err: unknown) {
    return [
      {
        range: DEFAULT_RANGE,
        severity: 1,
        code: "GRB1001",
        source: "modelscript-gerber",
        message: `Failed to parse Gerber file: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }
}

/**
 * Extracts hierarchical LSP document symbols for a Gerber layer (format spec, apertures, macros, regions).
 */
export function getGerberDocumentSymbols(content: string, uri: string = "layer.gbr"): LspDocumentSymbol[] {
  const doc = parseGerber(content, uri);
  const lines = content.split(/\r?\n/);
  const lastLine = Math.max(0, lines.length - 1);
  const lastChar = (lines[lastLine] ?? "").length;
  const children: LspDocumentSymbol[] = [];
  const unit = doc.unit ?? "MM";

  if (doc.formatSpec) {
    const fs = doc.formatSpec;
    const lineIdx = Math.max(0, fs.line - 1);
    const range: LspRange = {
      start: { line: lineIdx, character: Math.max(0, fs.column - 1) },
      end: { line: lineIdx, character: (lines[lineIdx] ?? "").length },
    };
    children.push({
      name: `Format ${fs.zeroOmission}${fs.coordNotation} X${fs.xInteger}.${fs.xDecimal} Y${fs.yInteger}.${fs.yDecimal}`,
      detail: `Units: ${unit}`,
      kind: LspSymbolKind.Constant,
      range,
      selectionRange: range,
    });
  }

  for (const [dCode, ap] of doc.apertures) {
    const lineIdx = Math.max(0, ap.line - 1);
    const range: LspRange = {
      start: { line: lineIdx, character: Math.max(0, ap.column - 1) },
      end: { line: lineIdx, character: (lines[lineIdx] ?? "").length },
    };
    const wMm = unitToMm(ap.width, unit).toFixed(3);
    const detail =
      ap.shape === "C"
        ? `Circle Ø${wMm} mm${ap.holeDiameter ? ` (hole Ø${unitToMm(ap.holeDiameter, unit).toFixed(3)} mm)` : ""}`
        : ap.shape === "R" || ap.shape === "O"
          ? `${ap.shape === "R" ? "Rectangle" : "Obround"} ${wMm}x${unitToMm(ap.height, unit).toFixed(3)} mm`
          : ap.shape === "P"
            ? `Polygon Ø${wMm} mm (${ap.vertices ?? 4}v)`
            : `Macro ${ap.macroName ?? ""}`;
    children.push({
      name: `D${dCode}`,
      detail,
      kind: LspSymbolKind.Property,
      range,
      selectionRange: range,
    });
  }

  for (const [macroName, macro] of doc.macros) {
    const lineIdx = Math.max(0, macro.line - 1);
    const range: LspRange = {
      start: { line: lineIdx, character: Math.max(0, macro.column - 1) },
      end: { line: lineIdx, character: (lines[lineIdx] ?? "").length },
    };
    children.push({
      name: macroName,
      detail: `Aperture Macro (${macro.primitives.length} primitives)`,
      kind: LspSymbolKind.Class,
      range,
      selectionRange: range,
    });
  }

  const rootRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: lastLine, character: lastChar },
  };

  return [
    {
      name: doc.name,
      detail: `Gerber ${unit} (${doc.apertures.size} apertures)`,
      kind: LspSymbolKind.File,
      range: rootRange,
      selectionRange: rootRange,
      children,
    },
  ];
}

/**
 * Provides hover documentation for Gerber commands (`G01`, `D10`, `%FS`, `%AD`, etc.) at the given position.
 */
export function getGerberHover(content: string, position: LspPosition, uri: string = "layer.gbr"): LspHover | null {
  const lines = content.split(/\r?\n/);
  const line = lines[position.line];
  if (!line) return null;

  const doc = parseGerber(content, uri);
  const unit = doc.unit ?? "MM";

  // Check for D10+ aperture reference near cursor
  const dRegex = /D(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = dRegex.exec(line)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (position.character >= start && position.character <= end) {
      const codeNum = Number.parseInt(m[1] ?? "0", 10);
      if (codeNum >= 10) {
        const ap = doc.apertures.get(codeNum);
        const value = ap
          ? `**Aperture D${codeNum}** (${ap.shape})\n\n- Width: ${unitToMm(ap.width, unit).toFixed(4)} mm\n- Height: ${unitToMm(ap.height, unit).toFixed(4)} mm${ap.holeDiameter ? `\n- Hole: ${unitToMm(ap.holeDiameter, unit).toFixed(4)} mm` : ""}`
          : `**Aperture D${codeNum}** — *Undefined aperture*`;
        return {
          contents: { kind: "markdown", value },
          range: {
            start: { line: position.line, character: start },
            end: { line: position.line, character: end },
          },
        };
      }
      const dKey = `D0${codeNum}`;
      const help = GERBER_COMMAND_DOCS[dKey];
      if (help) {
        return {
          contents: { kind: "markdown", value: help },
          range: {
            start: { line: position.line, character: start },
            end: { line: position.line, character: end },
          },
        };
      }
    }
  }

  // Check for G-code, M-code, or extended parameter prefix (%FS, %MO, %AD, etc.)
  const tokenRegex = /%([A-Z]{2})|([GM]\d{2})/g;
  while ((m = tokenRegex.exec(line)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (position.character >= start && position.character <= end) {
      const key = m[1] ?? m[2] ?? "";
      const help = GERBER_COMMAND_DOCS[key];
      if (help) {
        return {
          contents: { kind: "markdown", value: help },
          range: {
            start: { line: position.line, character: start },
            end: { line: position.line, character: end },
          },
        };
      }
    }
  }

  return null;
}

/**
 * Returns Gerber RS-274X command & defined-aperture completions.
 */
export function getGerberCompletions(content: string, uri: string = "layer.gbr"): LspCompletionItem[] {
  const doc = parseGerber(content, uri);
  const items: LspCompletionItem[] = [
    {
      label: "%FSLAX24Y24*%",
      detail: "Format Specification (Leading zero omission, Absolute, 2.4)",
      insertText: "%FSLAX24Y24*%",
    },
    { label: "%MOMM*%", detail: "Unit Mode: Millimeters", insertText: "%MOMM*%" },
    { label: "%MOIN*%", detail: "Unit Mode: Inches", insertText: "%MOIN*%" },
    {
      label: "%ADD10C,0.254*%",
      detail: "Define Circular Aperture D10 (0.254 mm / 10 mil)",
      insertText: "%ADD10C,0.254*%",
    },
    { label: "%LPD*%", detail: "Load Polarity: Dark", insertText: "%LPD*%" },
    { label: "%LPC*%", detail: "Load Polarity: Clear", insertText: "%LPC*%" },
    { label: "G01*", detail: "Linear Interpolation", insertText: "G01*" },
    { label: "G02*", detail: "Clockwise Circular Arc Interpolation", insertText: "G02*" },
    { label: "G03*", detail: "Counter-Clockwise Circular Arc Interpolation", insertText: "G03*" },
    { label: "G36*", detail: "Begin Region Fill", insertText: "G36*" },
    { label: "G37*", detail: "End Region Fill", insertText: "G37*" },
    { label: "G75*", detail: "Multi-Quadrant Arc Mode", insertText: "G75*" },
    { label: "M02*", detail: "End of File", insertText: "M02*" },
  ];

  for (const [dCode, ap] of doc.apertures) {
    items.push({
      label: `D${dCode}*`,
      detail: `Select Aperture D${dCode} (${ap.shape}, ${ap.width})`,
      insertText: `D${dCode}*`,
    });
  }

  return items;
}

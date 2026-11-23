// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for @modelscript/nmea0183:
 * - `validateNmea0183`
 * - `getNmea0183DocumentSymbols`
 * - `getNmea0183Hover`
 * - `getNmea0183Completions`
 */

import { NMEA0183_SENTENCE_SPECS } from "./catalog/nmea0183-std-schemas.js";
import { lintNmea0183 } from "./lints/index.js";
import { KNOWN_NMEA_FORMATTERS, KNOWN_NMEA_TALKERS, parseNmea0183 } from "./parser/index.js";

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
  severity: 1 | 2 | 3 | 4; // 1=Error, 2=Warning, 3=Info, 4=Hint
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
  kind: number; // 7=Class, 14=Keyword, 15=Snippet
  detail: string;
  documentation?: string | undefined;
  insertText?: string | undefined;
}

/**
 * Validates an NMEA 0183 telemetry stream and returns LSP diagnostics.
 */
export function validateNmea0183(content: string, _uri: string = "telemetry.nmea"): LspDiagnostic[] {
  const diags = lintNmea0183(content);
  return diags.map((d) => {
    const lineIdx = Math.max(0, d.line - 1);
    const startChar = Math.max(0, d.column - 1);
    const endChar = Math.max(startChar + 1, (d.endColumn ?? d.column + 1) - 1);
    return {
      range: {
        start: { line: lineIdx, character: startChar },
        end: { line: lineIdx, character: endChar },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.code,
      source: "nmea0183",
      message: d.message,
    };
  });
}

/**
 * Returns LSP DocumentSymbols grouped by sentence formatter.
 */
export function getNmea0183DocumentSymbols(content: string): LspDocumentSymbol[] {
  const doc = parseNmea0183(content);
  return doc.sentences.map((s) => {
    const lineIdx = Math.max(0, s.line - 1);
    const range: LspRange = {
      start: { line: lineIdx, character: 0 },
      end: { line: lineIdx, character: s.raw.length },
    };
    const selectionRange: LspRange = {
      start: { line: lineIdx, character: 0 },
      end: { line: lineIdx, character: Math.min(6, s.raw.length) },
    };

    let detail = KNOWN_NMEA_FORMATTERS[s.formatter] ?? "Custom NMEA Sentence";
    if (s.payload.kind === "GGA" && s.payload.latitudeDeg !== undefined && s.payload.longitudeDeg !== undefined) {
      detail = `${s.payload.latitudeDeg.toFixed(5)}°, ${s.payload.longitudeDeg.toFixed(5)}° (Q=${s.payload.fixQuality})`;
    } else if (
      s.payload.kind === "RMC" &&
      s.payload.latitudeDeg !== undefined &&
      s.payload.longitudeDeg !== undefined
    ) {
      detail = `${s.payload.latitudeDeg.toFixed(5)}°, ${s.payload.longitudeDeg.toFixed(5)}° (${s.payload.status})`;
    } else if (s.payload.kind === "GSV") {
      detail = `${s.payload.satellitesInView} SVs in view (msg ${s.payload.messageNumber}/${s.payload.totalMessages})`;
    }

    return {
      name: `${s.delimiter}${s.address}`,
      detail,
      kind: LspSymbolKind.Struct,
      range,
      selectionRange,
    };
  });
}

/**
 * Returns rich Markdown hover documentation for an NMEA 0183 sentence at `(line, character)`.
 */
export function getNmea0183Hover(content: string, position: LspPosition): LspHover | null {
  const doc = parseNmea0183(content);
  const targetLine = position.line + 1;
  const s = doc.sentences.find((item) => item.line === targetLine);
  if (!s) return null;

  const talkerDesc = KNOWN_NMEA_TALKERS[s.talker] ?? "Unknown Talker";
  const fmtDesc = KNOWN_NMEA_FORMATTERS[s.formatter] ?? "Custom Formatter";
  const lines: string[] = [
    `### \`${s.delimiter}${s.address}\` — ${fmtDesc}`,
    `- **Talker**: \`${s.talker}\` (${talkerDesc})`,
    `- **Formatter**: \`${s.formatter}\``,
    `- **Checksum**: ${s.checksumValid ? `Valid (\`*${s.checksumProvided}\`)` : `Invalid / Missing (expected \`*${s.checksumComputed}\`)`}`,
  ];

  const p = s.payload;
  if (p.kind === "GGA") {
    lines.push(
      `- **Position**: ${p.latitudeDeg?.toFixed(6) ?? "—"}°, ${p.longitudeDeg?.toFixed(6) ?? "—"}°`,
      `- **Altitude**: ${p.altitudeM ?? "—"} m · **Fix Quality**: ${p.fixQuality} · **HDOP**: ${p.hdop ?? "—"}`,
    );
  } else if (p.kind === "RMC") {
    lines.push(
      `- **Status**: \`${p.status}\` · **Position**: ${p.latitudeDeg?.toFixed(6) ?? "—"}°, ${p.longitudeDeg?.toFixed(6) ?? "—"}°`,
      `- **SOG**: ${p.speedKnots ?? "—"} kn · **COG**: ${p.courseDeg ?? "—"}°`,
    );
  } else if (p.kind === "GSV") {
    lines.push(`- **Satellites in View**: ${p.satellitesInView} (${p.satellites.length} in this sentence)`);
  } else if (p.kind === "HDG") {
    lines.push(`- **Magnetic Heading**: ${p.headingMagneticDeg ?? "—"}°`);
  } else if (p.kind === "DBT") {
    lines.push(`- **Depth Below Transducer**: ${p.depthMeters ?? "—"} m`);
  } else if (p.kind === "MWV") {
    lines.push(`- **Wind**: ${p.windSpeed ?? "—"} ${p.windSpeedUnits} @ ${p.windAngleDeg ?? "—"}° (${p.reference})`);
  }

  return {
    contents: {
      kind: "markdown",
      value: lines.join("\n"),
    },
    range: {
      start: { line: position.line, character: 0 },
      end: { line: position.line, character: s.raw.length },
    },
  };
}

/**
 * Provides NMEA 0183 sentence header and talker completions.
 */
export function getNmea0183Completions(prefix: string = ""): LspCompletionItem[] {
  const pfx = prefix.trim().toUpperCase();
  const items: LspCompletionItem[] = [];

  for (const spec of NMEA0183_SENTENCE_SPECS) {
    const label = `$GP${spec.formatter}`;
    if (!pfx || label.includes(pfx) || spec.formatter.includes(pfx)) {
      items.push({
        label,
        kind: 15,
        detail: spec.label,
        documentation: spec.description,
        insertText: `${label},`,
      });
    }
    for (const alias of spec.aliases ?? []) {
      const aliasLabel = `$${alias}`;
      if (aliasLabel !== label && (!pfx || aliasLabel.includes(pfx))) {
        items.push({
          label: aliasLabel,
          kind: 7,
          detail: spec.label,
          documentation: spec.description,
          insertText: `${aliasLabel},`,
        });
      }
    }
  }

  return items;
}

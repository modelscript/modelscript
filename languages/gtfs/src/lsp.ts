// SPDX-License-Identifier: AGPL-3.0-or-later

import { lintGtfs } from "./lints/index.js";
import { parseGtfs } from "./parser/index.js";
import type { GtfsFeed } from "./types.js";

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspDiagnostic {
  range: LspRange;
  severity: 1 | 2 | 3 | 4;
  code: number | string;
  source: string;
  message: string;
}

export interface LspHover {
  contents: { kind: "markdown" | "plaintext"; value: string };
  range?: LspRange | undefined;
}

export interface LspDocumentSymbol {
  name: string;
  detail?: string | undefined;
  kind: number;
  range: LspRange;
  selectionRange: LspRange;
}

export function validateGtfs(text: string): LspDiagnostic[] {
  try {
    const feed = parseGtfs(text);
    const diags = lintGtfs(feed);
    const lines = text.split(/\r?\n/);
    return diags.map((d) => {
      const lineIdx = Math.min(Math.max(0, d.line - 1), Math.max(0, lines.length - 1));
      const lt = lines[lineIdx] ?? "";
      let sChar = 0;
      while (sChar < lt.length && (lt[sChar] === " " || lt[sChar] === "\t")) sChar++;
      const tok = lt.slice(sChar).match(/^[^,\s]+/);
      const eChar = Math.min(lt.length, sChar + (tok ? tok[0].length : 1));
      return {
        range: {
          start: { line: lineIdx, character: sChar },
          end: { line: lineIdx, character: eChar },
        },
        severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
        code: `GTFS${d.code}`,
        source: "gtfs",
        message: d.message,
      };
    });
  } catch (err) {
    return [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        severity: 1,
        code: "GTFS1001",
        source: "gtfs",
        message: err instanceof Error ? err.message : String(err),
      },
    ];
  }
}

export function getGtfsDocumentSymbols(input: string | GtfsFeed): LspDocumentSymbol[] {
  let feed: GtfsFeed;
  try {
    feed = typeof input === "string" ? parseGtfs(input) : input;
  } catch {
    return [];
  }

  const lines = typeof input === "string" ? input.split(/\r?\n/) : [];
  const lineRange = (line: number, labelLen: number): LspRange => {
    const lt = lines[line] ?? "";
    const endChar = lt.length > 0 ? Math.max(1, lt.trimEnd().length) : Math.max(1, labelLen);
    return { start: { line, character: 0 }, end: { line, character: endChar } };
  };
  const symbols: LspDocumentSymbol[] = [];

  for (const r of feed.routes) {
    const l = Math.max(0, (r.line ?? 1) - 1);
    const label = `Route ${r.route_short_name || r.route_id}`;
    const rng = lineRange(l, label.length);
    symbols.push({
      name: label,
      detail: r.route_long_name,
      kind: 5,
      range: rng,
      selectionRange: rng,
    });
  }

  for (const s of feed.stops) {
    const l = Math.max(0, (s.line ?? 1) - 1);
    const label = s.stop_name || s.stop_id;
    const rng = lineRange(l, label.length);
    symbols.push({
      name: label,
      detail: `Stop (${s.stop_lat.toFixed(4)}, ${s.stop_lon.toFixed(4)})`,
      kind: 13,
      range: rng,
      selectionRange: rng,
    });
  }

  return symbols;
}

export function getGtfsHover(text: string, pos: LspPosition): LspHover | null {
  try {
    const feed = parseGtfs(text);
    const symbols = getGtfsDocumentSymbols(feed);
    for (const s of symbols) {
      if (pos.line >= s.range.start.line && pos.line <= s.range.end.line) {
        return {
          contents: {
            kind: "markdown",
            value: `**GTFS ${s.detail ?? ""}**: \`${s.name}\``,
          },
          range: s.range,
        };
      }
    }
  } catch {
    // Ignore
  }
  return null;
}

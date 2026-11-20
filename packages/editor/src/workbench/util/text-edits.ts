// SPDX-License-Identifier: AGPL-3.0-or-later

export interface LspTextEditRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface LspTextEditItem {
  range: LspTextEditRange;
  newText: string;
}

/**
 * Apply LSP TextEdits directly to a plain text string when the Monaco editor
 * instance is not yet mounted (e.g. lazy-loaded or hidden in diagram-only embed mode).
 */
export function applyLspTextEditsToString(sourceText: string, edits: LspTextEditItem[]): string {
  if (!edits || edits.length === 0) return sourceText;

  const lines = sourceText.split("\n");
  const toOffset = (pos: { line: number; character: number }): number => {
    const safeLine = Math.max(0, Math.min(lines.length - 1, pos.line));
    let offset = 0;
    for (let i = 0; i < safeLine; i++) {
      offset += (lines[i]?.length ?? 0) + 1;
    }
    const lineLen = lines[safeLine]?.length ?? 0;
    return offset + Math.max(0, Math.min(lineLen, pos.character));
  };

  const resolved = edits
    .map((e) => ({
      start: toOffset(e.range.start),
      end: toOffset(e.range.end),
      newText: e.newText,
    }))
    .sort((a, b) => b.start - a.start || b.end - a.end);

  let result = sourceText;
  for (const edit of resolved) {
    result = result.slice(0, edit.start) + edit.newText + result.slice(edit.end);
  }
  return result;
}

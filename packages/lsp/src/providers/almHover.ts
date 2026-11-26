// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * LSP Hover & CodeAction helpers for `@external` ALM-synced items
 * (IBM DOORS Next, Jama Connect, PTC Codebeamer, Siemens Polarion, Jira).
 */

import { CodeActionKind, MarkupKind, type CodeAction, type Hover } from "vscode-languageserver";

export interface AlmExternalLineInfo {
  id: string;
  uri?: string | undefined;
  webUrl?: string | undefined;
  rev?: string | undefined;
  status?: string | undefined;
  priority?: string | undefined;
}

function isWs(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n";
}

function isIdentChar(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95;
}

function readQuotedAttr(attrs: string, key: string): string | undefined {
  const needle = `${key}="`;
  let searchFrom = 0;
  while (searchFrom < attrs.length) {
    const idx = attrs.indexOf(needle, searchFrom);
    if (idx === -1) return undefined;
    if (idx > 0 && isIdentChar(attrs[idx - 1]!)) {
      searchFrom = idx + needle.length;
      continue;
    }
    const valStart = idx + needle.length;
    const valEnd = attrs.indexOf('"', valStart);
    if (valEnd === -1) return undefined;
    return attrs.slice(valStart, valEnd);
  }
  return undefined;
}

function readQuotedField(line: string, fieldName: string): string | undefined {
  let searchFrom = 0;
  while (searchFrom < line.length) {
    const idx = line.indexOf(fieldName, searchFrom);
    if (idx === -1) return undefined;
    const beforeOk = idx === 0 || !isIdentChar(line[idx - 1]!);
    const afterIdx = idx + fieldName.length;
    const afterOk = afterIdx >= line.length || !isIdentChar(line[afterIdx]!);
    if (!beforeOk || !afterOk) {
      searchFrom = afterIdx;
      continue;
    }
    let p = afterIdx;
    while (p < line.length && isWs(line[p]!)) p++;
    if (p < line.length && line[p] === ":") {
      let prevEnd = idx;
      while (prevEnd > 0 && isWs(line[prevEnd - 1]!)) prevEnd--;
      const attrLen = "attribute".length;
      const hasAttrPrefix =
        prevEnd < idx &&
        prevEnd >= attrLen &&
        line.slice(prevEnd - attrLen, prevEnd) === "attribute" &&
        (prevEnd - attrLen === 0 || !isIdentChar(line[prevEnd - attrLen - 1]!));
      if (!hasAttrPrefix) {
        searchFrom = afterIdx;
        continue;
      }
      p++;
      while (p < line.length && isWs(line[p]!)) p++;
      if (!line.startsWith("String", p)) {
        searchFrom = afterIdx;
        continue;
      }
      p += "String".length;
      while (p < line.length && isWs(line[p]!)) p++;
    }
    if (p < line.length && line[p] === "=") {
      p++;
      while (p < line.length && isWs(line[p]!)) p++;
      if (p < line.length && line[p] === '"') {
        const valEnd = line.indexOf('"', p + 1);
        if (valEnd !== -1) {
          return line.slice(p + 1, valEnd);
        }
      }
    }
    searchFrom = afterIdx;
  }
  return undefined;
}

function parseExternalHeaderLine(line: string): AlmExternalLineInfo | null {
  const slashIdx = line.indexOf("//");
  if (slashIdx === -1) return null;
  let p = slashIdx + 2;
  while (p < line.length && isWs(line[p]!)) p++;
  if (!line.startsWith("@external", p)) return null;
  p += "@external".length;
  if (p >= line.length || !isWs(line[p]!)) return null;
  while (p < line.length && isWs(line[p]!)) p++;
  if (p >= line.length) return null;
  const attrs = line.slice(p);
  const id = readQuotedAttr(attrs, "id");
  if (!id) return null;
  return {
    id,
    uri: readQuotedAttr(attrs, "uri"),
    webUrl: readQuotedAttr(attrs, "webUrl"),
    rev: readQuotedAttr(attrs, "rev"),
  };
}

/**
 * Checks whether the cursor line (or the immediately preceding `@external` header line)
 * belongs to a synced ALM requirement/concern/test item, returning a rich Markdown hover card.
 */
export function getAlmExternalHover(docText: string, lineIndex: number): Hover | null {
  const lines = docText.split(/\r?\n/);
  const info =
    parseExternalHeaderLine(lines[lineIndex] ?? "") ??
    (lineIndex > 0 ? parseExternalHeaderLine(lines[lineIndex - 1] ?? "") : null);
  if (!info) return null;

  // Scan the next ~8 lines inside the block for status / priority attributes
  for (let i = lineIndex; i < Math.min(lines.length, lineIndex + 10); i++) {
    const l = lines[i]!;
    if (!info.status) {
      const status = readQuotedField(l, "status");
      if (status !== undefined) info.status = status;
    }
    if (!info.priority) {
      const priority = readQuotedField(l, "priority");
      if (priority !== undefined) info.priority = priority;
    }
  }

  const md: string[] = [`**External ALM Artifact** \`${info.id}\``];
  if (info.status) md.push(`- **Status:** \`${info.status}\``);
  if (info.priority) md.push(`- **Priority:** \`${info.priority}\``);
  if (info.rev) md.push(`- **Revision:** \`${info.rev}\``);
  if (info.uri) md.push(`- **URI:** \`${info.uri}\``);
  if (info.webUrl) md.push(`\n[Open in ALM Web UI](${info.webUrl})`);

  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: md.join("\n"),
    },
  };
}

/**
 * Returns CodeActions for synced ALM items (Open in ALM, Sync remote dependency).
 */
export function getAlmCodeActions(docText: string, lineIndex: number, docUri: string): CodeAction[] {
  const lines = docText.split(/\r?\n/);
  const info =
    parseExternalHeaderLine(lines[lineIndex] ?? "") ??
    (lineIndex > 0 ? parseExternalHeaderLine(lines[lineIndex - 1] ?? "") : null);
  if (!info) return [];

  const actions: CodeAction[] = [];
  if (info.webUrl) {
    actions.push({
      title: `Open '${info.id}' in ALM Web UI`,
      kind: CodeActionKind.Source,
      command: {
        title: `Open '${info.id}' in ALM Web UI`,
        command: "modelscript.alm.openExternal",
        arguments: [info.webUrl, info.id],
      },
    });
  }
  actions.push({
    title: `Sync ALM remote for '${info.id}' (msx sync pull)`,
    kind: CodeActionKind.Source,
    command: {
      title: "Sync ALM remote",
      command: "modelscript.alm.syncPull",
      arguments: [docUri, info.id],
    },
  });
  return actions;
}

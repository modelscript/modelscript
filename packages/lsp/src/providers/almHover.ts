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

function parseExternalHeaderLine(line: string): AlmExternalLineInfo | null {
  const match = /\/\/\s*@external\s+(.+)$/.exec(line);
  if (!match) return null;
  const attrs = match[1]!;
  const read = (k: string): string | undefined => {
    const m = new RegExp(`${k}="([^"]*)"`).exec(attrs);
    return m ? m[1] : undefined;
  };
  const id = read("id");
  if (!id) return null;
  return {
    id,
    uri: read("uri"),
    webUrl: read("webUrl"),
    rev: read("rev"),
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
      const sm = /(?:attribute\s+status\s*:\s*String\s*=|\bstatus\s*=)\s*"([^"]*)"/.exec(l);
      if (sm) info.status = sm[1];
    }
    if (!info.priority) {
      const pm = /(?:attribute\s+priority\s*:\s*String\s*=|\bpriority\s*=)\s*"([^"]*)"/.exec(l);
      if (pm) info.priority = pm[1];
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

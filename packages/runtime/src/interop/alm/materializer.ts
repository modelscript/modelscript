// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Deterministic plain-text materializer for ALM artifacts.
 *
 * Projects canonical `AlmArtifact[]` + `AlmLink[]` into canonically sorted
 * SysML v2 (`.sysml`) or ModelScript (`.ms`) files suitable for Git diffs,
 * offline compilation, LSP hover/navigation, and 3-way conflict detection.
 */

import type { MaterializeFormat } from "../../workspace/manifest.js";
import type { AlmArtifact, AlmLink } from "./alm_ir.js";

export interface MaterializedFile {
  /** Relative filename inside the target package or materialization directory. */
  filename: string;
  /** Deterministic UTF-8 source text. */
  content: string;
  /** Map from `externalId` to its canonical `sha256:...` item hash. */
  itemHashes: Record<string, string>;
}

export interface MaterializedSnapshot {
  files: MaterializedFile[];
  /** Aggregate `sha256:...` integrity hash over all materialized files in sorted order. */
  integrity: string;
  /** Map from `externalId` to its canonical `sha256:...` item hash. */
  itemHashes: Record<string, string>;
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest("SHA-256", bytes as BufferSource);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  const cryptoMod = await import("node:crypto");
  return cryptoMod.createHash("sha256").update(bytes).digest("hex");
}

/**
 * Sanitizes an external ALM ID (e.g. `ENG-1420`, `REQ/042`) into a valid identifier.
 */
export function sanitizeAlmIdentifier(externalId: string): string {
  const cleaned = externalId.replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+/, "");
  if (!cleaned) return "ITEM";
  return /^[0-9]/.test(cleaned) ? `ID_${cleaned}` : cleaned;
}

function escapeString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n");
}

function escapeDocComment(value: string): string {
  return value.replace(/\*\//g, "* /").trim();
}

function sanitizePackageIdentifier(packageName: string): string {
  return (
    packageName
      .replace(/^@/, "")
      .replace(/[^A-Za-z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "") || "AlmRemote"
  );
}

/**
 * Sorts artifacts deterministically: preserves explicit `order` when present
 * (for Polarion LiveDocs, DOORS Modules, Jama trees), falling back to `externalId`.
 */
export function sortAlmArtifacts(artifacts: AlmArtifact[]): AlmArtifact[] {
  return [...artifacts].sort((a, b) => {
    const oa = a.order ?? Number.MAX_SAFE_INTEGER;
    const ob = b.order ?? Number.MAX_SAFE_INTEGER;
    if (oa !== ob) return oa - ob;
    return a.externalId.localeCompare(b.externalId);
  });
}

/**
 * Computes a deterministic canonical hash for a single ALM artifact's projected semantics.
 */
export async function computeAlmItemHash(artifact: AlmArtifact): Promise<string> {
  const sortedAttrs: Record<string, string | number | boolean> = {};
  for (const key of Object.keys(artifact.attributes).sort()) {
    sortedAttrs[key] = artifact.attributes[key]!;
  }
  const canonical = JSON.stringify({
    externalId: artifact.externalId,
    kind: artifact.kind,
    title: artifact.title,
    text: artifact.text,
    status: artifact.status,
    priority: artifact.priority ?? "",
    parentId: artifact.parentId ?? "",
    attributes: sortedAttrs,
  });
  return `sha256:${await sha256Hex(canonical)}`;
}

function renderSysmlArtifactBlock(artifact: AlmArtifact, links: AlmLink[]): string {
  const ident = sanitizeAlmIdentifier(artifact.externalId);
  const keyword =
    artifact.kind === "test_case"
      ? "verification def"
      : artifact.kind === "change_request"
        ? "concern def"
        : "requirement def";

  const lines: string[] = [];
  lines.push(
    `  // @external id="${escapeString(artifact.externalId)}" uri="${escapeString(artifact.uri)}"${artifact.webUrl ? ` webUrl="${escapeString(artifact.webUrl)}"` : ""}${artifact.revision ? ` rev="${escapeString(artifact.revision)}"` : ""}`,
  );
  lines.push(`  ${keyword} <'${escapeString(artifact.externalId)}'> ${ident} {`);
  lines.push(
    `    doc /* ${escapeDocComment(artifact.title)}${artifact.text ? `\n     * ${escapeDocComment(artifact.text).replace(/\n/g, "\n     * ")}` : ""} */`,
  );
  lines.push(`    attribute status : String = "${escapeString(artifact.status)}";`);
  if (artifact.priority) {
    lines.push(`    attribute priority : String = "${escapeString(artifact.priority)}";`);
  }
  if (artifact.parentId) {
    lines.push(`    attribute parentId : String = "${escapeString(artifact.parentId)}";`);
  }
  for (const key of Object.keys(artifact.attributes).sort()) {
    const val = artifact.attributes[key]!;
    const attrName = sanitizeAlmIdentifier(key);
    if (typeof val === "boolean") {
      lines.push(`    attribute ${attrName} : Boolean = ${val ? "true" : "false"};`);
    } else if (typeof val === "number") {
      lines.push(`    attribute ${attrName} : Real = ${val};`);
    } else {
      lines.push(`    attribute ${attrName} : String = "${escapeString(String(val))}";`);
    }
  }
  for (const link of links) {
    lines.push(`    // @link relation="${link.relation}" target="${escapeString(link.targetId)}"`);
  }
  lines.push("  }");
  return lines.join("\n");
}

function renderModelScriptArtifactBlock(artifact: AlmArtifact, links: AlmLink[]): string {
  const ident = sanitizeAlmIdentifier(artifact.externalId);
  const lines: string[] = [];
  lines.push(
    `  // @external id="${escapeString(artifact.externalId)}" uri="${escapeString(artifact.uri)}"${artifact.webUrl ? ` webUrl="${escapeString(artifact.webUrl)}"` : ""}${artifact.revision ? ` rev="${escapeString(artifact.revision)}"` : ""}`,
  );
  lines.push(`  requirement ${ident} {`);
  lines.push(`    id = "${escapeString(artifact.externalId)}";`);
  lines.push(`    title = "${escapeString(artifact.title)}";`);
  lines.push(`    text = "${escapeString(artifact.text)}";`);
  lines.push(`    status = "${escapeString(artifact.status)}";`);
  if (artifact.priority) {
    lines.push(`    priority = "${escapeString(artifact.priority)}";`);
  }
  for (const link of links) {
    lines.push(`    // @link relation="${link.relation}" target="${escapeString(link.targetId)}"`);
  }
  lines.push("  }");
  return lines.join("\n");
}

/**
 * Materializes ALM artifacts into deterministic `.sysml` or `.ms` files with
 * per-item and aggregate SHA-256 integrity hashes.
 */
export async function materializeAlmArtifacts(
  packageName: string,
  artifacts: AlmArtifact[],
  links: AlmLink[] = [],
  format: MaterializeFormat = "sysml2",
  metadata?: { source?: string | undefined; baseline?: string | undefined } | undefined,
): Promise<MaterializedSnapshot> {
  const sorted = sortAlmArtifacts(artifacts);
  const pkgIdent = sanitizePackageIdentifier(packageName);
  const linksBySource = new Map<string, AlmLink[]>();
  for (const link of links) {
    const arr = linksBySource.get(link.sourceId) ?? [];
    arr.push(link);
    linksBySource.set(link.sourceId, arr);
  }
  for (const arr of linksBySource.values()) {
    arr.sort((a, b) => `${a.relation}:${a.targetId}`.localeCompare(`${b.relation}:${b.targetId}`));
  }

  const itemHashes: Record<string, string> = {};
  const blocks: string[] = [];

  for (const item of sorted) {
    itemHashes[item.externalId] = await computeAlmItemHash(item);
    const itemLinks = linksBySource.get(item.externalId) ?? [];
    if (format === "modelscript") {
      blocks.push(renderModelScriptArtifactBlock(item, itemLinks));
    } else {
      blocks.push(renderSysmlArtifactBlock(item, itemLinks));
    }
  }

  const ext = format === "modelscript" ? "ms" : "sysml";
  const filename = `${pkgIdent}.${ext}`;
  const headerLines = [
    `// Generated by ModelScript ALM Sync — do not edit @external provenance headers.`,
    `// Package: ${packageName}`,
  ];
  if (metadata?.source) headerLines.push(`// Source: ${metadata.source}`);
  if (metadata?.baseline) headerLines.push(`// Baseline: ${metadata.baseline}`);

  const body = blocks.length > 0 ? `package ${pkgIdent} {\n${blocks.join("\n\n")}\n}\n` : `package ${pkgIdent} {\n}\n`;

  const content = `${headerLines.join("\n")}\n\n${body}`;
  const fileHash = await sha256Hex(`${filename}\0${content}`);

  return {
    files: [{ filename, content, itemHashes }],
    integrity: `sha256:${fileHash}`,
    itemHashes,
  };
}

/**
 * Extracts per-item block hashes from an existing materialized `.sysml` / `.ms` file
 * so the 3-way sync engine can detect local hand-edits cleanly.
 */
export async function extractLocalItemBlocks(content: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const blockRe = /\/\/\s*@external\s+id="([^"]+)"[^\n]*\n([\s\S]*?)(?=\n\s*\/\/\s*@external\s+id="|\n\}\s*$)/g;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(content)) !== null) {
    const id = match[1]!;
    const blockBody = match[2]!.trim();
    result[id] = `sha256:${await sha256Hex(blockBody)}`;
  }
  return result;
}

export interface ParsedExternalItem {
  externalId: string;
  uri?: string | undefined;
  webUrl?: string | undefined;
  revision?: string | undefined;
  title?: string | undefined;
  text?: string | undefined;
  status?: string | undefined;
  priority?: string | undefined;
  blockHash: string;
}

/**
 * Parses all `@external`-annotated requirement/concern blocks in a materialized `.sysml` or `.ms` file.
 * Used both by bidirectional `msx sync push` (artifact edits) and LSP hover/code-actions.
 */
export async function parseMaterializedExternalItems(content: string): Promise<ParsedExternalItem[]> {
  const items: ParsedExternalItem[] = [];
  const blockRe = /\/\/\s*@external\s+([^\n]+)\n([\s\S]*?)(?=\n\s*\/\/\s*@external\s+|\n\}\s*$)/g;
  let match: RegExpExecArray | null;

  while ((match = blockRe.exec(content)) !== null) {
    const headerAttrs = match[1]!;
    const body = match[2]!.trim();
    const readAttr = (key: string): string | undefined => {
      const m = new RegExp(`${key}="([^"]*)"`).exec(headerAttrs);
      return m ? m[1] : undefined;
    };

    const externalId = readAttr("id");
    if (!externalId) continue;

    let title: string | undefined;
    let text: string | undefined;
    let status: string | undefined;
    let priority: string | undefined;

    // SysML v2 doc /* title\n * text */
    const docMatch = /doc\s*\/\*([\s\S]*?)\*\//.exec(body);
    if (docMatch) {
      const lines = docMatch[1]!
        .split(/\r?\n/)
        .map((l) => l.replace(/^\s*\*\s?/, "").trim())
        .filter((l) => l.length > 0);
      title = lines[0];
      text = lines.slice(1).join("\n");
    }

    // ModelScript title = "..."; text = "...";
    const msTitle = /\btitle\s*=\s*"([^"]*)"/.exec(body);
    if (msTitle) title = msTitle[1];
    const msText = /\btext\s*=\s*"([^"]*)"/.exec(body);
    if (msText) text = msText[1];

    const statusMatch = /(?:attribute\s+status\s*:\s*String\s*=|\bstatus\s*=)\s*"([^"]*)"/.exec(body);
    if (statusMatch) status = statusMatch[1];

    const prioMatch = /(?:attribute\s+priority\s*:\s*String\s*=|\bpriority\s*=)\s*"([^"]*)"/.exec(body);
    if (prioMatch) priority = prioMatch[1];

    items.push({
      externalId,
      uri: readAttr("uri"),
      webUrl: readAttr("webUrl"),
      revision: readAttr("rev"),
      title,
      text,
      status,
      priority,
      blockHash: `sha256:${await sha256Hex(body)}`,
    });
  }

  return items;
}

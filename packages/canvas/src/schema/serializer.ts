// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CanvasDocument, CanvasTile, CanvasWire } from "./canvas-document.js";

export interface CanvasValidationIssue {
  path: string;
  message: string;
}

/**
 * Recursively sorts object keys so `.mscanvas` files serialize deterministically
 * for clean Git diffs.
 */
function canonicalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeValue);
  }
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) {
        sorted[key] = canonicalizeValue(entry);
      }
    }
    return sorted;
  }
  return value;
}

/** Serializes a CanvasDocument into deterministic, Git-diff-friendly JSON. */
export function serializeCanvasDocument(doc: CanvasDocument): string {
  return `${JSON.stringify(canonicalizeValue(doc), null, 2)}\n`;
}

/** Validates structural integrity and referential consistency of a CanvasDocument. */
export function validateCanvasDocument(raw: unknown): CanvasValidationIssue[] {
  const issues: CanvasValidationIssue[] = [];
  if (!raw || typeof raw !== "object") {
    return [{ path: "$", message: "Document must be a JSON object." }];
  }
  const obj = raw as Record<string, unknown>;
  if (obj["schemaVersion"] !== "1.0") {
    issues.push({ path: "$.schemaVersion", message: `Unsupported schemaVersion: ${String(obj["schemaVersion"])}.` });
  }
  if (typeof obj["id"] !== "string" || obj["id"].length === 0) {
    issues.push({ path: "$.id", message: "Document id must be a non-empty string." });
  }
  if (typeof obj["name"] !== "string") {
    issues.push({ path: "$.name", message: "Document name must be a string." });
  }

  const tiles = (obj["tiles"] && typeof obj["tiles"] === "object" ? obj["tiles"] : {}) as Record<string, CanvasTile>;
  const frames = (obj["frames"] && typeof obj["frames"] === "object" ? obj["frames"] : {}) as Record<string, unknown>;
  const wires = (obj["wires"] && typeof obj["wires"] === "object" ? obj["wires"] : {}) as Record<string, CanvasWire>;

  for (const [tileId, tile] of Object.entries(tiles)) {
    if (!tile || typeof tile !== "object") {
      issues.push({ path: `$.tiles.${tileId}`, message: "Tile entry must be an object." });
      continue;
    }
    if (!tile.bounds || tile.bounds.width <= 0 || tile.bounds.height <= 0) {
      issues.push({ path: `$.tiles.${tileId}.bounds`, message: "Tile bounds must have positive width and height." });
    }
    if (tile.frameId && !frames[tile.frameId]) {
      issues.push({
        path: `$.tiles.${tileId}.frameId`,
        message: `Referenced frame '${tile.frameId}' does not exist.`,
      });
    }
  }

  for (const [wireId, wire] of Object.entries(wires)) {
    if (!wire || typeof wire !== "object") {
      issues.push({ path: `$.wires.${wireId}`, message: "Wire entry must be an object." });
      continue;
    }
    if (!tiles[wire.source?.tileId]) {
      issues.push({
        path: `$.wires.${wireId}.source.tileId`,
        message: `Source tile '${wire.source?.tileId}' does not exist.`,
      });
    }
    if (!tiles[wire.target?.tileId]) {
      issues.push({
        path: `$.wires.${wireId}.target.tileId`,
        message: `Target tile '${wire.target?.tileId}' does not exist.`,
      });
    }
  }

  return issues;
}

/** Parses and validates a `.mscanvas` JSON string. Throws on invalid schema. */
export function deserializeCanvasDocument(json: string): CanvasDocument {
  const parsed: unknown = JSON.parse(json);
  const issues = validateCanvasDocument(parsed);
  if (issues.length > 0) {
    const summary = issues.map((i) => `${i.path}: ${i.message}`).join("; ");
    throw new Error(`Invalid .mscanvas document: ${summary}`);
  }
  return parsed as CanvasDocument;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * Exports all FMI co-simulation wires and participating tiles from a CanvasDocument
 * into a standards-compliant SSP 1.0 `SystemStructureDescription` XML document.
 */
export function exportCanvasToSspXml(doc: CanvasDocument): string {
  const fmiWires = Object.values(doc.wires)
    .filter((w) => w.kind === "fmi-signal")
    .sort((a, b) => a.id.localeCompare(b.id));

  const participatingTileIds = new Set<string>();
  for (const w of fmiWires) {
    participatingTileIds.add(w.source.tileId);
    participatingTileIds.add(w.target.tileId);
  }
  // Also include any explicit FMU tiles even if unwired
  for (const tile of Object.values(doc.tiles)) {
    if (tile.archetype === "fmu") {
      participatingTileIds.add(tile.id);
    }
  }

  const componentsXml = [...participatingTileIds]
    .sort()
    .map((tileId) => {
      const tile = doc.tiles[tileId];
      if (!tile) return "";
      const connectors = (tile.pinnedAnchors ?? [])
        .filter((a) => a.kind === "fmi-input" || a.kind === "fmi-output" || a.kind === "parameter")
        .map((a) => {
          const kind = a.kind === "fmi-input" ? "input" : a.kind === "fmi-output" ? "output" : "parameter";
          const typeTag = a.dataType === "Integer" ? "Integer" : a.dataType === "Boolean" ? "Boolean" : "Real";
          const unitAttr = a.unit ? ` unit="${escapeXml(a.unit)}"` : "";
          return `          <ssc:Connector name="${escapeXml(a.path)}" kind="${kind}"><ssc:${typeTag}${unitAttr}/></ssc:Connector>`;
        })
        .join("\n");

      const mimeType =
        tile.archetype === "fmu" ? "application/x-fmu-sharedlibrary" : `application/x-modelscript-${tile.languageId}`;
      return [
        `      <ssd:Component name="${escapeXml(tile.id)}" type="${escapeXml(mimeType)}" source="${escapeXml(tile.artifactUri)}">`,
        `        <ssd:Connectors>`,
        connectors,
        `        </ssd:Connectors>`,
        `        <ssd:ElementGeometry x1="${tile.bounds.x}" y1="${tile.bounds.y}" x2="${tile.bounds.x + tile.bounds.width}" y2="${tile.bounds.y + tile.bounds.height}"/>`,
        `      </ssd:Component>`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .filter(Boolean)
    .join("\n");

  const connectionsXml = fmiWires
    .map(
      (w) =>
        `      <ssd:Connection startElement="${escapeXml(w.source.tileId)}" startConnector="${escapeXml(w.source.anchorPath)}" endElement="${escapeXml(w.target.tileId)}" endConnector="${escapeXml(w.target.anchorPath)}"/>`,
    )
    .join("\n");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<ssd:SystemStructureDescription xmlns:ssd="http://ssp-standard.org/SSP1/SystemStructureDescription" xmlns:ssc="http://ssp-standard.org/SSP1/SystemStructureCommon" version="1.0" name="${escapeXml(doc.name)}">`,
    `  <ssd:System name="${escapeXml(doc.id)}">`,
    `    <ssd:Elements>`,
    componentsXml,
    `    </ssd:Elements>`,
    `    <ssd:Connections>`,
    connectionsXml,
    `    </ssd:Connections>`,
    `  </ssd:System>`,
    `</ssd:SystemStructureDescription>`,
    "",
  ].join("\n");
}

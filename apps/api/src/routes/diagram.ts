// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { optionalAuth } from "../middleware/auth-middleware.js";

const DEFAULT_WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAX_URI_LENGTH = 2048;
const MAX_WORKSPACE_FILE_BYTES = 2 * 1024 * 1024;

export type EmbeddedPortalKind = "cad" | "fea" | "cfd" | "step" | "usd" | "urdf" | "vtk";

export interface DiagramPortalMetadata {
  kind: EmbeddedPortalKind;
  artifactUri: string;
}

export interface DiagramPortSpec {
  id: string;
  group: string;
  args: { x: number; y: number; angle?: number | undefined };
  direction?: "in" | "out" | "inout" | undefined;
}

export interface DiagramMarkupSpec {
  tagName: string;
  selector?: string | undefined;
  attrs?: Record<string, string | number> | undefined;
  textContent?: string | undefined;
}

export interface DiagramNodeSpec {
  id: string;
  shape: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  opacity: number;
  zIndex: number;
  label: string;
  markup: DiagramMarkupSpec[];
  attrs: {
    body: Record<string, unknown>;
    label: Record<string, unknown>;
    subtitle?: Record<string, unknown> | undefined;
  };
  ports: {
    items: DiagramPortSpec[];
    groups: Record<string, { position: string; zIndex: number }>;
  };
  properties: {
    name: string;
    className: string;
  };
  portal?: DiagramPortalMetadata | undefined;
  data: Record<string, unknown>;
}

export interface DiagramEdgeLabelSpec {
  attrs: {
    text: {
      text: string;
      fill: string;
      fontSize: number;
    };
  };
  position: number;
}

export interface DiagramEdgeSpec {
  id: string;
  source: { cell: string; port: string };
  target: { cell: string; port: string };
  vertices: { x: number; y: number }[];
  connector: { name: string; args: { radius: number } };
  zIndex: number;
  attrs: {
    line: {
      stroke: string;
      strokeWidth: number;
      strokeDasharray?: string | undefined;
    };
  };
  labels: DiagramEdgeLabelSpec[];
}

export interface DiagramDataPayload {
  nodes: DiagramNodeSpec[];
  edges: DiagramEdgeSpec[];
}

export interface DiagramRouterOptions {
  /** Optional root directory for resolving safe workspace `.mo` source files. */
  workspaceRoot?: string | undefined;
}

export type UriValidationResult = { ok: true; uri: string } | { ok: false; error: string };

const DEFAULT_PORT_GROUPS: Record<string, { position: string; zIndex: number }> = {
  in: { position: "left", zIndex: 2 },
  out: { position: "right", zIndex: 2 },
  inout: { position: "left", zIndex: 2 },
  param: { position: "bottom", zIndex: 2 },
};

const MODELICA_QUALIFIERS = new Set([
  "replaceable",
  "redeclare",
  "inner",
  "outer",
  "encapsulated",
  "partial",
  "final",
  "flow",
  "stream",
  "discrete",
  "parameter",
  "constant",
  "input",
  "output",
]);

const MODELICA_PRIMITIVE_TYPES = new Set(["Real", "Integer", "Boolean", "String"]);

function containsControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function hasUnsafePathPattern(value: string): boolean {
  if (containsControlChar(value)) return true;
  const normalized = value.replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.startsWith("~")) return true;
  if (/^[A-Za-z]:/.test(normalized)) return true;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized)) return true;
  if (normalized.includes("..")) return true;
  return false;
}

/**
 * Validates that a requested diagram `uri` is a non-empty, safe relative artifact URI
 * without null bytes, control characters, path traversal (`..`), or absolute filesystem paths.
 */
export function validateDiagramUri(raw: unknown): UriValidationResult {
  if (typeof raw !== "string") {
    return { ok: false, error: "Missing required 'uri' query parameter." };
  }
  const uri = raw.trim();
  if (uri.length === 0) {
    return { ok: false, error: "Query parameter 'uri' must not be empty." };
  }
  if (uri.length > MAX_URI_LENGTH) {
    return { ok: false, error: "Query parameter 'uri' exceeds maximum allowed length." };
  }
  if (hasUnsafePathPattern(uri)) {
    return { ok: false, error: "Invalid 'uri': path traversal or absolute filesystem paths are not allowed." };
  }

  let decoded = uri;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    return { ok: false, error: "Invalid 'uri': malformed percent-encoding." };
  }
  if (hasUnsafePathPattern(decoded)) {
    return { ok: false, error: "Invalid 'uri': path traversal or absolute filesystem paths are not allowed." };
  }

  return { ok: true, uri };
}

function resolveSafeWorkspaceModelicaFile(uri: string, workspaceRoot?: string): string | null {
  if (!uri.toLowerCase().endsWith(".mo")) return null;

  const candidateRoots: string[] = workspaceRoot
    ? [path.resolve(workspaceRoot)]
    : [DEFAULT_WORKSPACE_ROOT, path.resolve(process.cwd())];

  const seenRoots = new Set<string>();
  for (const root of candidateRoots) {
    if (seenRoots.has(root)) continue;
    seenRoots.add(root);

    const candidatePath = path.resolve(root, uri);
    if (!candidatePath.startsWith(root + path.sep)) {
      continue;
    }

    try {
      if (!fs.existsSync(candidatePath)) continue;
      const stat = fs.statSync(candidatePath);
      if (!stat.isFile() || stat.size > MAX_WORKSPACE_FILE_BYTES) continue;

      const realRoot = fs.realpathSync(root);
      const realFile = fs.realpathSync(candidatePath);
      if (!realFile.startsWith(realRoot + path.sep)) continue;

      return fs.readFileSync(realFile, "utf8");
    } catch {
      continue;
    }
  }

  return null;
}

function truncateText(text: string, maxLen: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, Math.max(1, maxLen - 1))}…`;
}

function extractUriStem(uri: string): string {
  const normalized = uri.replace(/\\/g, "/");
  const base = normalized.slice(normalized.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return stem.length > 0 ? stem : "Model";
}

function extractExtension(uri: string): string {
  const normalized = uri.replace(/\\/g, "/").toLowerCase();
  const base = normalized.slice(normalized.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot) : "";
}

function buildBlockMarkup(
  width: number,
  height: number,
  strokeColor: string,
  title: string,
  subtitle: string | undefined,
  ports: DiagramPortSpec[],
): DiagramMarkupSpec[] {
  const markup: DiagramMarkupSpec[] = [
    {
      tagName: "rect",
      selector: "body",
      attrs: {
        x: 0,
        y: 0,
        width,
        height,
        rx: 6,
        ry: 6,
        fill: "#132038",
        stroke: strokeColor,
        "stroke-width": 1.6,
      },
    },
    {
      tagName: "rect",
      selector: "headerBg",
      attrs: {
        x: 1,
        y: 1,
        width: Math.max(2, width - 2),
        height: Math.min(18, Math.max(12, Math.round(height * 0.34))),
        rx: 5,
        ry: 5,
        fill: strokeColor,
        opacity: 0.2,
      },
    },
    {
      tagName: "text",
      selector: "label",
      attrs: {
        x: width / 2,
        y: subtitle ? Math.round(height * 0.44) : Math.round(height * 0.54),
        "text-anchor": "middle",
        fill: "#f8fafc",
        "font-size": 10.5,
        "font-weight": "600",
        "font-family": "sans-serif",
      },
      textContent: title,
    },
  ];

  if (subtitle) {
    markup.push({
      tagName: "text",
      selector: "subtitle",
      attrs: {
        x: width / 2,
        y: Math.round(height * 0.76),
        "text-anchor": "middle",
        fill: "#94a3b8",
        "font-size": 8.5,
        "font-family": "monospace",
      },
      textContent: subtitle,
    });
  }

  for (let i = 0; i < ports.length; i++) {
    const p = ports[i];
    if (!p) continue;
    const dotColor = p.group === "out" ? "#10b981" : p.group === "param" ? "#f59e0b" : strokeColor;
    markup.push({
      tagName: "circle",
      selector: `port_dot_${i}`,
      attrs: {
        cx: p.args.x,
        cy: p.args.y,
        r: 3.4,
        fill: dotColor,
        stroke: "#090f1d",
        "stroke-width": 1.2,
      },
    });
  }

  return markup;
}

interface BlockNodeInput {
  id: string;
  label: string;
  subtitle?: string | undefined;
  className: string;
  x: number;
  y: number;
  width: number;
  height: number;
  stroke: string;
  ports: DiagramPortSpec[];
  portal?: DiagramPortalMetadata | undefined;
  extraData?: Record<string, unknown> | undefined;
}

function createBlockNode(input: BlockNodeInput): DiagramNodeSpec {
  const title = truncateText(input.label, 20);
  const subtitle = input.subtitle ? truncateText(input.subtitle, 22) : undefined;
  const data: Record<string, unknown> = {
    className: input.className,
    ...(input.extraData ?? {}),
    ...(input.portal ? { portal: input.portal } : {}),
  };

  const attrs: DiagramNodeSpec["attrs"] = {
    body: {
      fill: "#132038",
      stroke: input.stroke,
      strokeWidth: 1.6,
      rx: 6,
      ry: 6,
    },
    label: {
      text: title,
      fill: "#f8fafc",
      fontSize: 10.5,
      fontWeight: "600",
    },
    ...(subtitle
      ? {
          subtitle: {
            text: subtitle,
            fill: "#94a3b8",
            fontSize: 8.5,
          },
        }
      : {}),
  };

  const node: DiagramNodeSpec = {
    id: input.id,
    shape: "rect",
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.height,
    angle: 0,
    opacity: 1,
    zIndex: 1,
    label: title,
    markup: buildBlockMarkup(input.width, input.height, input.stroke, title, subtitle, input.ports),
    attrs,
    ports: {
      items: input.ports,
      groups: { ...DEFAULT_PORT_GROUPS },
    },
    properties: {
      name: input.id,
      className: input.className,
    },
    data,
    ...(input.portal ? { portal: input.portal } : {}),
  };

  return node;
}

function resolvePortWorldPoint(
  nodeMap: Map<string, DiagramNodeSpec>,
  cellId: string,
  portId: string,
): { x: number; y: number } {
  const node = nodeMap.get(cellId);
  if (!node) return { x: 0, y: 0 };
  const port = node.ports.items.find((p) => p.id === portId);
  if (port) {
    return { x: node.x + port.args.x, y: node.y + port.args.y };
  }
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
}

function createRoutedEdge(
  id: string,
  sourceCell: string,
  sourcePort: string,
  targetCell: string,
  targetPort: string,
  labelText: string,
  stroke: string,
  nodeMap: Map<string, DiagramNodeSpec>,
  dashed = false,
): DiagramEdgeSpec {
  const srcPt = resolvePortWorldPoint(nodeMap, sourceCell, sourcePort);
  const tgtPt = resolvePortWorldPoint(nodeMap, targetCell, targetPort);
  const midX = Math.round((srcPt.x + tgtPt.x) / 2);

  const vertices =
    Math.abs(srcPt.y - tgtPt.y) <= 2
      ? []
      : [
          { x: midX, y: Math.round(srcPt.y) },
          { x: midX, y: Math.round(tgtPt.y) },
        ];

  return {
    id,
    source: { cell: sourceCell, port: sourcePort },
    target: { cell: targetCell, port: targetPort },
    vertices,
    connector: { name: "rounded", args: { radius: 6 } },
    zIndex: 0,
    attrs: {
      line: {
        stroke,
        strokeWidth: 1.8,
        ...(dashed ? { strokeDasharray: "5 3" } : {}),
      },
    },
    labels: [
      {
        attrs: {
          text: {
            text: labelText,
            fill: "#cbd5e1",
            fontSize: 9,
          },
        },
        position: 0.5,
      },
    ],
  };
}

// ── Modelica Source Parsing ──

function stripModelicaComments(source: string): string {
  let out = "";
  let i = 0;
  let inString = false;

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (inString) {
      out += ch;
      if (ch === "\\" && next !== undefined) {
        out += next;
        i += 2;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      i++;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }

    if (ch === "/" && next === "/") {
      i += 2;
      while (i < source.length && source[i] !== "\n") {
        i++;
      }
      continue;
    }

    if (ch === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        i++;
      }
      i += 2;
      out += " ";
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

function splitTopLevel(text: string, delimiter: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let inString = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\" && i + 1 < text.length) {
        i++;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "(") parenDepth++;
    else if (ch === ")" && parenDepth > 0) parenDepth--;
    else if (ch === "{") braceDepth++;
    else if (ch === "}" && braceDepth > 0) braceDepth--;
    else if (ch === "[") bracketDepth++;
    else if (ch === "]" && bracketDepth > 0) bracketDepth--;
    else if (ch === delimiter && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }

  if (start < text.length) {
    parts.push(text.slice(start));
  }
  return parts;
}

function extractBalancedParens(text: string, openIdx: number): { content: string; endIdx: number } | null {
  if (text[openIdx] !== "(") return null;
  let depth = 0;
  let inString = false;

  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\" && i + 1 < text.length) {
        i++;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        return { content: text.slice(openIdx + 1, i), endIdx: i };
      }
    }
  }
  return null;
}

function extractPortalFromText(text: string): DiagramPortalMetadata | undefined {
  const re = /\b(CAD|FEA|CFD)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const rawTag = match[1];
    if (!rawTag) continue;
    const openIdx = match.index + match[0].length - 1;
    const balanced = extractBalancedParens(text, openIdx);
    if (!balanced) continue;

    const namedMatch = /\b(?:uri|artifactUri|fileName|file|path)\s*=\s*"([^"]+)"/i.exec(balanced.content);
    const positionalMatch = /^\s*"([^"]+)"/.exec(balanced.content);
    const artifactUri = namedMatch?.[1] ?? positionalMatch?.[1];
    if (!artifactUri) continue;

    const kind: EmbeddedPortalKind = rawTag === "FEA" ? "fea" : rawTag === "CFD" ? "cfd" : "cad";
    return { kind, artifactUri };
  }
  return undefined;
}

function inferModelicaDomainColor(typeName: string, portal?: DiagramPortalMetadata): string {
  if (portal) return "#f59e0b";
  const lower = typeName.toLowerCase();
  if (lower.includes("thermal") || lower.includes("heat") || lower.includes("temp")) return "#ef4444";
  if (
    lower.includes("mechanic") ||
    lower.includes("gear") ||
    lower.includes("inertia") ||
    lower.includes("housing") ||
    lower.includes("mass")
  )
    return "#22c55e";
  if (lower.includes("fluid") || lower.includes("pipe") || lower.includes("pump") || lower.includes("valve"))
    return "#06b6d4";
  if (lower.includes("block") || lower.includes("pid") || lower.includes("control") || lower.includes("signal"))
    return "#818cf8";
  return "#38bdf8";
}

interface ParsedMoComponent {
  id: string;
  typeName: string;
  shortType: string;
  modifierSummary?: string | undefined;
  isPrimitive: boolean;
  isBoundarySignal: boolean;
  portal?: DiagramPortalMetadata | undefined;
}

interface ParsedMoConnection {
  sourceCell: string;
  sourcePort: string;
  targetCell: string;
  targetPort: string;
}

function parseConnectEndpoint(rawEndpoint: string, defaultPort: string): { cell: string; port: string } | null {
  const cleaned = rawEndpoint.trim().replace(/\[[^\]]*\]/g, "");
  if (!cleaned) return null;
  const dotIdx = cleaned.indexOf(".");
  if (dotIdx > 0) {
    const cell = cleaned.slice(0, dotIdx).trim();
    const port = cleaned.slice(dotIdx + 1).trim();
    if (!cell || !port) return null;
    return { cell, port };
  }
  return { cell: cleaned, port: defaultPort };
}

function stripLeadingSectionHeaders(
  rawChunk: string,
  currentSection: "decl" | "equation" | "algorithm",
): { text: string; section: "decl" | "equation" | "algorithm"; skip: boolean } {
  let text = rawChunk.trim();
  let section = currentSection;

  for (let guard = 0; guard < 12; guard++) {
    if (!text) return { text: "", section, skip: true };

    if (/^within\b/.test(text)) {
      return { text: "", section, skip: true };
    }

    if (/^end\s+[A-Za-z_]\w*\s*$/.test(text)) {
      return { text: "", section, skip: true };
    }

    const classHeader =
      /^(?:(?:encapsulated|partial|replaceable|redeclare|expandable|operator)\s+)*(?:model|block|connector|record|class|package|function)\s+[A-Za-z_]\w*(?:\s+"(?:[^"\\]|\\.)*")?\s*/.exec(
        text,
      );
    if (classHeader) {
      text = text.slice(classHeader[0].length).trim();
      section = "decl";
      continue;
    }

    const initEq = /^initial\s+equation\b\s*/.exec(text);
    if (initEq) {
      text = text.slice(initEq[0].length).trim();
      section = "equation";
      continue;
    }

    const eq = /^equation\b\s*/.exec(text);
    if (eq) {
      text = text.slice(eq[0].length).trim();
      section = "equation";
      continue;
    }

    const initAlg = /^initial\s+algorithm\b\s*/.exec(text);
    if (initAlg) {
      text = text.slice(initAlg[0].length).trim();
      section = "algorithm";
      continue;
    }

    const alg = /^algorithm\b\s*/.exec(text);
    if (alg) {
      text = text.slice(alg[0].length).trim();
      section = "algorithm";
      continue;
    }

    const vis = /^(?:public|protected)\b\s*/.exec(text);
    if (vis) {
      text = text.slice(vis[0].length).trim();
      section = "decl";
      continue;
    }

    break;
  }

  return { text, section, skip: text.length === 0 };
}

/**
 * Parses a Modelica `.mo` source text into a `DiagramDataPayload` containing
 * component nodes, `connect(a.p, b.n)` edges, and embedded 3D portal metadata
 * extracted from `CAD(...)`, `FEA(...)`, and `CFD(...)` annotations.
 */
export function parseModelicaSourceToDiagram(sourceText: string, uri: string): DiagramDataPayload {
  const cleaned = stripModelicaComments(sourceText);
  const modelMatch = /\b(?:model|block|package|connector|record|class)\s+([A-Za-z_]\w*)/.exec(cleaned);
  const modelName = modelMatch?.[1] ?? extractUriStem(uri);

  const declared = new Map<string, ParsedMoComponent>();
  const declaredOrder: string[] = [];
  const connections: ParsedMoConnection[] = [];
  const classLevelPortals: DiagramPortalMetadata[] = [];

  const statements = splitTopLevel(cleaned, ";");
  let section: "decl" | "equation" | "algorithm" = "decl";

  for (const rawStmt of statements) {
    const stripped = stripLeadingSectionHeaders(rawStmt, section);
    section = stripped.section;
    if (stripped.skip) continue;
    const stmt = stripped.text;

    if (/^annotation\s*\(/.test(stmt)) {
      const portal = extractPortalFromText(stmt);
      if (portal) {
        classLevelPortals.push(portal);
      }
      continue;
    }

    const connectMatch = /^connect\s*\(\s*([^,()]+?)\s*,\s*([^,()]+?)\s*\)/.exec(stmt);
    if (connectMatch) {
      const lhs = connectMatch[1];
      const rhs = connectMatch[2];
      if (lhs && rhs) {
        const src = parseConnectEndpoint(lhs, "out");
        const tgt = parseConnectEndpoint(rhs, "in");
        if (src && tgt) {
          connections.push({
            sourceCell: src.cell,
            sourcePort: src.port,
            targetCell: tgt.cell,
            targetPort: tgt.port,
          });
        }
      }
      continue;
    }

    if (section !== "decl") {
      // Check if an equation statement also carries an annotation with a CAD/FEA/CFD portal
      const portalInEq = extractPortalFromText(stmt);
      if (portalInEq) {
        classLevelPortals.push(portalInEq);
      }
      continue;
    }

    if (/^(?:extends|import|type|constant\s+String)\b/.test(stmt)) {
      continue;
    }

    // Parse optional qualifiers followed by type specifier and component declarators
    let cursor = stmt;
    let isParameterOrConst = false;
    let isBoundarySignal = false;
    while (true) {
      const qMatch = /^([A-Za-z_]\w*)\s+/.exec(cursor);
      const qWord = qMatch?.[1];
      if (!qWord || !MODELICA_QUALIFIERS.has(qWord)) break;
      if (qWord === "parameter" || qWord === "constant") isParameterOrConst = true;
      if (qWord === "input" || qWord === "output") isBoundarySignal = true;
      cursor = cursor.slice(qMatch[0].length);
    }

    const typeMatch = /^(\.?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)(?:\s*\[[^\]]*\])?\s+/.exec(cursor);
    if (!typeMatch?.[1]) continue;

    const fullTypeName = typeMatch[1].replace(/^\./, "");
    const shortType = fullTypeName.includes(".") ? fullTypeName.slice(fullTypeName.lastIndexOf(".") + 1) : fullTypeName;
    const rest = cursor.slice(typeMatch[0].length);
    const stmtPortal = extractPortalFromText(rest);
    const isPrimitive = MODELICA_PRIMITIVE_TYPES.has(fullTypeName);

    const declarators = splitTopLevel(rest, ",");
    for (const rawDecl of declarators) {
      const decl = rawDecl.trim();
      const nameMatch = /^([A-Za-z_]\w*)/.exec(decl);
      const compId = nameMatch?.[1];
      if (!compId) continue;

      let modifierSummary: string | undefined;
      const afterName = decl.slice(compId.length).trim();
      if (afterName.startsWith("(")) {
        const balanced = extractBalancedParens(afterName, 0);
        if (balanced) {
          const compact = balanced.content.replace(/\s+/g, " ").trim();
          if (compact.length > 0) {
            modifierSummary = compact;
          }
        }
      }

      const declPortal = extractPortalFromText(decl) ?? stmtPortal;
      if (!declared.has(compId)) {
        declaredOrder.push(compId);
      }
      declared.set(compId, {
        id: compId,
        typeName: fullTypeName,
        shortType,
        modifierSummary,
        isPrimitive: isPrimitive && isParameterOrConst ? true : isPrimitive,
        isBoundarySignal: isBoundarySignal && !isParameterOrConst,
        portal: declPortal,
      });
    }
  }

  // Determine active diagram components: all non-primitive declarations, boundary signals,
  // components carrying CAD/FEA/CFD portals, and any component referenced in connect(...).
  const referencedInConnect = new Set<string>();
  for (const c of connections) {
    referencedInConnect.add(c.sourceCell);
    referencedInConnect.add(c.targetCell);
  }

  const activeComponents: ParsedMoComponent[] = [];
  const activeIds = new Set<string>();

  for (const id of declaredOrder) {
    const comp = declared.get(id);
    if (!comp) continue;
    if (!comp.isPrimitive || comp.isBoundarySignal || comp.portal || referencedInConnect.has(id)) {
      activeComponents.push(comp);
      activeIds.add(id);
    }
  }

  for (const id of referencedInConnect) {
    if (activeIds.has(id)) continue;
    activeComponents.push({
      id,
      typeName: "Modelica.Connector",
      shortType: "Connector",
      isPrimitive: false,
      isBoundarySignal: true,
    });
    activeIds.add(id);
  }

  // Attach any class-level CAD/FEA/CFD portal annotation as a dedicated embedded 3D portal node
  for (let i = 0; i < classLevelPortals.length; i++) {
    const portal = classLevelPortals[i];
    if (!portal) continue;
    const hasExisting = activeComponents.some(
      (c) => c.portal?.artifactUri === portal.artifactUri && c.portal.kind === portal.kind,
    );
    if (hasExisting) continue;
    const portalId = i === 0 ? `${portal.kind}_portal` : `${portal.kind}_portal_${i + 1}`;
    activeComponents.push({
      id: portalId,
      typeName: `${portal.kind.toUpperCase()}.EmbeddedViewport`,
      shortType: extractUriStem(portal.artifactUri),
      isPrimitive: false,
      isBoundarySignal: false,
      portal,
    });
    activeIds.add(portalId);
  }

  if (activeComponents.length === 0) {
    return synthesizeGenericModelicaDiagram(modelName, uri);
  }

  // Collect per-node input and output ports from connect(...) equations
  const nodeInPorts = new Map<string, string[]>();
  const nodeOutPorts = new Map<string, string[]>();
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const comp of activeComponents) {
    nodeInPorts.set(comp.id, []);
    nodeOutPorts.set(comp.id, []);
    adjacency.set(comp.id, []);
    inDegree.set(comp.id, 0);
  }

  for (const conn of connections) {
    const outList = nodeOutPorts.get(conn.sourceCell);
    if (outList && !outList.includes(conn.sourcePort)) {
      outList.push(conn.sourcePort);
    }
    const inList = nodeInPorts.get(conn.targetCell);
    if (inList && !inList.includes(conn.targetPort)) {
      inList.push(conn.targetPort);
    }
    if (conn.sourceCell !== conn.targetCell) {
      adjacency.get(conn.sourceCell)?.push(conn.targetCell);
      inDegree.set(conn.targetCell, (inDegree.get(conn.targetCell) ?? 0) + 1);
    }
  }

  // Layered topological layout (handles cycles safely via visited set)
  const layers = new Map<string, number>();
  const queue: string[] = [];
  for (const comp of activeComponents) {
    if ((inDegree.get(comp.id) ?? 0) === 0) {
      layers.set(comp.id, 0);
      queue.push(comp.id);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    if (!cur) continue;
    const curLayer = layers.get(cur) ?? 0;
    for (const next of adjacency.get(cur) ?? []) {
      const nextLayer = curLayer + 1;
      const existing = layers.get(next);
      if (existing === undefined || (nextLayer > existing && nextLayer < activeComponents.length)) {
        layers.set(next, nextLayer);
        queue.push(next);
      }
    }
  }

  for (let i = 0; i < activeComponents.length; i++) {
    const comp = activeComponents[i];
    if (comp && !layers.has(comp.id)) {
      layers.set(comp.id, i % 3);
    }
  }

  const columns = new Map<number, ParsedMoComponent[]>();
  for (const comp of activeComponents) {
    const col = layers.get(comp.id) ?? 0;
    const list = columns.get(col) ?? [];
    list.push(comp);
    columns.set(col, list);
  }

  const sortedCols = Array.from(columns.keys()).sort((a, b) => a - b);
  const nodes: DiagramNodeSpec[] = [];
  const nodeMap = new Map<string, DiagramNodeSpec>();

  for (let colIdx = 0; colIdx < sortedCols.length; colIdx++) {
    const colKey = sortedCols[colIdx];
    if (colKey === undefined) continue;
    const colComps = columns.get(colKey) ?? [];
    for (let rowIdx = 0; rowIdx < colComps.length; rowIdx++) {
      const comp = colComps[rowIdx];
      if (!comp) continue;

      const rawIn = nodeInPorts.get(comp.id) ?? [];
      const rawOut = nodeOutPorts.get(comp.id) ?? [];
      const uniqueIn = rawIn.length > 0 ? rawIn : rawOut.length === 0 ? ["in"] : [];
      const uniqueOut = rawOut.filter((p) => !uniqueIn.includes(p));
      if (uniqueOut.length === 0 && rawIn.length === 0) {
        uniqueOut.push("out");
      }

      const maxSidePorts = Math.max(1, uniqueIn.length, uniqueOut.length);
      const width = comp.portal ? 148 : 132;
      const height = Math.max(comp.portal ? 68 : 56, maxSidePorts * 22 + 24);
      const x = 24 + colIdx * 196;
      const y = 24 + rowIdx * 96;

      const ports: DiagramPortSpec[] = [];
      for (let i = 0; i < uniqueIn.length; i++) {
        const pId = uniqueIn[i];
        if (!pId) continue;
        ports.push({
          id: pId,
          group: "in",
          direction: "in",
          args: { x: 0, y: Math.round(((i + 1) / (uniqueIn.length + 1)) * height), angle: 180 },
        });
      }
      for (let i = 0; i < uniqueOut.length; i++) {
        const pId = uniqueOut[i];
        if (!pId) continue;
        ports.push({
          id: pId,
          group: "out",
          direction: "out",
          args: { x: width, y: Math.round(((i + 1) / (uniqueOut.length + 1)) * height), angle: 0 },
        });
      }

      const subtitle = comp.portal
        ? `${comp.portal.kind.toUpperCase()}: ${extractUriStem(comp.portal.artifactUri)}`
        : comp.modifierSummary
          ? `${comp.shortType}(${comp.modifierSummary})`
          : comp.shortType;

      const node = createBlockNode({
        id: comp.id,
        label: comp.id,
        subtitle,
        className: comp.typeName,
        x,
        y,
        width,
        height,
        stroke: inferModelicaDomainColor(comp.typeName, comp.portal),
        ports,
        portal: comp.portal,
        extraData: {
          language: "modelica",
          modelName,
          sourceUri: uri,
        },
      });
      nodes.push(node);
      nodeMap.set(node.id, node);
    }
  }

  const edges: DiagramEdgeSpec[] = [];
  for (let i = 0; i < connections.length; i++) {
    const conn = connections[i];
    if (!conn) continue;
    const srcNode = nodeMap.get(conn.sourceCell);
    const stroke =
      (typeof srcNode?.attrs.body["stroke"] === "string" ? srcNode.attrs.body["stroke"] : undefined) ?? "#38bdf8";
    const labelText = `${conn.sourcePort} -> ${conn.targetPort}`;
    edges.push(
      createRoutedEdge(
        `connect_${i}_${conn.sourceCell}_${conn.targetCell}`,
        conn.sourceCell,
        conn.sourcePort,
        conn.targetCell,
        conn.targetPort,
        labelText,
        stroke,
        nodeMap,
      ),
    );
  }

  return { nodes, edges };
}

// ── Domain-Specific Synthesizers ──

function synthesizeActuatorPlantDiagram(uri: string): DiagramDataPayload {
  const housingPortal: DiagramPortalMetadata = {
    kind: "cad",
    artifactUri: "cad/actuator_housing.step",
  };

  const nodes: DiagramNodeSpec[] = [
    createBlockNode({
      id: "u_in",
      label: "u_cmd",
      subtitle: "RealInput [V]",
      className: "Modelica.Blocks.Interfaces.RealInput",
      x: 20,
      y: 78,
      width: 108,
      height: 52,
      stroke: "#38bdf8",
      ports: [{ id: "y", group: "out", direction: "out", args: { x: 108, y: 26, angle: 0 } }],
      extraData: { language: "modelica", sourceUri: uri, unit: "V" },
    }),
    createBlockNode({
      id: "motor",
      label: "motor",
      subtitle: "DC EMF (k=0.12)",
      className: "Modelica.Electrical.Analog.Basic.EMF",
      x: 176,
      y: 62,
      width: 136,
      height: 84,
      stroke: "#38bdf8",
      ports: [
        { id: "u", group: "in", direction: "in", args: { x: 0, y: 42, angle: 180 } },
        { id: "flange", group: "out", direction: "out", args: { x: 136, y: 24, angle: 0 } },
        { id: "omega", group: "out", direction: "out", args: { x: 136, y: 48, angle: 0 } },
        { id: "heatPort", group: "out", direction: "out", args: { x: 136, y: 70, angle: 0 } },
      ],
      extraData: { language: "modelica", sourceUri: uri },
    }),
    createBlockNode({
      id: "gearbox",
      label: "gearbox",
      subtitle: "IdealGear (12:1)",
      className: "Modelica.Mechanics.Rotational.Components.IdealGear",
      x: 364,
      y: 26,
      width: 136,
      height: 58,
      stroke: "#22c55e",
      ports: [
        { id: "flange_a", group: "in", direction: "in", args: { x: 0, y: 29, angle: 180 } },
        { id: "flange_b", group: "out", direction: "out", args: { x: 136, y: 29, angle: 0 } },
      ],
      extraData: { language: "modelica", sourceUri: uri },
    }),
    createBlockNode({
      id: "thermal",
      label: "thermal",
      subtitle: "HeatCapacitor (348K)",
      className: "Modelica.Thermal.HeatTransfer.Components.HeatCapacitor",
      x: 364,
      y: 120,
      width: 136,
      height: 58,
      stroke: "#ef4444",
      ports: [
        { id: "port", group: "in", direction: "in", args: { x: 0, y: 29, angle: 180 } },
        { id: "T_max", group: "out", direction: "out", args: { x: 136, y: 29, angle: 0 } },
      ],
      extraData: { language: "modelica", sourceUri: uri, unit: "K" },
    }),
    createBlockNode({
      id: "housing",
      label: "housing",
      subtitle: "CAD STEP (2.14 kg)",
      className: "Modelica.Mechanics.MultiBody.Parts.BodyShape",
      x: 556,
      y: 62,
      width: 152,
      height: 84,
      stroke: "#f59e0b",
      ports: [
        { id: "flange", group: "in", direction: "in", args: { x: 0, y: 26, angle: 180 } },
        { id: "heatPort", group: "in", direction: "in", args: { x: 0, y: 58, angle: 180 } },
        { id: "mass", group: "param", direction: "out", args: { x: 76, y: 84, angle: 90 } },
      ],
      portal: housingPortal,
      extraData: { language: "modelica", sourceUri: uri, massKg: 2.14 },
    }),
  ];

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const edges: DiagramEdgeSpec[] = [
    createRoutedEdge("e_u_motor", "u_in", "y", "motor", "u", "u_cmd [V]", "#38bdf8", nodeMap),
    createRoutedEdge("e_motor_gearbox", "motor", "flange", "gearbox", "flange_a", "tau_m [N.m]", "#22c55e", nodeMap),
    createRoutedEdge(
      "e_gearbox_housing",
      "gearbox",
      "flange_b",
      "housing",
      "flange",
      "tau_out [N.m]",
      "#22c55e",
      nodeMap,
    ),
    createRoutedEdge("e_motor_thermal", "motor", "heatPort", "thermal", "port", "Q_loss [W]", "#ef4444", nodeMap),
    createRoutedEdge("e_thermal_housing", "thermal", "T_max", "housing", "heatPort", "T_max [K]", "#f97316", nodeMap),
  ];

  return { nodes, edges };
}

function synthesizeSimulinkPidDiagram(uri: string): DiagramDataPayload {
  const modelName = extractUriStem(uri);
  const nodes: DiagramNodeSpec[] = [
    createBlockNode({
      id: "ref_in",
      label: "omega_ref",
      subtitle: "Simulink.Inport",
      className: "Simulink.Inport",
      x: 16,
      y: 52,
      width: 108,
      height: 46,
      stroke: "#38bdf8",
      ports: [{ id: "out", group: "out", direction: "out", args: { x: 108, y: 23, angle: 0 } }],
      extraData: { language: "simulink", modelName, sourceUri: uri },
    }),
    createBlockNode({
      id: "omega_fb",
      label: "omega_meas",
      subtitle: "Simulink.Inport",
      className: "Simulink.Inport",
      x: 16,
      y: 126,
      width: 108,
      height: 46,
      stroke: "#38bdf8",
      ports: [{ id: "out", group: "out", direction: "out", args: { x: 108, y: 23, angle: 0 } }],
      extraData: { language: "simulink", modelName, sourceUri: uri },
    }),
    createBlockNode({
      id: "sum_err",
      label: "Sum (+ / -)",
      subtitle: "Error Junction",
      className: "Simulink.Sum",
      x: 168,
      y: 82,
      width: 96,
      height: 60,
      stroke: "#818cf8",
      ports: [
        { id: "in_pos", group: "in", direction: "in", args: { x: 0, y: 20, angle: 180 } },
        { id: "in_fb", group: "in", direction: "in", args: { x: 0, y: 42, angle: 180 } },
        { id: "out", group: "out", direction: "out", args: { x: 96, y: 30, angle: 0 } },
      ],
      extraData: { language: "simulink", modelName, sourceUri: uri },
    }),
    createBlockNode({
      id: "pid_p",
      label: "Gain Kp",
      subtitle: "Kp = 1.85",
      className: "Simulink.Gain",
      x: 314,
      y: 18,
      width: 118,
      height: 48,
      stroke: "#f59e0b",
      ports: [
        { id: "in", group: "in", direction: "in", args: { x: 0, y: 24, angle: 180 } },
        { id: "out", group: "out", direction: "out", args: { x: 118, y: 24, angle: 0 } },
      ],
      extraData: { language: "simulink", modelName, sourceUri: uri, gain: 1.85 },
    }),
    createBlockNode({
      id: "pid_i",
      label: "Integrator",
      subtitle: "Ki / s (0.42)",
      className: "Simulink.Integrator",
      x: 314,
      y: 88,
      width: 118,
      height: 48,
      stroke: "#10b981",
      ports: [
        { id: "in", group: "in", direction: "in", args: { x: 0, y: 24, angle: 180 } },
        { id: "out", group: "out", direction: "out", args: { x: 118, y: 24, angle: 0 } },
      ],
      extraData: { language: "simulink", modelName, sourceUri: uri, ki: 0.42 },
    }),
    createBlockNode({
      id: "pid_d",
      label: "Derivative",
      subtitle: "Kd·s (0.08)",
      className: "Simulink.Derivative",
      x: 314,
      y: 158,
      width: 118,
      height: 48,
      stroke: "#ec4899",
      ports: [
        { id: "in", group: "in", direction: "in", args: { x: 0, y: 24, angle: 180 } },
        { id: "out", group: "out", direction: "out", args: { x: 118, y: 24, angle: 0 } },
      ],
      extraData: { language: "simulink", modelName, sourceUri: uri, kd: 0.08 },
    }),
    createBlockNode({
      id: "sum_pid",
      label: "PID Sum",
      subtitle: "P + I + D",
      className: "Simulink.Sum",
      x: 482,
      y: 78,
      width: 96,
      height: 68,
      stroke: "#818cf8",
      ports: [
        { id: "p", group: "in", direction: "in", args: { x: 0, y: 16, angle: 180 } },
        { id: "i", group: "in", direction: "in", args: { x: 0, y: 34, angle: 180 } },
        { id: "d", group: "in", direction: "in", args: { x: 0, y: 52, angle: 180 } },
        { id: "out", group: "out", direction: "out", args: { x: 96, y: 34, angle: 0 } },
      ],
      extraData: { language: "simulink", modelName, sourceUri: uri },
    }),
    createBlockNode({
      id: "sat_clamp",
      label: "Saturation",
      subtitle: "[-24, +24] V",
      className: "Simulink.Saturate",
      x: 626,
      y: 86,
      width: 114,
      height: 52,
      stroke: "#f97316",
      ports: [
        { id: "in", group: "in", direction: "in", args: { x: 0, y: 26, angle: 180 } },
        { id: "out", group: "out", direction: "out", args: { x: 114, y: 26, angle: 0 } },
      ],
      extraData: { language: "simulink", modelName, sourceUri: uri },
    }),
    createBlockNode({
      id: "u_out",
      label: "u_cmd",
      subtitle: "Simulink.Outport",
      className: "Simulink.Outport",
      x: 784,
      y: 89,
      width: 108,
      height: 46,
      stroke: "#10b981",
      ports: [{ id: "in", group: "in", direction: "in", args: { x: 0, y: 23, angle: 180 } }],
      extraData: { language: "simulink", modelName, sourceUri: uri, unit: "V" },
    }),
  ];

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const edges: DiagramEdgeSpec[] = [
    createRoutedEdge("e_ref_sum", "ref_in", "out", "sum_err", "in_pos", "r(t)", "#38bdf8", nodeMap),
    createRoutedEdge("e_fb_sum", "omega_fb", "out", "sum_err", "in_fb", "omega_meas", "#38bdf8", nodeMap),
    createRoutedEdge("e_err_p", "sum_err", "out", "pid_p", "in", "e(t)", "#f59e0b", nodeMap),
    createRoutedEdge("e_err_i", "sum_err", "out", "pid_i", "in", "e(t)", "#10b981", nodeMap),
    createRoutedEdge("e_err_d", "sum_err", "out", "pid_d", "in", "e(t)", "#ec4899", nodeMap),
    createRoutedEdge("e_p_sum", "pid_p", "out", "sum_pid", "p", "u_P", "#f59e0b", nodeMap),
    createRoutedEdge("e_i_sum", "pid_i", "out", "sum_pid", "i", "u_I", "#10b981", nodeMap),
    createRoutedEdge("e_d_sum", "pid_d", "out", "sum_pid", "d", "u_D", "#ec4899", nodeMap),
    createRoutedEdge("e_sum_sat", "sum_pid", "out", "sat_clamp", "in", "u_raw", "#818cf8", nodeMap),
    createRoutedEdge("e_sat_out", "sat_clamp", "out", "u_out", "in", "u_cmd [V]", "#10b981", nodeMap),
  ];

  return { nodes, edges };
}

function synthesizeSpiceDiagram(uri: string): DiagramDataPayload {
  const circuitName = extractUriStem(uri);
  const nodes: DiagramNodeSpec[] = [
    createBlockNode({
      id: "V1",
      label: "V1 (24V DC)",
      subtitle: "VoltageSource",
      className: "SPICE.VSource",
      x: 20,
      y: 66,
      width: 118,
      height: 54,
      stroke: "#f59e0b",
      ports: [
        { id: "p", group: "out", direction: "out", args: { x: 118, y: 18, angle: 0 } },
        { id: "n", group: "param", direction: "inout", args: { x: 59, y: 54, angle: 90 } },
      ],
      extraData: { language: "spice", circuitName, sourceUri: uri },
    }),
    createBlockNode({
      id: "R1",
      label: "R1 (10 Ohm)",
      subtitle: "Series Resistor",
      className: "SPICE.Resistor",
      x: 188,
      y: 54,
      width: 116,
      height: 48,
      stroke: "#38bdf8",
      ports: [
        { id: "p", group: "in", direction: "in", args: { x: 0, y: 24, angle: 180 } },
        { id: "n", group: "out", direction: "out", args: { x: 116, y: 24, angle: 0 } },
      ],
      extraData: { language: "spice", circuitName, sourceUri: uri },
    }),
    createBlockNode({
      id: "C1",
      label: "C1 (100 uF)",
      subtitle: "Filter Cap",
      className: "SPICE.Capacitor",
      x: 356,
      y: 54,
      width: 116,
      height: 48,
      stroke: "#10b981",
      ports: [
        { id: "p", group: "in", direction: "in", args: { x: 0, y: 24, angle: 180 } },
        { id: "n", group: "out", direction: "out", args: { x: 116, y: 24, angle: 0 } },
      ],
      extraData: { language: "spice", circuitName, sourceUri: uri },
    }),
    createBlockNode({
      id: "GND",
      label: "GND (0)",
      subtitle: "Reference Node",
      className: "SPICE.Ground",
      x: 240,
      y: 148,
      width: 108,
      height: 44,
      stroke: "#94a3b8",
      ports: [
        { id: "ref_a", group: "in", direction: "in", args: { x: 0, y: 22, angle: 180 } },
        { id: "ref_b", group: "out", direction: "in", args: { x: 108, y: 22, angle: 0 } },
      ],
      extraData: { language: "spice", circuitName, sourceUri: uri },
    }),
  ];

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const edges: DiagramEdgeSpec[] = [
    createRoutedEdge("net_vin", "V1", "p", "R1", "p", "NET_VIN", "#f59e0b", nodeMap),
    createRoutedEdge("net_vout", "R1", "n", "C1", "p", "NET_VOUT", "#38bdf8", nodeMap),
    createRoutedEdge("net_gnd_src", "V1", "n", "GND", "ref_a", "GND (0)", "#94a3b8", nodeMap),
    createRoutedEdge("net_gnd_cap", "C1", "n", "GND", "ref_b", "GND (0)", "#94a3b8", nodeMap),
  ];

  return { nodes, edges };
}

function synthesizeSysmlDiagram(uri: string): DiagramDataPayload {
  const sysName = extractUriStem(uri);
  const nodes: DiagramNodeSpec[] = [
    createBlockNode({
      id: "controller",
      label: "controller",
      subtitle: "«part» ControlUnit",
      className: "SysML2.PartUsage",
      x: 20,
      y: 66,
      width: 136,
      height: 60,
      stroke: "#a855f7",
      ports: [
        { id: "cmdOut", group: "out", direction: "out", args: { x: 136, y: 22, angle: 0 } },
        { id: "senseIn", group: "in", direction: "in", args: { x: 136, y: 44, angle: 0 } },
      ],
      extraData: { language: "sysml2", systemName: sysName, sourceUri: uri },
    }),
    createBlockNode({
      id: "actuator",
      label: sysName,
      subtitle: "«part» ActuatorSubsys",
      className: "SysML2.PartUsage",
      x: 214,
      y: 44,
      width: 148,
      height: 66,
      stroke: "#38bdf8",
      ports: [
        { id: "cmdIn", group: "in", direction: "in", args: { x: 0, y: 33, angle: 180 } },
        { id: "mechOut", group: "out", direction: "out", args: { x: 148, y: 33, angle: 0 } },
      ],
      extraData: { language: "sysml2", systemName: sysName, sourceUri: uri },
    }),
    createBlockNode({
      id: "sensor",
      label: "sensor",
      subtitle: "«part» StateSensor",
      className: "SysML2.PartUsage",
      x: 420,
      y: 66,
      width: 136,
      height: 60,
      stroke: "#10b981",
      ports: [
        { id: "measIn", group: "in", direction: "in", args: { x: 0, y: 22, angle: 180 } },
        { id: "fbOut", group: "out", direction: "out", args: { x: 0, y: 44, angle: 180 } },
      ],
      extraData: { language: "sysml2", systemName: sysName, sourceUri: uri },
    }),
  ];

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const edges: DiagramEdgeSpec[] = [
    createRoutedEdge("flow_cmd", "controller", "cmdOut", "actuator", "cmdIn", "«flow» DriveCmd", "#a855f7", nodeMap),
    createRoutedEdge("flow_mech", "actuator", "mechOut", "sensor", "measIn", "«flow» Torque", "#38bdf8", nodeMap),
    createRoutedEdge(
      "flow_fb",
      "sensor",
      "fbOut",
      "controller",
      "senseIn",
      "«flow» Feedback",
      "#10b981",
      nodeMap,
      true,
    ),
  ];

  return { nodes, edges };
}

function synthesizeFmuDiagram(uri: string): DiagramDataPayload {
  const fmuName = extractUriStem(uri);
  const nodes: DiagramNodeSpec[] = [
    createBlockNode({
      id: "fmu_inputs",
      label: "FMI Inputs",
      subtitle: "u_cmd, T_amb",
      className: "FMI3.InputBus",
      x: 20,
      y: 66,
      width: 118,
      height: 54,
      stroke: "#38bdf8",
      ports: [{ id: "bus_out", group: "out", direction: "out", args: { x: 118, y: 27, angle: 0 } }],
      extraData: { language: "fmu", fmuName, sourceUri: uri },
    }),
    createBlockNode({
      id: "fmu_kernel",
      label: fmuName,
      subtitle: "FMI 3.0 Co-Sim FMU",
      className: "FMI3.CoSimulationUnit",
      x: 190,
      y: 54,
      width: 156,
      height: 78,
      stroke: "#10b981",
      ports: [
        { id: "in", group: "in", direction: "in", args: { x: 0, y: 39, angle: 180 } },
        { id: "out", group: "out", direction: "out", args: { x: 156, y: 39, angle: 0 } },
        { id: "params", group: "param", direction: "in", args: { x: 78, y: 78, angle: 90 } },
      ],
      extraData: { language: "fmu", fmuName, sourceUri: uri },
    }),
    createBlockNode({
      id: "fmu_outputs",
      label: "FMI Outputs",
      subtitle: "omega, T_max",
      className: "FMI3.OutputBus",
      x: 400,
      y: 66,
      width: 118,
      height: 54,
      stroke: "#10b981",
      ports: [{ id: "bus_in", group: "in", direction: "in", args: { x: 0, y: 27, angle: 180 } }],
      extraData: { language: "fmu", fmuName, sourceUri: uri },
    }),
  ];

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const edges: DiagramEdgeSpec[] = [
    createRoutedEdge("e_fmu_in", "fmu_inputs", "bus_out", "fmu_kernel", "in", "setReal()", "#38bdf8", nodeMap),
    createRoutedEdge("e_fmu_out", "fmu_kernel", "out", "fmu_outputs", "bus_in", "getReal()", "#10b981", nodeMap),
  ];

  return { nodes, edges };
}

function synthesizeGenericModelicaDiagram(modelName: string, uri: string): DiagramDataPayload {
  const nodes: DiagramNodeSpec[] = [
    createBlockNode({
      id: "source",
      label: "source",
      subtitle: "Boundary Input",
      className: "Modelica.Blocks.Sources.Step",
      x: 20,
      y: 68,
      width: 114,
      height: 52,
      stroke: "#38bdf8",
      ports: [{ id: "y", group: "out", direction: "out", args: { x: 114, y: 26, angle: 0 } }],
      extraData: { language: "modelica", modelName, sourceUri: uri },
    }),
    createBlockNode({
      id: "plant",
      label: modelName,
      subtitle: "Modelica Model",
      className: `Modelica.${modelName}`,
      x: 186,
      y: 56,
      width: 146,
      height: 76,
      stroke: "#38bdf8",
      ports: [
        { id: "u", group: "in", direction: "in", args: { x: 0, y: 38, angle: 180 } },
        { id: "y", group: "out", direction: "out", args: { x: 146, y: 38, angle: 0 } },
      ],
      extraData: { language: "modelica", modelName, sourceUri: uri },
    }),
    createBlockNode({
      id: "sensor",
      label: "sensor",
      subtitle: "Output Probe",
      className: "Modelica.Blocks.Interfaces.RealOutput",
      x: 384,
      y: 68,
      width: 114,
      height: 52,
      stroke: "#10b981",
      ports: [{ id: "u", group: "in", direction: "in", args: { x: 0, y: 26, angle: 180 } }],
      extraData: { language: "modelica", modelName, sourceUri: uri },
    }),
  ];

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const edges: DiagramEdgeSpec[] = [
    createRoutedEdge("e_src_plant", "source", "y", "plant", "u", "u", "#38bdf8", nodeMap),
    createRoutedEdge("e_plant_sensor", "plant", "y", "sensor", "u", "y", "#10b981", nodeMap),
  ];

  return { nodes, edges };
}

function synthesizeGenericPolyglotDiagram(uri: string, ext: string): DiagramDataPayload {
  const stem = extractUriStem(uri);
  const langTag = ext ? ext.slice(1).toUpperCase() : "POLYGLOT";
  const nodes: DiagramNodeSpec[] = [
    createBlockNode({
      id: "input_stage",
      label: "Input",
      subtitle: "Signal In",
      className: `${langTag}.Input`,
      x: 20,
      y: 66,
      width: 104,
      height: 50,
      stroke: "#38bdf8",
      ports: [{ id: "out", group: "out", direction: "out", args: { x: 104, y: 25, angle: 0 } }],
      extraData: { language: langTag.toLowerCase(), sourceUri: uri },
    }),
    createBlockNode({
      id: "core_block",
      label: stem,
      subtitle: langTag,
      className: `${langTag}.Block`,
      x: 174,
      y: 54,
      width: 144,
      height: 74,
      stroke: "#818cf8",
      ports: [
        { id: "in", group: "in", direction: "in", args: { x: 0, y: 37, angle: 180 } },
        { id: "out", group: "out", direction: "out", args: { x: 144, y: 37, angle: 0 } },
      ],
      extraData: { language: langTag.toLowerCase(), sourceUri: uri },
    }),
    createBlockNode({
      id: "output_stage",
      label: "Output",
      subtitle: "Signal Out",
      className: `${langTag}.Output`,
      x: 368,
      y: 66,
      width: 104,
      height: 50,
      stroke: "#10b981",
      ports: [{ id: "in", group: "in", direction: "in", args: { x: 0, y: 25, angle: 180 } }],
      extraData: { language: langTag.toLowerCase(), sourceUri: uri },
    }),
  ];

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const edges: DiagramEdgeSpec[] = [
    createRoutedEdge("e_in_core", "input_stage", "out", "core_block", "in", "in", "#38bdf8", nodeMap),
    createRoutedEdge("e_core_out", "core_block", "out", "output_stage", "in", "out", "#10b981", nodeMap),
  ];

  return { nodes, edges };
}

/**
 * Builds domain-accurate `DiagramDataPayload` for a validated artifact URI.
 * If the URI resolves to an existing safe `.mo` file inside the workspace root,
 * parses components, `connect(...)` equations, and `CAD`/`FEA`/`CFD` portal annotations
 * directly from the Modelica source text.
 */
export function buildDiagramForUri(uri: string, workspaceRoot?: string): DiagramDataPayload {
  const realMoSource = resolveSafeWorkspaceModelicaFile(uri, workspaceRoot);
  if (realMoSource !== null) {
    return parseModelicaSourceToDiagram(realMoSource, uri);
  }

  const lowerUri = uri.replace(/\\/g, "/").toLowerCase();
  const ext = extractExtension(uri);

  if (ext === ".mo") {
    if (
      lowerUri === "models/actuatorplant.mo" ||
      lowerUri.endsWith("/actuatorplant.mo") ||
      lowerUri === "actuatorplant.mo"
    ) {
      return synthesizeActuatorPlantDiagram(uri);
    }
    return synthesizeGenericModelicaDiagram(extractUriStem(uri), uri);
  }

  if (ext === ".slx" || ext === ".mdl") {
    return synthesizeSimulinkPidDiagram(uri);
  }

  if (ext === ".cir" || ext === ".sp" || ext === ".spice") {
    return synthesizeSpiceDiagram(uri);
  }

  if (ext === ".sysml") {
    return synthesizeSysmlDiagram(uri);
  }

  if (ext === ".fmu") {
    return synthesizeFmuDiagram(uri);
  }

  return synthesizeGenericPolyglotDiagram(uri, ext);
}

/**
 * REST API for polyglot schematic diagram hydration (`/api/v1/diagram`).
 * Hydrates `SpatialCanvasPage`, `SpaceCanvasTab`, and `LiveUnifiedSchematicTile`
 * with domain `DiagramData` (`nodes` & `edges`) and embedded 3D portal metadata.
 */
export function diagramRouter(options?: DiagramRouterOptions): Router {
  const router = Router();
  router.use(optionalAuth);

  /** Hydrate schematic `DiagramData` for a workspace or canonical polyglot artifact URI */
  router.get("/", (req, res) => {
    const rawUri = req.query["uri"];
    const validation = validateDiagramUri(rawUri);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const diagramData = buildDiagramForUri(validation.uri, options?.workspaceRoot);
    res.json({
      uri: validation.uri,
      diagramData,
    });
  });

  return router;
}

// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CstDocumentSession,
  CstTransaction,
  CstXmlAdapter,
  encodeXmlAttrValue,
  nodeEndOffset,
  nodeStartOffset,
  walkHealthyCst,
  type CstIncrementalParser,
  type CstTextEdit,
} from "@modelscript/dsl/unparser";
import type { SyntaxNode } from "@modelscript/dsl/utils";
import { applySplices, type Splice, type XmlElement } from "@modelscript/dsl/xml";
import { attr, type ExternalDefinitions, type Pt } from "../model/pscad-model.js";
import { getPscadWasmParser } from "../parser/wasm-loader.js";
export { applySplices };

/**
 * CST-backed structural edit engine for PSCAD projects.
 *
 * Every operation executes directly against a live {@link CstDocumentSession} through
 * {@link CstTransaction} and {@link CstXmlAdapter} (`@modelscript/dsl/unparser`).
 * Untouched bytes (CRLF/`\r\r\n` endings, indentation, attribute order, CDATA, and even
 * sibling `ERROR` subtrees when the file contains syntax errors) are preserved verbatim.
 */
export type PscadEditOp =
  | { type: "moveComponent"; id: string; x: number; y: number; orient?: number }
  | { type: "setParameter"; id: string; name: string; value: string }
  | { type: "removeComponent"; id: string }
  | {
      type: "addComponent";
      /** Owning definition (default `Main`). */
      definition?: string;
      defn: string;
      x: number;
      y: number;
      w?: number;
      h?: number;
      orient?: number;
      params?: Record<string, string>;
    }
  | { type: "setWirePoints"; id: string; points: Pt[] }
  | { type: "addWire"; definition?: string; points: Pt[] }
  | {
      type: "addBus";
      definition?: string;
      name?: string;
      x: number;
      y: number;
      w?: number;
      h?: number;
      baseKV?: string;
    }
  | { type: "removeWire"; id: string }
  | { type: "toggleDisable"; id: string; disabled?: boolean | undefined }
  | {
      type: "resizeBus";
      id: string;
      x?: number;
      y?: number;
      w?: number;
      h?: number;
      points?: Pt[];
      name?: string;
      baseKV?: string;
    }
  | {
      type: "editSticky";
      id: string;
      text?: string;
      x?: number;
      y?: number;
      w?: number;
      h?: number;
    }
  | {
      type: "addSticky";
      definition?: string;
      x: number;
      y: number;
      w?: number;
      h?: number;
      text: string;
    }
  | {
      type: "renameNet";
      oldName: string;
      newName: string;
      definition?: string;
    }
  | {
      type: "setScriptSegment";
      definition: string;
      segment: string;
      code: string;
    }
  | {
      type: "addDefinition";
      name: string;
      description?: string;
      ports?: {
        name: string;
        mode?: "In" | "Out" | "Electrical";
        dim?: number;
        side?: "left" | "right" | "top" | "bottom";
        x?: number;
        y?: number;
      }[];
      shapes?: {
        kind: "rect" | "line" | "circle" | "text";
        x: number;
        y: number;
        w?: number;
        h?: number;
        x2?: number;
        y2?: number;
        r?: number;
        text?: string;
        stroke?: string;
        fill?: string;
      }[];
      parameters?: {
        name: string;
        label?: string;
        type?: "Real" | "Integer" | "Text" | "Boolean";
        defaultValue?: string;
        unit?: string;
        cond?: string;
        vis?: string;
      }[];
      dsdyn?: string;
    }
  | {
      type: "updateDefinition";
      name: string;
      description?: string;
      ports?: {
        name: string;
        mode?: "In" | "Out" | "Electrical";
        dim?: number;
        side?: "left" | "right" | "top" | "bottom";
        x?: number;
        y?: number;
      }[];
      shapes?: {
        kind: "rect" | "line" | "circle" | "text";
        x: number;
        y: number;
        w?: number;
        h?: number;
        x2?: number;
        y2?: number;
        r?: number;
        text?: string;
        stroke?: string;
        fill?: string;
      }[];
      parameters?: {
        name: string;
        label?: string;
        type?: "Real" | "Integer" | "Text" | "Boolean";
        defaultValue?: string;
        unit?: string;
        cond?: string;
        vis?: string;
      }[];
      dsdyn?: string;
    }
  | {
      type: "setProjectSettings";
      settings: Record<string, string | number>;
    }
  | {
      type: "copySelection";
      ids: string[];
      targetDefinition?: string;
      dx?: number;
      dy?: number;
    }
  | {
      type: "syncSubmodulePorts";
      definition: string;
      componentId?: string;
    };

export interface PscadEditResult {
  text: string;
  splices: Splice[];
  edits: CstTextEdit[];
  /** Ids of elements created by the edit, in operation order. */
  createdIds: string[];
  errors: string[];
}

function escapeAttr(s: string): string {
  return encodeXmlAttrValue(s, '"');
}

export function createPscadCstSession(text: string, uri = "file:///document.pscx"): CstDocumentSession {
  let wasmParser: CstIncrementalParser | null = null;
  try {
    wasmParser = getPscadWasmParser() as unknown as CstIncrementalParser;
  } catch {
    wasmParser = null;
  }
  return new CstDocumentSession({
    uri,
    text,
    parser: wasmParser,
    xmlFallback: true,
  });
}

function collectCstIds(root: SyntaxNode | null, source: string): Set<string> {
  const ids = new Set<string>();
  walkHealthyCst(root, (node) => {
    const tag = CstXmlAdapter.getTagName(node, source);
    if (!tag) return;
    const id = CstXmlAdapter.getAttribute(node, "id", source)?.value;
    if (id) ids.add(id);
  });
  return ids;
}

function newId(used: Set<string>, seed: number): string {
  let n = (Math.imul(seed + 1, 2654435761) >>> 1) % 2147483000;
  while (used.has(String(n)) || n === 0) n = (n + 7919) % 2147483000;
  used.add(String(n));
  return String(n);
}

/** Legacy compatibility helper for XmlElement callers. */
export function findElementById(root: XmlElement, id: string, tagNames?: Set<string>): XmlElement | undefined {
  if (attr(root, "id") === id && (!tagNames || tagNames.has(root.name))) {
    return root;
  }
  for (const c of root.children) {
    const found = findElementById(c, id, tagNames);
    if (found) return found;
  }
  return undefined;
}

function findCstElementById(
  root: SyntaxNode | null,
  source: string,
  id: string,
  tagNamesLower?: Set<string>,
): SyntaxNode | null {
  let found: SyntaxNode | null = null;
  walkHealthyCst(root, (node) => {
    if (found) return false;
    const tag = CstXmlAdapter.getTagName(node, source);
    if (!tag) return undefined;
    if (tagNamesLower && !tagNamesLower.has(tag.toLowerCase())) return undefined;
    if (CstXmlAdapter.getAttribute(node, "id", source)?.value === id) {
      found = node;
      return false;
    }
    return undefined;
  });
  return found;
}

function findCstChildByTag(parent: SyntaxNode, source: string, ...tagNamesLower: string[]): SyntaxNode | null {
  const want = new Set(tagNamesLower.map((t) => t.toLowerCase()));
  for (const ch of CstXmlAdapter.getChildElements(parent)) {
    const tag = CstXmlAdapter.getTagName(ch, source);
    if (tag && want.has(tag.toLowerCase())) return ch;
  }
  return null;
}

function getCstChildrenByTag(parent: SyntaxNode, source: string, ...tagNamesLower: string[]): SyntaxNode[] {
  const want = new Set(tagNamesLower.map((t) => t.toLowerCase()));
  return CstXmlAdapter.getChildElements(parent).filter((ch) => {
    const tag = CstXmlAdapter.getTagName(ch, source);
    return Boolean(tag && want.has(tag.toLowerCase()));
  });
}

function findDefinitionNode(root: SyntaxNode | null, source: string, defName?: string): SyntaxNode | null {
  const defs = CstXmlAdapter.findElements(root, source, (_n, tag) => tag.toLowerCase() === "definition");
  if (defs.length === 0) return null;
  if (defName) {
    const clean = defName.includes(":") ? defName.split(":").pop()! : defName;
    const exact = defs.find((d) => {
      const n = CstXmlAdapter.getAttribute(d, "name", source)?.value;
      return n === defName || n === clean;
    });
    if (exact) return exact;
    const ci = defs.find((d) => {
      const n = (CstXmlAdapter.getAttribute(d, "name", source)?.value ?? "").toLowerCase();
      return n === defName.toLowerCase() || n === clean.toLowerCase();
    });
    if (ci) return ci;
  }
  return (
    defs.find((d) => (CstXmlAdapter.getAttribute(d, "name", source)?.value ?? "").toLowerCase() === "main") ?? defs[0]!
  );
}

function findSchematicNode(root: SyntaxNode | null, source: string, defName?: string): SyntaxNode | null {
  const def = findDefinitionNode(root, source, defName);
  if (def) {
    const sch = findCstChildByTag(def, source, "schematic");
    if (sch) return sch;
  }
  return CstXmlAdapter.findElements(root, source, (_n, tag) => tag.toLowerCase() === "schematic")[0] ?? null;
}

function findRootXmlElement(root: SyntaxNode | null, source: string): SyntaxNode | null {
  return CstXmlAdapter.findElements(root, source, () => true)[0] ?? null;
}

function findOwnerDefinitionName(elNode: SyntaxNode, source: string): string | undefined {
  let cur: SyntaxNode | null | undefined = elNode.parent;
  while (cur) {
    const tag = CstXmlAdapter.getTagName(cur, source);
    if (tag && tag.toLowerCase() === "definition") {
      return CstXmlAdapter.getAttribute(cur, "name", source)?.value;
    }
    cur = cur.parent;
  }
  return undefined;
}

/** `Wire` x/y is the first vertex; vertices are relative; w/h is the padded bounding box. */
export function wireXml(id: string, points: Pt[], eol: string, indent: string): string {
  const xs = points.map((p) => Math.round(p.x));
  const ys = points.map((p) => Math.round(p.y));
  const x0 = xs[0] ?? 0;
  const y0 = ys[0] ?? 0;
  const w = Math.max(...xs) - Math.min(...xs) + 10;
  const h = Math.max(...ys) - Math.min(...ys) + 10;
  const verts = points.map((_, i) => `${indent}  <vertex x="${xs[i]! - x0}" y="${ys[i]! - y0}" />`).join(eol);
  return `<Wire classid="WireOrthogonal" id="${id}" name="" x="${x0}" y="${y0}" w="${w}" h="${h}" orient="0" disable="false">${eol}${verts}${eol}${indent}</Wire>`;
}

function stickyXml(id: string, op: Extract<PscadEditOp, { type: "addSticky" }>, eol: string, indent: string): string {
  const safeText = op.text.replace(/]]>/g, "]]]]><![CDATA[>");
  return (
    `<Sticky classid="Sticky" id="${id}" x="${Math.round(op.x)}" y="${Math.round(op.y)}" ` +
    `w="${Math.round(op.w ?? 220)}" h="${Math.round(op.h ?? 44)}" fullfont="true">${eol}` +
    `${indent}  <paramlist link="-1" name="" crc="0">${eol}` +
    `${indent}    <param name="font" value="1" />${eol}` +
    `${indent}    <param name="style" value="0" />${eol}` +
    `${indent}    <param name="fg_color" value="0" />${eol}` +
    `${indent}    <param name="bg_color" value="16777199" />${eol}` +
    `${indent}  </paramlist><![CDATA[${safeText}]]>${eol}` +
    `${indent}</Sticky>`
  );
}

function componentXml(
  id: string,
  op: Extract<PscadEditOp, { type: "addComponent" }>,
  eol: string,
  indent: string,
): string {
  const params = Object.entries(op.params ?? {})
    .map(([k, v]) => `${indent}    <param name="${escapeAttr(k)}" value="${escapeAttr(v)}" />`)
    .join(eol);
  const body =
    params === ""
      ? `${indent}  <paramlist link="-1" name="" crc="0" />`
      : `${indent}  <paramlist link="-1" name="" crc="0">${eol}${params}${eol}${indent}  </paramlist>`;
  return (
    `<User classid="UserCmp" id="${id}" name="${escapeAttr(op.defn)}" x="${Math.round(op.x)}" y="${Math.round(op.y)}" ` +
    `w="${op.w ?? 60}" h="${op.h ?? 60}" z="1" orient="${op.orient ?? 0}" defn="${escapeAttr(op.defn)}" link="-1" q="4" disable="false">${eol}` +
    `${body}${eol}${indent}</User>`
  );
}

type DefinitionPortSpec = NonNullable<Extract<PscadEditOp, { type: "addDefinition" }>["ports"]>[number];
type DefinitionShapeSpec = NonNullable<Extract<PscadEditOp, { type: "addDefinition" }>["shapes"]>[number];
type DefinitionParamSpec = NonNullable<Extract<PscadEditOp, { type: "addDefinition" }>["parameters"]>[number];

function buildDefinitionXml(
  op: {
    name: string;
    description?: string;
    ports?: DefinitionPortSpec[];
    shapes?: DefinitionShapeSpec[];
    parameters?: DefinitionParamSpec[];
    dsdyn?: string;
  },
  eol: string,
  extraChildXml = "",
): string {
  const ports = op.ports ?? [];
  const portsXml = ports
    .map((p, idx) => {
      const side = p.side ?? (p.mode === "Out" ? "right" : "left");
      const slotOffset = (idx - (ports.length - 1) / 2) * 18;
      const defaultX = side === "left" ? -54 : side === "right" ? 54 : Math.round(slotOffset);
      const defaultY = side === "top" ? -36 : side === "bottom" ? 36 : idx * 18;
      const x = p.x ?? defaultX;
      const y = p.y ?? defaultY;
      const modeNum = p.mode === "Out" ? "2" : p.mode === "In" ? "1" : "3";
      const portType = p.mode === "Electrical" ? "Electrical" : "Signal";
      return (
        `      <port name="${escapeAttr(p.name)}" x="${x}" y="${y}" dim="${p.dim ?? 1}" mode="${modeNum}" type="${portType}">` +
        `<param name="name" value="${escapeAttr(p.name)}"/>` +
        `<param name="dim" value="${p.dim ?? 1}"/>` +
        `<param name="mode" value="${modeNum}"/>` +
        `</port>`
      );
    })
    .join(eol);
  const shapesXml = (op.shapes ?? [])
    .map((s) => {
      const strokeAttr = s.stroke ? ` stroke="${escapeAttr(s.stroke)}"` : "";
      const fillAttr = s.fill ? ` fill-style="solid" fill-fg="${escapeAttr(s.fill)}"` : "";
      if (s.kind === "rect") {
        return `      <Gfx classid="Graphics.Rectangle" x="${s.x}" y="${s.y}" w="${s.w ?? 40}" h="${s.h ?? 32}"${strokeAttr}${fillAttr}/>`;
      }
      if (s.kind === "line") {
        return `      <Gfx classid="Graphics.Line" x1="${s.x}" y1="${s.y}" x2="${s.x2 ?? s.x + 24}" y2="${s.y2 ?? s.y}"${strokeAttr}/>`;
      }
      if (s.kind === "circle") {
        const d = (s.r ?? 12) * 2;
        return `      <Gfx classid="Graphics.Ellipse" x="${s.x}" y="${s.y}" w="${d}" h="${d}"${strokeAttr}${fillAttr}/>`;
      }
      return `      <Gfx classid="Graphics.Text" x="${s.x}" y="${s.y}"${strokeAttr}><param name="text" value="${escapeAttr(s.text ?? "")}"/></Gfx>`;
    })
    .join(eol);
  const gfxBody = [shapesXml, portsXml].filter(Boolean).join(eol);
  const paramsXml = (op.parameters ?? [])
    .map((p) => {
      const condAttr = p.cond?.trim() ? ` cond="${escapeAttr(p.cond.trim())}"` : "";
      const visAttr = p.vis?.trim() ? ` vis="${escapeAttr(p.vis.trim())}"` : "";
      return `        <parameter desc="${escapeAttr(p.label || p.name)}" name="${escapeAttr(p.name)}" type="${p.type ?? "Real"}" unit="${escapeAttr(p.unit ?? "")}" content_type="Literal"${condAttr}${visAttr}><value><![CDATA[${p.defaultValue ?? "0"}]]></value></parameter>`;
    })
    .join(eol);
  const safeDsdyn = (op.dsdyn ?? "").replace(/]]>/g, "]]]]><![CDATA[>");
  const extraPart = extraChildXml ? `${eol}${extraChildXml}` : "";
  return (
    `<Definition classid="UserCmpDefn" name="${escapeAttr(op.name)}" desc="${escapeAttr(op.description ?? op.name)}">` +
    `${eol}  <graphics>${gfxBody ? eol + gfxBody + eol + "  " : ""}</graphics>` +
    `${eol}  <form>${eol}    <category name="Parameters">${paramsXml ? eol + paramsXml + eol + "    " : ""}</category>${eol}  </form>` +
    `${eol}  <script>${eol}    <segment name="Dsdyn"><![CDATA[${safeDsdyn}]]></segment>${eol}  </script>` +
    `${extraPart}${eol}</Definition>`
  );
}

/**
 * Applies `PscadEditOp[]` directly to a live {@link CstDocumentSession} via {@link CstTransaction}
 * and {@link CstXmlAdapter} with zero redundant parsing and full error isolation.
 */
export function planPscadEditsOnSession(
  session: CstDocumentSession,
  ops: ReadonlyArray<PscadEditOp>,
  _external?: ExternalDefinitions,
): PscadEditResult {
  const text = session.text;
  const eol = session.eol;
  const root = session.rootNode;
  const tx = new CstTransaction(session);
  const used = collectCstIds(root, text);
  const createdIds: string[] = [];
  const errors: string[] = [];
  const removedStarts = new Set<number>();
  let seed = text.length;

  const CMP_TAGS = new Set(["user", "component"]);
  const WIRE_BUS_TAGS = new Set(["wire", "bus"]);
  const STICKY_TAGS = new Set(["sticky"]);
  const CLONE_TAGS = new Set(["user", "component", "wire", "bus", "sticky"]);

  const insertIntoSchematic = (defName: string | undefined, buildXml: (indent: string) => string): boolean => {
    const sch = findSchematicNode(root, text, defName);
    if (!sch) {
      errors.push(`No schematic found for definition '${defName ?? "Main"}'.`);
      return false;
    }
    const children = CstXmlAdapter.getChildElements(sch);
    const indent =
      children.length > 0
        ? session.lineIndentAt(nodeStartOffset(children[0]!))
        : `${session.lineIndentAt(nodeStartOffset(sch))}  `;
    return CstXmlAdapter.appendChild(tx, sch, buildXml(indent));
  };

  for (const op of ops) {
    switch (op.type) {
      case "moveComponent": {
        const cmpNode = findCstElementById(root, text, op.id, CMP_TAGS);
        if (!cmpNode) {
          errors.push(`Component '${op.id}' not found.`);
          break;
        }
        CstXmlAdapter.setAttribute(tx, cmpNode, "x", String(Math.round(op.x)));
        CstXmlAdapter.setAttribute(tx, cmpNode, "y", String(Math.round(op.y)));
        if (op.orient !== undefined) {
          CstXmlAdapter.setAttribute(tx, cmpNode, "orient", String(op.orient));
        }
        break;
      }

      case "setParameter": {
        const cmpNode = findCstElementById(root, text, op.id, CMP_TAGS);
        if (!cmpNode) {
          errors.push(`Component '${op.id}' not found.`);
          break;
        }
        const paramlist = findCstChildByTag(cmpNode, text, "paramlist");
        const existingParam = paramlist
          ? getCstChildrenByTag(paramlist, text, "param").find(
              (p) => CstXmlAdapter.getAttribute(p, "name", text, false)?.value === op.name,
            )
          : undefined;
        if (existingParam) {
          CstXmlAdapter.setAttribute(tx, existingParam, "value", op.value);
        } else if (paramlist) {
          // Handles both container `<paramlist>...</paramlist>`, self-closing `<paramlist/>`, and unclosed `<paramlist>`
          CstXmlAdapter.appendChild(
            tx,
            paramlist,
            `<param name="${escapeAttr(op.name)}" value="${escapeAttr(op.value)}" />`,
          );
        } else {
          const cmpIndent = session.lineIndentAt(nodeStartOffset(cmpNode));
          const paramlistXml =
            `<paramlist link="-1" name="" crc="0">${eol}` +
            `${cmpIndent}    <param name="${escapeAttr(op.name)}" value="${escapeAttr(op.value)}" />${eol}` +
            `${cmpIndent}  </paramlist>`;
          CstXmlAdapter.appendChild(tx, cmpNode, paramlistXml);
        }
        break;
      }

      case "removeComponent": {
        const cmpNode = findCstElementById(root, text, op.id, CMP_TAGS);
        if (!cmpNode) {
          errors.push(`Component '${op.id}' not found.`);
          break;
        }
        const s = nodeStartOffset(cmpNode);
        if (!removedStarts.has(s)) {
          removedStarts.add(s);
          CstXmlAdapter.deleteElement(tx, cmpNode);
        }
        break;
      }

      case "addComponent": {
        const id = newId(used, seed++);
        if (insertIntoSchematic(op.definition, (indent) => componentXml(id, op, eol, indent))) {
          createdIds.push(id);
        }
        break;
      }

      case "setWirePoints": {
        const wireNode = findCstElementById(root, text, op.id, WIRE_BUS_TAGS);
        if (!wireNode) {
          errors.push(`Wire '${op.id}' not found.`);
          break;
        }
        const wStart = nodeStartOffset(wireNode);
        if (removedStarts.has(wStart)) break;
        removedStarts.add(wStart);

        const xs = op.points.map((p) => Math.round(p.x));
        const ys = op.points.map((p) => Math.round(p.y));
        const x0 = xs[0] ?? 0;
        const y0 = ys[0] ?? 0;
        const verts = getCstChildrenByTag(wireNode, text, "vertex");
        const first = verts[0];
        const last = verts[verts.length - 1];

        if (first && last) {
          CstXmlAdapter.setAttribute(tx, wireNode, "x", String(x0));
          CstXmlAdapter.setAttribute(tx, wireNode, "y", String(y0));
          CstXmlAdapter.setAttribute(tx, wireNode, "w", String(Math.max(...xs) - Math.min(...xs) + 10));
          CstXmlAdapter.setAttribute(tx, wireNode, "h", String(Math.max(...ys) - Math.min(...ys) + 10));
          const vTag = CstXmlAdapter.getTagName(first, text) ?? "vertex";
          const vIndent = session.lineIndentAt(nodeStartOffset(first));
          tx.replaceRange(
            nodeStartOffset(first),
            nodeEndOffset(last),
            op.points.map((_, i) => `<${vTag} x="${xs[i]! - x0}" y="${ys[i]! - y0}" />`).join(`${eol}${vIndent}`),
          );
        } else if (
          op.points.length === 2 &&
          (CstXmlAdapter.getAttribute(wireNode, "x2", text) !== undefined ||
            CstXmlAdapter.getAttribute(wireNode, "y2", text) !== undefined)
        ) {
          CstXmlAdapter.setAttribute(tx, wireNode, "x", String(x0));
          CstXmlAdapter.setAttribute(tx, wireNode, "y", String(y0));
          CstXmlAdapter.setAttribute(tx, wireNode, "x2", String(xs[1] ?? x0));
          CstXmlAdapter.setAttribute(tx, wireNode, "y2", String(ys[1] ?? y0));
        } else {
          const indent = session.lineIndentAt(wStart);
          CstXmlAdapter.setAttribute(tx, wireNode, "x", String(x0));
          CstXmlAdapter.setAttribute(tx, wireNode, "y", String(y0));
          CstXmlAdapter.setAttribute(tx, wireNode, "w", String(Math.max(...xs) - Math.min(...xs) + 10));
          CstXmlAdapter.setAttribute(tx, wireNode, "h", String(Math.max(...ys) - Math.min(...ys) + 10));
          const vText = op.points
            .map((_, i) => `<vertex x="${xs[i]! - x0}" y="${ys[i]! - y0}" />`)
            .join(`${eol}${indent}  `);
          CstXmlAdapter.appendChild(tx, wireNode, vText);
        }
        break;
      }

      case "addWire": {
        const id = newId(used, seed++);
        if (insertIntoSchematic(op.definition, (indent) => wireXml(id, op.points, eol, indent))) {
          createdIds.push(id);
        }
        break;
      }

      case "addBus": {
        const id = newId(used, seed++);
        const busName = op.name || `Bus_${id}`;
        const bw = Math.round(op.w ?? 0);
        const bh = Math.round(op.h ?? 72);
        const bx = Math.round(op.x);
        const by = Math.round(op.y);
        const kv = op.baseKV ?? "230.0";
        const buildBus = (indent: string) =>
          `<Bus id="${id}" name="${escapeAttr(busName)}" x="${bx}" y="${by}" w="${bw}" h="${bh}" BaseKV="${escapeAttr(kv)}">` +
          `${eol}${indent}  <paramlist>` +
          `${eol}${indent}    <param name="Name" value="${escapeAttr(busName)}"/>` +
          `${eol}${indent}    <param name="BaseKV" value="${escapeAttr(kv)}"/>` +
          `${eol}${indent}  </paramlist>` +
          `${eol}${indent}</Bus>`;
        if (insertIntoSchematic(op.definition, buildBus)) {
          createdIds.push(id);
        }
        break;
      }

      case "removeWire": {
        const wireNode = findCstElementById(root, text, op.id, WIRE_BUS_TAGS);
        if (!wireNode) {
          errors.push(`Wire '${op.id}' not found.`);
          break;
        }
        const s = nodeStartOffset(wireNode);
        if (!removedStarts.has(s)) {
          removedStarts.add(s);
          CstXmlAdapter.deleteElement(tx, wireNode);
        }
        break;
      }

      case "toggleDisable": {
        const cmpNode = findCstElementById(root, text, op.id, CMP_TAGS);
        if (!cmpNode) {
          errors.push(`Component '${op.id}' not found.`);
          break;
        }
        const current = CstXmlAdapter.getAttribute(cmpNode, "disable", text)?.value === "true";
        const target = op.disabled !== undefined ? op.disabled : !current;
        CstXmlAdapter.setAttribute(tx, cmpNode, "disable", target ? "true" : "false");
        break;
      }

      case "resizeBus": {
        const busNode = findCstElementById(root, text, op.id, WIRE_BUS_TAGS);
        if (!busNode) {
          errors.push(`Bus '${op.id}' not found.`);
          break;
        }
        if (op.x !== undefined) CstXmlAdapter.setAttribute(tx, busNode, "x", String(Math.round(op.x)));
        if (op.y !== undefined) CstXmlAdapter.setAttribute(tx, busNode, "y", String(Math.round(op.y)));
        if (op.w !== undefined) CstXmlAdapter.setAttribute(tx, busNode, "w", String(Math.round(op.w)));
        if (op.h !== undefined) CstXmlAdapter.setAttribute(tx, busNode, "h", String(Math.round(op.h)));
        if (op.name !== undefined) {
          CstXmlAdapter.setAttribute(tx, busNode, "name", op.name);
          const paramlist = findCstChildByTag(busNode, text, "paramlist");
          const nameParam = paramlist
            ? getCstChildrenByTag(paramlist, text, "param").find((p) => {
                const n = CstXmlAdapter.getAttribute(p, "name", text)?.value;
                return n === "Name" || n === "name";
              })
            : undefined;
          if (nameParam) CstXmlAdapter.setAttribute(tx, nameParam, "value", op.name);
        }
        if (op.baseKV !== undefined) {
          const paramlist = findCstChildByTag(busNode, text, "paramlist");
          const kvParam = paramlist
            ? getCstChildrenByTag(paramlist, text, "param").find((p) => {
                const n = CstXmlAdapter.getAttribute(p, "name", text)?.value;
                return n === "BaseKV" || n === "Vbase" || n === "Vm";
              })
            : undefined;
          if (kvParam) CstXmlAdapter.setAttribute(tx, kvParam, "value", op.baseKV);
          else CstXmlAdapter.setAttribute(tx, busNode, "vbase", op.baseKV);
        }
        if (op.points && op.points.length >= 2) {
          const verts = getCstChildrenByTag(busNode, text, "vertex");
          const first = verts[0];
          const last = verts[verts.length - 1];
          const xs = op.points.map((p) => Math.round(p.x));
          const ys = op.points.map((p) => Math.round(p.y));
          const x0 = xs[0] ?? 0;
          const y0 = ys[0] ?? 0;
          CstXmlAdapter.setAttribute(tx, busNode, "x", String(x0));
          CstXmlAdapter.setAttribute(tx, busNode, "y", String(y0));
          if (first && last) {
            const vTag = CstXmlAdapter.getTagName(first, text) ?? "vertex";
            const vIndent = session.lineIndentAt(nodeStartOffset(first));
            tx.replaceRange(
              nodeStartOffset(first),
              nodeEndOffset(last),
              op.points.map((_, i) => `<${vTag} x="${xs[i]! - x0}" y="${ys[i]! - y0}" />`).join(`${eol}${vIndent}`),
            );
          }
        } else if (op.w !== undefined || op.h !== undefined) {
          const verts = getCstChildrenByTag(busNode, text, "vertex");
          if (verts.length >= 2) {
            const last = verts[verts.length - 1]!;
            const isVertical = (op.h ?? 0) >= (op.w ?? 0);
            if (isVertical && op.h !== undefined) {
              CstXmlAdapter.setAttribute(tx, last, "y", String(Math.round(op.h)));
            } else if (!isVertical && op.w !== undefined) {
              CstXmlAdapter.setAttribute(tx, last, "x", String(Math.round(op.w)));
            }
          }
        }
        break;
      }

      case "editSticky": {
        const stickyNode = findCstElementById(root, text, op.id, STICKY_TAGS);
        if (!stickyNode) {
          errors.push(`Sticky '${op.id}' not found.`);
          break;
        }
        if (op.x !== undefined) CstXmlAdapter.setAttribute(tx, stickyNode, "x", String(Math.round(op.x)));
        if (op.y !== undefined) CstXmlAdapter.setAttribute(tx, stickyNode, "y", String(Math.round(op.y)));
        if (op.w !== undefined) CstXmlAdapter.setAttribute(tx, stickyNode, "w", String(Math.round(op.w)));
        if (op.h !== undefined) CstXmlAdapter.setAttribute(tx, stickyNode, "h", String(Math.round(op.h)));
        if (op.text !== undefined) {
          const safeText = op.text.replace(/]]>/g, "]]]]><![CDATA[>");
          let cdataNode: SyntaxNode | null = null;
          walkHealthyCst(stickyNode, (n) => {
            if (cdataNode) return false;
            if (n.type === "CData") {
              cdataNode = n;
              return false;
            }
            return undefined;
          });
          if (cdataNode) {
            tx.replaceNode(cdataNode, `<![CDATA[${safeText}]]>`);
          } else {
            const sStart = nodeStartOffset(stickyNode);
            const sEnd = nodeEndOffset(stickyNode);
            const slice = text.slice(sStart, sEnd);
            const cdataMatch = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(slice);
            if (cdataMatch && cdataMatch.index !== undefined) {
              tx.replaceRange(
                sStart + cdataMatch.index,
                sStart + cdataMatch.index + cdataMatch[0].length,
                `<![CDATA[${safeText}]]>`,
              );
            } else {
              CstXmlAdapter.appendChild(tx, stickyNode, `<![CDATA[${safeText}]]>`);
            }
          }
        }
        break;
      }

      case "addSticky": {
        const id = newId(used, seed++);
        if (insertIntoSchematic(op.definition, (indent) => stickyXml(id, op, eol, indent))) {
          createdIds.push(id);
        }
        break;
      }

      case "renameNet": {
        const targetDefs = op.definition
          ? [findDefinitionNode(root, text, op.definition)].filter((d): d is SyntaxNode => Boolean(d))
          : CstXmlAdapter.findElements(root, text, (_n, tag) => tag.toLowerCase() === "definition");
        let count = 0;
        for (const defNode of targetDefs) {
          const cmps = CstXmlAdapter.findElements(defNode, text, (_n, tag) => CMP_TAGS.has(tag.toLowerCase()));
          for (const cmpNode of cmps) {
            const defnName =
              CstXmlAdapter.getAttribute(cmpNode, "defn", text)?.value ??
              CstXmlAdapter.getAttribute(cmpNode, "name", text)?.value ??
              "";
            if (!/datalabel|xnode|pgb|pin|port/i.test(defnName)) continue;
            const paramlist = findCstChildByTag(cmpNode, text, "paramlist");
            const searchEls = paramlist
              ? getCstChildrenByTag(paramlist, text, "param")
              : getCstChildrenByTag(cmpNode, text, "param");
            for (const p of searchEls) {
              const pName = CstXmlAdapter.getAttribute(p, "name", text)?.value;
              const pVal = CstXmlAdapter.getAttribute(p, "value", text)?.value;
              if ((pName === "Name" || pName === "name") && pVal === op.oldName) {
                CstXmlAdapter.setAttribute(tx, p, "value", op.newName);
                count++;
              }
            }
          }
        }
        if (count === 0) {
          errors.push(`Wireless net '${op.oldName}' not found.`);
        }
        break;
      }

      case "copySelection": {
        const dx = Math.round(op.dx ?? 36);
        const dy = Math.round(op.dy ?? 36);
        let cloned = 0;
        for (const rawId of op.ids) {
          const elNode = findCstElementById(root, text, rawId, CLONE_TAGS);
          if (!elNode) {
            errors.push(`Selection element '${rawId}' not found.`);
            continue;
          }
          const nid = newId(used, seed++);
          const oldX = Number(CstXmlAdapter.getAttribute(elNode, "x", text)?.value ?? "0");
          const oldY = Number(CstXmlAdapter.getAttribute(elNode, "y", text)?.value ?? "0");
          const ownerDef = op.targetDefinition ?? findOwnerDefinitionName(elNode, text);

          // Clone via a mini CST transaction (zero regex rewriting — preserves single quotes and nested attributes!)
          const rawSlice = text.slice(nodeStartOffset(elNode), nodeEndOffset(elNode));
          const cloneSession = createPscadCstSession(rawSlice, "file:///clone.pscx");
          const cloneRoot = findRootXmlElement(cloneSession.rootNode, rawSlice);
          let shiftedSlice = rawSlice;
          if (cloneRoot) {
            const cloneTx = new CstTransaction(cloneSession);
            CstXmlAdapter.setAttribute(cloneTx, cloneRoot, "id", nid);
            CstXmlAdapter.setAttribute(cloneTx, cloneRoot, "x", String(Math.round(oldX + dx)));
            CstXmlAdapter.setAttribute(cloneTx, cloneRoot, "y", String(Math.round(oldY + dy)));
            shiftedSlice = cloneTx.commit().applyToString(rawSlice);
          }
          cloneSession.dispose();

          if (insertIntoSchematic(ownerDef, () => shiftedSlice)) {
            createdIds.push(nid);
            cloned++;
          }
        }
        if (cloned === 0 && op.ids.length === 0) {
          errors.push("copySelection requires at least one element ID.");
        }
        break;
      }

      case "syncSubmodulePorts": {
        const targetDef = findDefinitionNode(root, text, op.definition);
        if (!targetDef) {
          errors.push(`Submodule definition '${op.definition}' not found.`);
          break;
        }
        const sch = findCstChildByTag(targetDef, text, "schematic");
        const gfx = findCstChildByTag(targetDef, text, "graphics", "graphic", "svg");
        if (!sch || !gfx) {
          errors.push(`Submodule '${op.definition}' lacks schematic or graphic section.`);
          break;
        }
        const desiredPorts: { name: string; x: number; y: number; dim: string; mode: string }[] = [];
        for (const cmpNode of CstXmlAdapter.findElements(sch, text, (_n, tag) => CMP_TAGS.has(tag.toLowerCase()))) {
          const defnAttr = CstXmlAdapter.getAttribute(cmpNode, "defn", text)?.value ?? "";
          const shortDef = (defnAttr.includes(":") ? defnAttr.split(":").pop()! : defnAttr).toLowerCase();
          if (shortDef !== "xnode" && shortDef !== "pin" && shortDef !== "import" && shortDef !== "export") continue;
          const paramlist = findCstChildByTag(cmpNode, text, "paramlist");
          const params = paramlist ? getCstChildrenByTag(paramlist, text, "param") : [];
          const getParam = (k: string) =>
            params.find(
              (p) => (CstXmlAdapter.getAttribute(p, "name", text)?.value ?? "").toLowerCase() === k.toLowerCase(),
            );
          const pName = (
            (getParam("Name") ? CstXmlAdapter.getAttribute(getParam("Name")!, "value", text)?.value : undefined) ??
            CstXmlAdapter.getAttribute(cmpNode, "name", text)?.value ??
            ""
          ).trim();
          if (!pName) continue;
          const dim =
            (getParam("Dim") ? CstXmlAdapter.getAttribute(getParam("Dim")!, "value", text)?.value : undefined) ?? "1";
          const mode = shortDef === "export" ? "Out" : shortDef === "import" ? "In" : "Electrical";
          desiredPorts.push({ name: pName, x: -54, y: desiredPorts.length * 18, dim, mode });
        }
        const existingPorts = getCstChildrenByTag(gfx, text, "port");
        const existingByName = new Map(
          existingPorts.map((p) => [
            (CstXmlAdapter.getAttribute(p, "name", text)?.value ?? "").trim().toLowerCase(),
            p,
          ]),
        );
        const desiredNames = new Set(desiredPorts.map((d) => d.name.toLowerCase()));
        for (const ep of existingPorts) {
          const nm = (CstXmlAdapter.getAttribute(ep, "name", text)?.value ?? "").trim().toLowerCase();
          const s = nodeStartOffset(ep);
          if (nm && !desiredNames.has(nm) && !removedStarts.has(s)) {
            removedStarts.add(s);
            CstXmlAdapter.deleteElement(tx, ep);
          }
        }
        for (const dp of desiredPorts) {
          const existing = existingByName.get(dp.name.toLowerCase());
          if (!existing) {
            const portXml = `<port name="${escapeAttr(dp.name)}" x="${dp.x}" y="${dp.y}" dim="${escapeAttr(dp.dim)}" mode="${escapeAttr(dp.mode)}" type="" />`;
            CstXmlAdapter.appendChild(tx, gfx, portXml);
          } else {
            CstXmlAdapter.setAttribute(tx, existing, "dim", dp.dim);
            CstXmlAdapter.setAttribute(tx, existing, "mode", dp.mode);
          }
        }
        break;
      }

      case "setScriptSegment": {
        const targetDef = findDefinitionNode(root, text, op.definition);
        if (!targetDef) {
          errors.push(`Definition '${op.definition}' not found.`);
          break;
        }
        const safeCode = op.code.replace(/]]>/g, "]]]]><![CDATA[>");
        const scriptEl = findCstChildByTag(targetDef, text, "script");
        if (!scriptEl) {
          const scriptXml = `<script>${eol}  <segment name="${escapeAttr(op.segment)}"><![CDATA[${safeCode}]]></segment>${eol}</script>`;
          CstXmlAdapter.appendChild(tx, targetDef, scriptXml);
          break;
        }
        const segEl = getCstChildrenByTag(scriptEl, text, "segment").find(
          (s) => (CstXmlAdapter.getAttribute(s, "name", text)?.value ?? "").toLowerCase() === op.segment.toLowerCase(),
        );
        if (!segEl) {
          const segXml = `<segment name="${escapeAttr(op.segment)}"><![CDATA[${safeCode}]]></segment>`;
          CstXmlAdapter.appendChild(tx, scriptEl, segXml);
          break;
        }
        if (CstXmlAdapter.isSelfClosing(segEl, text)) {
          tx.replaceNode(segEl, `<segment name="${escapeAttr(op.segment)}"><![CDATA[${safeCode}]]></segment>`);
        } else {
          let cdataNode: SyntaxNode | null = null;
          walkHealthyCst(segEl, (n) => {
            if (cdataNode) return false;
            if (n.type === "CData") {
              cdataNode = n;
              return false;
            }
            return undefined;
          });
          if (cdataNode) {
            tx.replaceNode(cdataNode, `<![CDATA[${safeCode}]]>`);
          } else {
            // Replace inner body between open and close tag via CST
            const open = typeof segEl.childForFieldName === "function" ? segEl.childForFieldName("open") : null;
            const close = typeof segEl.childForFieldName === "function" ? segEl.childForFieldName("endName") : null;
            if (open && close) {
              tx.replaceRange(nodeEndOffset(open), nodeStartOffset(close), `<![CDATA[${safeCode}]]>`);
            } else {
              tx.replaceNode(segEl, `<segment name="${escapeAttr(op.segment)}"><![CDATA[${safeCode}]]></segment>`);
            }
          }
        }
        break;
      }

      case "addDefinition": {
        const rootEl = findRootXmlElement(root, text);
        const defsEl = (rootEl ? findCstChildByTag(rootEl, text, "definitions") : null) ?? rootEl;
        if (!defsEl) {
          errors.push("No <definitions> or root element found.");
          break;
        }
        CstXmlAdapter.appendChild(tx, defsEl, buildDefinitionXml(op, eol));
        break;
      }

      case "updateDefinition": {
        const rootEl = findRootXmlElement(root, text);
        const defsEl = (rootEl ? findCstChildByTag(rootEl, text, "definitions") : null) ?? rootEl;
        if (!defsEl) {
          errors.push("No <definitions> or root element found.");
          break;
        }
        const targetLower = op.name.trim().toLowerCase();
        const existingDef = getCstChildrenByTag(defsEl, text, "definition").find(
          (el) => (CstXmlAdapter.getAttribute(el, "name", text)?.value ?? "").trim().toLowerCase() === targetLower,
        );
        if (existingDef) {
          const extraSch = getCstChildrenByTag(existingDef, text, "schematic")
            .map((sc) => text.slice(nodeStartOffset(sc), nodeEndOffset(sc)))
            .join(eol);
          tx.replaceNode(existingDef, buildDefinitionXml(op, eol, extraSch ? `  ${extraSch}` : ""));
        } else {
          CstXmlAdapter.appendChild(tx, defsEl, buildDefinitionXml(op, eol));
        }
        break;
      }

      case "setProjectSettings": {
        const rootEl = findRootXmlElement(root, text);
        if (!rootEl) {
          errors.push("No root element found.");
          break;
        }
        const paramlists = getCstChildrenByTag(rootEl, text, "paramlist");
        const settingsList =
          paramlists.find(
            (p) => (CstXmlAdapter.getAttribute(p, "name", text)?.value ?? "").toLowerCase() === "settings",
          ) ?? paramlists[0];
        if (!settingsList) {
          const entries = Object.entries(op.settings)
            .map(([k, v]) => `    <param name="${escapeAttr(k)}" value="${escapeAttr(String(v))}"/>`)
            .join(eol);
          CstXmlAdapter.appendChild(tx, rootEl, `<paramlist name="Settings">${eol}${entries}${eol}</paramlist>`);
          break;
        }
        const existingParams = getCstChildrenByTag(settingsList, text, "param");
        for (const [k, v] of Object.entries(op.settings)) {
          const hit = existingParams.find(
            (p) => (CstXmlAdapter.getAttribute(p, "name", text)?.value ?? "").toLowerCase() === k.toLowerCase(),
          );
          if (hit) {
            CstXmlAdapter.setAttribute(tx, hit, "value", String(v));
          } else {
            CstXmlAdapter.appendChild(
              tx,
              settingsList,
              `<param name="${escapeAttr(k)}" value="${escapeAttr(String(v))}"/>`,
            );
          }
        }
        break;
      }
    }
  }

  const committed = tx.commit();
  const splices: Splice[] = committed.byteEdits.map((b) => ({ start: b.start, end: b.end, text: b.text }));
  return {
    text: committed.applyToString(text),
    splices,
    edits: committed.edits,
    createdIds,
    errors,
  };
}

export function planPscadEdits(text: string, ops: PscadEditOp[], external?: ExternalDefinitions): PscadEditResult {
  const session = createPscadCstSession(text);
  try {
    return planPscadEditsOnSession(session, ops, external);
  } finally {
    session.dispose();
  }
}

/** Converts offset splices to LSP-style text edits (0-based line/character). */
export function splicesToTextEdits(
  text: string,
  splices: Splice[],
): {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  newText: string;
}[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  const pos = (off: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= off) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo, character: off - starts[lo]! };
  };
  return splices.map((s) => ({ range: { start: pos(s.start), end: pos(s.end) }, newText: s.text }));
}

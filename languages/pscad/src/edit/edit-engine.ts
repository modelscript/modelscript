// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  appendChildSplice,
  applySplices,
  removeElementSplice,
  setAttributeSplice,
  type Splice,
  type XmlElement,
} from "@modelscript/dsl/xml";
import {
  attr,
  buildProjectModel,
  childrenNamed,
  type ExternalDefinitions,
  type ModelDefinition,
  type PscadProjectModel,
  type Pt,
} from "../model/pscad-model.js";
import { registeredExternalDefinitions } from "../model/workspace-registry.js";
export { applySplices };

/**
 * Structural edit engine for PSCAD projects.
 *
 * Every operation is expressed on the lossless XML tree and produces minimal text splices, so
 * untouched bytes (CRLF/`\r\r\n` endings, indentation, attribute order, CDATA) are preserved and
 * editor undo history stays meaningful.
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
  /** Ids of elements created by the edit, in operation order. */
  createdIds: string[];
  errors: string[];
}

function eolOf(text: string): string {
  return /\r\r\n/.test(text) ? "\r\r\n" : /\r\n/.test(text) ? "\r\n" : "\n";
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function collectIds(model: PscadProjectModel): Set<string> {
  const ids = new Set<string>();
  const walk = (el: XmlElement) => {
    const id = attr(el, "id");
    if (id) ids.add(id);
    for (const c of el.children) walk(c);
  };
  walk(model.root);
  return ids;
}

function newId(used: Set<string>, seed: number): string {
  let n = (Math.imul(seed + 1, 2654435761) >>> 1) % 2147483000;
  while (used.has(String(n)) || n === 0) n = (n + 7919) % 2147483000;
  used.add(String(n));
  return String(n);
}

function findInstance(model: PscadProjectModel, id: string) {
  for (const d of model.definitions.values()) {
    const inst = d.instances.find((i) => i.id === id);
    if (inst) return { def: d, inst };
  }
  return undefined;
}

function findWire(model: PscadProjectModel, id: string) {
  for (const d of model.definitions.values()) {
    const wire = d.wires.find((w) => w.id === id);
    if (wire) return { def: d, wire };
  }
  return undefined;
}

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

function schematicOf(def: ModelDefinition): XmlElement | undefined {
  return childrenNamed(def.element, "schematic")[0];
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

export function planPscadEdits(
  text: string,
  ops: PscadEditOp[],
  external: ExternalDefinitions | undefined = registeredExternalDefinitions(),
): PscadEditResult {
  const model = buildProjectModel(text, external);
  const eol = eolOf(text);
  const used = collectIds(model);
  const splices: Splice[] = [];
  const createdIds: string[] = [];
  const errors: string[] = [];
  // Several ops may touch the same attribute; the last write wins.
  const attrWrites = new Map<string, Splice>();
  const writeAttr = (el: XmlElement, name: string, value: string) => {
    const s = setAttributeSplice(el, name, value, text);
    attrWrites.set(`${el.start}:${name}`, s);
  };
  const removed = new Set<number>();
  let seed = text.length;

  const insertInto = (defName: string | undefined, xml: (indent: string) => string): boolean => {
    const def = model.definitions.get(defName ?? "Main") ?? [...model.definitions.values()][0];
    const sch = def ? schematicOf(def) : undefined;
    if (!sch) {
      errors.push(`No schematic found for definition '${defName ?? "Main"}'.`);
      return false;
    }
    const first = sch.children[0];
    let indent = "        ";
    if (first) {
      let s = first.start;
      while (s > 0 && (text[s - 1] === " " || text[s - 1] === "\t")) s--;
      indent = text.slice(s, first.start);
    }
    splices.push(appendChildSplice(sch, xml(indent), text));
    return true;
  };

  for (const op of ops) {
    switch (op.type) {
      case "moveComponent": {
        const hit = findInstance(model, op.id);
        if (!hit) {
          errors.push(`Component '${op.id}' not found.`);
          break;
        }
        writeAttr(hit.inst.element, "x", String(Math.round(op.x)));
        writeAttr(hit.inst.element, "y", String(Math.round(op.y)));
        if (op.orient !== undefined) writeAttr(hit.inst.element, "orient", String(op.orient));
        break;
      }
      case "setParameter": {
        const hit = findInstance(model, op.id);
        if (!hit) {
          errors.push(`Component '${op.id}' not found.`);
          break;
        }
        const paramlist = childrenNamed(hit.inst.element, "paramlist")[0];
        const param = paramlist
          ? childrenNamed(paramlist, "param").find((p) => attr(p, "name") === op.name)
          : undefined;
        if (param) {
          writeAttr(param, "value", op.value);
        } else if (paramlist && !paramlist.selfClosing) {
          splices.push(
            appendChildSplice(
              paramlist,
              `<param name="${escapeAttr(op.name)}" value="${escapeAttr(op.value)}" />`,
              text,
            ),
          );
        } else if (paramlist) {
          // Self-closing <paramlist ... />: expand it.
          const open = text.slice(paramlist.start, paramlist.end).replace(/\s*\/>$/, ">");
          let s = paramlist.start;
          while (s > 0 && (text[s - 1] === " " || text[s - 1] === "\t")) s--;
          const indent = text.slice(s, paramlist.start);
          splices.push({
            start: paramlist.start,
            end: paramlist.end,
            text: `${open}${eol}${indent}  <param name="${escapeAttr(op.name)}" value="${escapeAttr(op.value)}" />${eol}${indent}</paramlist>`,
          });
        } else {
          const paramlistXml =
            `<paramlist link="-1" name="" crc="0">${eol}` +
            `  <param name="${escapeAttr(op.name)}" value="${escapeAttr(op.value)}" />${eol}` +
            `</paramlist>`;
          splices.push(appendChildSplice(hit.inst.element, paramlistXml, text));
        }
        break;
      }
      case "removeComponent": {
        const hit = findInstance(model, op.id);
        if (!hit) {
          errors.push(`Component '${op.id}' not found.`);
          break;
        }
        if (!removed.has(hit.inst.element.start)) {
          removed.add(hit.inst.element.start);
          splices.push(removeElementSplice(hit.inst.element, text));
        }
        break;
      }
      case "addComponent": {
        const id = newId(used, seed++);
        if (insertInto(op.definition, (indent) => componentXml(id, op, eol, indent))) createdIds.push(id);
        break;
      }
      case "setWirePoints": {
        const hit = findWire(model, op.id);
        if (!hit) {
          errors.push(`Wire '${op.id}' not found.`);
          break;
        }
        if (removed.has(hit.wire.element.start)) break;
        removed.add(hit.wire.element.start);
        let s = hit.wire.element.start;
        while (s > 0 && (text[s - 1] === " " || text[s - 1] === "\t")) s--;
        const indent = text.slice(s, hit.wire.element.start);
        // Keep the original classid/name/orient attributes by only replacing geometry attributes + vertices.
        const el = hit.wire.element;
        const xs = op.points.map((p) => Math.round(p.x));
        const ys = op.points.map((p) => Math.round(p.y));
        const x0 = xs[0] ?? 0;
        const y0 = ys[0] ?? 0;
        const verts = [...childrenNamed(el, "vertex"), ...childrenNamed(el, "Vertex")];
        const first = verts[0];
        const last = verts[verts.length - 1];
        if (first && last) {
          writeAttr(el, "x", String(x0));
          writeAttr(el, "y", String(y0));
          writeAttr(el, "w", String(Math.max(...xs) - Math.min(...xs) + 10));
          writeAttr(el, "h", String(Math.max(...ys) - Math.min(...ys) + 10));
          const vTag = first.name;
          const vindent = (() => {
            let vs = first.start;
            while (vs > 0 && (text[vs - 1] === " " || text[vs - 1] === "\t")) vs--;
            return text.slice(vs, first.start);
          })();
          splices.push({
            start: first.start,
            end: last.end,
            text: op.points.map((_, i) => `<${vTag} x="${xs[i]! - x0}" y="${ys[i]! - y0}" />`).join(`${eol}${vindent}`),
          });
        } else if (op.points.length === 2 && (attr(el, "x2") !== undefined || attr(el, "y2") !== undefined)) {
          writeAttr(el, "x", String(x0));
          writeAttr(el, "y", String(y0));
          writeAttr(el, "x2", String(xs[1] ?? x0));
          writeAttr(el, "y2", String(ys[1] ?? y0));
        } else if (el.selfClosing) {
          const open = text.slice(el.start, el.end).replace(/\s*\/>$/, ">");
          const vText = op.points
            .map((_, i) => `${indent}  <vertex x="${xs[i]! - x0}" y="${ys[i]! - y0}" />`)
            .join(eol);
          splices.push({
            start: el.start,
            end: el.end,
            text: `${open}${eol}${vText}${eol}${indent}</Wire>`,
          });
        } else {
          errors.push(`Wire '${op.id}' has no vertices to replace (indent '${indent.length}').`);
        }
        break;
      }
      case "addWire": {
        const id = newId(used, seed++);
        if (insertInto(op.definition, (indent) => wireXml(id, op.points, eol, indent))) createdIds.push(id);
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
        const snippet = (indent: string) =>
          `${indent}<Bus id="${id}" name="${busName}" x="${bx}" y="${by}" w="${bw}" h="${bh}" BaseKV="${kv}">` +
          `${eol}${indent}  <paramlist>` +
          `${eol}${indent}    <param name="Name" value="${busName}"/>` +
          `${eol}${indent}    <param name="BaseKV" value="${kv}"/>` +
          `${eol}${indent}  </paramlist>` +
          `${eol}${indent}</Bus>`;
        if (insertInto(op.definition, snippet)) createdIds.push(id);
        break;
      }
      case "removeWire": {
        const hit = findWire(model, op.id);
        const wireEl = hit?.wire.element ?? findElementById(model.root, op.id, new Set(["Bus", "Wire"]));
        if (!wireEl) {
          errors.push(`Wire '${op.id}' not found.`);
          break;
        }
        if (!removed.has(wireEl.start)) {
          removed.add(wireEl.start);
          splices.push(removeElementSplice(wireEl, text));
        }
        break;
      }
      case "toggleDisable": {
        const hit = findInstance(model, op.id);
        if (!hit) {
          errors.push(`Component '${op.id}' not found.`);
          break;
        }
        const current = attr(hit.inst.element, "disable") === "true";
        const target = op.disabled !== undefined ? op.disabled : !current;
        writeAttr(hit.inst.element, "disable", target ? "true" : "false");
        break;
      }
      case "resizeBus": {
        const busEl = findElementById(model.root, op.id, new Set(["Bus", "Wire"]));
        if (!busEl) {
          errors.push(`Bus '${op.id}' not found.`);
          break;
        }
        if (op.x !== undefined) writeAttr(busEl, "x", String(Math.round(op.x)));
        if (op.y !== undefined) writeAttr(busEl, "y", String(Math.round(op.y)));
        if (op.w !== undefined) writeAttr(busEl, "w", String(Math.round(op.w)));
        if (op.h !== undefined) writeAttr(busEl, "h", String(Math.round(op.h)));
        if (op.name !== undefined) {
          writeAttr(busEl, "name", op.name);
          const paramlist = childrenNamed(busEl, "paramlist")[0];
          const nameParam = paramlist
            ? childrenNamed(paramlist, "param").find((p) => {
                const n = attr(p, "name");
                return n === "Name" || n === "name";
              })
            : undefined;
          if (nameParam) writeAttr(nameParam, "value", op.name);
        }
        if (op.baseKV !== undefined) {
          const paramlist = childrenNamed(busEl, "paramlist")[0];
          const kvParam = paramlist
            ? childrenNamed(paramlist, "param").find((p) => {
                const n = attr(p, "name");
                return n === "BaseKV" || n === "Vbase" || n === "Vm";
              })
            : undefined;
          if (kvParam) writeAttr(kvParam, "value", op.baseKV);
          else writeAttr(busEl, "vbase", op.baseKV);
        }
        if (op.points && op.points.length >= 2) {
          const verts = [...childrenNamed(busEl, "vertex"), ...childrenNamed(busEl, "Vertex")];
          const first = verts[0];
          const last = verts[verts.length - 1];
          const xs = op.points.map((p) => Math.round(p.x));
          const ys = op.points.map((p) => Math.round(p.y));
          const x0 = xs[0] ?? 0;
          const y0 = ys[0] ?? 0;
          writeAttr(busEl, "x", String(x0));
          writeAttr(busEl, "y", String(y0));
          if (first && last) {
            const vTag = first.name;
            let vs = first.start;
            while (vs > 0 && (text[vs - 1] === " " || text[vs - 1] === "\t")) vs--;
            const vindent = text.slice(vs, first.start);
            splices.push({
              start: first.start,
              end: last.end,
              text: op.points
                .map((_, i) => `<${vTag} x="${xs[i]! - x0}" y="${ys[i]! - y0}" />`)
                .join(`${eol}${vindent}`),
            });
          }
        } else if (op.w !== undefined || op.h !== undefined) {
          const verts = [...childrenNamed(busEl, "vertex"), ...childrenNamed(busEl, "Vertex")];
          if (verts.length >= 2) {
            const last = verts[verts.length - 1]!;
            const isVertical = (op.h ?? 0) >= (op.w ?? 0);
            if (isVertical && op.h !== undefined) {
              writeAttr(last, "y", String(Math.round(op.h)));
            } else if (!isVertical && op.w !== undefined) {
              writeAttr(last, "x", String(Math.round(op.w)));
            }
          }
        }
        break;
      }
      case "editSticky": {
        const stickyEl = findElementById(model.root, op.id, new Set(["Sticky"]));
        if (!stickyEl) {
          errors.push(`Sticky '${op.id}' not found.`);
          break;
        }
        if (op.x !== undefined) writeAttr(stickyEl, "x", String(Math.round(op.x)));
        if (op.y !== undefined) writeAttr(stickyEl, "y", String(Math.round(op.y)));
        if (op.w !== undefined) writeAttr(stickyEl, "w", String(Math.round(op.w)));
        if (op.h !== undefined) writeAttr(stickyEl, "h", String(Math.round(op.h)));
        if (op.text !== undefined) {
          const rawSlice = text.slice(stickyEl.start, stickyEl.end);
          const cdataMatch = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(rawSlice);
          const safeText = op.text.replace(/]]>/g, "]]]]><![CDATA[>");
          if (cdataMatch && cdataMatch.index !== undefined) {
            const cStart = stickyEl.start + cdataMatch.index;
            const cEnd = cStart + cdataMatch[0].length;
            splices.push({
              start: cStart,
              end: cEnd,
              text: `<![CDATA[${safeText}]]>`,
            });
          } else if (!stickyEl.selfClosing) {
            const closeIdx = rawSlice.lastIndexOf("</Sticky>");
            if (closeIdx > 0) {
              const openEnd = rawSlice.indexOf(">") + 1;
              const paramlist = childrenNamed(stickyEl, "paramlist")[0];
              const bodyStart = paramlist ? paramlist.end : stickyEl.start + openEnd;
              const bodyEnd = stickyEl.start + closeIdx;
              splices.push({
                start: bodyStart,
                end: bodyEnd,
                text: `<![CDATA[${safeText}]]>`,
              });
            }
          }
        }
        break;
      }
      case "addSticky": {
        const id = newId(used, seed++);
        if (insertInto(op.definition, (indent) => stickyXml(id, op, eol, indent))) createdIds.push(id);
        break;
      }
      case "renameNet": {
        const targetDefs = op.definition
          ? [model.definitions.get(op.definition)].filter((d): d is ModelDefinition => Boolean(d))
          : [...model.definitions.values()];
        let count = 0;
        for (const d of targetDefs) {
          for (const inst of d.instances) {
            const isNetEndpoint = /datalabel|xnode|pgb|pin|port/i.test(inst.defnName);
            if (!isNetEndpoint) continue;
            const paramlist = childrenNamed(inst.element, "paramlist")[0];
            const searchEls = paramlist ? childrenNamed(paramlist, "param") : childrenNamed(inst.element, "param");
            for (const p of searchEls) {
              const pName = attr(p, "name");
              const pVal = attr(p, "value") ?? p.text.trim();
              if ((pName === "Name" || pName === "name") && pVal === op.oldName) {
                writeAttr(p, "value", op.newName);
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
          const el =
            findElementById(model.root, rawId, new Set(["User", "Component", "Wire", "Bus", "Sticky"])) ??
            findInstance(model, rawId)?.inst.element;
          if (!el) {
            errors.push(`Selection element '${rawId}' not found.`);
            continue;
          }
          const nid = newId(used, seed++);
          const oldX = Number(attr(el, "x") ?? "0");
          const oldY = Number(attr(el, "y") ?? "0");
          const ownerDef =
            op.targetDefinition ??
            (() => {
              let p = el.parent;
              while (p && p.name.toLowerCase() !== "definition") p = p.parent;
              return p ? attr(p, "name") : undefined;
            })();
          const rawSlice = text.slice(el.start, el.end);
          const shiftedSlice = rawSlice
            .replace(/\bid\s*=\s*"([^"]*)"/i, `id="${nid}"`)
            .replace(/\bx\s*=\s*"(-?\d+(?:\.\d+)?)"/i, `x="${Math.round(oldX + dx)}"`)
            .replace(/\by\s*=\s*"(-?\d+(?:\.\d+)?)"/i, `y="${Math.round(oldY + dy)}"`);
          if (insertInto(ownerDef, () => shiftedSlice)) {
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
        const cleanTarget = op.definition.includes(":") ? op.definition.split(":").pop()! : op.definition;
        const targetDef = model.definitions.get(op.definition) ?? model.definitions.get(cleanTarget);
        if (!targetDef) {
          errors.push(`Submodule definition '${op.definition}' not found.`);
          break;
        }
        const sch = schematicOf(targetDef);
        const gfx =
          childrenNamed(targetDef.element, "graphics")[0] ??
          childrenNamed(targetDef.element, "Graphics")[0] ??
          childrenNamed(targetDef.element, "graphic")[0] ??
          childrenNamed(targetDef.element, "svg")[0];
        if (!sch || !gfx) {
          errors.push(`Submodule '${op.definition}' lacks schematic or graphic section.`);
          break;
        }
        // Collect boundary pins/xnodes inside the submodule schematic
        const desiredPorts: { name: string; x: number; y: number; dim: string; mode: string }[] = [];
        for (const inst of targetDef.instances) {
          const shortDef = (
            inst.defnName.includes(":") ? inst.defnName.split(":").pop()! : inst.defnName
          ).toLowerCase();
          if (shortDef !== "xnode" && shortDef !== "pin" && shortDef !== "import" && shortDef !== "export") continue;
          const pName = (inst.params.get("Name") ?? inst.params.get("name") ?? attr(inst.element, "name") ?? "").trim();
          if (!pName) continue;
          const dim = inst.params.get("Dim") ?? inst.params.get("dim") ?? "1";
          const mode = shortDef === "export" ? "Out" : shortDef === "import" ? "In" : "Electrical";
          desiredPorts.push({ name: pName, x: -54, y: desiredPorts.length * 18, dim, mode });
        }
        const existingPorts = childrenNamed(gfx, "port");
        const existingByName = new Map(existingPorts.map((p) => [(attr(p, "name") ?? "").trim().toLowerCase(), p]));
        const desiredNames = new Set(desiredPorts.map((d) => d.name.toLowerCase()));
        for (const ep of existingPorts) {
          const nm = (attr(ep, "name") ?? "").trim().toLowerCase();
          if (nm && !desiredNames.has(nm) && !removed.has(ep.start)) {
            removed.add(ep.start);
            splices.push(removeElementSplice(ep, text));
          }
        }
        for (const dp of desiredPorts) {
          const existing = existingByName.get(dp.name.toLowerCase());
          if (!existing) {
            const portXml = `<port name="${escapeAttr(dp.name)}" x="${dp.x}" y="${dp.y}" dim="${escapeAttr(dp.dim)}" mode="${escapeAttr(dp.mode)}" type="" />`;
            splices.push(appendChildSplice(gfx, portXml, text));
          } else {
            writeAttr(existing, "dim", dp.dim);
            writeAttr(existing, "mode", dp.mode);
          }
        }
        break;
      }
      case "setScriptSegment": {
        const cleanTarget = op.definition.includes(":") ? op.definition.split(":").pop()! : op.definition;
        const targetDef = model.definitions.get(op.definition) ?? model.definitions.get(cleanTarget);
        if (!targetDef) {
          errors.push(`Definition '${op.definition}' not found.`);
          break;
        }
        const safeCode = op.code.replace(/]]>/g, "]]]]><![CDATA[>");
        const scriptEl = childrenNamed(targetDef.element, "script")[0];
        if (!scriptEl) {
          const scriptXml = `<script>${eol}  <segment name="${escapeAttr(op.segment)}"><![CDATA[${safeCode}]]></segment>${eol}</script>`;
          splices.push(appendChildSplice(targetDef.element, scriptXml, text));
          break;
        }
        const segEl = childrenNamed(scriptEl, "segment").find(
          (s) => (attr(s, "name") ?? "").toLowerCase() === op.segment.toLowerCase(),
        );
        if (!segEl) {
          const segXml = `<segment name="${escapeAttr(op.segment)}"><![CDATA[${safeCode}]]></segment>`;
          splices.push(appendChildSplice(scriptEl, segXml, text));
          break;
        }
        if (segEl.end > segEl.openEnd && !segEl.selfClosing) {
          const closeIdx = text.lastIndexOf("</segment>", segEl.end);
          if (closeIdx >= segEl.openEnd) {
            splices.push({
              start: segEl.openEnd,
              end: closeIdx,
              text: `<![CDATA[${safeCode}]]>`,
            });
          }
        } else {
          splices.push({
            start: segEl.start,
            end: segEl.end,
            text: `<segment name="${escapeAttr(op.segment)}"><![CDATA[${safeCode}]]></segment>`,
          });
        }
        break;
      }
      case "addDefinition": {
        const defsEl = childrenNamed(model.root, "definitions")[0] ?? model.root;
        splices.push(appendChildSplice(defsEl, buildDefinitionXml(op, eol), text));
        break;
      }
      case "updateDefinition": {
        const defsEl = childrenNamed(model.root, "definitions")[0] ?? model.root;
        const targetLower = op.name.trim().toLowerCase();
        const candidates = [...childrenNamed(defsEl, "Definition"), ...childrenNamed(defsEl, "definition")];
        const existingDef = candidates.find((el) => (attr(el, "name") ?? "").trim().toLowerCase() === targetLower);
        if (existingDef) {
          const extraSch = childrenNamed(existingDef, "schematic")
            .map((sc) => text.slice(sc.start, sc.end))
            .join(eol);
          splices.push({
            start: existingDef.start,
            end: existingDef.end,
            text: buildDefinitionXml(op, eol, extraSch ? `  ${extraSch}` : ""),
          });
        } else {
          splices.push(appendChildSplice(defsEl, buildDefinitionXml(op, eol), text));
        }
        break;
      }
      case "setProjectSettings": {
        const paramlists = childrenNamed(model.root, "paramlist");
        const settingsList =
          paramlists.find((p) => (attr(p, "name") ?? "").toLowerCase() === "settings") ?? paramlists[0];
        if (!settingsList) {
          const entries = Object.entries(op.settings)
            .map(([k, v]) => `    <param name="${escapeAttr(k)}" value="${escapeAttr(String(v))}"/>`)
            .join(eol);
          splices.push(
            appendChildSplice(model.root, `<paramlist name="Settings">${eol}${entries}${eol}</paramlist>`, text),
          );
          break;
        }
        const existingParams = childrenNamed(settingsList, "param");
        for (const [k, v] of Object.entries(op.settings)) {
          const hit = existingParams.find((p) => (attr(p, "name") ?? "").toLowerCase() === k.toLowerCase());
          if (hit) {
            writeAttr(hit, "value", String(v));
          } else {
            splices.push(
              appendChildSplice(
                settingsList,
                `<param name="${escapeAttr(k)}" value="${escapeAttr(String(v))}"/>`,
                text,
              ),
            );
          }
        }
        break;
      }
    }
  }

  // Drop attribute writes that fall inside removed elements.
  const inRemoved = (s: Splice) =>
    splices.some((r) => r.text === "" && r.start <= s.start && s.end <= r.end && r !== s);
  for (const s of attrWrites.values()) if (!inRemoved(s)) splices.push(s);

  // Merge coincident zero-length insertions (e.g. multiple new attributes added to a bare <Wire>)
  // so downstream LSP/VS Code TextEdit application never sees overlapping inserts at the same offset.
  const mergedSplices: Splice[] = [];
  const insertAt = new Map<number, Splice>();
  for (const s of splices) {
    if (s.start === s.end) {
      const existing = insertAt.get(s.start);
      if (existing) {
        existing.text += s.text;
        continue;
      }
      const copy: Splice = { ...s };
      insertAt.set(s.start, copy);
      mergedSplices.push(copy);
    } else {
      mergedSplices.push(s);
    }
  }

  return { text: applySplices(text, mergedSplices), splices: mergedSplices, createdIds, errors };
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

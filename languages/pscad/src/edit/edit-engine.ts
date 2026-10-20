// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  appendChildSplice,
  applySplices,
  removeElementSplice,
  setAttributeSplice,
  type Splice,
  type XmlElement,
} from "@modelscript/xml-cst";
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
  | { type: "removeWire"; id: string };

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
    `w="${op.w ?? 60}" h="${op.h ?? 60}" z="-1" orient="${op.orient ?? 0}" defn="${escapeAttr(op.defn)}" link="-1" q="4" disable="false">${eol}` +
    `${body}${eol}${indent}</User>`
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
          errors.push(`Component '${op.id}' has no paramlist.`);
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
        writeAttr(el, "x", String(x0));
        writeAttr(el, "y", String(y0));
        writeAttr(el, "w", String(Math.max(...xs) - Math.min(...xs) + 10));
        writeAttr(el, "h", String(Math.max(...ys) - Math.min(...ys) + 10));
        const verts = childrenNamed(el, "vertex");
        const first = verts[0];
        const last = verts[verts.length - 1];
        if (first && last) {
          const vindent = (() => {
            let vs = first.start;
            while (vs > 0 && (text[vs - 1] === " " || text[vs - 1] === "\t")) vs--;
            return text.slice(vs, first.start);
          })();
          splices.push({
            start: first.start,
            end: last.end,
            text: op.points.map((_, i) => `<vertex x="${xs[i]! - x0}" y="${ys[i]! - y0}" />`).join(`${eol}${vindent}`),
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
      case "removeWire": {
        const hit = findWire(model, op.id);
        if (!hit) {
          errors.push(`Wire '${op.id}' not found.`);
          break;
        }
        if (!removed.has(hit.wire.element.start)) {
          removed.add(hit.wire.element.start);
          splices.push(removeElementSplice(hit.wire.element, text));
        }
        break;
      }
    }
  }

  // Drop attribute writes that fall inside removed elements.
  const inRemoved = (s: Splice) =>
    splices.some((r) => r.text === "" && r.start <= s.start && s.end <= r.end && r !== s);
  for (const s of attrWrites.values()) if (!inRemoved(s)) splices.push(s);

  return { text: applySplices(text, splices), splices, createdIds, errors };
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

// SPDX-License-Identifier: AGPL-3.0-or-later

import { getMasterComponentSchema } from "../catalog/master-library-schemas.js";
import { buildProjectModel, type Pt } from "../model/pscad-model.js";
import { registeredExternalDefinitions } from "../model/workspace-registry.js";
import { computePortWorldPosition, parsePscx } from "../parser/pscx-parser.js";
import type { PscxModule } from "../types.js";
import { planPscadEdits, splicesToTextEdits, type PscadEditOp } from "./edit-engine.js";

/**
 * Translates diagram-protocol actions (move, connect, updateParameter, ...) into structural
 * PSCAD edits. Anything that cannot be resolved against the XML model is reported in
 * `unresolved` so callers can fall back to another strategy instead of guessing.
 */
export interface DiagramEdge {
  id?: string;
  source: string;
  target: string;
  points?: Pt[];
}

export type DiagramAction =
  | {
      type: "move";
      items: {
        name: string;
        x: number;
        y: number;
        width: number;
        height: number;
        rotation?: number;
        edges?: DiagramEdge[];
      }[];
    }
  | { type: "rotate"; item: { name: string; rotation?: number } }
  | { type: "updateParameter"; name: string; parameter: string; value: unknown }
  | { type: "updateProperty"; name: string; key: string; value: unknown }
  | { type: "updateName"; oldName: string; newName: string }
  | { type: "addComponent"; className: string; name?: string; x: number; y: number; section?: string }
  | { type: "deleteComponents"; names: string[] }
  | {
      type: "connect";
      source: string;
      target: string;
      sourcePort?: string;
      targetPort?: string;
      points?: Pt[];
      section?: string;
    }
  | { type: "disconnect"; source: string; target: string }
  | { type: "moveEdge"; edges: DiagramEdge[] }
  | {
      type: "reconnect";
      edgeId?: string;
      oldSource: string;
      oldTarget: string;
      newSource: string;
      newTarget: string;
      newSourcePort?: string;
      newTargetPort?: string;
      points?: Pt[];
    }
  | { type: string };

export interface PlannedDiagramEdits {
  edits: ReturnType<typeof splicesToTextEdits>;
  createdIds: string[];
  unresolved: string[];
  renderHint: "none" | "immediate" | "debounced";
}

const stripPrefix = (raw: string): string =>
  raw.startsWith("cmp_") || raw.startsWith("bus_") ? raw.slice(4) : raw.startsWith("wire_") ? raw.slice(5) : raw;

/** Makes every segment axis-aligned by inserting elbows (horizontal-first). */
export function orthogonalize(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && prev.x !== p.x && prev.y !== p.y) out.push({ x: p.x, y: prev.y });
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

export function planDiagramActions(text: string, actions: DiagramAction[]): PlannedDiagramEdits {
  const external = registeredExternalDefinitions();
  const model = buildProjectModel(text, external);
  const project = parsePscx(text);
  const modules: PscxModule[] = [project.rootModule, ...project.subModules.values()];
  const legacyCmps = modules.flatMap((m) => m.components);
  const legacyWires = modules.flatMap((m) => m.wires);

  const instances = [...model.definitions.values()].flatMap((d) => d.instances.map((i) => ({ d, i })));
  const wires = [...model.definitions.values()].flatMap((d) => d.wires.map((w) => ({ d, w })));

  const ops: PscadEditOp[] = [];
  const unresolved: string[] = [];
  let renderHint: "none" | "immediate" | "debounced" = "none";
  const touchedWires = new Set<string>();

  const findInst = (name: string) => {
    const id = stripPrefix(name);
    return (
      instances.find(({ i }) => i.id === id || i.id === name) ??
      instances.find(({ i }) => (i.params.get("Name") ?? i.params.get("name")) === name)
    );
  };
  const wireIndex = (name: string) => {
    const id = stripPrefix(name);
    return wires.find(({ w }) => w.id === id || w.id === name);
  };
  const portWorld = (endpoint: string, port?: string): Pt | undefined => {
    const [cell, dotted] = endpoint.includes(".") ? endpoint.split(".", 2) : [endpoint, undefined];
    const id = stripPrefix(cell ?? endpoint);
    const cmp = legacyCmps.find((c) => c.id === id || c.id === endpoint || c.instanceName === endpoint);
    if (!cmp) return undefined;
    const want = port ?? dotted;
    const p =
      (want ? cmp.ports.find((q) => q.name === want || q.id === want || q.id === `${cmp.id}_${want}`) : undefined) ??
      cmp.ports[0];
    if (!p) return { x: cmp.position.x, y: cmp.position.y };
    const w = computePortWorldPosition(cmp.position, p.position, cmp.rotation ?? 0, Boolean(cmp.mirror));
    return { x: Math.round(w.x), y: Math.round(w.y) };
  };
  const tokensOf = (ep: string): string[] => {
    const raw = ep.trim();
    const t = new Set([raw, stripPrefix(raw)]);
    if (raw.includes(".")) {
      const [c, p] = raw.split(".", 2);
      if (c) {
        t.add(c);
        t.add(stripPrefix(c));
      }
      if (p) t.add(p);
    }
    return [...t];
  };
  const wireTouches = (wid: string, ep: string): boolean => {
    const lw = legacyWires.find((w) => w.id === wid);
    if (!lw) return false;
    const toks = tokensOf(ep);
    return lw.connectedPortIds.some((pid) => toks.some((t) => pid === t || pid.startsWith(`${t}_`)));
  };
  const matchWire = (e: { id?: string | undefined; source: string; target: string }) => {
    if (e.id) {
      const direct = wireIndex(e.id);
      if (direct) return direct;
    }
    const direct = wireIndex(e.source);
    if (direct) return direct;
    return wires.find(({ w }) => wireTouches(w.id, e.source) && wireTouches(w.id, e.target));
  };
  const setPoints = (wid: string, pts: Pt[]) => {
    if (touchedWires.has(wid)) return;
    touchedWires.add(wid);
    ops.push({ type: "setWirePoints", id: wid, points: orthogonalize(pts) });
  };
  const orientCode = (rotation: number): number => {
    const deg = ((Math.round(rotation) % 360) + 360) % 360;
    return deg % 90 === 0 ? (deg / 90) % 4 : deg;
  };

  for (const action of actions) {
    switch (action.type) {
      case "move": {
        const a = action as Extract<DiagramAction, { type: "move" }>;
        for (const item of a.items) {
          const hit = findInst(item.name);
          if (!hit) {
            unresolved.push(item.name);
            continue;
          }
          const nx = Math.round(item.width > 0 ? item.x + item.width / 2 : item.x);
          const ny = Math.round(item.height > 0 ? item.y + item.height / 2 : item.y);
          const move: PscadEditOp = { type: "moveComponent", id: hit.i.id, x: nx, y: ny };
          if (item.rotation !== undefined) (move as { orient?: number }).orient = orientCode(item.rotation);
          ops.push(move);
          renderHint = "immediate";
          if (item.edges?.length) {
            for (const edge of item.edges) {
              const w = edge.points && edge.points.length >= 2 ? matchWire(edge) : undefined;
              if (w && edge.points) setPoints(w.w.id, edge.points);
            }
          }
          const dx = nx - hit.i.x;
          const dy = ny - hit.i.y;
          if (dx !== 0 || dy !== 0) {
            const lc = legacyCmps.find((c) => c.id === hit.i.id);
            const ids = new Set(lc?.ports.map((p) => p.id) ?? []);
            for (const lw of legacyWires) {
              if (touchedWires.has(lw.id)) continue;
              const startAttached = Boolean(lw.startPortId && ids.has(lw.startPortId));
              const endAttached = Boolean(lw.endPortId && ids.has(lw.endPortId));
              if (!startAttached && !endAttached) continue;
              const pts = lw.vertices.map((v, idx) => {
                if (idx === 0 && startAttached) return { x: v.x + dx, y: v.y + dy };
                if (idx === lw.vertices.length - 1 && endAttached) return { x: v.x + dx, y: v.y + dy };
                return { x: v.x, y: v.y };
              });
              if (wireIndex(lw.id)) setPoints(lw.id, pts);
            }
          }
        }
        break;
      }
      case "rotate": {
        const a = action as Extract<DiagramAction, { type: "rotate" }>;
        const hit = findInst(a.item.name);
        if (!hit) {
          unresolved.push(a.item.name);
          break;
        }
        ops.push({
          type: "moveComponent",
          id: hit.i.id,
          x: hit.i.x,
          y: hit.i.y,
          orient: orientCode(a.item.rotation ?? 0),
        });
        renderHint = "immediate";
        break;
      }
      case "updateParameter":
      case "updateProperty": {
        const a = action as { name: string; parameter?: string; key?: string; value: unknown };
        const hit = findInst(a.name);
        const key = a.parameter ?? a.key;
        if (!hit || !key) {
          unresolved.push(a.name);
          break;
        }
        ops.push({ type: "setParameter", id: hit.i.id, name: key, value: String(a.value) });
        renderHint = "debounced";
        break;
      }
      case "updateName": {
        const a = action as Extract<DiagramAction, { type: "updateName" }>;
        const hit = findInst(a.oldName);
        if (!hit) {
          unresolved.push(a.oldName);
          break;
        }
        ops.push({
          type: "setParameter",
          id: hit.i.id,
          name: hit.i.params.has("name") ? "name" : "Name",
          value: a.newName,
        });
        renderHint = "immediate";
        break;
      }
      case "addComponent": {
        const a = action as Extract<DiagramAction, { type: "addComponent" }>;
        const schema = getMasterComponentSchema(a.className);
        const params: Record<string, string> = {};
        for (const p of schema?.parameters ?? []) params[p.key] = String(p.defaultValue);
        if (a.name) params["Name"] = a.name;
        ops.push({
          type: "addComponent",
          ...(a.section ? { definition: a.section } : {}),
          defn: a.className,
          x: a.x,
          y: a.y,
          ...(schema ? { w: schema.defaultWidth, h: schema.defaultHeight } : {}),
          params,
        });
        renderHint = "immediate";
        break;
      }
      case "deleteComponents": {
        const a = action as Extract<DiagramAction, { type: "deleteComponents" }>;
        for (const n of a.names) {
          const hit = findInst(n);
          if (hit) {
            ops.push({ type: "removeComponent", id: hit.i.id });
            renderHint = "immediate";
          } else unresolved.push(n);
        }
        break;
      }
      case "connect": {
        const a = action as Extract<DiagramAction, { type: "connect" }>;
        let pts = a.points && a.points.length >= 2 ? a.points : undefined;
        if (!pts) {
          const s = portWorld(a.source, a.sourcePort);
          const d = portWorld(a.target, a.targetPort);
          if (!s || !d) {
            unresolved.push(`${a.source}->${a.target}`);
            break;
          }
          pts = [s, d];
        }
        ops.push({ type: "addWire", ...(a.section ? { definition: a.section } : {}), points: orthogonalize(pts) });
        renderHint = "immediate";
        break;
      }
      case "disconnect": {
        const a = action as Extract<DiagramAction, { type: "disconnect" }>;
        const w = matchWire(a);
        if (!w) {
          unresolved.push(`${a.source}->${a.target}`);
          break;
        }
        ops.push({ type: "removeWire", id: w.w.id });
        renderHint = "immediate";
        break;
      }
      case "moveEdge": {
        const a = action as Extract<DiagramAction, { type: "moveEdge" }>;
        for (const e of a.edges) {
          if (!e.points || e.points.length < 2) continue;
          const w = matchWire(e);
          if (!w) {
            unresolved.push(`${e.source}->${e.target}`);
            continue;
          }
          setPoints(w.w.id, e.points);
          renderHint = "immediate";
        }
        break;
      }
      case "reconnect": {
        const a = action as Extract<DiagramAction, { type: "reconnect" }>;
        const w = matchWire({ id: a.edgeId, source: a.oldSource, target: a.oldTarget });
        if (!w) {
          unresolved.push(`${a.oldSource}->${a.oldTarget}`);
          break;
        }
        let pts = a.points && a.points.length >= 2 ? a.points : undefined;
        if (!pts) {
          const s = portWorld(a.newSource, a.newSourcePort) ?? w.w.vertices[0];
          const d = portWorld(a.newTarget, a.newTargetPort) ?? w.w.vertices[w.w.vertices.length - 1];
          if (!s || !d) {
            unresolved.push(`${a.newSource}->${a.newTarget}`);
            break;
          }
          pts = [s, d];
        }
        setPoints(w.w.id, pts);
        renderHint = "immediate";
        break;
      }
      default:
        unresolved.push(`unsupported action '${action.type}'`);
    }
  }

  const plan = planPscadEdits(text, ops, external);
  unresolved.push(...plan.errors);
  return {
    edits: splicesToTextEdits(text, plan.splices),
    createdIds: plan.createdIds,
    unresolved,
    renderHint,
  };
}

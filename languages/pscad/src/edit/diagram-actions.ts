// SPDX-License-Identifier: AGPL-3.0-or-later

import { getMasterComponentSchema } from "../catalog/master-library-schemas.js";
import { buildProjectModel, type Pt } from "../model/pscad-model.js";
import { registeredExternalDefinitions } from "../model/workspace-registry.js";
import { computePortWorldPosition, parsePscx } from "../parser/pscx-parser.js";
import type { PscxModule } from "../types.js";
import { findElementById, planPscadEdits, splicesToTextEdits, type PscadEditOp } from "./edit-engine.js";

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
  | {
      type: "resize";
      item?: {
        name: string;
        x: number;
        y: number;
        width: number;
        height: number;
        rotation?: number;
        edges?: DiagramEdge[];
      };
      items?: {
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
  | { type: "toggleDisable"; name: string; disabled?: boolean }
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
  raw.startsWith("cmp_") || raw.startsWith("bus_")
    ? raw.slice(4)
    : raw.startsWith("wire_")
      ? raw.slice(5)
      : raw.startsWith("sticky_")
        ? raw.slice(7)
        : raw;

export interface ObstacleBox {
  id?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function segmentIntersectsBox(p1: Pt, p2: Pt, box: ObstacleBox): boolean {
  const minX = box.x - box.w / 2;
  const maxX = box.x + box.w / 2;
  const minY = box.y - box.h / 2;
  const maxY = box.y + box.h / 2;
  const sx1 = Math.min(p1.x, p2.x);
  const sx2 = Math.max(p1.x, p2.x);
  const sy1 = Math.min(p1.y, p2.y);
  const sy2 = Math.max(p1.y, p2.y);
  // Strict interior intersection so endpoints on component boundary ports don't trigger false positives
  return sx2 > minX + 2 && sx1 < maxX - 2 && sy2 > minY + 2 && sy1 < maxY - 2;
}

/**
 * Makes every segment axis-aligned by inserting elbows (horizontal-first by default, or
 * vertical-first / Z-bend when an obstacle box blocks the horizontal-first elbow), and
 * collapses consecutive duplicate or collinear points.
 */
export function orthogonalize(points: Pt[], obstacles?: ObstacleBox[]): Pt[] {
  const raw: Pt[] = [];
  for (const p of points) {
    const prev = raw[raw.length - 1];
    if (prev && prev.x !== p.x && prev.y !== p.y) {
      const horizElbow: Pt = { x: p.x, y: prev.y };
      const vertElbow: Pt = { x: prev.x, y: p.y };
      if (obstacles && obstacles.length > 0) {
        const horizBlocked = obstacles.some(
          (b) => segmentIntersectsBox(prev, horizElbow, b) || segmentIntersectsBox(horizElbow, p, b),
        );
        const vertBlocked = obstacles.some(
          (b) => segmentIntersectsBox(prev, vertElbow, b) || segmentIntersectsBox(vertElbow, p, b),
        );
        if (horizBlocked && !vertBlocked) {
          raw.push(vertElbow);
        } else if (horizBlocked && vertBlocked) {
          const midX = Math.round((prev.x + p.x) / 2 / 18) * 18;
          raw.push({ x: midX, y: prev.y }, { x: midX, y: p.y });
        } else {
          raw.push(horizElbow);
        }
      } else {
        raw.push(horizElbow);
      }
    }
    raw.push({ x: p.x, y: p.y });
  }
  // Collapse duplicate and collinear intermediate points
  const out: Pt[] = [];
  for (const pt of raw) {
    const last = out[out.length - 1];
    if (last && last.x === pt.x && last.y === pt.y) continue;
    if (out.length >= 2) {
      const prev2 = out[out.length - 2]!;
      const prev1 = out[out.length - 1]!;
      if ((prev2.x === prev1.x && prev1.x === pt.x) || (prev2.y === prev1.y && prev1.y === pt.y)) {
        out[out.length - 1] = pt;
        continue;
      }
    }
    out.push(pt);
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
  const obstacles: ObstacleBox[] = instances.map(({ i }) => ({
    id: i.id,
    x: i.x,
    y: i.y,
    w: i.w > 0 ? i.w : 54,
    h: i.h > 0 ? i.h : 36,
  }));

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
  const setPoints = (wid: string, pts: Pt[], customObstacles?: ObstacleBox[]) => {
    if (touchedWires.has(wid)) return;
    touchedWires.add(wid);
    ops.push({ type: "setWirePoints", id: wid, points: orthogonalize(pts, customObstacles ?? obstacles) });
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
          if (item.name.startsWith("bus_")) {
            const busId = stripPrefix(item.name);
            ops.push({
              type: "resizeBus",
              id: busId,
              x: Math.round(item.x),
              y: Math.round(item.y),
              ...(item.width > 0 ? { w: Math.round(item.width) } : {}),
              ...(item.height > 0 ? { h: Math.round(item.height) } : {}),
            });
            renderHint = "immediate";
            continue;
          }
          if (item.name.startsWith("sticky_")) {
            const stickyId = stripPrefix(item.name);
            ops.push({
              type: "editSticky",
              id: stickyId,
              x: Math.round(item.x),
              y: Math.round(item.y),
              ...(item.width > 0 ? { w: Math.round(item.width) } : {}),
              ...(item.height > 0 ? { h: Math.round(item.height) } : {}),
            });
            renderHint = "immediate";
            continue;
          }
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
            const obs = obstacles.find((b) => b.id === hit.i.id);
            if (obs) {
              obs.x = nx;
              obs.y = ny;
            }
            const lc = legacyCmps.find((c) => c.id === hit.i.id);
            const ids = new Set(lc?.ports.map((p) => p.id) ?? []);
            for (const lw of legacyWires) {
              if (touchedWires.has(lw.id)) continue;
              const startAttached = Boolean(lw.startPortId && ids.has(lw.startPortId));
              const endAttached = Boolean(lw.endPortId && ids.has(lw.endPortId));
              if (!startAttached && !endAttached) continue;
              let pts = lw.vertices.map((v) => ({ x: v.x, y: v.y }));
              if (pts.length < 2) continue;

              if (startAttached && endAttached) {
                // Both ends attached to moved component: translate entire wire
                pts = pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
              } else if (startAttached) {
                const oldStart = { ...pts[0]! };
                pts[0] = { x: oldStart.x + dx, y: oldStart.y + dy };
                if (pts.length === 2) {
                  const wasHoriz = oldStart.y === pts[1]!.y;
                  const wasVert = oldStart.x === pts[1]!.x;
                  if (wasHoriz && pts[0]!.y !== pts[1]!.y && pts[0]!.x !== pts[1]!.x) {
                    const midX = Math.round((pts[0]!.x + pts[1]!.x) / 2 / 18) * 18;
                    if (midX === pts[0]!.x) {
                      pts = [pts[0]!, { x: pts[0]!.x, y: pts[1]!.y }, pts[1]!];
                    } else if (midX === pts[1]!.x) {
                      pts = [pts[0]!, { x: pts[1]!.x, y: pts[0]!.y }, pts[1]!];
                    } else {
                      pts = [pts[0]!, { x: midX, y: pts[0]!.y }, { x: midX, y: pts[1]!.y }, pts[1]!];
                    }
                  } else if (wasVert && pts[0]!.x !== pts[1]!.x && pts[0]!.y !== pts[1]!.y) {
                    const midY = Math.round((pts[0]!.y + pts[1]!.y) / 2 / 18) * 18;
                    if (midY === pts[0]!.y) {
                      pts = [pts[0]!, { x: pts[1]!.x, y: pts[0]!.y }, pts[1]!];
                    } else if (midY === pts[1]!.y) {
                      pts = [pts[0]!, { x: pts[0]!.x, y: pts[1]!.y }, pts[1]!];
                    } else {
                      pts = [pts[0]!, { x: pts[0]!.x, y: midY }, { x: pts[1]!.x, y: midY }, pts[1]!];
                    }
                  }
                } else {
                  // Adjust adjacent elbow so the interior segment stays orthogonal
                  if (pts[1]!.x === oldStart.x) pts[1]!.x = pts[0]!.x;
                  else if (pts[1]!.y === oldStart.y) pts[1]!.y = pts[0]!.y;
                }
              } else if (endAttached) {
                const lastIdx = pts.length - 1;
                const oldEnd = { ...pts[lastIdx]! };
                pts[lastIdx] = { x: oldEnd.x + dx, y: oldEnd.y + dy };
                if (pts.length === 2) {
                  const wasHoriz = pts[0]!.y === oldEnd.y;
                  const wasVert = pts[0]!.x === oldEnd.x;
                  if (wasHoriz && pts[0]!.y !== pts[1]!.y && pts[0]!.x !== pts[1]!.x) {
                    const midX = Math.round((pts[0]!.x + pts[1]!.x) / 2 / 18) * 18;
                    if (midX === pts[0]!.x) {
                      pts = [pts[0]!, { x: pts[0]!.x, y: pts[1]!.y }, pts[1]!];
                    } else if (midX === pts[1]!.x) {
                      pts = [pts[0]!, { x: pts[1]!.x, y: pts[0]!.y }, pts[1]!];
                    } else {
                      pts = [pts[0]!, { x: midX, y: pts[0]!.y }, { x: midX, y: pts[1]!.y }, pts[1]!];
                    }
                  } else if (wasVert && pts[0]!.x !== pts[1]!.x && pts[0]!.y !== pts[1]!.y) {
                    const midY = Math.round((pts[0]!.y + pts[1]!.y) / 2 / 18) * 18;
                    if (midY === pts[0]!.y) {
                      pts = [pts[0]!, { x: pts[1]!.x, y: pts[0]!.y }, pts[1]!];
                    } else if (midY === pts[1]!.y) {
                      pts = [pts[0]!, { x: pts[0]!.x, y: pts[1]!.y }, pts[1]!];
                    } else {
                      pts = [pts[0]!, { x: pts[0]!.x, y: midY }, { x: pts[1]!.x, y: midY }, pts[1]!];
                    }
                  }
                } else {
                  const prevIdx = lastIdx - 1;
                  if (pts[prevIdx]!.x === oldEnd.x) pts[prevIdx]!.x = pts[lastIdx]!.x;
                  else if (pts[prevIdx]!.y === oldEnd.y) pts[prevIdx]!.y = pts[lastIdx]!.y;
                }
              }
              if (wireIndex(lw.id)) {
                const relevantObstacles = obstacles.filter((b) => b.id !== hit.i.id);
                setPoints(lw.id, pts, relevantObstacles);
              }
            }
          }
        }
        break;
      }
      case "resize": {
        const a = action as Extract<DiagramAction, { type: "resize" }>;
        const resizeItems = a.items ?? (a.item ? [a.item] : []);
        for (const item of resizeItems) {
          const cleanId = stripPrefix(item.name);
          const isBus =
            item.name.startsWith("bus_") ||
            [...model.definitions.values()].some((d) =>
              d.wires.some((w) => (w.id === cleanId || w.id === item.name) && w.element.name === "Bus"),
            );
          if (isBus) {
            ops.push({
              type: "resizeBus",
              id: cleanId,
              x: Math.round(item.x),
              y: Math.round(item.y),
              ...(item.width > 0 ? { w: Math.round(item.width) } : {}),
              ...(item.height > 0 ? { h: Math.round(item.height) } : {}),
            });
            renderHint = "immediate";
            continue;
          }
          const isSticky =
            item.name.startsWith("sticky_") || findElementById(model.root, cleanId, new Set(["Sticky"])) !== undefined;
          if (isSticky) {
            ops.push({
              type: "editSticky",
              id: cleanId,
              x: Math.round(item.x),
              y: Math.round(item.y),
              ...(item.width > 0 ? { w: Math.round(item.width) } : {}),
              ...(item.height > 0 ? { h: Math.round(item.height) } : {}),
            });
            renderHint = "immediate";
            continue;
          }
          const hit = findInst(item.name);
          if (!hit) {
            unresolved.push(item.name);
            continue;
          }
          const nx = Math.round(item.width > 0 ? item.x + item.width / 2 : item.x);
          const ny = Math.round(item.height > 0 ? item.y + item.height / 2 : item.y);
          ops.push({ type: "moveComponent", id: hit.i.id, x: nx, y: ny });
          renderHint = "immediate";
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
      case "toggleDisable": {
        const a = action as Extract<DiagramAction, { type: "toggleDisable" }>;
        const hit = findInst(a.name);
        if (!hit) {
          unresolved.push(a.name);
          break;
        }
        ops.push({ type: "toggleDisable", id: hit.i.id, disabled: a.disabled });
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
        const isNetEndpoint = /datalabel|xnode|pgb|pin|port/i.test(hit.i.defnName);
        const oldNetName = hit.i.params.get("Name") ?? hit.i.params.get("name");
        if (isNetEndpoint && oldNetName) {
          ops.push({
            type: "renameNet",
            oldName: oldNetName,
            newName: a.newName,
          });
        } else {
          ops.push({
            type: "setParameter",
            id: hit.i.id,
            name: hit.i.params.has("name") ? "name" : "Name",
            value: a.newName,
          });
        }
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

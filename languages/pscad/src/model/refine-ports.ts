// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Point2D, PscxModule, PscxPort } from "../types.js";
import type { ModelDefinition } from "./pscad-model.js";

/** Inverse of `computePortWorldPosition`: world position -> component-local port offset. */
function worldToLocal(world: Point2D, cmpPos: Point2D, rotationDeg: number, mirror: boolean): Point2D {
  const dx = world.x - cmpPos.x;
  const dy = world.y - cmpPos.y;
  const rad = (-(rotationDeg % 360) * Math.PI) / 180;
  const cos = Math.round(Math.cos(rad) * 1e6) / 1e6;
  const sin = Math.round(Math.sin(rad) * 1e6) / 1e6;
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  return { x: mirror ? -lx : lx, y: ly };
}

function localToWorld(local: Point2D, cmpPos: Point2D, rotationDeg: number, mirror: boolean): Point2D {
  const lx = mirror ? -local.x : local.x;
  const rad = ((rotationDeg % 360) * Math.PI) / 180;
  const cos = Math.round(Math.cos(rad) * 1e6) / 1e6;
  const sin = Math.round(Math.sin(rad) * 1e6) / 1e6;
  return { x: cmpPos.x + (lx * cos - local.y * sin), y: cmpPos.y + (lx * sin + local.y * cos) };
}

/**
 * Reconciles guessed master-library port offsets with the ports the semantic model inferred from
 * the actual wire geometry. Catalog ports keep their names; their positions snap to where wires
 * really end. Wire ends with no matching catalog port become additional `pN` ports.
 */
export function refineModulePorts(mod: PscxModule, def: ModelDefinition | undefined): void {
  if (!def) return;
  const byId = new Map(def.instances.map((i) => [i.id, i]));
  for (const cmp of mod.components) {
    const inst = byId.get(cmp.id);
    if (!inst) continue;
    if (cmp.ports.length === 0) {
      const seen = new Set<string>();
      for (const dp of inst.ports.filter((p) => p.source === "definition")) {
        if (seen.has(dp.name)) continue;
        seen.add(dp.name);
        cmp.ports.push({
          id: `${cmp.id}_${dp.name}`,
          name: dp.name,
          kind: (dp.mode !== undefined ? dp.mode !== 3 : dp.electype === 0) ? "signal" : "electrical",
          dimension: dp.dim ?? 1,
          position: worldToLocal(dp, cmp.position, cmp.rotation ?? 0, Boolean(cmp.mirror)),
        });
      }
    }
    const inferred = inst.ports.filter((p) => p.source === "inferred");
    if (inferred.length === 0) continue;
    const rot = cmp.rotation ?? 0;
    const mirror = Boolean(cmp.mirror);
    const used = new Set<PscxPort>();
    const rest: { x: number; y: number }[] = [];
    // Exact hits first so they claim their catalog port.
    for (const ip of inferred) {
      const exact = cmp.ports.find(
        (p) =>
          !used.has(p) &&
          Math.hypot(
            localToWorld(p.position, cmp.position, rot, mirror).x - ip.x,
            localToWorld(p.position, cmp.position, rot, mirror).y - ip.y,
          ) < 1,
      );
      if (exact) used.add(exact);
      else rest.push(ip);
    }
    let extra = cmp.ports.length;
    for (const ip of rest) {
      const local = worldToLocal(ip, cmp.position, rot, mirror);
      let best: PscxPort | undefined;
      let bd = Infinity;
      for (const p of cmp.ports) {
        if (used.has(p)) continue;
        const d = Math.hypot(p.position.x - local.x, p.position.y - local.y);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      if (best) {
        best.position = local;
        used.add(best);
      } else {
        extra++;
        const port: PscxPort = {
          id: `${cmp.id}_p${extra}`,
          name: `p${extra}`,
          kind: "electrical",
          dimension: 3,
          position: local,
        };
        cmp.ports.push(port);
        used.add(port);
      }
    }
  }
}

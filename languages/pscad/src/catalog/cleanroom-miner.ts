// SPDX-License-Identifier: AGPL-3.0-or-later

import type { XmlElement } from "@modelscript/dsl/xml";
import type { DiagramComponentSpec, DiagramPortSpec, LibrarySymbolStub } from "@modelscript/runtime";
import { attr, buildProjectModel, childrenNamed, wireEnds, type Pt } from "../model/pscad-model.js";
import { registerPscadLibraryBundle } from "./library-package-adapter.js";

interface PortCandidate {
  port: DiagramPortSpec;
  count: number;
}

interface MinedComponentAccumulator {
  defn: string;
  paramDefaults: Map<string, string>;
  inferredPorts: Map<string, PortCandidate>;
  occurrences: number;
}

/** Snap an offset within 2px of PSCAD's 18px grid to the exact grid multiple. */
function snapToGrid18(v: number): number {
  const snapped = Math.round(v / 18) * 18;
  return Math.abs(v - snapped) <= 2 ? (snapped === 0 ? 0 : snapped) : v;
}

/** Collects endpoints from `<Wire classid="Bus">` elements (excluded from `def.wires`). */
function collectBusEndpoints(el: XmlElement): Pt[] {
  const pts: Pt[] = [];
  for (const c of el.children) {
    if (c.name === "schematic") {
      pts.push(...collectBusEndpoints(c));
      continue;
    }
    if (c.name !== "Wire") continue;
    const cls = attr(c, "classid");
    if (cls === "Branch") {
      pts.push(...collectBusEndpoints(c));
    } else if (cls === "Bus") {
      const ox = Number(attr(c, "x") ?? 0) || 0;
      const oy = Number(attr(c, "y") ?? 0) || 0;
      const verts = childrenNamed(c, "vertex").map((v) => ({
        x: ox + (Number(attr(v, "x") ?? 0) || 0),
        y: oy + (Number(attr(v, "y") ?? 0) || 0),
      }));
      if (verts.length > 0) {
        pts.push(verts[0]!);
        if (verts.length > 1) pts.push(verts[verts.length - 1]!);
      } else {
        const w = Number(attr(c, "w") ?? 0) || 0;
        const h = Number(attr(c, "h") ?? 0) || 0;
        if (w !== 0 || h !== 0) {
          pts.push({ x: ox, y: oy }, { x: ox + w, y: oy + h });
        }
      }
    }
  }
  return pts;
}

/** Inverse of PSCAD's `orientOffset`: maps a world-space delta back to canonical local `(dx, dy)`. */
function unorientOffset(delta: Pt, orient: number): Pt {
  let x = delta.x;
  let y = delta.y;
  switch (orient % 4) {
    case 1:
      [x, y] = [y, -x];
      break;
    case 2:
      [x, y] = [-x, -y];
      break;
    case 3:
      [x, y] = [-y, x];
      break;
  }
  if (orient >= 4) x = -x;
  return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y };
}

function pointOnOrthogonalSegment(p: Pt, a: Pt, b: Pt): boolean {
  if (a.x === b.x && p.x === a.x) {
    const lo = Math.min(a.y, b.y);
    const hi = Math.max(a.y, b.y);
    return p.y > lo && p.y < hi;
  }
  if (a.y === b.y && p.y === a.y) {
    const lo = Math.min(a.x, b.x);
    const hi = Math.max(a.x, b.x);
    return p.x > lo && p.x < hi;
  }
  return false;
}

function inferParamKind(val: string): "number" | "boolean" | "string" {
  const trimmed = val.trim();
  if (trimmed === "0" || trimmed === "1" || trimmed === "true" || trimmed === "false") {
    return "number";
  }
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?(\s*\[[^\]]+\])?$/.test(trimmed)) {
    return "number";
  }
  return "string";
}

function addPortCandidate(
  entry: MinedComponentAccumulator,
  dx: number,
  dy: number,
  name?: string,
  kind: "electrical" | "signal" = "electrical",
): void {
  const key = `${dx},${dy}`;
  const existing = entry.inferredPorts.get(key);
  if (existing) {
    existing.count++;
    if (name && existing.port.name.startsWith("Port")) {
      existing.port.name = name;
    }
    return;
  }
  const idx = entry.inferredPorts.size + 1;
  entry.inferredPorts.set(key, {
    port: {
      name: name ?? `Port${idx}`,
      kind,
      side: Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? "left" : "right") : dy < 0 ? "top" : "bottom",
      dx,
      dy,
    },
    count: 1,
  });
}

/**
 * Clean-room miner: scans one or more `.pscx` / `.pslx` XML texts, extracts `<paramlist>`
 * keys/defaults and wire-endpoint port offsets for `master:*` (or any) component instances,
 * and synthesizes `LibrarySymbolStub[]` + `DiagramComponentSpec[]` without touching `master.pslx`.
 */
export function mineCleanRoomLibraryFromPscx(pscxTexts: string[]): {
  symbols: LibrarySymbolStub[];
  diagrams: DiagramComponentSpec[];
} {
  const acc = new Map<string, MinedComponentAccumulator>();

  for (const text of pscxTexts) {
    let model;
    try {
      model = buildProjectModel(text);
    } catch {
      continue;
    }

    for (const def of model.definitions.values()) {
      const getOrCreateEntry = (defn: string): MinedComponentAccumulator => {
        let entry = acc.get(defn);
        if (!entry) {
          entry = {
            defn,
            paramDefaults: new Map(),
            inferredPorts: new Map(),
            occurrences: 0,
          };
          acc.set(defn, entry);
        }
        return entry;
      };

      for (const inst of def.instances) {
        if (!inst.defn) continue;
        const entry = getOrCreateEntry(inst.defn);
        entry.occurrences++;

        for (const [k, v] of inst.params.entries()) {
          if (!entry.paramDefaults.has(k)) {
            entry.paramDefaults.set(k, v);
          }
        }

        // Only trust exact definition-level ports (e.g., from .pslx / subpage definitions)
        for (const p of inst.ports) {
          if (p.source !== "definition") continue;
          const local = unorientOffset({ x: p.x - inst.x, y: p.y - inst.y }, inst.orient);
          addPortCandidate(entry, local.x, local.y, p.name, (p.dim ?? 1) > 1 ? "electrical" : "signal");
        }
      }

      // Collect non-junction wire endpoints and assign each to its single nearest instance
      const instancesWithNoDefPorts = def.instances.filter(
        (inst) => inst.defn && inst.defn !== "master:annotation" && !inst.ports.some((p) => p.source === "definition"),
      );
      if (instancesWithNoDefPorts.length === 0) continue;

      const candidateEndpoints: Pt[] = [];
      for (const w of def.wires) {
        for (const ep of wireEnds(w)) {
          // Skip endpoints that land on the interior of another wire segment (T-junctions)
          const isJunction = def.wires.some((other) => {
            if (other === w) return false;
            for (let k = 0; k + 1 < other.vertices.length; k++) {
              if (pointOnOrthogonalSegment(ep, other.vertices[k]!, other.vertices[k + 1]!)) {
                return true;
              }
            }
            return false;
          });
          if (!isJunction) candidateEndpoints.push(ep);
        }
      }
      candidateEndpoints.push(...collectBusEndpoints(def.element));

      for (const ep of candidateEndpoints) {
        let bestInst = undefined;
        let bestDist = Infinity;
        let bestNonZeroInst = undefined;
        let bestNonZeroDist = Infinity;
        for (const inst of instancesWithNoDefPorts) {
          const dx = ep.x - inst.x;
          const dy = ep.y - inst.y;
          const maxReach = Math.max(72, Math.max(inst.w, inst.h) / 2 + 36);
          if (Math.abs(dx) > maxReach || Math.abs(dy) > maxReach) continue;
          const d = Math.hypot(dx, dy);
          if (d < bestDist) {
            bestDist = d;
            bestInst = inst;
          }
          if (d > 0 && d < bestNonZeroDist) {
            bestNonZeroDist = d;
            bestNonZeroInst = inst;
          }
        }

        if (bestInst) {
          const entry = acc.get(bestInst.defn);
          if (entry) {
            const local = unorientOffset({ x: ep.x - bestInst.x, y: ep.y - bestInst.y }, bestInst.orient);
            addPortCandidate(entry, snapToGrid18(local.x), snapToGrid18(local.y));
          }
        }
        // If a label/ground/xnode sits directly on the wire endpoint (dist=0), also let the
        // nearest enclosing/adjacent component claim the endpoint.
        if (bestDist === 0 && bestNonZeroInst && bestNonZeroInst !== bestInst) {
          const entry = acc.get(bestNonZeroInst.defn);
          if (entry) {
            const local = unorientOffset(
              { x: ep.x - bestNonZeroInst.x, y: ep.y - bestNonZeroInst.y },
              bestNonZeroInst.orient,
            );
            addPortCandidate(entry, snapToGrid18(local.x), snapToGrid18(local.y));
          }
        }
      }
    }
  }

  const symbols: LibrarySymbolStub[] = [];
  const diagrams: DiagramComponentSpec[] = [];

  for (const entry of acc.values()) {
    const shortName = entry.defn.includes(":") ? entry.defn.split(":").pop()! : entry.defn;
    const parameters = Array.from(entry.paramDefaults.entries()).map(([key, val]) => ({
      key,
      label: key,
      tab: "General",
      group: "Parameters",
      kind: inferParamKind(val),
      defaultValue: val,
      description: `Clean-room mined parameter '${key}' (observed in ${entry.occurrences} instance(s))`,
    }));

    symbols.push({
      name: shortName,
      kind: "pscad_component",
      ruleName: "UserCmpDefn",
      namePath: entry.defn,
      exports: parameters.map((p) => p.key),
      inherits: [],
      metadata: {
        label: shortName,
        category: "Mined Clean-Room Components",
        domain: "electrical",
        parameters,
        occurrences: entry.occurrences,
      },
    });

    const candidates = Array.from(entry.inferredPorts.values()).sort((a, b) => b.count - a.count);
    const maxCount = candidates[0]?.count ?? 0;
    const isSinglePortDominant = maxCount >= 30 && (candidates[1]?.count ?? 0) < maxCount * 0.15;
    const relRatio = isSinglePortDominant ? 0.15 : 0.08;
    const minCount = Math.max(entry.occurrences >= 4 ? 2 : 1, Math.floor(maxCount * relRatio));
    const filteredPorts = candidates
      .filter((c) => c.count >= minCount)
      .map((c, idx) => ({
        ...c.port,
        name: c.port.name.startsWith("Port") ? `Port${idx + 1}` : c.port.name,
      }));

    diagrams.push({
      namePath: entry.defn,
      label: shortName,
      category: "Mined Clean-Room Components",
      domain: "electrical",
      width: 64,
      height: Math.max(48, filteredPorts.length * 20),
      ports: filteredPorts,
    });
  }

  return { symbols, diagrams };
}

/**
 * Merges mined clean-room symbols/diagrams with authored clean-room definitions.
 * Authored entries take precedence for ports and parameter metadata, while mined entries
 * supply additional components and any extra parameter keys observed in public `.pscx` files.
 */
export function mergeCleanRoomWithCatalog(
  mined: { symbols: LibrarySymbolStub[]; diagrams: DiagramComponentSpec[] },
  authored: { symbols: LibrarySymbolStub[]; diagrams: DiagramComponentSpec[] },
): { symbols: LibrarySymbolStub[]; diagrams: DiagramComponentSpec[] } {
  const symMap = new Map<string, LibrarySymbolStub>();
  for (const s of mined.symbols) symMap.set(s.namePath, s);
  for (const s of authored.symbols) {
    const prev = symMap.get(s.namePath);
    if (!prev) {
      symMap.set(s.namePath, s);
      continue;
    }
    const authoredParams = ((s.metadata?.["parameters"] as Array<{ key: string }>) ?? []).slice();
    const seenKeys = new Set(authoredParams.map((p) => p.key));
    const minedParams = (prev.metadata?.["parameters"] as Array<{ key: string }>) ?? [];
    for (const mp of minedParams) {
      if (!seenKeys.has(mp.key)) {
        authoredParams.push(mp);
        seenKeys.add(mp.key);
      }
    }
    symMap.set(s.namePath, {
      ...s,
      exports: authoredParams.map((p) => p.key),
      metadata: {
        ...prev.metadata,
        ...s.metadata,
        parameters: authoredParams,
      },
    });
  }

  const diagMap = new Map<string, DiagramComponentSpec>();
  for (const d of mined.diagrams) diagMap.set(d.namePath, d);
  for (const d of authored.diagrams) diagMap.set(d.namePath, d);

  return {
    symbols: Array.from(symMap.values()),
    diagrams: Array.from(diagMap.values()),
  };
}

/**
 * Mines `.pscx` texts and immediately registers the resulting clean-room library
 * into `globalLibraryRegistry` under the given package name.
 */
export function registerMinedCleanRoomLibrary(packageName: string, pscxTexts: string[]) {
  const { symbols, diagrams } = mineCleanRoomLibraryFromPscx(pscxTexts);
  return registerPscadLibraryBundle(
    {
      name: packageName,
      version: "0.1.0",
      modelscript: {
        category: "library",
        language: "pscad",
        symbols: "./dist/symbols.json",
        diagrams: "./dist/diagrams.json",
      },
    },
    { symbols, diagrams },
  );
}

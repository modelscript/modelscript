// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseXml, type XmlElement } from "@modelscript/dsl/xml";

/**
 * Semantic model of a PSCAD project (`.pscx`/`.pslx`) built on the lossless XML CST.
 *
 * Every entity keeps its source `element` (exact offsets), so diagrams, LSP features and the
 * edit engine can all address the original text without re-serializing anything.
 */

export interface Pt {
  x: number;
  y: number;
}

export interface ModelPort {
  name: string;
  /** Local position relative to the owning definition's origin. */
  x: number;
  y: number;
  mode: number;
  dim: number;
  datatype: number;
  electype: number;
  element: XmlElement;
}

export interface ModelInstance {
  id: string;
  /** Raw `defn` value, e.g. `master:resistor` or `DC_EMT_lib:AC_Grid_Eq`. */
  defn: string;
  /** Library part (`master`, a project name) and definition name. */
  lib: string;
  defnName: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  orient: number;
  disabled: boolean;
  params: Map<string, string>;
  element: XmlElement;
  /** Ports resolved at the instance (user definitions or catalog); empty for unknown masters. */
  ports: ResolvedPort[];
}

export interface ResolvedPort {
  name: string;
  /** Absolute canvas position. */
  x: number;
  y: number;
  /** How the position was determined. */
  source: "definition" | "catalog" | "inferred";
  dim?: number;
  electype?: number;
  /** PSCAD port mode: 1 = signal input, 2 = signal output, 3 = electrical. */
  mode?: number;
}

export interface ModelWire {
  id: string;
  /** Absolute vertices (wire origin + relative vertex offsets). */
  vertices: Pt[];
  element: XmlElement;
}

import { parseChecksSegment, parseFlyBySegment, parseScriptElement } from "../script/script-parser.js";
import type { PscadCheckRule, PscadFlyByDoc, PscadScriptSegment } from "../types.js";

export interface ModelDefinition {
  name: string;
  id: string;
  params: Map<string, string>;
  ports: ModelPort[];
  instances: ModelInstance[];
  wires: ModelWire[];
  element: XmlElement;
  scripts?: Map<string, PscadScriptSegment> | undefined;
  flyBy?: PscadFlyByDoc | undefined;
  checks?: PscadCheckRule[] | undefined;
}

export interface PscadProjectModel {
  name: string;
  version: string;
  target: string;
  definitions: Map<string, ModelDefinition>;
  root: XmlElement;
  errors: { start: number; end: number }[];
}

const num = (s: string | undefined, d = 0): number => {
  const v = s === undefined ? NaN : Number(s);
  return Number.isFinite(v) ? v : d;
};

export function attr(el: XmlElement, name: string): string | undefined {
  return el.attributes.find((a) => a.name === name)?.value;
}

export function childrenNamed(el: XmlElement, name: string): XmlElement[] {
  return el.children.filter((c) => c.name === name);
}

export function readParamList(el: XmlElement): Map<string, string> {
  const out = new Map<string, string>();
  for (const pl of childrenNamed(el, "paramlist")) {
    for (const p of childrenNamed(pl, "param")) {
      const name = attr(p, "name");
      if (name !== undefined) out.set(name, attr(p, "value") ?? "");
    }
  }
  return out;
}

/** Applies PSCAD orientation (0-3 rotation steps, 4-7 mirrored) to a local offset. */
export function orientOffset(p: Pt, orient: number): Pt {
  let { x, y } = p;
  if (orient >= 4) x = -x;
  switch (orient % 4) {
    case 1:
      return { x: -y, y: x };
    case 2:
      return { x: -x, y: -y };
    case 3:
      return { x: y, y: -x };
    default:
      return { x, y };
  }
}

function collectSchematic(
  el: XmlElement,
  instances: ModelInstance[],
  wires: ModelWire[],
  catalogPorts?: (defn: string) => ModelPort[] | undefined,
): void {
  for (const c of el.children) {
    if (c.name === "User" && attr(c, "classid") === "UserCmp") {
      const defn = attr(c, "defn") ?? attr(c, "name") ?? "";
      const colon = defn.indexOf(":");
      instances.push({
        id: attr(c, "id") ?? "",
        defn,
        lib: colon >= 0 ? defn.slice(0, colon) : "",
        defnName: colon >= 0 ? defn.slice(colon + 1) : defn,
        x: num(attr(c, "x")),
        y: num(attr(c, "y")),
        w: num(attr(c, "w")),
        h: num(attr(c, "h")),
        z: num(attr(c, "z")),
        orient: num(attr(c, "orient")),
        disabled: attr(c, "disable") === "true",
        params: readParamList(c),
        element: c,
        ports: [],
      });
      void catalogPorts;
    } else if (c.name === "Wire") {
      const cls = attr(c, "classid");
      if (cls === "WireOrthogonal" || cls === "WireDiagonal") {
        const ox = num(attr(c, "x"));
        const oy = num(attr(c, "y"));
        wires.push({
          id: attr(c, "id") ?? "",
          vertices: childrenNamed(c, "vertex").map((v) => ({ x: ox + num(attr(v, "x")), y: oy + num(attr(v, "y")) })),
          element: c,
        });
      } else {
        // `Branch` wires wrap nested components; descend.
        collectSchematic(c, instances, wires, catalogPorts);
      }
    }
  }
}

export function buildProjectModel(source: string, external?: ExternalDefinitions): PscadProjectModel {
  const doc = parseXml(source);
  const root = doc.root;
  if (!root) {
    throw new Error("PSCAD project has no root element");
  }
  const model: PscadProjectModel = {
    name: attr(root, "name") ?? "",
    version: attr(root, "version") ?? "",
    target: attr(root, "Target") ?? "",
    definitions: new Map(),
    root,
    errors: doc.errors,
  };
  const defsEl = childrenNamed(root, "definitions")[0];
  for (const d of defsEl ? childrenNamed(defsEl, "Definition") : []) {
    const name = attr(d, "name") ?? "";
    const ports: ModelPort[] = [];
    const graphics = childrenNamed(d, "graphics")[0];
    for (const p of graphics ? childrenNamed(graphics, "Port") : []) {
      const pr = readParamList(p);
      ports.push({
        name: pr.get("name") ?? "",
        x: num(attr(p, "x")),
        y: num(attr(p, "y")),
        mode: num(pr.get("mode")),
        dim: num(pr.get("dim"), 1),
        datatype: num(pr.get("datatype")),
        electype: num(pr.get("electype")),
        element: p,
      });
    }
    const instances: ModelInstance[] = [];
    const wires: ModelWire[] = [];
    const sch = childrenNamed(d, "schematic")[0];
    if (sch) collectSchematic(sch, instances, wires);

    const scriptEl = childrenNamed(d, "script")[0];
    let scripts: Map<string, PscadScriptSegment> | undefined;
    let flyBy: PscadFlyByDoc | undefined;
    let checks: PscadCheckRule[] | undefined;
    if (scriptEl) {
      scripts = parseScriptElement(scriptEl, source);
      const flyByText = scripts.get("flyby")?.content;
      if (flyByText) flyBy = parseFlyBySegment(flyByText);
      const checksText = scripts.get("checks")?.content;
      if (checksText) checks = parseChecksSegment(checksText);
    }

    model.definitions.set(name, {
      name,
      id: attr(d, "id") ?? "",
      params: readParamList(d),
      ports,
      instances,
      wires,
      element: d,
      scripts,
      flyBy,
      checks,
    });
  }
  finalizeModel(model, external);
  return model;
}

/**
 * Builds every project of a workspace and resolves cross-file user definitions
 * (e.g. a case instantiating `DC_EMT_lib:AC_Grid_Eq` from a `.pslx`). Keyed by project name.
 */
export function buildWorkspaceModels(sources: string[]): Map<string, PscadProjectModel> {
  const models = sources.map((s) => buildProjectModel(s));
  const byName = new Map(models.map((m) => [m.name, m]));
  const lookup: ExternalDefinitions = (lib, name) => byName.get(lib)?.definitions.get(name);
  for (const m of models) finalizeModel(m, lookup);
  return byName;
}

/** Looks up a definition in another project, e.g. `DC_EMT_lib:AC_Grid_Eq`. */
export type ExternalDefinitions = (lib: string, name: string) => ModelDefinition | undefined;

/**
 * (Re)computes instance ports: user-definition ports first (local or external), then geometry-based
 * inference for the rest. Safe to call again once more projects of a workspace are known.
 */
export function finalizeModel(model: PscadProjectModel, external?: ExternalDefinitions): void {
  for (const def of model.definitions.values()) for (const i of def.instances) i.ports = [];
  resolvePorts(model, external);
  for (const def of model.definitions.values()) inferPorts(def);
}

function onSegment(p: Pt, a: Pt, b: Pt): boolean {
  return (
    p.x >= Math.min(a.x, b.x) &&
    p.x <= Math.max(a.x, b.x) &&
    p.y >= Math.min(a.y, b.y) &&
    p.y <= Math.max(a.y, b.y) &&
    (a.x === b.x ? p.x === a.x : a.y === b.y ? p.y === a.y : true)
  );
}

/** Distance from a point to an origin-centered component box (PSCAD x/y is the component center). */
function distToBox(p: Pt, i: ModelInstance): number {
  const swap = i.orient % 2 === 1;
  const hw = (swap ? i.h : i.w) / 2;
  const hh = (swap ? i.w : i.h) / 2;
  const dx = Math.max(Math.abs(p.x - i.x) - hw, 0);
  const dy = Math.max(Math.abs(p.y - i.y) - hh, 0);
  return Math.hypot(dx, dy);
}

/**
 * Master-library port layouts are not stored in project files, so for components without a known
 * layout we infer ports from wire ends that dangle next to the component body. Ends that land on
 * another wire are junctions, not ports.
 */
export function inferPorts(def: ModelDefinition, tolerance = 4): void {
  const segs = (except: ModelWire) =>
    def.wires
      .filter((w) => w !== except)
      .flatMap((w) => w.vertices.slice(1).map((v, k) => [w.vertices[k]!, v] as const));
  for (const w of def.wires) {
    const others = segs(w);
    for (const e of wireEnds(w)) {
      if (def.instances.some((i) => i.ports.some((p) => p.x === e.x && p.y === e.y))) continue;
      if (others.some(([a, b]) => onSegment(e, a, b))) continue;
      let best: ModelInstance | undefined;
      let bd = Infinity;
      for (const i of def.instances) {
        if (i.ports.some((p) => p.source === "definition")) continue;
        const d = distToBox(e, i);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      if (best && bd <= tolerance) best.ports.push({ name: "", x: e.x, y: e.y, source: "inferred" });
    }
  }
}

/** Resolves instance ports from user definitions in the same project (cross-file in workspace phase). */
function resolvePorts(model: PscadProjectModel, external?: ExternalDefinitions): void {
  for (const def of model.definitions.values()) {
    for (const inst of def.instances) {
      const target =
        inst.lib === model.name || inst.lib === ""
          ? model.definitions.get(inst.defnName)
          : inst.lib === "master"
            ? undefined
            : external?.(inst.lib, inst.defnName);
      if (!target) continue;
      inst.ports = target.ports.map((p) => {
        const o = orientOffset({ x: p.x, y: p.y }, inst.orient);
        return {
          name: p.name,
          x: inst.x + o.x,
          y: inst.y + o.y,
          source: "definition" as const,
          dim: p.dim,
          electype: p.electype,
          mode: p.mode,
        };
      });
    }
  }
}

export function wireEnds(w: ModelWire): Pt[] {
  if (w.vertices.length === 0) return [];
  return [w.vertices[0]!, w.vertices[w.vertices.length - 1]!];
}

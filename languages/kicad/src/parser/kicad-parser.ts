// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/kicad — S-Expression Parser & KiCad 6/7/8/9 Document Extractor.
 *
 * Parses `.kicad_pcb` and `.kicad_sch` S-expressions into typed board and
 * schematic models, handling KiCad 6/7 (`fp_text`) and KiCad 8/9 (`property`)
 * conventions and footprint-to-board pad coordinate transformations.
 */

import type {
  KiCadArc,
  KiCadBoard,
  KiCadDiagnostic,
  KiCadDocument,
  KiCadFootprint,
  KiCadJunction,
  KiCadLabel,
  KiCadLayerDef,
  KiCadLibPin,
  KiCadLibSymbol,
  KiCadNet,
  KiCadNoConnect,
  KiCadPad,
  KiCadPinElectricalType,
  KiCadSchematic,
  KiCadSegment,
  KiCadStackupLayer,
  KiCadSymbolInstance,
  KiCadSymbolPinInstance,
  KiCadVia,
  KiCadWire,
  KiCadZone,
  SExprAtom,
  SExprList,
  SExprNode,
} from "../types.js";

// ── S-Expression Tokenizer & Parser ──

export function parseKiCadSExpr(source: string): { roots: SExprList[]; diagnostics: KiCadDiagnostic[] } {
  const diagnostics: KiCadDiagnostic[] = [];
  const roots: SExprList[] = [];
  const stack: { list: SExprList; hasHead: boolean }[] = [];
  const len = source.length;
  let i = 0;

  const pushNode = (node: SExprNode) => {
    if (stack.length === 0) {
      if (node.kind === "list") {
        roots.push(node);
      } else {
        diagnostics.push({
          code: "K1001",
          severity: "error",
          message: `Unexpected top-level atom '${node.value}' outside S-expression.`,
          span: node.span,
        });
      }
      return;
    }
    const top = stack[stack.length - 1]!;
    if (!top.hasHead && node.kind === "atom") {
      top.list.head = node.value;
      top.hasHead = true;
    } else {
      top.list.items.push(node);
    }
  };

  while (i < len) {
    const ch = source.charCodeAt(i);
    // Skip whitespace
    if (ch === 32 || ch === 9 || ch === 10 || ch === 13) {
      i++;
      continue;
    }
    // Line comments (# ...)
    if (ch === 35) {
      while (i < len && source.charCodeAt(i) !== 10) i++;
      continue;
    }
    // Open paren '('
    if (ch === 40) {
      const list: SExprList = { kind: "list", head: "", items: [], span: { startOffset: i, endOffset: i + 1 } };
      stack.push({ list, hasHead: false });
      i++;
      continue;
    }
    // Close paren ')'
    if (ch === 41) {
      if (stack.length === 0) {
        diagnostics.push({
          code: "K1001",
          severity: "error",
          message: "Unexpected closing parenthesis ')'.",
          span: { startOffset: i, endOffset: i + 1 },
        });
        i++;
        continue;
      }
      const finished = stack.pop()!;
      finished.list.span.endOffset = i + 1;
      pushNode(finished.list);
      i++;
      continue;
    }
    // Quoted string "..."
    if (ch === 34) {
      const start = i;
      i++;
      let out = "";
      let closed = false;
      while (i < len) {
        const c = source.charCodeAt(i);
        if (c === 92 && i + 1 < len) {
          const next = source[i + 1]!;
          if (next === "n") out += "\n";
          else if (next === "r") out += "\r";
          else if (next === "t") out += "\t";
          else out += next;
          i += 2;
          continue;
        }
        if (c === 34) {
          closed = true;
          i++;
          break;
        }
        out += source[i]!;
        i++;
      }
      if (!closed) {
        diagnostics.push({
          code: "K1001",
          severity: "error",
          message: "Unterminated string literal.",
          span: { startOffset: start, endOffset: i },
        });
      }
      const atom: SExprAtom = { kind: "atom", value: out, quoted: true, span: { startOffset: start, endOffset: i } };
      pushNode(atom);
      continue;
    }
    // Unquoted atom
    const start = i;
    while (i < len) {
      const c = source.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13 || c === 40 || c === 41 || c === 34) break;
      i++;
    }
    const atom: SExprAtom = {
      kind: "atom",
      value: source.slice(start, i),
      quoted: false,
      span: { startOffset: start, endOffset: i },
    };
    pushNode(atom);
  }

  while (stack.length > 0) {
    const unclosed = stack.pop()!;
    unclosed.list.span.endOffset = len;
    diagnostics.push({
      code: "K1001",
      severity: "error",
      message: `Unclosed S-expression '(${unclosed.list.head}'.`,
      span: unclosed.list.span,
    });
    if (stack.length === 0) roots.push(unclosed.list);
  }

  return { roots, diagnostics };
}

// ── S-Expr Navigation Helpers ──

function childLists(list: SExprList | undefined, head?: string): SExprList[] {
  if (!list) return [];
  const out: SExprList[] = [];
  for (const item of list.items) {
    if (item.kind === "list" && (head === undefined || item.head === head)) {
      out.push(item);
    }
  }
  return out;
}

function findList(list: SExprList | undefined, head: string): SExprList | undefined {
  if (!list) return undefined;
  for (const item of list.items) {
    if (item.kind === "list" && item.head === head) return item;
  }
  return undefined;
}

function atomAt(list: SExprList | undefined, index: number): string | undefined {
  const item = list?.items[index];
  return item && item.kind === "atom" ? item.value : undefined;
}

function numAt(list: SExprList | undefined, index: number, fallback = 0): number {
  const raw = atomAt(list, index);
  if (raw === undefined) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

function atomValues(list: SExprList | undefined): string[] {
  if (!list) return [];
  const out: string[] = [];
  for (const item of list.items) {
    if (item.kind === "atom") out.push(item.value);
  }
  return out;
}

function transformPadToBoard(fpAt: [number, number], fpRotDeg: number, padAt: [number, number]): [number, number] {
  // KiCad PCB uses clockwise-positive screen Y-down coordinates; footprint rotation is CCW in KiCad 7+.
  const rad = (-fpRotDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rx = padAt[0] * cos - padAt[1] * sin;
  const ry = padAt[0] * sin + padAt[1] * cos;
  return [fpAt[0] + rx, fpAt[1] + ry];
}

function normalizePadType(raw: string | undefined): KiCadPad["padType"] {
  if (raw === "thru_hole" || raw === "np_thru_hole" || raw === "connect") return raw;
  return "smd";
}

function normalizePadShape(raw: string | undefined): KiCadPad["shape"] {
  if (raw === "circle" || raw === "oval" || raw === "roundrect" || raw === "trapezoid" || raw === "custom") {
    return raw;
  }
  return "rect";
}

function orderEdgeCutsPolygon(segments: [[number, number], [number, number]][]): [number, number][] {
  if (segments.length === 0) return [];
  const eps = 1e-3;
  const samePt = (a: [number, number], b: [number, number]) =>
    Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;

  const remaining = segments.map((s) => ({ a: s[0], b: s[1], used: false }));
  const chain: [number, number][] = [remaining[0]!.a, remaining[0]!.b];
  remaining[0]!.used = true;

  for (let step = 0; step < remaining.length; step++) {
    const tail = chain[chain.length - 1]!;
    let found = false;
    for (const seg of remaining) {
      if (seg.used) continue;
      if (samePt(seg.a, tail)) {
        seg.used = true;
        if (!samePt(seg.b, chain[0]!)) chain.push(seg.b);
        found = true;
        break;
      }
      if (samePt(seg.b, tail)) {
        seg.used = true;
        if (!samePt(seg.a, chain[0]!)) chain.push(seg.a);
        found = true;
        break;
      }
    }
    if (!found) break;
  }
  return chain;
}

// ── Board (.kicad_pcb) Extractor ──

export function parseKiCadBoard(source: string): KiCadBoard {
  const { roots, diagnostics } = parseKiCadSExpr(source);
  const root = roots.find((r) => r.head === "kicad_pcb");

  if (!root) {
    diagnostics.push({
      code: "K1002",
      severity: "error",
      message: "Missing top-level '(kicad_pcb ...)' S-expression.",
    });
    return {
      kind: "kicad_pcb",
      version: "",
      generator: "",
      layers: [],
      stackup: [],
      nets: [],
      footprints: [],
      segments: [],
      arcs: [],
      vias: [],
      zones: [],
      outline: [],
      diagnostics,
    };
  }

  const version = atomAt(findList(root, "version"), 0) ?? "";
  const generator = atomAt(findList(root, "generator"), 0) ?? "";

  // Layers
  const layers: KiCadLayerDef[] = [];
  const layersNode = findList(root, "layers");
  for (const layerList of childLists(layersNode)) {
    const id = Number.parseInt(layerList.head, 10);
    const name = atomAt(layerList, 0) ?? "";
    const type = atomAt(layerList, 1) ?? "signal";
    const userName = atomAt(layerList, 2);
    if (Number.isFinite(id) && name) {
      const entry: KiCadLayerDef = { id, name, type };
      if (userName !== undefined) entry.userName = userName;
      layers.push(entry);
    }
  }

  // Stackup
  const stackup: KiCadStackupLayer[] = [];
  const setupNode = findList(root, "setup");
  const stackupNode = findList(setupNode, "stackup");
  for (const sl of childLists(stackupNode, "layer")) {
    const name = atomAt(sl, 0) ?? `Layer_${stackup.length + 1}`;
    const type = atomAt(findList(sl, "type"), 0) ?? "copper";
    const entry: KiCadStackupLayer = { name, type };
    const thick = findList(sl, "thickness");
    if (thick) entry.thicknessMm = numAt(thick, 0);
    const mat = atomAt(findList(sl, "material"), 0);
    if (mat !== undefined) entry.material = mat;
    const epsR = findList(sl, "epsilon_r");
    if (epsR) entry.dielectricConstant = numAt(epsR, 0);
    const lt = findList(sl, "loss_tangent");
    if (lt) entry.lossTangent = numAt(lt, 0);
    stackup.push(entry);
  }

  // Nets
  const nets: KiCadNet[] = [];
  const netById = new Map<number, string>();
  for (const netNode of childLists(root, "net")) {
    const id = Math.round(numAt(netNode, 0, -1));
    const name = atomAt(netNode, 1) ?? "";
    if (id >= 0) {
      nets.push({ id, name, span: netNode.span });
      netById.set(id, name);
    }
  }

  // Footprints
  const footprints: KiCadFootprint[] = [];
  for (const fpNode of childLists(root, "footprint")) {
    const libId = atomAt(fpNode, 0) ?? "";
    const layer = atomAt(findList(fpNode, "layer"), 0) ?? "F.Cu";
    const atNode = findList(fpNode, "at");
    const at: [number, number] = [numAt(atNode, 0), numAt(atNode, 1)];
    const rotation = numAt(atNode, 2, 0);

    let refDes = "";
    let value = "";
    let mpn: string | undefined;
    let dnp: boolean | undefined;

    // KiCad 8/9: (property "Reference" "U1")
    for (const prop of childLists(fpNode, "property")) {
      const key = (atomAt(prop, 0) ?? "").toLowerCase();
      const val = atomAt(prop, 1) ?? "";
      if (key === "reference") refDes = val;
      else if (key === "value") value = val;
      else if (key === "mpn" || key === "manufacturer_part_number") mpn = val;
    }
    // KiCad 6/7: (fp_text reference "U1")
    for (const ft of childLists(fpNode, "fp_text")) {
      const kind = (atomAt(ft, 0) ?? "").toLowerCase();
      const val = atomAt(ft, 1) ?? "";
      if (kind === "reference" && !refDes) refDes = val;
      else if (kind === "value" && !value) value = val;
    }
    const attrNode = findList(fpNode, "attr");
    if (attrNode && atomValues(attrNode).includes("dnp")) {
      dnp = true;
    }

    const pads: KiCadPad[] = [];
    for (const padNode of childLists(fpNode, "pad")) {
      const number = atomAt(padNode, 0) ?? "";
      const padType = normalizePadType(atomAt(padNode, 1));
      const shape = normalizePadShape(atomAt(padNode, 2));
      const pAtNode = findList(padNode, "at");
      const pAt: [number, number] = [numAt(pAtNode, 0), numAt(pAtNode, 1)];
      const pRot = numAt(pAtNode, 2, 0);
      const sizeNode = findList(padNode, "size");
      const size: [number, number] = [numAt(sizeNode, 0, 1), numAt(sizeNode, 1, 1)];
      const drillNode = findList(padNode, "drill");
      const drill = drillNode ? numAt(drillNode, 0, 0) : 0;
      const pLayers = atomValues(findList(padNode, "layers"));
      const pNetNode = findList(padNode, "net");
      const netId = pNetNode ? Math.round(numAt(pNetNode, 0, 0)) : 0;
      const netName = atomAt(pNetNode, 1) ?? netById.get(netId) ?? "";

      pads.push({
        number,
        padType,
        shape,
        at: pAt,
        boardPos: transformPadToBoard(at, rotation, pAt),
        rotation: pRot,
        size,
        drill,
        layers: pLayers,
        netId,
        netName,
      });
    }

    const fp: KiCadFootprint = {
      libId,
      refDes,
      value,
      layer,
      at,
      rotation,
      pads,
      span: fpNode.span,
    };
    if (mpn !== undefined) fp.mpn = mpn;
    if (dnp !== undefined) fp.dnp = dnp;
    footprints.push(fp);
  }

  // Segments (Traces)
  const segments: KiCadSegment[] = [];
  for (const seg of childLists(root, "segment")) {
    const startNode = findList(seg, "start");
    const endNode = findList(seg, "end");
    const netId = Math.round(numAt(findList(seg, "net"), 0, 0));
    segments.push({
      start: [numAt(startNode, 0), numAt(startNode, 1)],
      end: [numAt(endNode, 0), numAt(endNode, 1)],
      width: numAt(findList(seg, "width"), 0, 0.25),
      layer: atomAt(findList(seg, "layer"), 0) ?? "F.Cu",
      netId,
      netName: netById.get(netId) ?? "",
      span: seg.span,
    });
  }

  // Arcs
  const arcs: KiCadArc[] = [];
  for (const arc of childLists(root, "arc")) {
    const startNode = findList(arc, "start");
    const midNode = findList(arc, "mid");
    const endNode = findList(arc, "end");
    const netId = Math.round(numAt(findList(arc, "net"), 0, 0));
    arcs.push({
      start: [numAt(startNode, 0), numAt(startNode, 1)],
      mid: [numAt(midNode, 0), numAt(midNode, 1)],
      end: [numAt(endNode, 0), numAt(endNode, 1)],
      width: numAt(findList(arc, "width"), 0, 0.25),
      layer: atomAt(findList(arc, "layer"), 0) ?? "F.Cu",
      netId,
      netName: netById.get(netId) ?? "",
      span: arc.span,
    });
  }

  // Vias
  const vias: KiCadVia[] = [];
  for (const via of childLists(root, "via")) {
    const atNode = findList(via, "at");
    const netId = Math.round(numAt(findList(via, "net"), 0, 0));
    vias.push({
      at: [numAt(atNode, 0), numAt(atNode, 1)],
      size: numAt(findList(via, "size"), 0, 0.6),
      drill: numAt(findList(via, "drill"), 0, 0.3),
      layers: atomValues(findList(via, "layers")),
      netId,
      netName: netById.get(netId) ?? "",
      span: via.span,
    });
  }

  // Copper Zones
  const zones: KiCadZone[] = [];
  for (const zone of childLists(root, "zone")) {
    const netId = Math.round(numAt(findList(zone, "net"), 0, 0));
    const netName = atomAt(findList(zone, "net_name"), 0) ?? netById.get(netId) ?? "";
    const layer = atomAt(findList(zone, "layer"), 0) ?? "F.Cu";
    const clearanceNode = findList(findList(zone, "connect_pads"), "clearance");
    const ptsNode = findList(findList(zone, "polygon"), "pts");
    const vertices: [number, number][] = childLists(ptsNode, "xy").map((xy) => [numAt(xy, 0), numAt(xy, 1)]);
    const z: KiCadZone = { netId, netName, layer, vertices, span: zone.span };
    if (clearanceNode) z.clearance = numAt(clearanceNode, 0);
    zones.push(z);
  }

  // Board Outline (Edge.Cuts gr_rect, gr_poly, or chained gr_line)
  let outline: [number, number][] = [];
  for (const rect of childLists(root, "gr_rect")) {
    if (atomAt(findList(rect, "layer"), 0) !== "Edge.Cuts") continue;
    const s = findList(rect, "start");
    const e = findList(rect, "end");
    if (s && e) {
      const x1 = numAt(s, 0);
      const y1 = numAt(s, 1);
      const x2 = numAt(e, 0);
      const y2 = numAt(e, 1);
      outline = [
        [x1, y1],
        [x2, y1],
        [x2, y2],
        [x1, y2],
      ];
      break;
    }
  }
  if (outline.length === 0) {
    for (const poly of childLists(root, "gr_poly")) {
      if (atomAt(findList(poly, "layer"), 0) !== "Edge.Cuts") continue;
      const pts = childLists(findList(poly, "pts"), "xy").map((xy): [number, number] => [numAt(xy, 0), numAt(xy, 1)]);
      if (pts.length >= 3) {
        outline = pts;
        break;
      }
    }
  }
  if (outline.length === 0) {
    const edgeSegs: [[number, number], [number, number]][] = [];
    for (const line of childLists(root, "gr_line")) {
      if (atomAt(findList(line, "layer"), 0) !== "Edge.Cuts") continue;
      const s = findList(line, "start");
      const e = findList(line, "end");
      if (s && e) {
        edgeSegs.push([
          [numAt(s, 0), numAt(s, 1)],
          [numAt(e, 0), numAt(e, 1)],
        ]);
      }
    }
    outline = orderEdgeCutsPolygon(edgeSegs);
  }

  return {
    kind: "kicad_pcb",
    version,
    generator,
    layers,
    stackup,
    nets,
    footprints,
    segments,
    arcs,
    vias,
    zones,
    outline,
    diagnostics,
  };
}

// ── Schematic (.kicad_sch) Extractor ──

const VALID_PIN_TYPES = new Set<KiCadPinElectricalType>([
  "input",
  "output",
  "bidirectional",
  "tri_state",
  "passive",
  "free",
  "unspecified",
  "power_in",
  "power_out",
  "open_collector",
  "open_emitter",
  "no_connect",
]);

function normalizePinElectricalType(raw: string | undefined): KiCadPinElectricalType {
  if (raw && VALID_PIN_TYPES.has(raw as KiCadPinElectricalType)) {
    return raw as KiCadPinElectricalType;
  }
  return "unspecified";
}

function collectLibSymbolPins(symNode: SExprList, out: KiCadLibPin[]): void {
  for (const pin of childLists(symNode, "pin")) {
    const electricalType = normalizePinElectricalType(atomAt(pin, 0));
    const atNode = findList(pin, "at");
    const name = atomAt(findList(pin, "name"), 0) ?? "~";
    const number = atomAt(findList(pin, "number"), 0) ?? "";
    out.push({
      number,
      name,
      electricalType,
      at: [numAt(atNode, 0), numAt(atNode, 1)],
      rotation: numAt(atNode, 2, 0),
    });
  }
  for (const sub of childLists(symNode, "symbol")) {
    collectLibSymbolPins(sub, out);
  }
}

function transformLibPinToSheet(
  symAt: [number, number],
  symRotDeg: number,
  mirror: "x" | "y" | undefined,
  pinAt: [number, number],
): [number, number] {
  // KiCad lib_symbols use Y-up; schematic sheet uses Y-down.
  let lx = pinAt[0];
  let ly = -pinAt[1];
  if (mirror === "x") ly = -ly;
  else if (mirror === "y") lx = -lx;
  const rad = (-symRotDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rx = lx * cos - ly * sin;
  const ry = lx * sin + ly * cos;
  return [symAt[0] + rx, symAt[1] + ry];
}

export function parseKiCadSchematic(source: string): KiCadSchematic {
  const { roots, diagnostics } = parseKiCadSExpr(source);
  const root = roots.find((r) => r.head === "kicad_sch");

  if (!root) {
    diagnostics.push({
      code: "K1002",
      severity: "error",
      message: "Missing top-level '(kicad_sch ...)' S-expression.",
    });
    return {
      kind: "kicad_sch",
      version: "",
      generator: "",
      libSymbols: {},
      symbols: [],
      wires: [],
      junctions: [],
      noConnects: [],
      labels: [],
      diagnostics,
    };
  }

  const version = atomAt(findList(root, "version"), 0) ?? "";
  const generator = atomAt(findList(root, "generator"), 0) ?? "";

  // Parse embedded (lib_symbols ...) definitions
  const libSymbols: Record<string, KiCadLibSymbol> = {};
  const libSymbolsNode = findList(root, "lib_symbols");
  for (const symDef of childLists(libSymbolsNode, "symbol")) {
    const libId = atomAt(symDef, 0) ?? "";
    if (!libId) continue;
    const isPower = Boolean(findList(symDef, "power")) || libId.startsWith("power:");
    const pins: KiCadLibPin[] = [];
    collectLibSymbolPins(symDef, pins);
    libSymbols[libId] = { libId, isPower, pins };
  }

  const symbols: KiCadSymbolInstance[] = [];
  for (const sym of childLists(root, "symbol")) {
    const libId = atomAt(findList(sym, "lib_id"), 0) ?? "";
    const atNode = findList(sym, "at");
    const at: [number, number] = [numAt(atNode, 0), numAt(atNode, 1)];
    const rotation = numAt(atNode, 2, 0);
    const mirrorAtom = atomAt(findList(sym, "mirror"), 0);
    const mirror = mirrorAtom === "x" || mirrorAtom === "y" ? mirrorAtom : undefined;

    let refDes = "";
    let value = "";
    let footprint: string | undefined;
    let simDevice: string | undefined;
    let simParams: string | undefined;

    for (const prop of childLists(sym, "property")) {
      const k = (atomAt(prop, 0) ?? "").toLowerCase();
      const v = atomAt(prop, 1) ?? "";
      if (k === "reference") refDes = v;
      else if (k === "value") value = v;
      else if (k === "footprint") footprint = v;
      else if (k === "sim.device") simDevice = v;
      else if (k === "sim.params") simParams = v;
    }

    const libDef = libSymbols[libId];
    const resolvedPins: KiCadSymbolPinInstance[] = (libDef?.pins ?? []).map((p) => ({
      number: p.number,
      name: p.name,
      electricalType: p.electricalType,
      sheetPos: transformLibPinToSheet(at, rotation, mirror, p.at),
    }));

    const inst: KiCadSymbolInstance = {
      libId,
      refDes,
      value,
      at,
      rotation,
      pins: resolvedPins,
      span: sym.span,
    };
    if (footprint !== undefined) inst.footprint = footprint;
    if (simDevice !== undefined) inst.simDevice = simDevice;
    if (simParams !== undefined) inst.simParams = simParams;
    if (mirror !== undefined) inst.mirror = mirror;
    symbols.push(inst);
  }

  const wires: KiCadWire[] = [];
  for (const w of childLists(root, "wire")) {
    const pts = childLists(findList(w, "pts"), "xy");
    if (pts.length >= 2) {
      wires.push({
        start: [numAt(pts[0], 0), numAt(pts[0], 1)],
        end: [numAt(pts[1], 0), numAt(pts[1], 1)],
      });
    }
  }

  const junctions: KiCadJunction[] = childLists(root, "junction").map((j) => {
    const atNode = findList(j, "at");
    return { at: [numAt(atNode, 0), numAt(atNode, 1)] };
  });

  const noConnects: KiCadNoConnect[] = childLists(root, "no_connect").map((nc) => {
    const atNode = findList(nc, "at");
    return { at: [numAt(atNode, 0), numAt(atNode, 1)] };
  });

  const labels: KiCadLabel[] = [];
  for (const kind of ["label", "global_label", "hierarchical_label"] as const) {
    for (const lbl of childLists(root, kind)) {
      const name = atomAt(lbl, 0) ?? "";
      const atNode = findList(lbl, "at");
      labels.push({ kind, name, at: [numAt(atNode, 0), numAt(atNode, 1)] });
    }
  }

  return {
    kind: "kicad_sch",
    version,
    generator,
    libSymbols,
    symbols,
    wires,
    junctions,
    noConnects,
    labels,
    diagnostics,
  };
}

export function parseKiCadDocument(source: string): KiCadDocument {
  const { roots, diagnostics } = parseKiCadSExpr(source);
  const first = roots[0] ?? null;
  if (first?.head === "kicad_pcb") return parseKiCadBoard(source);
  if (first?.head === "kicad_sch") return parseKiCadSchematic(source);
  const kind = first?.head === "kicad_symbol_lib" || first?.head === "footprint" ? first.head : "unknown";
  return { kind, root: first, diagnostics };
}

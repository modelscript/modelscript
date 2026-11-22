// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/kicad — Bridge to `@modelscript/cad` Canonical `PCBLayout`.
 *
 * Converts a parsed `KiCadBoard` into ModelScript's canonical `PCBLayout` +
 * `NetlistGraph`, unlocking `runDRC`, `PCBRenderer`, `PCBRouter`,
 * `compileToIPC2581`, `compileToODB`, `generateGerbers`, and 3D PCBA clearance.
 */

import type {
  BomEntry,
  CopperZone,
  LayerStackup,
  Net,
  NetlistComponent,
  NetlistPin,
  PCBLayout,
  PadDefinition,
  TraceArc,
  TraceSegment,
  ViaDefinition,
} from "@modelscript/cad/ecad";
import type { KiCadBoard, KiCadPad } from "./types.js";

/** Map KiCad layer names to ModelScript canonical ECAD layer names. */
export function kicadLayerToCanonical(layer: string): string {
  switch (layer) {
    case "F.Cu":
      return "TopCopper";
    case "B.Cu":
      return "BottomCopper";
    case "F.SilkS":
    case "F.Silkscreen":
      return "TopSilkscreen";
    case "B.SilkS":
    case "B.Silkscreen":
      return "BottomSilkscreen";
    case "F.Mask":
      return "TopSolderMask";
    case "B.Mask":
      return "BottomSolderMask";
    case "F.Paste":
      return "TopPaste";
    case "B.Paste":
      return "BottomPaste";
    case "Edge.Cuts":
      return "BoardOutline";
    default:
      return layer;
  }
}

/** Map ModelScript canonical ECAD layer names back to KiCad layer names. */
export function canonicalLayerToKiCad(layer: string): string {
  switch (layer) {
    case "TopCopper":
      return "F.Cu";
    case "BottomCopper":
      return "B.Cu";
    case "TopSilkscreen":
      return "F.SilkS";
    case "BottomSilkscreen":
      return "B.SilkS";
    case "TopSolderMask":
      return "F.Mask";
    case "BottomSolderMask":
      return "B.Mask";
    case "TopPaste":
      return "F.Paste";
    case "BottomPaste":
      return "B.Paste";
    case "BoardOutline":
      return "Edge.Cuts";
    default:
      return layer;
  }
}

function mapPadShape(shape: KiCadPad["shape"]): PadDefinition["shape"] {
  if (shape === "circle" || shape === "oval" || shape === "roundrect") return shape;
  return "rect";
}

function resolvePadCopperLayer(pad: KiCadPad, fpLayer: string): string {
  if (pad.layers.includes("F.Cu") || pad.layers.includes("*.Cu")) return "TopCopper";
  if (pad.layers.includes("B.Cu")) return "BottomCopper";
  return kicadLayerToCanonical(fpLayer);
}

function mapStackupType(raw: string): LayerStackup["type"] {
  const t = raw.toLowerCase();
  if (t.includes("copper")) return "CONDUCTOR";
  if (t.includes("core") || t.includes("prepreg") || t.includes("dielectric")) return "DIELECTRIC";
  if (t.includes("mask")) return "SOLDERMASK";
  if (t.includes("silk")) return "SILKSCREEN";
  if (t.includes("paste")) return "PASTEMASK";
  return "OTHER";
}

/**
 * Converts a parsed `KiCadBoard` into ModelScript's canonical `PCBLayout`.
 */
export function kicadBoardToPcbLayout(board: KiCadBoard): PCBLayout {
  const pads: PadDefinition[] = [];
  const components: NetlistComponent[] = [];
  const netPins = new Map<string, NetlistPin[]>();
  const bom: Record<string, BomEntry> = {};

  for (const net of board.nets) {
    if (net.name) {
      netPins.set(net.name, []);
    }
  }

  for (const fp of board.footprints) {
    const ref = fp.refDes || fp.libId;
    const pinNames: string[] = [];

    for (const pad of fp.pads) {
      pinNames.push(pad.number);
      const layer = resolvePadCopperLayer(pad, fp.layer);
      pads.push({
        center: pad.boardPos,
        shape: mapPadShape(pad.shape),
        width: pad.size[0],
        height: pad.size[1],
        drill: pad.drill,
        layer,
        net: pad.netName,
        component: ref,
      });

      if (pad.netName) {
        let pins = netPins.get(pad.netName);
        if (!pins) {
          pins = [];
          netPins.set(pad.netName, pins);
        }
        pins.push({
          name: `${ref}.${pad.number}`,
          component: ref,
          localName: pad.number,
        });
      }
    }

    components.push({
      name: ref,
      pins: pinNames,
      placement: {
        footprint: fp.libId || null,
        layer: kicadLayerToCanonical(fp.layer),
        x: fp.at[0],
        y: fp.at[1],
        angle: fp.rotation,
      },
    });

    const bomEntry: BomEntry = { refDes: ref };
    if (fp.value) bomEntry.value = fp.value;
    if (fp.libId) bomEntry.footprint = fp.libId;
    if (fp.mpn !== undefined) bomEntry.mpn = fp.mpn;
    if (fp.dnp !== undefined) bomEntry.dnp = fp.dnp;
    bom[ref] = bomEntry;
  }

  const nets: Net[] = [];
  let totalPins = 0;
  for (const [id, pins] of netPins) {
    nets.push({ id, pins });
    totalPins += pins.length;
  }

  const traces: TraceSegment[] = board.segments.map((s) => ({
    start: s.start,
    end: s.end,
    width: s.width,
    layer: kicadLayerToCanonical(s.layer),
    net: s.netName,
  }));

  const arcs: TraceArc[] = board.arcs.map((a) => ({
    start: a.start,
    mid: a.mid,
    end: a.end,
    width: a.width,
    layer: kicadLayerToCanonical(a.layer),
    net: a.netName,
  }));

  const vias: ViaDefinition[] = board.vias.map((v) => ({
    center: v.at,
    drill: v.drill,
    annularRing: Math.max(0.05, (v.size - v.drill) / 2),
    net: v.netName,
  }));

  const zones: CopperZone[] = board.zones.map((z) => {
    const out: CopperZone = {
      net: z.netName,
      layer: kicadLayerToCanonical(z.layer),
      vertices: z.vertices,
    };
    if (z.clearance !== undefined) out.clearance = z.clearance;
    return out;
  });

  const stackup: LayerStackup[] = board.stackup.map((sl, idx) => {
    const canonicalName = kicadLayerToCanonical(sl.name);
    const entry: LayerStackup = {
      name: canonicalName,
      type: mapStackupType(sl.type),
      sequence: idx + 1,
    };
    if (canonicalName.startsWith("Top")) entry.side = "TOP";
    else if (canonicalName.startsWith("Bottom")) entry.side = "BOTTOM";
    else entry.side = "INTERNAL";
    if (sl.thicknessMm !== undefined) entry.thicknessMm = sl.thicknessMm;
    if (sl.material !== undefined) entry.material = sl.material;
    if (sl.dielectricConstant !== undefined) entry.dielectricConstant = sl.dielectricConstant;
    if (sl.lossTangent !== undefined) entry.lossTangent = sl.lossTangent;
    return entry;
  });

  const layout: PCBLayout = {
    traces,
    pads,
    vias,
    outline: board.outline.length >= 3 ? { vertices: board.outline } : null,
    netlist: {
      nets,
      components,
      totalPins,
      totalConnections: nets.reduce((acc, n) => acc + Math.max(0, n.pins.length - 1), 0),
    },
  };

  if (stackup.length > 0) layout.stackup = stackup;
  if (arcs.length > 0) layout.arcs = arcs;
  if (zones.length > 0) layout.zones = zones;
  if (Object.keys(bom).length > 0) layout.bom = bom;

  return layout;
}

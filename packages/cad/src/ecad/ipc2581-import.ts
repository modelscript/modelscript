// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IPC-2581B / IPC-2581C (DPMX) Importer.
 *
 * Parses standard IPC-2581 XML documents (exported by Altium Designer, Cadence
 * Allegro/OrCAD, Siemens Xpedition/PADS, KiCad, or ModelScript's own
 * `compileToIPC2581`) into the canonical `PCBLayout` + `NetlistGraph` model.
 *
 * Zero external XML dependencies: uses a lightweight single-pass streaming
 * XML element tree parser with unit normalization (INCH / MICRON -> MILLIMETER).
 */

import type {
  BoardOutline,
  BomEntry,
  LayerStackup,
  PCBLayout,
  PadDefinition,
  TraceSegment,
  ViaDefinition,
} from "./gerber.js";
import type { Net, NetlistComponent, NetlistGraph, NetlistPin } from "./netlist.js";

// ── Public Types ──

export interface IPC2581Diagnostic {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
}

export interface IPC2581Metadata {
  version: string;
  assemblyName: string;
  revision: string;
  units: "MILLIMETER" | "INCH" | "MICRON";
  enterprise?: string;
  designer?: string;
  ipcClass?: string;
  surfaceFinish?: string;
}

export interface IPC2581ParseResult {
  layout: PCBLayout;
  metadata: IPC2581Metadata;
  diagnostics: IPC2581Diagnostic[];
}

// ── Lightweight XML Parser ──

interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

function unescapeXml(str: string): string {
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(raw)) !== null) {
    const key = m[1]!;
    const val = m[2] !== undefined ? m[2] : (m[3] ?? "");
    attrs[key] = unescapeXml(val);
  }
  return attrs;
}

function stripNamespace(tag: string): string {
  const idx = tag.indexOf(":");
  return idx >= 0 ? tag.slice(idx + 1) : tag;
}

function parseXmlTree(xml: string, diagnostics: IPC2581Diagnostic[]): XmlNode | null {
  const root: XmlNode = { tag: "__root__", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];

  // Strip comments and processing instructions / DOCTYPE
  const cleaned = xml
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "");

  const tokenRe = /<(\/)?([A-Za-z_][\w:.-]*)([^>]*?)(\/)?>|([^<]+)/g;
  let m: RegExpExecArray | null;

  while ((m = tokenRe.exec(cleaned)) !== null) {
    const isClose = m[1] === "/";
    const rawTag = m[2];
    const rawAttrs = m[3] ?? "";
    const isSelfClose = m[4] === "/";
    const textChunk = m[5];

    if (textChunk !== undefined) {
      const trimmed = textChunk.trim();
      if (trimmed.length > 0) {
        const current = stack[stack.length - 1]!;
        current.text = current.text ? `${current.text} ${unescapeXml(trimmed)}` : unescapeXml(trimmed);
      }
      continue;
    }

    if (!rawTag) continue;
    const tag = stripNamespace(rawTag);

    if (isClose) {
      if (stack.length > 1 && stack[stack.length - 1]!.tag === tag) {
        stack.pop();
      } else {
        let foundIdx = -1;
        for (let i = stack.length - 1; i >= 1; i--) {
          if (stack[i]!.tag === tag) {
            foundIdx = i;
            break;
          }
        }
        if (foundIdx >= 1) {
          diagnostics.push({
            severity: "warning",
            code: "IPC2581_UNCLOSED_TAG",
            message: `Unclosed XML element <${stack[stack.length - 1]!.tag}> before </${tag}>.`,
          });
          stack.length = foundIdx;
        } else {
          diagnostics.push({
            severity: "warning",
            code: "IPC2581_UNMATCHED_CLOSE",
            message: `Unexpected closing tag </${tag}>.`,
          });
        }
      }
      continue;
    }

    const node: XmlNode = {
      tag,
      attrs: parseAttributes(rawAttrs),
      children: [],
      text: "",
    };
    stack[stack.length - 1]!.children.push(node);
    if (!isSelfClose) {
      stack.push(node);
    }
  }

  if (stack.length > 1) {
    diagnostics.push({
      severity: "warning",
      code: "IPC2581_UNCLOSED_EOF",
      message: `XML document ended with unclosed element <${stack[stack.length - 1]!.tag}>.`,
    });
  }

  return root.children.find((c) => c.tag === "IPC-2581") ?? root.children[0] ?? null;
}

function attr(node: XmlNode | undefined, key: string): string | undefined {
  return node?.attrs[key];
}

function findChild(node: XmlNode | undefined, tag: string): XmlNode | undefined {
  return node?.children.find((c) => c.tag === tag);
}

function findChildren(node: XmlNode | undefined, tag: string): XmlNode[] {
  return node ? node.children.filter((c) => c.tag === tag) : [];
}

function findAllDeep(node: XmlNode | undefined, tag: string, out: XmlNode[] = []): XmlNode[] {
  if (!node) return out;
  for (const child of node.children) {
    if (child.tag === tag) out.push(child);
    findAllDeep(child, tag, out);
  }
  return out;
}

// ── Unit & Shape Helpers ──

function unitScaleToMm(
  units: string | undefined,
  diagnostics: IPC2581Diagnostic[],
): { scale: number; normalized: "MILLIMETER" | "INCH" | "MICRON" } {
  const u = (units ?? "MILLIMETER").toUpperCase();
  if (u === "MILLIMETER" || u === "MM") return { scale: 1, normalized: "MILLIMETER" };
  if (u === "INCH" || u === "IN") return { scale: 25.4, normalized: "INCH" };
  if (u === "MICRON" || u === "UM") return { scale: 0.001, normalized: "MICRON" };
  diagnostics.push({
    severity: "warning",
    code: "IPC2581_UNKNOWN_UNITS",
    message: `Unknown IPC-2581 units '${units}'; defaulting to MILLIMETER.`,
  });
  return { scale: 1, normalized: "MILLIMETER" };
}

function parseNum(value: string | undefined, fallback = 0): number {
  if (value === undefined || value === "") return fallback;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePadShape(raw: string | undefined): PadDefinition["shape"] {
  const s = (raw ?? "rect").toLowerCase();
  if (s === "circle" || s === "round") return "circle";
  if (s === "oval" || s === "oblong") return "oval";
  if (s === "roundrect" || s === "rectround") return "roundrect";
  return "rect";
}

function normalizeLayerType(raw: string | undefined): LayerStackup["type"] {
  const t = (raw ?? "OTHER").toUpperCase();
  if (t === "CONDUCTOR" || t === "SIGNAL" || t === "PLANE" || t === "MIXED") return "CONDUCTOR";
  if (t === "DIELECTRIC" || t === "CORE" || t === "PREPREG") return "DIELECTRIC";
  if (t === "SOLDERMASK") return "SOLDERMASK";
  if (t === "SILKSCREEN" || t === "LEGEND") return "SILKSCREEN";
  if (t === "PASTEMASK" || t === "SOLDERPASTE") return "PASTEMASK";
  if (t === "DRILL") return "DRILL";
  return "OTHER";
}

function normalizeLayerSide(raw: string | undefined): LayerStackup["side"] | undefined {
  if (!raw) return undefined;
  const s = raw.toUpperCase();
  if (s === "TOP" || s === "BOTTOM" || s === "INTERNAL" || s === "ALL") return s;
  return undefined;
}

interface ParsedPrimitive {
  shape: PadDefinition["shape"];
  width: number;
  height: number;
  drill: number;
}

// ── Main Importer ──

/**
 * Parses an IPC-2581B / IPC-2581C XML string into ModelScript's canonical
 * `PCBLayout` + `NetlistGraph` representation.
 *
 * Supports both ModelScript's compact IPC-2581C dialect and standard
 * IPC-2581B/C exports from Altium Designer, Cadence Allegro/OrCAD,
 * Siemens Xpedition, and KiCad.
 */
export function parseIPC2581(xml: string): IPC2581ParseResult {
  const diagnostics: IPC2581Diagnostic[] = [];
  const doc = parseXmlTree(xml, diagnostics);

  if (!doc || doc.tag !== "IPC-2581") {
    diagnostics.push({
      severity: "error",
      code: "IPC2581_MISSING_ROOT",
      message: "Missing <IPC-2581> root element.",
    });
    return {
      layout: {
        traces: [],
        pads: [],
        vias: [],
        outline: null,
        netlist: { nets: [], components: [], totalPins: 0, totalConnections: 0 },
      },
      metadata: { version: "C", assemblyName: "UNKNOWN", revision: "1.0.0", units: "MILLIMETER" },
      diagnostics,
    };
  }

  // 1. Metadata & Units
  const ecadNode = findChild(doc, "Ecad");
  const cadHeader = findChild(ecadNode, "CadHeader");
  const unitsAttr = attr(cadHeader, "units") ?? attr(findChild(cadHeader, "Units"), "units");
  const { scale, normalized: normalizedUnits } = unitScaleToMm(unitsAttr, diagnostics);

  const logisticHeader = findChild(doc, "LogisticHeader");
  const historyRecord = findChild(doc, "HistoryRecord");
  const bomNode = findChild(doc, "Bom");
  const bomHeader = findChild(bomNode, "BomHeader");

  const metadata: IPC2581Metadata = {
    version: attr(doc, "version") ?? attr(doc, "revision") ?? "C",
    assemblyName: attr(ecadNode, "name") ?? attr(bomHeader, "assembly") ?? "PCB_ASSEMBLY",
    revision:
      findChild(historyRecord, "Revision")?.text ||
      attr(bomHeader, "revision") ||
      attr(findChild(logisticHeader, "Specification"), "revision") ||
      "1.0.0",
    units: normalizedUnits,
  };
  const enterprise = attr(findChild(logisticHeader, "Enterprise"), "name");
  if (enterprise !== undefined) metadata.enterprise = enterprise;
  const designer = attr(findChild(logisticHeader, "Person"), "name");
  if (designer !== undefined) metadata.designer = designer;
  const ipcClass = attr(findChild(logisticHeader, "Specification"), "class");
  if (ipcClass !== undefined) metadata.ipcClass = ipcClass;
  const surfaceFinish = attr(findChild(logisticHeader, "ManufacturingCharacteristics"), "finish");
  if (surfaceFinish !== undefined) metadata.surfaceFinish = surfaceFinish;

  // 2. BOM extraction (both compact <BomItem refDes> and standard <BomItem><RefDes name>)
  const bom: Record<string, BomEntry> = {};
  for (const item of findChildren(bomNode, "BomItem")) {
    const refDesList: string[] = [];
    const directRefDes = attr(item, "refDes");
    if (directRefDes) refDesList.push(directRefDes);
    for (const rd of findChildren(item, "RefDes")) {
      const name = attr(rd, "name");
      if (name) refDesList.push(name);
    }

    let value: string | undefined;
    let mpn: string | undefined = attr(item, "OEMDesignNumberRef");
    let footprint: string | undefined;
    let dnp: boolean | undefined;

    const chars = findChild(item, "Characteristics");
    for (const cat of findChildren(chars, "Category")) {
      const catName = (attr(cat, "name") ?? "").toLowerCase();
      const catVal = attr(cat, "value");
      if (!catVal) continue;
      if (catName === "electrical" || catName === "value") value = catVal;
      else if (catName === "mpn" || catName === "partnumber") mpn = catVal;
      else if (catName === "package" || catName === "footprint") footprint = catVal;
      else if (catName === "dnp") dnp = catVal.toLowerCase() === "true" || catVal.toLowerCase() === "yes";
    }
    for (const textChar of findChildren(chars, "Textual")) {
      const name = (attr(textChar, "textualCharacteristicName") ?? "").toLowerCase();
      const val = attr(textChar, "textualCharacteristicValue");
      if (!val) continue;
      if (name === "value") value = val;
      else if (name === "mpn") mpn = val;
      else if (name === "footprint" || name === "package") footprint = val;
    }

    for (const refDes of refDesList) {
      const entry: BomEntry = { refDes };
      if (value !== undefined) entry.value = value;
      if (mpn !== undefined) entry.mpn = mpn;
      if (footprint !== undefined) entry.footprint = footprint;
      if (dnp !== undefined) entry.dnp = dnp;
      bom[refDes] = entry;
    }
  }

  // 3. Layer Stackup (<LayerStack>/<LayerDef> and standard <CadData>/<Stackup>/<StackupGroup>/<StackupLayer>)
  const stackup: LayerStackup[] = [];
  const cadDataNode = findChild(ecadNode, "CadData") ?? ecadNode;

  const layerStack = findChild(cadDataNode, "LayerStack");
  for (const layerDef of findChildren(layerStack, "LayerDef")) {
    const entry: LayerStackup = {
      name: attr(layerDef, "name") ?? `Layer_${stackup.length + 1}`,
      type: normalizeLayerType(attr(layerDef, "type")),
      sequence: Math.round(parseNum(attr(layerDef, "sequence"), stackup.length + 1)),
    };
    const side = normalizeLayerSide(attr(layerDef, "side"));
    if (side !== undefined) entry.side = side;
    const thickness = attr(layerDef, "thickness");
    if (thickness !== undefined) entry.thicknessMm = parseNum(thickness) * scale;
    const material = attr(layerDef, "material");
    if (material !== undefined) entry.material = material;
    const er = attr(layerDef, "dielectricConstant");
    if (er !== undefined) entry.dielectricConstant = parseNum(er);
    const lt = attr(layerDef, "lossTangent");
    if (lt !== undefined) entry.lossTangent = parseNum(lt);
    stackup.push(entry);
  }

  if (stackup.length === 0) {
    const layerMeta = new Map<string, { type: LayerStackup["type"]; side?: LayerStackup["side"] }>();
    for (const layer of findChildren(cadDataNode, "Layer")) {
      const name = attr(layer, "name");
      if (name) {
        const meta: { type: LayerStackup["type"]; side?: LayerStackup["side"] } = {
          type: normalizeLayerType(attr(layer, "layerFunction")),
        };
        const side = normalizeLayerSide(attr(layer, "side"));
        if (side !== undefined) meta.side = side;
        layerMeta.set(name, meta);
      }
    }
    const stackupLayers = findAllDeep(findChild(cadDataNode, "Stackup"), "StackupLayer");
    for (const sl of stackupLayers) {
      const name = attr(sl, "layerOrGroupRef") ?? `Layer_${stackup.length + 1}`;
      const meta = layerMeta.get(name);
      const entry: LayerStackup = {
        name,
        type: meta?.type ?? "OTHER",
        sequence: Math.round(parseNum(attr(sl, "sequence"), stackup.length + 1)),
      };
      if (meta?.side !== undefined) entry.side = meta.side;
      const thickness = attr(sl, "thickness");
      if (thickness !== undefined) entry.thicknessMm = parseNum(thickness) * scale;
      const material = attr(sl, "matDes");
      if (material !== undefined) entry.material = material;
      const er = attr(sl, "er");
      if (er !== undefined) entry.dielectricConstant = parseNum(er);
      const lt = attr(sl, "lossTangent");
      if (lt !== undefined) entry.lossTangent = parseNum(lt);
      stackup.push(entry);
    }
  }

  // 4. Standard Primitives & Padstacks (<DictionaryStandard> + <PadstackGroup>)
  const primitives = new Map<string, ParsedPrimitive>();

  const dictStd =
    findChild(findChild(doc, "Content"), "DictionaryStandard") ?? findChild(cadDataNode, "DictionaryStandard");
  for (const entry of findChildren(dictStd, "EntryStandard")) {
    const id = attr(entry, "id");
    if (!id) continue;
    const circle = findChild(entry, "Circle");
    const rect = findChild(entry, "RectCenter") ?? findChild(entry, "Rect");
    const oval = findChild(entry, "Oval");
    const roundRect = findChild(entry, "RectRound");
    if (circle) {
      const d = parseNum(attr(circle, "diameter")) * scale;
      primitives.set(id, { shape: "circle", width: d, height: d, drill: 0 });
    } else if (rect) {
      primitives.set(id, {
        shape: "rect",
        width: parseNum(attr(rect, "width")) * scale,
        height: parseNum(attr(rect, "height")) * scale,
        drill: 0,
      });
    } else if (oval) {
      primitives.set(id, {
        shape: "oval",
        width: parseNum(attr(oval, "width")) * scale,
        height: parseNum(attr(oval, "height")) * scale,
        drill: 0,
      });
    } else if (roundRect) {
      primitives.set(id, {
        shape: "roundrect",
        width: parseNum(attr(roundRect, "width")) * scale,
        height: parseNum(attr(roundRect, "height")) * scale,
        drill: 0,
      });
    }
  }

  const lineWidths = new Map<string, number>();
  const dictLine = findChild(findChild(doc, "Content"), "DictionaryLineDesc");
  for (const entry of findChildren(dictLine, "EntryLineDesc")) {
    const id = attr(entry, "id");
    const ld = findChild(entry, "LineDesc");
    const lw = attr(ld, "lineWidth");
    if (id && lw !== undefined) {
      lineWidths.set(id, parseNum(lw) * scale);
    }
  }

  const padstackGroup = findChild(cadDataNode, "PadstackGroup");
  for (const ps of findChildren(padstackGroup, "PadstackDef")) {
    const name = attr(ps, "name");
    if (!name) continue;
    const padEl = findChild(ps, "Pad");
    const holeEl = findChild(ps, "Hole");
    primitives.set(name, {
      shape: normalizePadShape(attr(padEl, "shape")),
      width: parseNum(attr(padEl, "width")) * scale,
      height: parseNum(attr(padEl, "height")) * scale,
      drill: parseNum(attr(holeEl, "diameter")) * scale,
    });
  }

  // 5. Locate <Step>
  const stepNode = findChild(cadDataNode, "Step");
  if (!stepNode) {
    diagnostics.push({
      severity: "error",
      code: "IPC2581_MISSING_STEP",
      message: "No <Step> element found inside <Ecad>.",
    });
    const layout: PCBLayout = {
      traces: [],
      pads: [],
      vias: [],
      outline: null,
      netlist: { nets: [], components: [], totalPins: 0, totalConnections: 0 },
    };
    if (stackup.length > 0) layout.stackup = stackup;
    if (Object.keys(bom).length > 0) layout.bom = bom;
    return { layout, metadata, diagnostics };
  }

  // 6. Components (<ComponentGroup>/<Component> or direct <Step>/<Component>)
  const components: NetlistComponent[] = [];
  const componentNodes = [
    ...findChildren(findChild(stepNode, "ComponentGroup"), "Component"),
    ...findChildren(stepNode, "Component"),
  ];
  for (const comp of componentNodes) {
    const refDes = attr(comp, "refDes");
    if (!refDes) continue;
    const locNode = findChild(comp, "Location");
    const xformNode = findChild(comp, "Xform");
    const x = parseNum(attr(comp, "x") ?? attr(locNode, "x")) * scale;
    const y = parseNum(attr(comp, "y") ?? attr(locNode, "y")) * scale;
    const angle = parseNum(attr(comp, "rotation") ?? attr(xformNode, "rotation"));
    const layer =
      attr(comp, "layer") ??
      attr(comp, "layerRef") ??
      (attr(comp, "side")?.toUpperCase() === "BOTTOM" ? "BottomCopper" : "TopCopper");
    const footprint = attr(comp, "packageRef") ?? bom[refDes]?.footprint ?? null;

    const pins = findChildren(comp, "ComponentPin")
      .map((p) => attr(p, "pin"))
      .filter((p): p is string => Boolean(p));

    components.push({
      name: refDes,
      pins,
      placement: { footprint, layer, x, y, angle },
    });
  }

  // 7. Logical Nets (<LogicalNetGroup>/<LogicalNet> or direct <Step>/<LogicalNet>)
  const nets: Net[] = [];
  const componentPinSet = new Map<string, Set<string>>();
  for (const c of components) {
    componentPinSet.set(c.name, new Set(c.pins));
  }

  const netNodes = [
    ...findChildren(findChild(stepNode, "LogicalNetGroup"), "LogicalNet"),
    ...findChildren(stepNode, "LogicalNet"),
  ];
  let totalPins = 0;
  for (const netNode of netNodes) {
    const id = attr(netNode, "name");
    if (!id) continue;
    const pins: NetlistPin[] = [];
    for (const pinRef of findChildren(netNode, "PinRef")) {
      const compName = attr(pinRef, "componentRef");
      const localName = attr(pinRef, "pin");
      if (!compName || !localName) continue;
      pins.push({ name: `${compName}.${localName}`, component: compName, localName });
      totalPins++;
      if (!componentPinSet.has(compName)) {
        componentPinSet.set(compName, new Set());
      }
      componentPinSet.get(compName)!.add(localName);
    }
    nets.push({ id, pins });
  }

  for (const c of components) {
    const discovered = componentPinSet.get(c.name);
    if (discovered && c.pins.length === 0) {
      c.pins = [...discovered];
    }
  }

  const netlist: NetlistGraph = {
    nets,
    components,
    totalPins,
    totalConnections: nets.reduce((acc, n) => acc + Math.max(0, n.pins.length - 1), 0),
  };

  // 8. Routing, Pads, and Vias
  const traces: TraceSegment[] = [];
  const pads: PadDefinition[] = [];
  const vias: ViaDefinition[] = [];

  // 8a. Compact ModelScript <RoutingGroup>
  const routingGroup = findChild(stepNode, "RoutingGroup");
  for (const track of findChildren(routingGroup, "Track")) {
    traces.push({
      start: [parseNum(attr(track, "x1")) * scale, parseNum(attr(track, "y1")) * scale],
      end: [parseNum(attr(track, "x2")) * scale, parseNum(attr(track, "y2")) * scale],
      width: parseNum(attr(track, "width")) * scale,
      layer: attr(track, "layer") ?? "TopCopper",
      net: attr(track, "net") ?? "",
    });
  }
  for (const via of findChildren(routingGroup, "Via")) {
    const drill = parseNum(attr(via, "drill")) * scale;
    const outer = parseNum(attr(via, "outerDiameter")) * scale;
    const annularRing = outer > drill ? (outer - drill) / 2 : 0.15;
    vias.push({
      center: [parseNum(attr(via, "x")) * scale, parseNum(attr(via, "y")) * scale],
      drill,
      annularRing,
      net: attr(via, "net") ?? "",
    });
  }
  for (const padEl of findChildren(routingGroup, "PadInstance")) {
    const psRef = attr(padEl, "padstackRef");
    const refPrim = psRef ? primitives.get(psRef) : undefined;
    const shapeAttr = attr(padEl, "shape");
    const wAttr = attr(padEl, "width");
    const hAttr = attr(padEl, "height");
    const dAttr = attr(padEl, "drill");
    pads.push({
      center: [parseNum(attr(padEl, "x")) * scale, parseNum(attr(padEl, "y")) * scale],
      shape: shapeAttr ? normalizePadShape(shapeAttr) : (refPrim?.shape ?? "rect"),
      width: wAttr !== undefined ? parseNum(wAttr) * scale : (refPrim?.width ?? 1),
      height: hAttr !== undefined ? parseNum(hAttr) * scale : (refPrim?.height ?? 1),
      drill: dAttr !== undefined ? parseNum(dAttr) * scale : (refPrim?.drill ?? 0),
      layer: attr(padEl, "layer") ?? "TopCopper",
      net: attr(padEl, "net") ?? "",
      component: attr(padEl, "component") ?? "",
    });
  }

  // 8b. Standard IPC-2581 <LayerFeature layerRef="..."><Set net="..."><Features>...</Features></Set></LayerFeature>
  for (const lf of findChildren(stepNode, "LayerFeature")) {
    const layer = attr(lf, "layerRef") ?? "TopCopper";
    for (const setNode of findChildren(lf, "Set")) {
      const net = attr(setNode, "net") ?? "";
      const component = attr(setNode, "componentRef") ?? "";
      const padUsage = (attr(setNode, "padUsage") ?? "").toUpperCase();

      for (const padEl of findChildren(setNode, "Pad")) {
        const loc = findChild(padEl, "Location");
        const x = parseNum(attr(padEl, "x") ?? attr(loc, "x")) * scale;
        const y = parseNum(attr(padEl, "y") ?? attr(loc, "y")) * scale;
        const primRef = attr(findChild(padEl, "StandardPrimitiveRef"), "id") ?? attr(padEl, "padstackDefRef");
        const prim = primRef ? primitives.get(primRef) : undefined;
        const pinRef = findChild(padEl, "PinRef");
        const compName = attr(pinRef, "componentRef") ?? component;

        if (padUsage === "VIA") {
          const outer = prim?.width ?? 0.6;
          const drill = prim?.drill || outer * 0.5;
          vias.push({ center: [x, y], drill, annularRing: Math.max(0.05, (outer - drill) / 2), net });
        } else {
          pads.push({
            center: [x, y],
            shape: prim?.shape ?? "rect",
            width: prim?.width ?? 1.0,
            height: prim?.height ?? 1.0,
            drill: prim?.drill ?? 0,
            layer,
            net,
            component: compName,
          });
        }
      }

      for (const holeEl of findChildren(setNode, "Hole")) {
        const drill = parseNum(attr(holeEl, "diameter")) * scale;
        const x = parseNum(attr(holeEl, "x")) * scale;
        const y = parseNum(attr(holeEl, "y")) * scale;
        if (padUsage === "VIA" || attr(holeEl, "platingStatus")?.toUpperCase() === "VIA") {
          vias.push({ center: [x, y], drill, annularRing: 0.15, net });
        }
      }

      for (const feat of findChildren(setNode, "Features")) {
        for (const line of findChildren(feat, "Line")) {
          const lineDesc = findChild(line, "LineDesc");
          const lineDescRef = attr(findChild(line, "LineDescRef"), "id");
          const lwAttr = attr(lineDesc, "lineWidth");
          const width =
            lwAttr !== undefined
              ? parseNum(lwAttr) * scale
              : lineDescRef
                ? (lineWidths.get(lineDescRef) ?? 0.25)
                : 0.25;
          traces.push({
            start: [parseNum(attr(line, "startX")) * scale, parseNum(attr(line, "startY")) * scale],
            end: [parseNum(attr(line, "endX")) * scale, parseNum(attr(line, "endY")) * scale],
            width,
            layer,
            net,
          });
        }
        for (const poly of findChildren(feat, "Polyline")) {
          const lineDesc = findChild(poly, "LineDesc");
          const lineDescRef = attr(findChild(poly, "LineDescRef"), "id");
          const lwAttr = attr(lineDesc, "lineWidth");
          const width =
            lwAttr !== undefined
              ? parseNum(lwAttr) * scale
              : lineDescRef
                ? (lineWidths.get(lineDescRef) ?? 0.25)
                : 0.25;
          const begin = findChild(poly, "PolyBegin");
          if (!begin) continue;
          let prev: [number, number] = [parseNum(attr(begin, "x")) * scale, parseNum(attr(begin, "y")) * scale];
          for (const seg of findChildren(poly, "PolyStepSegment")) {
            const next: [number, number] = [parseNum(attr(seg, "x")) * scale, parseNum(attr(seg, "y")) * scale];
            traces.push({ start: prev, end: next, width, layer, net });
            prev = next;
          }
        }
      }
    }
  }

  // 9. Board Outline (<BoardProfile>/<Polygon>/<Vertex> or standard <Profile>/<Polygon>/<PolyBegin>+<PolyStepSegment>)
  let outline: BoardOutline | null = null;
  const profileNode = findChild(stepNode, "BoardProfile") ?? findChild(stepNode, "Profile");
  const polygonNode = findChild(profileNode, "Polygon");
  if (polygonNode) {
    const vertices: [number, number][] = [];
    for (const v of findChildren(polygonNode, "Vertex")) {
      vertices.push([parseNum(attr(v, "x")) * scale, parseNum(attr(v, "y")) * scale]);
    }
    if (vertices.length === 0) {
      const begin = findChild(polygonNode, "PolyBegin");
      if (begin) {
        vertices.push([parseNum(attr(begin, "x")) * scale, parseNum(attr(begin, "y")) * scale]);
        for (const seg of findChildren(polygonNode, "PolyStepSegment")) {
          const vx = parseNum(attr(seg, "x")) * scale;
          const vy = parseNum(attr(seg, "y")) * scale;
          const first = vertices[0]!;
          if (Math.abs(vx - first[0]) < 1e-6 && Math.abs(vy - first[1]) < 1e-6) continue;
          vertices.push([vx, vy]);
        }
      }
    }
    if (vertices.length >= 3) {
      outline = { vertices };
    }
  }

  const layout: PCBLayout = {
    traces,
    pads,
    vias,
    outline,
    netlist,
  };
  if (stackup.length > 0) layout.stackup = stackup;
  if (Object.keys(bom).length > 0) layout.bom = bom;

  return { layout, metadata, diagnostics };
}

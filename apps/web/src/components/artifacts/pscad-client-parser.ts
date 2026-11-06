// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PscadBusLike, PscadComponentLike, PscadStickyLike, PscadWireLike } from "@modelscript/diagram";
import { parseXml, type XmlElement } from "@modelscript/dsl/xml";

function getXmlAttr(el: XmlElement, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const attr of el.attributes) {
    if (attr.name.toLowerCase() === target) {
      return attr.value;
    }
  }
  return undefined;
}

export interface PscadClientModel {
  buses: PscadBusLike[];
  components: PscadComponentLike[];
  wires: PscadWireLike[];
  stickies: PscadStickyLike[];
  junctions: { x: number; y: number }[];
  componentCount: number;
  busCount: number;
  transformerCount: number;
  ibrCount: number;
  timeStepUs?: number | undefined;
}

export function parsePscadClient(code: string): PscadClientModel {
  const components: PscadComponentLike[] = [];
  const buses: PscadBusLike[] = [];
  const wires: PscadWireLike[] = [];
  const stickies: PscadStickyLike[] = [];
  let idx = 0;
  let bIdx = 0;
  let wIdx = 0;
  let sIdx = 0;
  let timeStepUs: number | undefined;

  const doc = parseXml(code);
  const elements: XmlElement[] = [];
  const collect = (node: XmlElement) => {
    elements.push(node);
    for (const child of node.children) {
      collect(child);
    }
  };
  if (doc.root) collect(doc.root);

  for (const el of elements) {
    const tag = el.name.toLowerCase();

    if (tag === "user" || tag === "component") {
      const defName = getXmlAttr(el, "name") || getXmlAttr(el, "defn");
      if (defName) {
        const id = getXmlAttr(el, "id") || `c_${idx + 1}`;
        const xStr = getXmlAttr(el, "x");
        const yStr = getXmlAttr(el, "y");
        const rotStr = getXmlAttr(el, "rotation") || getXmlAttr(el, "orient");
        const params: Record<string, string> = {};
        for (const child of el.children) {
          if (child.name.toLowerCase() === "param") {
            const pName = getXmlAttr(child, "name");
            const pVal = getXmlAttr(child, "value");
            if (pName) params[pName] = pVal || "";
          }
        }
        const col = idx % 4;
        const row = Math.floor(idx / 4);
        components.push({
          id,
          definitionName: defName,
          instanceName: params.Name || params.name || defName.split(":").pop() || `C${idx + 1}`,
          position: {
            x: xStr ? Number.parseFloat(xStr) : 140 + col * 180,
            y: yStr ? Number.parseFloat(yStr) : 140 + row * 120,
          },
          rotation: rotStr ? Number.parseFloat(rotStr) : undefined,
          parameters: params,
        });
        idx++;
      }
    } else if (tag === "bus") {
      const id = getXmlAttr(el, "id") || getXmlAttr(el, "name") || `Bus_${++bIdx}`;
      const name = getXmlAttr(el, "name") || id;
      const vStr = getXmlAttr(el, "vbase") || getXmlAttr(el, "v_base");
      const xStr = getXmlAttr(el, "x");
      const yStr = getXmlAttr(el, "y");
      const lenStr = getXmlAttr(el, "length");
      buses.push({
        id,
        name,
        voltageBaseKv: vStr ? Number.parseFloat(vStr) : 230,
        position: {
          x: xStr ? Number.parseFloat(xStr) : 200,
          y: yStr ? Number.parseFloat(yStr) : 150,
        },
        length: lenStr ? Number.parseFloat(lenStr) : 80,
      });
    } else if (tag === "wire") {
      const classId = (getXmlAttr(el, "classid") || "").toLowerCase();
      if (classId === "branch") continue;

      const id = getXmlAttr(el, "id");
      const wx = Number.parseFloat(getXmlAttr(el, "x") || "0");
      const wy = Number.parseFloat(getXmlAttr(el, "y") || "0");

      const vertices: { x: number; y: number }[] = [];
      for (const child of el.children) {
        if (child.name.toLowerCase() === "vertex") {
          const vx = Number.parseFloat(getXmlAttr(child, "x") || "0");
          const vy = Number.parseFloat(getXmlAttr(child, "y") || "0");
          vertices.push({ x: vx + wx, y: vy + wy });
        }
      }

      if (vertices.length === 0) {
        const x1Str = getXmlAttr(el, "x1");
        const y1Str = getXmlAttr(el, "y1");
        const x2Str = getXmlAttr(el, "x2");
        const y2Str = getXmlAttr(el, "y2");
        const wStr = getXmlAttr(el, "w");
        const hStr = getXmlAttr(el, "h");
        if (x2Str !== undefined || y2Str !== undefined) {
          const x1 = x1Str !== undefined ? Number.parseFloat(x1Str) : wx;
          const y1 = y1Str !== undefined ? Number.parseFloat(y1Str) : wy;
          const x2 = x2Str !== undefined ? Number.parseFloat(x2Str) : x1;
          const y2 = y2Str !== undefined ? Number.parseFloat(y2Str) : y1;
          vertices.push({ x: x1, y: y1 }, { x: x2, y: y2 });
        } else if (wStr !== undefined || hStr !== undefined) {
          const dw = wStr !== undefined ? Number.parseFloat(wStr) : 0;
          const dh = hStr !== undefined ? Number.parseFloat(hStr) : 0;
          if (dw !== 0 || dh !== 0) {
            vertices.push({ x: wx, y: wy }, { x: wx + dw, y: wy + dh });
          }
        }
      }

      if (classId === "bus" && vertices.length >= 2) {
        let nameParam: string | undefined;
        let kvParam: string | undefined;
        for (const child of el.children) {
          if (child.name.toLowerCase() === "param") {
            const pName = (getXmlAttr(child, "name") || "").toLowerCase();
            if (pName === "name") nameParam = getXmlAttr(child, "value");
            if (pName === "basekv" || pName === "vbase") kvParam = getXmlAttr(child, "value");
          }
        }
        const p0 = vertices[0]!;
        const p1 = vertices[vertices.length - 1]!;
        const busId = id || nameParam || `Bus_${++bIdx}`;
        buses.push({
          id: busId,
          name: nameParam || busId,
          voltageBaseKv: kvParam ? Number.parseFloat(kvParam) : 230,
          position: p0,
          length: Math.hypot(p1.x - p0.x, p1.y - p0.y) || 80,
        });
        continue;
      }

      if (vertices.length >= 2) {
        wires.push({ id: id || `w_${++wIdx}`, vertices });
      }
    } else if (tag === "sticky") {
      const rawBody = (el.cdata[0]?.text || el.text || "").trim();
      if (rawBody) {
        const id = getXmlAttr(el, "id") || `sticky_${++sIdx}`;
        const xStr = getXmlAttr(el, "x");
        const yStr = getXmlAttr(el, "y");
        const wStr = getXmlAttr(el, "w");
        const hStr = getXmlAttr(el, "h");
        stickies.push({
          id,
          position: {
            x: xStr ? Number.parseFloat(xStr) : 90,
            y: yStr ? Number.parseFloat(yStr) : 90,
          },
          width: wStr ? Number.parseFloat(wStr) : 420,
          height: hStr ? Number.parseFloat(hStr) : 34,
          text: rawBody,
        });
      }
    } else if (tag === "param" && getXmlAttr(el, "name") === "time_step") {
      const dtVal = getXmlAttr(el, "value");
      if (dtVal) timeStepUs = Number.parseFloat(dtVal);
    }
  }

  // Synthesize T-junction solder dots where a wire endpoint taps the interior of another wire segment
  const junctions: { x: number; y: number }[] = [];
  const seenJ = new Set<string>();
  for (const wA of wires) {
    for (const endPt of [wA.vertices[0]!, wA.vertices[wA.vertices.length - 1]!]) {
      for (const wB of wires) {
        if (wA.id === wB.id) continue;
        for (let i = 0; i < wB.vertices.length - 1; i++) {
          const p1 = wB.vertices[i]!;
          const p2 = wB.vertices[i + 1]!;
          const minX = Math.min(p1.x, p2.x);
          const maxX = Math.max(p1.x, p2.x);
          const minY = Math.min(p1.y, p2.y);
          const maxY = Math.max(p1.y, p2.y);
          const onHoriz =
            Math.abs(p1.y - p2.y) < 1 && Math.abs(endPt.y - p1.y) < 1 && endPt.x > minX + 1 && endPt.x < maxX - 1;
          const onVert =
            Math.abs(p1.x - p2.x) < 1 && Math.abs(endPt.x - p1.x) < 1 && endPt.y > minY + 1 && endPt.y < maxY - 1;
          if (onHoriz || onVert) {
            const key = `${endPt.x},${endPt.y}`;
            if (!seenJ.has(key)) {
              seenJ.add(key);
              junctions.push({ x: endPt.x, y: endPt.y });
            }
          }
        }
      }
    }
  }

  const xfrmrCount = components.filter((c) => /xfmr|trans|tp3/i.test(c.definitionName)).length;
  const ibrCount = components.filter((c) => /ibr|inv|vsc|pv|bess|wind|fmu/i.test(c.definitionName)).length;
  if (timeStepUs === undefined) {
    const dtMatch = code.match(/time_step\s*=\s*"?([0-9.eE+-]+)"?/i);
    timeStepUs = dtMatch?.[1] ? Number.parseFloat(dtMatch[1]) : undefined;
  }
  return {
    buses,
    components,
    wires,
    stickies,
    junctions,
    componentCount: components.length,
    busCount: buses.length,
    transformerCount: xfrmrCount,
    ibrCount,
    timeStepUs,
  };
}

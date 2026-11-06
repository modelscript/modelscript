// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Parser for modern SINTEF Ocean .sima XML project archives.
 */

import { parseXmlSync, type XmlElement } from "@modelscript/dsl/xml";
import type {
  EnvironmentalConditions,
  FairleadPoint,
  LineSegment,
  MooringLine,
  SimaModel,
  SimulationConfig,
  Vessel,
} from "../types.js";

function getLocalName(name: string): string {
  const idx = name.indexOf(":");
  return (idx >= 0 ? name.slice(idx + 1) : name).toLowerCase();
}

function getAttr(el: XmlElement, ...names: string[]): string | undefined {
  for (const name of names) {
    const lower = name.toLowerCase();
    for (const a of el.attributes) {
      const aName = a.name.toLowerCase();
      const aLocal = aName.includes(":") ? aName.slice(aName.indexOf(":") + 1) : aName;
      if (aName === lower || aLocal === lower) return a.value;
    }
  }
  return undefined;
}

function walkElements(node: XmlElement, visit: (el: XmlElement) => void): void {
  visit(node);
  for (const child of node.children) {
    walkElements(child, visit);
  }
}

export function parseSimaXml(xmlText: string, filePath?: string): SimaModel {
  const vessels: Vessel[] = [];
  const lines: MooringLine[] = [];

  const environment: EnvironmentalConditions = {
    waterDepth: 200,
    waterDensity: 1025,
    seabedFriction: 0.5,
    wave: {
      spectrum: "jonswap",
      hs: 6.0,
      tp: 12.0,
      gamma: 3.3,
      direction: 0,
    },
    wind: {
      speed: 15.0,
      direction: 0,
    },
    current: {
      surfaceSpeed: 1.0,
      direction: 0,
    },
  };

  const simulation: SimulationConfig = {
    timeStep: 0.1,
    duration: 3600,
    solver: "catenary_quasi_static",
  };

  let xmlDoc = parseXmlSync(xmlText);
  if ((!xmlDoc.root && xmlText.includes("<")) || (xmlDoc.root && xmlText.slice(xmlDoc.root.end).includes("<"))) {
    xmlDoc = parseXmlSync("<_root_>" + xmlText + "</_root_>");
  }

  if (xmlDoc.root) {
    // 1. Extract environment, wave, and wind properties
    walkElements(xmlDoc.root, (el) => {
      const tag = getLocalName(el.name);

      if (tag === "environment") {
        const depth = getAttr(el, "waterdepth", "depth");
        if (depth !== undefined) {
          environment.waterDepth = parseFloat(depth);
        }
        const density = getAttr(el, "density");
        if (density !== undefined) {
          environment.waterDensity = parseFloat(density);
        }
        const friction = getAttr(el, "friction", "seabedfriction");
        if (friction !== undefined) {
          environment.seabedFriction = parseFloat(friction);
        }
      } else if (tag === "wave") {
        const hs = getAttr(el, "hs");
        if (hs !== undefined) environment.wave.hs = parseFloat(hs);
        const tp = getAttr(el, "tp");
        if (tp !== undefined) environment.wave.tp = parseFloat(tp);
        const gamma = getAttr(el, "gamma");
        if (gamma !== undefined) environment.wave.gamma = parseFloat(gamma);
        const dir = getAttr(el, "direction", "dir");
        if (dir !== undefined) environment.wave.direction = parseFloat(dir);
      } else if (tag === "wind") {
        const speed = getAttr(el, "speed");
        if (speed !== undefined) environment.wind.speed = parseFloat(speed);
        const dir = getAttr(el, "direction", "dir");
        if (dir !== undefined) environment.wind.direction = parseFloat(dir);
      }
    });

    // 2. Extract vessels and fairleads
    walkElements(xmlDoc.root, (el) => {
      const tag = getLocalName(el.name);
      if (tag === "vessel" || tag === "body") {
        const id = getAttr(el, "id", "name") || `vessel_${vessels.length + 1}`;
        const name = getAttr(el, "name") || id;
        const mass = parseFloat(getAttr(el, "mass") || "10000000");
        const disp = parseFloat(getAttr(el, "displacement", "disp") || (mass / environment.waterDensity).toString());
        const gmt = parseFloat(getAttr(el, "gmt") || "4.5");
        const gml = parseFloat(getAttr(el, "gml") || "5.0");
        const cgX = parseFloat(getAttr(el, "cgx") || "0");
        const cgY = parseFloat(getAttr(el, "cgy") || "0");
        const cgZ = parseFloat(getAttr(el, "cgz") || "-5");
        const rxx = parseFloat(getAttr(el, "rxx") || "30");
        const ryy = parseFloat(getAttr(el, "ryy") || "30");
        const rzz = parseFloat(getAttr(el, "rzz") || "35");

        const fairleads: FairleadPoint[] = [];
        walkElements(el, (child) => {
          const cTag = getLocalName(child.name);
          if (cTag === "fairlead" || cTag === "attachment") {
            const flId = getAttr(child, "id", "name") || `fl_${fairleads.length + 1}`;
            fairleads.push({
              id: flId,
              name: flId,
              vesselId: id,
              position: [
                parseFloat(getAttr(child, "x") || "0"),
                parseFloat(getAttr(child, "y") || "0"),
                parseFloat(getAttr(child, "z") || "0"),
              ],
            });
          }
        });

        vessels.push({
          id,
          name,
          mass,
          displacement: disp,
          cg: [cgX, cgY, cgZ],
          radiiOfGyration: [rxx, ryy, rzz],
          massMatrix: [
            [mass, 0, 0, 0, 0, 0],
            [0, mass, 0, 0, 0, 0],
            [0, 0, mass, 0, 0, 0],
            [0, 0, 0, mass * rxx * rxx, 0, 0],
            [0, 0, 0, 0, mass * ryy * ryy, 0],
            [0, 0, 0, 0, 0, mass * rzz * rzz],
          ],
          hydrostaticMatrix: [
            [0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0],
            [0, 0, (disp / 20) * 1.2 * environment.waterDensity * 9.81, 0, 0, 0],
            [0, 0, 0, disp * environment.waterDensity * 9.81 * gmt, 0, 0],
            [0, 0, 0, 0, disp * environment.waterDensity * 9.81 * gml, 0],
            [0, 0, 0, 0, 0, 0],
          ],
          linearDamping: [
            [1e5, 0, 0, 0, 0, 0],
            [0, 1e5, 0, 0, 0, 0],
            [0, 0, 2e5, 0, 0, 0],
            [0, 0, 0, 1e7, 0, 0],
            [0, 0, 0, 0, 1e7, 0],
            [0, 0, 0, 0, 0, 1e7],
          ],
          quadraticDamping: [
            [5e4, 0, 0, 0, 0, 0],
            [0, 5e4, 0, 0, 0, 0],
            [0, 0, 1e5, 0, 0, 0],
            [0, 0, 0, 5e6, 0, 0],
            [0, 0, 0, 0, 5e6, 0],
            [0, 0, 0, 0, 0, 5e6],
          ],
          gmTransverse: gmt,
          gmLongitudinal: gml,
          fairleads,
        });
      }
    });

    // 3. Extract mooring lines and segments
    walkElements(xmlDoc.root, (el) => {
      const tag = getLocalName(el.name);
      if (tag === "mooringline" || tag === "line") {
        const id = getAttr(el, "id", "name") || `line_${lines.length + 1}`;
        const name = getAttr(el, "name") || id;
        const type = (getAttr(el, "type")?.toLowerCase() || "catenary") as MooringLine["type"];
        const fairleadId = getAttr(el, "fairleadid", "fairlead") || "fl_1";
        const ancX = parseFloat(getAttr(el, "anchorx", "anc_x") || "500");
        const ancY = parseFloat(getAttr(el, "anchory", "anc_y") || "0");
        const ancZ = parseFloat(getAttr(el, "anchorz", "anc_z") || (-environment.waterDepth).toString());

        const segments: LineSegment[] = [];
        let totalLen = 0;

        walkElements(el, (child) => {
          const cTag = getLocalName(child.name);
          if (cTag === "segment") {
            const len = parseFloat(getAttr(child, "length", "len") || "500");
            totalLen += len;
            segments.push({
              id: getAttr(child, "id") || `${id}_seg_${segments.length + 1}`,
              name: getAttr(child, "name") || `Segment ${segments.length + 1}`,
              length: len,
              diameter: parseFloat(getAttr(child, "diameter", "diam") || "0.12"),
              dryMassPerMeter: parseFloat(getAttr(child, "drymass", "mass") || "290"),
              submergedWeightPerMeter: parseFloat(getAttr(child, "subweight", "weight") || "2500"),
              axialStiffnessEA: parseFloat(getAttr(child, "ea") || "1e9"),
              bendingStiffnessEI: parseFloat(getAttr(child, "ei") || "1e5"),
              mbl: parseFloat(getAttr(child, "mbl") || "1.5e7"),
              cd: parseFloat(getAttr(child, "cd") || "1.2"),
              cm: parseFloat(getAttr(child, "cm") || "2.0"),
              material: getAttr(child, "material"),
            });
          }
        });

        lines.push({
          id,
          name,
          type,
          fairleadId,
          anchorPosition: [ancX, ancY, ancZ],
          segments,
          totalLength: totalLen,
        });
      }
    });
  }

  // Correlate fairlead positions
  for (const line of lines) {
    for (const v of vessels) {
      const fl = v.fairleads.find((f) => f.id === line.fairleadId);
      if (fl) {
        line.fairleadPosition = fl.position;
        break;
      }
    }
  }

  return {
    title: filePath ? filePath.split("/").pop() : "SIMA XML Model",
    sourceFile: filePath,
    vessels,
    lines,
    environment,
    simulation,
  };
}

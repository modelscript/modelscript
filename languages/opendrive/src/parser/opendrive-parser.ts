// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/opendrive — Zero-Regex ASAM OpenDRIVE XML Parser.
 *
 * Conforms to ASAM OpenDRIVE v1.6 and v1.7 schemas using @modelscript/dsl/xml.
 */

import { parseXml, type XmlElement } from "@modelscript/dsl/xml";
import type {
  OpenDriveConnection,
  OpenDriveDocument,
  OpenDriveElevationRecord,
  OpenDriveGeometry,
  OpenDriveHeader,
  OpenDriveJunction,
  OpenDriveLane,
  OpenDriveLaneLink,
  OpenDriveLaneLinkEntry,
  OpenDriveLanes,
  OpenDriveLaneSection,
  OpenDriveLaneWidth,
  OpenDriveRange,
  OpenDriveRoad,
  OpenDriveRoadLink,
  OpenDriveSignal,
  OpenDriveSuperelevationRecord,
} from "../types.js";

function getAttr(elem: XmlElement, name: string): string | undefined {
  const a = elem.attributes.find((attr) => attr.name.toLowerCase() === name.toLowerCase());
  return a?.value;
}

function getNumAttr(elem: XmlElement, name: string, defaultValue = 0): number {
  const val = getAttr(elem, name);
  if (val === undefined) return defaultValue;
  const num = parseFloat(val);
  return isNaN(num) ? defaultValue : num;
}

function findChild(elem: XmlElement, name: string): XmlElement | undefined {
  return elem.children.find((c) => c.name.toLowerCase() === name.toLowerCase());
}

function findChildren(elem: XmlElement, name: string): XmlElement[] {
  return elem.children.filter((c) => c.name.toLowerCase() === name.toLowerCase());
}

function computeLineCol(source: string, offset: number): { line: number; col: number } {
  let line = 1;
  let col = 1;
  const target = Math.min(offset, source.length);
  for (let i = 0; i < target; i++) {
    if (source[i] === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}

function makeRange(source: string, elem: XmlElement): OpenDriveRange {
  const start = computeLineCol(source, elem.start);
  const end = computeLineCol(source, elem.end);
  return {
    startLine: start.line,
    startColumn: start.col,
    endLine: end.line,
    endColumn: end.col,
    startOffset: elem.start,
    endOffset: elem.end,
  };
}

export function parseOpenDrive(source: string, filename?: string): OpenDriveDocument {
  const doc = parseXml(source);
  if (doc.errors && doc.errors.length > 0) {
    throw new Error(`XML syntax error at offset ${doc.errors[0]?.start ?? 0}`);
  }
  const root = doc.root;

  if (!root || (root.name.toLowerCase() !== "opendrive" && root.name.toLowerCase() !== "road")) {
    throw new Error("Missing valid <OpenDRIVE> or <road> root element");
  }

  // 1. Header
  const headerElem = findChild(root, "header");
  const header: OpenDriveHeader = {
    revMajor: headerElem ? getNumAttr(headerElem, "revMajor", 1) : 1,
    revMinor: headerElem ? getNumAttr(headerElem, "revMinor", 6) : 6,
    name: headerElem ? getAttr(headerElem, "name") : undefined,
    version: headerElem ? getAttr(headerElem, "version") : undefined,
    date: headerElem ? getAttr(headerElem, "date") : undefined,
    north: headerElem ? getNumAttr(headerElem, "north") : undefined,
    south: headerElem ? getNumAttr(headerElem, "south") : undefined,
    east: headerElem ? getNumAttr(headerElem, "east") : undefined,
    west: headerElem ? getNumAttr(headerElem, "west") : undefined,
    vendor: headerElem ? getAttr(headerElem, "vendor") : undefined,
  };

  // 2. Roads
  const roads: OpenDriveRoad[] = [];
  const roadElements = root.name.toLowerCase() === "road" ? [root] : findChildren(root, "road");

  for (const rElem of roadElements) {
    roads.push(parseRoadElement(source, rElem));
  }

  // 3. Junctions
  const junctions: OpenDriveJunction[] = [];
  for (const jElem of findChildren(root, "junction")) {
    const jId = getAttr(jElem, "id") ?? "";
    const jName = getAttr(jElem, "name");
    const jType = getAttr(jElem, "type");
    const connections: OpenDriveConnection[] = [];

    for (const cElem of findChildren(jElem, "connection")) {
      const cId = getAttr(cElem, "id") ?? "";
      const incRoad = getAttr(cElem, "incomingRoad") ?? "";
      const connRoad = getAttr(cElem, "connectingRoad") ?? "";
      const cpStr = getAttr(cElem, "contactPoint")?.toLowerCase();
      const contactPoint: "start" | "end" = cpStr === "end" ? "end" : "start";

      const laneLinks: OpenDriveLaneLinkEntry[] = [];
      for (const llElem of findChildren(cElem, "laneLink")) {
        laneLinks.push({
          from: getNumAttr(llElem, "from", 0),
          to: getNumAttr(llElem, "to", 0),
        });
      }

      connections.push({
        id: cId,
        incomingRoad: incRoad,
        connectingRoad: connRoad,
        contactPoint,
        laneLinks,
      });
    }

    junctions.push({
      id: jId,
      name: jName,
      type: jType,
      connections,
      range: makeRange(source, jElem),
    });
  }

  return {
    header,
    roads,
    junctions,
    sourceFile: filename,
  };
}

function parseRoadElement(source: string, rElem: XmlElement): OpenDriveRoad {
  const id = getAttr(rElem, "id") ?? "0";
  const name = getAttr(rElem, "name");
  const length = getNumAttr(rElem, "length", 0);
  const junction = getAttr(rElem, "junction") ?? "-1";

  // Links
  let link: OpenDriveRoadLink | undefined = undefined;
  const linkElem = findChild(rElem, "link");
  if (linkElem) {
    const predElem = findChild(linkElem, "predecessor");
    const succElem = findChild(linkElem, "successor");

    link = {
      predecessor: predElem
        ? {
            elementType: getAttr(predElem, "elementType")?.toLowerCase() === "junction" ? "junction" : "road",
            elementId: getAttr(predElem, "elementId") ?? "",
            contactPoint: getAttr(predElem, "contactPoint")?.toLowerCase() === "end" ? "end" : "start",
          }
        : undefined,
      successor: succElem
        ? {
            elementType: getAttr(succElem, "elementType")?.toLowerCase() === "junction" ? "junction" : "road",
            elementId: getAttr(succElem, "elementId") ?? "",
            contactPoint: getAttr(succElem, "contactPoint")?.toLowerCase() === "end" ? "end" : "start",
          }
        : undefined,
    };
  }

  // PlanView Geometries
  const planView: OpenDriveGeometry[] = [];
  const pvElem = findChild(rElem, "planView");
  if (pvElem) {
    for (const gElem of findChildren(pvElem, "geometry")) {
      const s = getNumAttr(gElem, "s");
      const x = getNumAttr(gElem, "x");
      const y = getNumAttr(gElem, "y");
      const hdg = getNumAttr(gElem, "hdg");
      const geomLength = getNumAttr(gElem, "length");
      const gRange = makeRange(source, gElem);

      const spiralSub = findChild(gElem, "spiral");
      const arcSub = findChild(gElem, "arc");
      const poly3Sub = findChild(gElem, "poly3");
      const paramPoly3Sub = findChild(gElem, "paramPoly3");

      if (spiralSub) {
        planView.push({
          type: "spiral",
          s,
          x,
          y,
          hdg,
          length: geomLength,
          curvStart: getNumAttr(spiralSub, "curvStart"),
          curvEnd: getNumAttr(spiralSub, "curvEnd"),
          range: gRange,
        });
      } else if (arcSub) {
        planView.push({
          type: "arc",
          s,
          x,
          y,
          hdg,
          length: geomLength,
          curvature: getNumAttr(arcSub, "curvature"),
          range: gRange,
        });
      } else if (poly3Sub) {
        planView.push({
          type: "poly3",
          s,
          x,
          y,
          hdg,
          length: geomLength,
          a: getNumAttr(poly3Sub, "a"),
          b: getNumAttr(poly3Sub, "b"),
          c: getNumAttr(poly3Sub, "c"),
          d: getNumAttr(poly3Sub, "d"),
          range: gRange,
        });
      } else if (paramPoly3Sub) {
        planView.push({
          type: "paramPoly3",
          s,
          x,
          y,
          hdg,
          length: geomLength,
          aU: getNumAttr(paramPoly3Sub, "aU"),
          bU: getNumAttr(paramPoly3Sub, "bU"),
          cU: getNumAttr(paramPoly3Sub, "cU"),
          dU: getNumAttr(paramPoly3Sub, "dU"),
          aV: getNumAttr(paramPoly3Sub, "aV"),
          bV: getNumAttr(paramPoly3Sub, "bV"),
          cV: getNumAttr(paramPoly3Sub, "cV"),
          dV: getNumAttr(paramPoly3Sub, "dV"),
          pRange: getAttr(paramPoly3Sub, "pRange") === "normalized" ? "normalized" : "arcLength",
          range: gRange,
        });
      } else {
        // Line default
        planView.push({
          type: "line",
          s,
          x,
          y,
          hdg,
          length: geomLength,
          range: gRange,
        });
      }
    }
  }

  // Elevation Profile
  const elevationProfile: OpenDriveElevationRecord[] = [];
  const epElem = findChild(rElem, "elevationProfile");
  if (epElem) {
    for (const elevElem of findChildren(epElem, "elevation")) {
      elevationProfile.push({
        s: getNumAttr(elevElem, "s"),
        a: getNumAttr(elevElem, "a"),
        b: getNumAttr(elevElem, "b"),
        c: getNumAttr(elevElem, "c"),
        d: getNumAttr(elevElem, "d"),
        range: makeRange(source, elevElem),
      });
    }
  }

  // Lateral Profile (Superelevation)
  const lateralProfile: OpenDriveSuperelevationRecord[] = [];
  const lpElem = findChild(rElem, "lateralProfile");
  if (lpElem) {
    for (const seElem of findChildren(lpElem, "superelevation")) {
      lateralProfile.push({
        s: getNumAttr(seElem, "s"),
        a: getNumAttr(seElem, "a"),
        b: getNumAttr(seElem, "b"),
        c: getNumAttr(seElem, "c"),
        d: getNumAttr(seElem, "d"),
        range: makeRange(source, seElem),
      });
    }
  }

  // Lanes
  const laneSections: OpenDriveLaneSection[] = [];
  const lanesElem = findChild(rElem, "lanes");
  if (lanesElem) {
    for (const lsElem of findChildren(lanesElem, "laneSection")) {
      const secS = getNumAttr(lsElem, "s");
      const leftLanes: OpenDriveLane[] = [];
      let centerLane: OpenDriveLane = {
        id: 0,
        type: "none",
        widthRecords: [],
        range: makeRange(source, lsElem),
      };
      const rightLanes: OpenDriveLane[] = [];

      const leftElem = findChild(lsElem, "left");
      if (leftElem) {
        for (const lElem of findChildren(leftElem, "lane")) {
          leftLanes.push(parseLane(source, lElem));
        }
      }

      const centerElem = findChild(lsElem, "center");
      if (centerElem) {
        const cLaneElem = findChild(centerElem, "lane");
        if (cLaneElem) {
          centerLane = parseLane(source, cLaneElem);
        }
      }

      const rightElem = findChild(lsElem, "right");
      if (rightElem) {
        for (const lElem of findChildren(rightElem, "lane")) {
          rightLanes.push(parseLane(source, lElem));
        }
      }

      laneSections.push({
        s: secS,
        leftLanes,
        centerLane,
        rightLanes,
        range: makeRange(source, lsElem),
      });
    }
  }

  const lanes: OpenDriveLanes = {
    laneSections,
    range: lanesElem ? makeRange(source, lanesElem) : undefined,
  };

  // Signals
  const signals: OpenDriveSignal[] = [];
  const signalsElem = findChild(rElem, "signals");
  if (signalsElem) {
    for (const sigElem of findChildren(signalsElem, "signal")) {
      const oriStr = getAttr(sigElem, "orientation") ?? "none";
      const orientation: "+" | "-" | "none" = oriStr === "+" || oriStr === "-" ? oriStr : "none";

      signals.push({
        id: getAttr(sigElem, "id") ?? "",
        s: getNumAttr(sigElem, "s"),
        t: getNumAttr(sigElem, "t"),
        name: getAttr(sigElem, "name"),
        dynamic: getAttr(sigElem, "dynamic") === "yes",
        orientation,
        zOffset: getNumAttr(sigElem, "zOffset"),
        country: getAttr(sigElem, "country"),
        type: getAttr(sigElem, "type"),
        subtype: getAttr(sigElem, "subtype"),
        value: getNumAttr(sigElem, "value"),
        range: makeRange(source, sigElem),
      });
    }
  }

  return {
    id,
    name,
    length,
    junction,
    link,
    planView,
    elevationProfile,
    lateralProfile,
    lanes,
    signals,
    range: makeRange(source, rElem),
  };
}

function parseLane(source: string, lElem: XmlElement): OpenDriveLane {
  const id = getNumAttr(lElem, "id", 0);
  const type = getAttr(lElem, "type") ?? "driving";
  const level = getAttr(lElem, "level") === "true";

  let link: OpenDriveLaneLink | undefined = undefined;
  const linkElem = findChild(lElem, "link");
  if (linkElem) {
    const predElem = findChild(linkElem, "predecessor");
    const succElem = findChild(linkElem, "successor");
    link = {
      predecessor: predElem ? getNumAttr(predElem, "id") : undefined,
      successor: succElem ? getNumAttr(succElem, "id") : undefined,
    };
  }

  const widthRecords: OpenDriveLaneWidth[] = [];
  for (const wElem of findChildren(lElem, "width")) {
    widthRecords.push({
      sOffset: getNumAttr(wElem, "sOffset"),
      a: getNumAttr(wElem, "a"),
      b: getNumAttr(wElem, "b"),
      c: getNumAttr(wElem, "c"),
      d: getNumAttr(wElem, "d"),
    });
  }

  return {
    id,
    type,
    level,
    link,
    widthRecords,
    range: makeRange(source, lElem),
  };
}

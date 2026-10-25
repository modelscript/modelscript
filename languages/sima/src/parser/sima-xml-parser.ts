// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Parser for modern SINTEF Ocean .sima XML project archives.
 */

import type {
  EnvironmentalConditions,
  FairleadPoint,
  LineSegment,
  MooringLine,
  SimaModel,
  SimulationConfig,
  Vessel,
} from "../types.js";

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

  // Extract environment properties
  const envMatch = xmlText.match(/<(?:\w+:)?environment\b([^>]*)\/?>/i);
  if (envMatch) {
    const attrs = parseAttributes(envMatch[1]!);
    if (attrs["waterdepth"] || attrs["depth"]) {
      environment.waterDepth = parseFloat(attrs["waterdepth"] || attrs["depth"]!);
    }
    if (attrs["density"]) {
      environment.waterDensity = parseFloat(attrs["density"]!);
    }
    if (attrs["friction"] || attrs["seabedfriction"]) {
      environment.seabedFriction = parseFloat(attrs["friction"] || attrs["seabedfriction"]!);
    }
  }

  // Extract wave properties
  const waveMatch = xmlText.match(/<(?:\w+:)?wave\b([^>]*)\/?>/i);
  if (waveMatch) {
    const attrs = parseAttributes(waveMatch[1]!);
    if (attrs["hs"]) environment.wave.hs = parseFloat(attrs["hs"]!);
    if (attrs["tp"]) environment.wave.tp = parseFloat(attrs["tp"]!);
    if (attrs["gamma"]) environment.wave.gamma = parseFloat(attrs["gamma"]!);
    if (attrs["direction"] || attrs["dir"]) {
      environment.wave.direction = parseFloat(attrs["direction"] || attrs["dir"]!);
    }
  }

  // Extract wind properties
  const windMatch = xmlText.match(/<(?:\w+:)?wind\b([^>]*)\/?>/i);
  if (windMatch) {
    const attrs = parseAttributes(windMatch[1]!);
    if (attrs["speed"]) environment.wind.speed = parseFloat(attrs["speed"]!);
    if (attrs["direction"] || attrs["dir"]) {
      environment.wind.direction = parseFloat(attrs["direction"] || attrs["dir"]!);
    }
  }

  // Extract vessels
  const vesselRegex = /<(?:\w+:)?(?:vessel|body)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?(?:vessel|body)>)/gi;
  let match: RegExpExecArray | null;

  while ((match = vesselRegex.exec(xmlText)) !== null) {
    const attrs = parseAttributes(match[1]!);
    const bodyXml = match[2] || "";

    const id = attrs["id"] || attrs["name"] || `vessel_${vessels.length + 1}`;
    const name = attrs["name"] || id;
    const mass = parseFloat(attrs["mass"] || "10000000");
    const disp = parseFloat(attrs["displacement"] || attrs["disp"] || (mass / environment.waterDensity).toString());
    const gmt = parseFloat(attrs["gmt"] || "4.5");
    const gml = parseFloat(attrs["gml"] || "5.0");
    const cgX = parseFloat(attrs["cgx"] || "0");
    const cgY = parseFloat(attrs["cgy"] || "0");
    const cgZ = parseFloat(attrs["cgz"] || "-5");
    const rxx = parseFloat(attrs["rxx"] || "30");
    const ryy = parseFloat(attrs["ryy"] || "30");
    const rzz = parseFloat(attrs["rzz"] || "35");

    const fairleads: FairleadPoint[] = [];
    const flRegex = /<(?:\w+:)?(?:fairlead|attachment)\b([^>]*)\/?>/gi;
    let flMatch: RegExpExecArray | null;
    while ((flMatch = flRegex.exec(bodyXml)) !== null) {
      const flAttrs = parseAttributes(flMatch[1]!);
      const flId = flAttrs["id"] || flAttrs["name"] || `fl_${fairleads.length + 1}`;
      fairleads.push({
        id: flId,
        name: flId,
        vesselId: id,
        position: [parseFloat(flAttrs["x"] || "0"), parseFloat(flAttrs["y"] || "0"), parseFloat(flAttrs["z"] || "0")],
      });
    }

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

  // Extract mooring lines
  const lineRegex = /<(?:\w+:)?(?:mooringline|line)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?(?:mooringline|line)>)/gi;
  while ((match = lineRegex.exec(xmlText)) !== null) {
    const attrs = parseAttributes(match[1]!);
    const lineXml = match[2] || "";

    const id = attrs["id"] || attrs["name"] || `line_${lines.length + 1}`;
    const name = attrs["name"] || id;
    const type = (attrs["type"]?.toLowerCase() || "catenary") as MooringLine["type"];
    const fairleadId = attrs["fairleadid"] || attrs["fairlead"] || "fl_1";
    const ancX = parseFloat(attrs["anchorx"] || attrs["anc_x"] || "500");
    const ancY = parseFloat(attrs["anchory"] || attrs["anc_y"] || "0");
    const ancZ = parseFloat(attrs["anchorz"] || attrs["anc_z"] || (-environment.waterDepth).toString());

    const segments: LineSegment[] = [];
    const segRegex = /<(?:\w+:)?segment\b([^>]*)\/?>/gi;
    let segMatch: RegExpExecArray | null;
    let totalLen = 0;

    while ((segMatch = segRegex.exec(lineXml)) !== null) {
      const segAttrs = parseAttributes(segMatch[1]!);
      const len = parseFloat(segAttrs["length"] || segAttrs["len"] || "500");
      totalLen += len;
      segments.push({
        id: segAttrs["id"] || `${id}_seg_${segments.length + 1}`,
        name: segAttrs["name"] || `Segment ${segments.length + 1}`,
        length: len,
        diameter: parseFloat(segAttrs["diameter"] || segAttrs["diam"] || "0.12"),
        dryMassPerMeter: parseFloat(segAttrs["drymass"] || segAttrs["mass"] || "290"),
        submergedWeightPerMeter: parseFloat(segAttrs["subweight"] || segAttrs["weight"] || "2500"),
        axialStiffnessEA: parseFloat(segAttrs["ea"] || "1e9"),
        bendingStiffnessEI: parseFloat(segAttrs["ei"] || "1e5"),
        mbl: parseFloat(segAttrs["mbl"] || "1.5e7"),
        cd: parseFloat(segAttrs["cd"] || "1.2"),
        cm: parseFloat(segAttrs["cm"] || "2.0"),
        material: segAttrs["material"],
      });
    }

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

function parseAttributes(attrString: string): Record<string, string> {
  const result: Record<string, string> = {};
  const regex = /([A-Za-z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(attrString)) !== null) {
    const key = match[1]!.toLowerCase();
    const val = match[2] ?? match[3] ?? match[4] ?? "";
    result[key] = val;
  }
  return result;
}

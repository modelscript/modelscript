// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fast PSCAD .pscx / .pslx / .pswx / .psmx XML Parser.
 *
 * Parses PSCAD project files into typed PscxProject structures,
 * preserving schematic coordinates, component definitions, parameters,
 * source line/column locations, and electrical connectivity.
 */

import type {
  Point2D,
  PortKind,
  PscxModule,
  PscxPort,
  PscxProject,
  PscxProjectSettings,
  PscxSticky,
} from "../types.js";

/**
 * Built-in port catalog for standard PSCAD Master Library components
 * when inline <port> tags are not embedded in the .pscx instance.
 */
const MASTER_LIBRARY_PORTS: Record<string, { name: string; kind: PortKind; dim: number; x: number; y: number }[]> = {
  source_3p: [{ name: "out", kind: "electrical", dim: 3, x: 20, y: 0 }],
  source3: [{ name: "N", kind: "electrical", dim: 3, x: 36, y: 0 }],
  source_3: [{ name: "N", kind: "electrical", dim: 3, x: 36, y: 0 }],
  source_1: [{ name: "N", kind: "electrical", dim: 1, x: 36, y: 0 }],
  "xfmr-3p": [
    { name: "P", kind: "electrical", dim: 3, x: -30, y: 0 },
    { name: "S", kind: "electrical", dim: 3, x: 30, y: 0 },
  ],
  "xfmr-3p2w": [
    { name: "N1", kind: "electrical", dim: 3, x: -36, y: 0 },
    { name: "N2", kind: "electrical", dim: 3, x: 36, y: 0 },
  ],
  tline_3p: [
    { name: "in", kind: "electrical", dim: 3, x: -40, y: 0 },
    { name: "out", kind: "electrical", dim: 3, x: 40, y: 0 },
  ],
  tline: [
    { name: "in", kind: "electrical", dim: 3, x: -36, y: 0 },
    { name: "out", kind: "electrical", dim: 3, x: 36, y: 0 },
  ],
  cable: [
    { name: "in", kind: "electrical", dim: 3, x: -36, y: 0 },
    { name: "out", kind: "electrical", dim: 3, x: 36, y: 0 },
  ],
  resistor: [
    { name: "p1", kind: "electrical", dim: 3, x: -18, y: 0 },
    { name: "p2", kind: "electrical", dim: 3, x: 18, y: 0 },
  ],
  inductor: [
    { name: "p1", kind: "electrical", dim: 3, x: -18, y: 0 },
    { name: "p2", kind: "electrical", dim: 3, x: 18, y: 0 },
  ],
  capacitor: [
    { name: "p1", kind: "electrical", dim: 3, x: -18, y: 0 },
    { name: "p2", kind: "electrical", dim: 3, x: 18, y: 0 },
  ],
  rlc: [
    { name: "p1", kind: "electrical", dim: 3, x: -18, y: 0 },
    { name: "p2", kind: "electrical", dim: 3, x: 18, y: 0 },
  ],
  breaker: [
    { name: "N1", kind: "electrical", dim: 3, x: -18, y: 0 },
    { name: "N2", kind: "electrical", dim: 3, x: 18, y: 0 },
  ],
  breaker3: [
    { name: "N1", kind: "electrical", dim: 3, x: -18, y: 0 },
    { name: "N2", kind: "electrical", dim: 3, x: 18, y: 0 },
  ],
  switch: [
    { name: "N1", kind: "electrical", dim: 3, x: -18, y: 0 },
    { name: "N2", kind: "electrical", dim: 3, x: 18, y: 0 },
  ],
  inverter_fmu: [{ name: "term", kind: "electrical", dim: 3, x: -20, y: 0 }],
  fmu: [{ name: "term", kind: "electrical", dim: 3, x: -20, y: 0 }],
  ibr: [{ name: "term", kind: "electrical", dim: 3, x: -20, y: 0 }],
  arrester: [{ name: "p1", kind: "electrical", dim: 3, x: 0, y: -18 }],
  mov: [{ name: "p1", kind: "electrical", dim: 3, x: 0, y: -18 }],
  sync_machine: [{ name: "term", kind: "electrical", dim: 3, x: 36, y: 0 }],
  ind_machine: [{ name: "term", kind: "electrical", dim: 3, x: 36, y: 0 }],
  induction_machine: [{ name: "term", kind: "electrical", dim: 3, x: 36, y: 0 }],
  dfig: [{ name: "term", kind: "electrical", dim: 3, x: 36, y: 0 }],
  tpflt: [{ name: "N", kind: "electrical", dim: 3, x: 0, y: -18 }],
  fault: [{ name: "N", kind: "electrical", dim: 3, x: 0, y: -18 }],
  vsc_pwm: [{ name: "ac", kind: "electrical", dim: 3, x: -36, y: 0 }],
  lcc_6pulse: [{ name: "ac", kind: "electrical", dim: 3, x: -36, y: 0 }],
  mmc_thevenin: [{ name: "ac", kind: "electrical", dim: 3, x: -36, y: 0 }],
  mmc: [{ name: "ac", kind: "electrical", dim: 3, x: -36, y: 0 }],
  ground: [{ name: "GND", kind: "electrical", dim: 3, x: 0, y: -18 }],
  const: [{ name: "out", kind: "signal", dim: 1, x: 18, y: 0 }],
  gain: [
    { name: "in", kind: "signal", dim: 1, x: -18, y: 0 },
    { name: "out", kind: "signal", dim: 1, x: 18, y: 0 },
  ],
  pi_ctlr: [
    { name: "in", kind: "signal", dim: 1, x: -18, y: 0 },
    { name: "out", kind: "signal", dim: 1, x: 18, y: 0 },
  ],
  pi: [
    { name: "in", kind: "signal", dim: 1, x: -18, y: 0 },
    { name: "out", kind: "signal", dim: 1, x: 18, y: 0 },
  ],
  realpole: [
    { name: "in", kind: "signal", dim: 1, x: -18, y: 0 },
    { name: "out", kind: "signal", dim: 1, x: 18, y: 0 },
  ],
  lag: [
    { name: "in", kind: "signal", dim: 1, x: -18, y: 0 },
    { name: "out", kind: "signal", dim: 1, x: 18, y: 0 },
  ],
  leadlag: [
    { name: "in", kind: "signal", dim: 1, x: -18, y: 0 },
    { name: "out", kind: "signal", dim: 1, x: 18, y: 0 },
  ],
  limit: [
    { name: "in", kind: "signal", dim: 1, x: -18, y: 0 },
    { name: "out", kind: "signal", dim: 1, x: 18, y: 0 },
  ],
  sum: [
    { name: "in1", kind: "signal", dim: 1, x: -18, y: 0 },
    { name: "in2", kind: "signal", dim: 1, x: 0, y: 18 },
    { name: "out", kind: "signal", dim: 1, x: 18, y: 0 },
  ],
  compar: [
    { name: "in1", kind: "signal", dim: 1, x: -18, y: 0 },
    { name: "in2", kind: "signal", dim: 1, x: 0, y: 18 },
    { name: "out", kind: "signal", dim: 1, x: 18, y: 0 },
  ],
  pgb: [{ name: "in", kind: "signal", dim: 1, x: -18, y: 0 }],
  datalabel: [{ name: "port", kind: "signal", dim: 1, x: 0, y: 0 }],
  xnode: [{ name: "port", kind: "electrical", dim: 3, x: 0, y: 0 }],
  pin: [{ name: "port", kind: "electrical", dim: 3, x: 0, y: 0 }],
  load: [{ name: "N", kind: "electrical", dim: 3, x: 0, y: -18 }],
  fixed_load: [{ name: "N", kind: "electrical", dim: 3, x: 0, y: -18 }],
  voltmeter: [{ name: "N1", kind: "electrical", dim: 3, x: 0, y: 18 }],
  ammeter: [
    { name: "N1", kind: "electrical", dim: 3, x: -18, y: 0 },
    { name: "N2", kind: "electrical", dim: 3, x: 18, y: 0 },
  ],
  multimeter: [
    { name: "N1", kind: "electrical", dim: 3, x: -18, y: 0 },
    { name: "N2", kind: "electrical", dim: 3, x: 18, y: 0 },
    { name: "P", kind: "signal", dim: 1, x: 0, y: -18 },
    { name: "Q", kind: "signal", dim: 1, x: 0, y: 18 },
  ],
};

/**
 * Precomputes 0-indexed line start offsets for O(log N) line/column lookup.
 */
function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
}

/**
 * Converts a character offset to 1-indexed { line, column }.
 */
function offsetToLineCol(lineStarts: number[], offset: number): { line: number; column: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (lineStarts[mid]! <= offset) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const lineIdx = Math.max(0, low - 1);
  return {
    line: lineIdx + 1,
    column: offset - lineStarts[lineIdx]! + 1,
  };
}

/**
 * Parses point string e.g. "[150, 240]" or "150, 240".
 */
function parsePoint(val?: string | null): Point2D {
  if (!val) return { x: 0, y: 0 };
  const cleaned = val.replace(/[[\]()]/g, "").trim();
  const parts = cleaned.split(/[\s,]+/).map(Number);
  return {
    x: isNaN(parts[0]!) ? 0 : parts[0]!,
    y: isNaN(parts[1]!) ? 0 : parts[1]!,
  };
}

/**
 * Parses a parameter value, converting strictly valid numeric strings to numbers
 * while keeping alphanumeric strings (like "3Phase_Gen") intact.
 */
function parseParamValue(raw: string): string | number {
  const trimmed = raw.trim();
  if (trimmed === "") return raw;
  const num = Number(trimmed);
  return !isNaN(num) ? num : raw;
}

/**
 * Checks whether a byte/character offset falls within any excluded XML range (e.g., `StationDefn` or sub-module blocks).
 */
function isOffsetInRanges(offset: number, ranges: { start: number; end: number }[]): boolean {
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i]!;
    if (offset >= r.start && offset < r.end) return true;
  }
  return false;
}

/**
 * Parses a PSCAD `.pscx` / `.pslx` / `.pswx` XML string into a structured `PscxProject`,
 * extracting project settings, user definitions, root/sub-module schematics, and spatially snapped wire nets.
 */
export function parsePscx(xmlContent: string): PscxProject {
  const lineStarts = computeLineStarts(xmlContent);
  const settings: PscxProjectSettings = {
    timeStepUs: 50.0,
    durationSec: 1.0,
    startType: "flat",
    frequencyHz: 60.0,
  };

  let projectName = "Untitled";
  let version = "5.0";
  let projectType: "case" | "library" = "case";
  const linkedLibraries: string[] = [];

  // Match root <project> or <workspace> tag
  const projectMatch = /<(?:project|workspace)\s+([^>]*?)>/i.exec(xmlContent);
  if (projectMatch) {
    const attrText = projectMatch[1]!;
    const nameMatch = /name\s*=\s*["']([^"']+)["']/i.exec(attrText);
    if (nameMatch) projectName = nameMatch[1]!;
    const verMatch = /version\s*=\s*["']([^"']+)["']/i.exec(attrText);
    if (verMatch) version = verMatch[1]!;
    const typeMatch = /type\s*=\s*["']([^"']+)["']/i.exec(attrText) || /target\s*=\s*["']([^"']+)["']/i.exec(attrText);
    if (typeMatch && typeMatch[1]!.toLowerCase().includes("library")) {
      projectType = "library";
    }
  }

  // Extract linked libraries from workspace <projects> or <Reference> tags
  const libFileRegex = /\bfilepath\s*=\s*["']([^"']+)["']/gi;
  let libMatch: RegExpExecArray | null;
  while ((libMatch = libFileRegex.exec(xmlContent)) !== null) {
    if (libMatch[1]) linkedLibraries.push(libMatch[1]);
  }

  // Scope project settings strictly to project header / <paramlist name="Settings">
  // so component-level parameters (e.g. a source's "frequency") never overwrite project settings.
  const defsIdx = xmlContent.search(/<(?:definitions|hierarchy)\b/i);
  const settingsXml =
    /<paramlist\s+name\s*=\s*["']Settings["'][^>]*>([\s\S]*?)<\/paramlist>/i.exec(xmlContent)?.[1] ??
    (defsIdx > 0 ? xmlContent.slice(0, defsIdx) : xmlContent.slice(0, 2000));

  const paramRegex = /<param\s+([^>]*?)(?:\/>|>(.*?)<\/param>)/gi;
  let pMatch: RegExpExecArray | null;
  while ((pMatch = paramRegex.exec(settingsXml)) !== null) {
    const attrs = pMatch[1]!;
    const nameAttr = /name\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    const valAttr = /value\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ?? pMatch[2]?.trim();

    if (!nameAttr || valAttr === undefined) continue;

    const lowerName = nameAttr.toLowerCase();
    if (lowerName === "time_step" || lowerName === "timestep") {
      const parsed = parseFloat(valAttr);
      if (!isNaN(parsed) && parsed > 0) settings.timeStepUs = parsed;
    } else if (lowerName === "time_duration" || lowerName === "duration") {
      const parsed = parseFloat(valAttr);
      if (!isNaN(parsed) && parsed > 0) settings.durationSec = parsed;
    } else if (lowerName === "f_base" || lowerName === "frequency" || lowerName === "freq") {
      const parsed = parseFloat(valAttr);
      if (!isNaN(parsed) && parsed > 0) settings.frequencyHz = parsed;
    } else if (lowerName === "start_type" || lowerName === "starttype") {
      settings.startType = valAttr === "1" ? "snapshot" : "flat";
    } else if (lowerName === "startup_filename" && valAttr) {
      settings.snapshotFile = valAttr;
    }
  }

  // Extract definition ports from <Definition classid="UserCmpDefn" name="...">...<graphics>...<Port ...>
  // and identify excluded station/sub-module ranges.
  const definitionPorts = new Map<string, PscxPort[]>();
  const excludedRanges: { start: number; end: number }[] = [];
  const subModuleDefs: { name: string; xml: string; baseOffset: number }[] = [];

  const defRegex = /<Definition\s+([^>]*?)>([\s\S]*?)<\/Definition>/gi;
  let defMatch: RegExpExecArray | null;
  while ((defMatch = defRegex.exec(xmlContent)) !== null) {
    const dAttrs = defMatch[1]!;
    const dBody = defMatch[2]!;
    const defName = /name\s*=\s*["']([^"']+)["']/i.exec(dAttrs)?.[1];
    const classId = /classid\s*=\s*["']([^"']+)["']/i.exec(dAttrs)?.[1];
    const defType = /type\s*=\s*["']([^"']+)["']/i.exec(dAttrs)?.[1];

    // Exclude Drawing Station (StationDefn) from root schematic
    if (classId === "StationDefn" || defName === "DS") {
      excludedRanges.push({ start: defMatch.index, end: defMatch.index + defMatch[0].length });
      continue;
    }

    if (defName && classId === "UserCmpDefn") {
      const defPorts: PscxPort[] = [];
      const portRegex = /<Port\s+([^>]*?)>([\s\S]*?)<\/Port>/gi;
      let portMatch: RegExpExecArray | null;
      const seenPortNames = new Set<string>();
      while ((portMatch = portRegex.exec(dBody)) !== null) {
        const pAttrs = portMatch[1]!;
        const pBody = portMatch[2]!;
        const portX = parseFloat(/x\s*=\s*["']([^"']+)["']/i.exec(pAttrs)?.[1] || "0");
        const portY = parseFloat(/y\s*=\s*["']([^"']+)["']/i.exec(pAttrs)?.[1] || "0");
        const pName = /<param\s+name\s*=\s*["']name["']\s+value\s*=\s*["']([^"']+)["']/i.exec(pBody)?.[1] || "p";
        if (seenPortNames.has(pName)) continue;
        seenPortNames.add(pName);
        const pDim = parseInt(
          /<param\s+name\s*=\s*["']dim["']\s+value\s*=\s*["']([^"']+)["']/i.exec(pBody)?.[1] || "1",
          10,
        );
        const pElectype = /<param\s+name\s*=\s*["']electype["']\s+value\s*=\s*["']([^"']+)["']/i.exec(pBody)?.[1];
        const kind: PortKind = pElectype === "0" || pElectype === "signal" ? "signal" : "electrical";
        defPorts.push({
          id: pName,
          name: pName,
          kind,
          dimension: isNaN(pDim) ? 1 : pDim,
          position: { x: portX, y: portY },
        });
      }
      if (defPorts.length > 0) {
        definitionPorts.set(defName, defPorts);
      }
    }

    // If this is a non-Main sub-module definition with its own schematic, parse it into subModules
    if (
      defName &&
      defName !== "Main" &&
      (classId === "UserCmpDefn" || defType === "module") &&
      /<schematic\b/i.test(dBody)
    ) {
      const bodyStartOffset = defMatch.index + defMatch[0].indexOf(dBody);
      subModuleDefs.push({ name: defName, xml: dBody, baseOffset: bodyStartOffset });
      excludedRanges.push({ start: defMatch.index, end: defMatch.index + defMatch[0].length });
    }
  }

  // Also exclude standalone <schematic classid="StationCanvas"> blocks
  const stationCanvasRegex = /<schematic\s+[^>]*?classid=["']StationCanvas["'][\s\S]*?<\/schematic>/gi;
  let scMatch: RegExpExecArray | null;
  while ((scMatch = stationCanvasRegex.exec(xmlContent)) !== null) {
    excludedRanges.push({ start: scMatch.index, end: scMatch.index + scMatch[0].length });
  }

  function parseModuleFromXml(
    modId: string,
    modName: string,
    xmlSlice: string,
    baseOffset: number,
    skipRanges: { start: number; end: number }[],
  ): PscxModule {
    const mod: PscxModule = {
      id: modId,
      name: modName,
      components: [],
      buses: [],
      wires: [],
    };

    let autoIdCounter = 1;

    // 1. Extract User / Component elements (including self-closing <User .../> tags)
    const cmpRegex = /<(?:User|Component)\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:User|Component)>)/gi;
    let cMatch: RegExpExecArray | null;

    while ((cMatch = cmpRegex.exec(xmlSlice)) !== null) {
      const absOffset = baseOffset + cMatch.index;
      if (skipRanges.length > 0 && isOffsetInRanges(absOffset, skipRanges)) continue;

      const attrs = cMatch[1]!;
      const inner = cMatch[2] ?? "";

      const defn =
        /defn\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ||
        /\bname\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ||
        /type\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ||
        "Component";

      const idMatch = /\bid\s*=\s*["']([^"']+)["']/i.exec(attrs);
      const id = idMatch?.[1] || String(autoIdCounter++);
      let cmpLocOffset = absOffset;
      const cmpAttrsIdx = cMatch[0].indexOf(attrs);
      if (idMatch && cmpAttrsIdx >= 0) {
        cmpLocOffset = absOffset + cmpAttrsIdx + idMatch.index + idMatch[0].lastIndexOf(id);
      }
      const loc = offsetToLineCol(lineStarts, cmpLocOffset);
      const posX = parseFloat(/\bx\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || "0");
      const posY = parseFloat(/\by\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || "0");
      const width = parseFloat(/\bw\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || "0");
      const height = parseFloat(/\bh\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || "0");
      const orientRaw = parseInt(/orient\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || "0", 10);
      const mirrorAttr = /mirror\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
      const mirror = mirrorAttr === "true" || mirrorAttr === "1" || (orientRaw >= 4 && orientRaw <= 7);

      // Normalize rotation: PSCAD orient 0..3 -> 0, 90, 180, 270 degrees
      const rotation =
        orientRaw >= 0 && orientRaw <= 3
          ? orientRaw * 90
          : orientRaw >= 4 && orientRaw <= 7
            ? (orientRaw - 4) * 90
            : isNaN(orientRaw)
              ? 0
              : orientRaw % 360;

      const params: Record<string, string | number> = {};
      const paramLocations: Record<string, { line: number; column: number }> = {};
      const ports: PscxPort[] = [];
      const innerStartInMatch = inner ? cMatch[0].indexOf(inner) : 0;

      // Parse inner parameters
      let innerParamMatch: RegExpExecArray | null;
      const innerParamRegex = /<param\s+([^>]*?)(?:\/>|>(.*?)<\/param>)/gi;
      while ((innerParamMatch = innerParamRegex.exec(inner)) !== null) {
        const pAttrs = innerParamMatch[1]!;
        const pNameMatch = /name\s*=\s*["']([^"']+)["']/i.exec(pAttrs);
        const pName = pNameMatch?.[1];
        const pVal = /value\s*=\s*["']([^"']*)["']/i.exec(pAttrs)?.[1] ?? innerParamMatch[2]?.trim();
        if (pName && pVal !== undefined) {
          params[pName] = parseParamValue(pVal);
          if (innerStartInMatch >= 0) {
            const pAttrsIdx = innerParamMatch[0].indexOf(pAttrs);
            const nameOffsetInParam =
              pNameMatch && pAttrsIdx >= 0 ? pAttrsIdx + pNameMatch.index + pNameMatch[0].lastIndexOf(pName) : 0;
            paramLocations[pName] = offsetToLineCol(
              lineStarts,
              absOffset + innerStartInMatch + innerParamMatch.index + nameOffsetInParam,
            );
          }
        }
      }

      // Parse inner ports
      let portMatch: RegExpExecArray | null;
      const portRegex = /<port\s+([^>]*?)(?:\/>|>(.*?)<\/port>)/gi;
      while ((portMatch = portRegex.exec(inner)) !== null) {
        const portAttrs = portMatch[1]!;
        const portName = /name\s*=\s*["']([^"']+)["']/i.exec(portAttrs)?.[1] || "p";
        const posVal = /pos\s*=\s*["']([^"']+)["']/i.exec(portAttrs)?.[1];
        const kindVal = (/kind\s*=\s*["']([^"']+)["']/i.exec(portAttrs)?.[1] as PortKind) || "electrical";
        const dimVal = parseInt(/dim\s*=\s*["']([^"']+)["']/i.exec(portAttrs)?.[1] || "3", 10);

        ports.push({
          id: `${id}_${portName}`,
          name: portName,
          kind: kindVal,
          dimension: isNaN(dimVal) ? 3 : dimVal,
          position: parsePoint(posVal),
        });
      }

      // If no inline ports found, inherit from user definition or Master Library catalog
      const cleanDefn = defn.includes(":") ? defn.split(":").pop()! : defn;
      if (ports.length === 0) {
        if (definitionPorts.has(cleanDefn)) {
          const seenInheritedNames = new Set<string>();
          for (const dp of definitionPorts.get(cleanDefn)!) {
            if (seenInheritedNames.has(dp.name)) continue;
            seenInheritedNames.add(dp.name);
            ports.push({
              id: `${id}_${dp.name}`,
              name: dp.name,
              kind: dp.kind,
              dimension: dp.dimension,
              position: { ...dp.position },
            });
          }
        } else {
          const masterPorts = MASTER_LIBRARY_PORTS[cleanDefn.toLowerCase()];
          if (masterPorts) {
            for (const mp of masterPorts) {
              ports.push({
                id: `${id}_${mp.name}`,
                name: mp.name,
                kind: mp.kind,
                dimension: mp.dim,
                position: { x: mp.x, y: mp.y },
              });
            }
          }
        }
      }

      // Infer instance name if present in params or attrs
      const nameAttr = /name\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
      const paramName = (params["Name"] ?? params["name"]) as string | number | undefined;
      const instanceName =
        paramName !== undefined && String(paramName).trim() !== ""
          ? String(paramName).trim()
          : nameAttr && nameAttr.trim() !== ""
            ? nameAttr.trim()
            : `${defn}_${id}`;

      mod.components.push({
        id,
        definitionName: defn,
        instanceName,
        position: { x: posX, y: posY },
        width: width > 0 ? width : undefined,
        height: height > 0 ? height : undefined,
        rotation,
        mirror: mirror || undefined,
        parameters: params,
        paramLocations,
        ports,
        line: loc.line,
        column: loc.column,
        sourceRange: { startOffset: absOffset, endOffset: absOffset + cMatch[0].length },
      });
    }

    // 2. Extract <Bus .../> elements
    const busRegex = /<Bus\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/Bus>)/gi;
    let bMatch: RegExpExecArray | null;
    while ((bMatch = busRegex.exec(xmlSlice)) !== null) {
      const absOffset = baseOffset + bMatch.index;
      if (skipRanges.length > 0 && isOffsetInRanges(absOffset, skipRanges)) continue;

      const attrs = bMatch[1]!;
      const busNameMatch = /name\s*=\s*["']([^"']+)["']/i.exec(attrs);
      const busIdMatch = /\bid\s*=\s*["']([^"']+)["']/i.exec(attrs);
      const busName = busNameMatch?.[1] || `Bus_${autoIdCounter++}`;
      const busId = busIdMatch?.[1] || busName;
      let busLocOffset = absOffset;
      const bAttrsIdx = bMatch[0].indexOf(attrs);
      if (busNameMatch && bAttrsIdx >= 0) {
        busLocOffset = absOffset + bAttrsIdx + busNameMatch.index + busNameMatch[0].lastIndexOf(busName);
      } else if (busIdMatch && bAttrsIdx >= 0) {
        busLocOffset = absOffset + bAttrsIdx + busIdMatch.index + busIdMatch[0].lastIndexOf(busId);
      }
      const loc = offsetToLineCol(lineStarts, busLocOffset);
      const posX = parseFloat(/\bx\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || "0");
      const posY = parseFloat(/\by\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || "0");
      const vbase = parseFloat(
        /vbase\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || /v_base\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || "0",
      );
      const length = parseFloat(/length\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || "50");

      mod.buses.push({
        id: busId,
        name: busName,
        voltageBaseKv: vbase > 0 ? vbase : undefined,
        position: { x: posX, y: posY },
        length,
        phaseCount: 3,
        line: loc.line,
        column: loc.column,
        sourceRange: { startOffset: absOffset, endOffset: absOffset + bMatch[0].length },
      });
    }

    // 3. Extract Wires (and <Wire classid="Bus"> busbars in PSCAD v4/v5)
    const wireRegex = /<Wire\s*([^>]*?)>([\s\S]*?)<\/Wire>/gi;
    let wMatch: RegExpExecArray | null;
    let wireId = 1;
    while ((wMatch = wireRegex.exec(xmlSlice)) !== null) {
      const absOffset = baseOffset + wMatch.index;
      if (skipRanges.length > 0 && isOffsetInRanges(absOffset, skipRanges)) continue;

      const wAttrs = wMatch[1]!;
      const inner = wMatch[2]!;
      const classId = /classid\s*=\s*["']([^"']+)["']/i.exec(wAttrs)?.[1] || "";

      // Skip hierarchy branch links
      if (classId.toLowerCase() === "branch") continue;

      const wireX = parseFloat(/\bx\s*=\s*["']([^"']+)["']/i.exec(wAttrs)?.[1] || "0");
      const wireY = parseFloat(/\by\s*=\s*["']([^"']+)["']/i.exec(wAttrs)?.[1] || "0");
      const vertices: Point2D[] = [];

      const vertexRegex = /<vertex\s+([^>]*?)\/>/gi;
      let vMatch: RegExpExecArray | null;
      while ((vMatch = vertexRegex.exec(inner)) !== null) {
        const vAttrs = vMatch[1]!;
        const vx = parseFloat(/\bx\s*=\s*["']([^"']+)["']/i.exec(vAttrs)?.[1] || "0") + wireX;
        const vy = parseFloat(/\by\s*=\s*["']([^"']+)["']/i.exec(vAttrs)?.[1] || "0") + wireY;
        vertices.push({ x: vx, y: vy });
      }

      if (classId.toLowerCase() === "bus") {
        const innerNameMatch = /<param\s+name\s*=\s*["']Name["']\s+value\s*=\s*["']([^"']+)["']/i.exec(inner);
        const attrNameMatch = /name\s*=\s*["']([^"']+)["']/i.exec(wAttrs);
        const attrIdMatch = /\bid\s*=\s*["']([^"']+)["']/i.exec(wAttrs);
        const busName = innerNameMatch?.[1] || attrNameMatch?.[1] || `Bus_${autoIdCounter++}`;
        const busId = attrIdMatch?.[1] || busName;
        let busLocOffset = absOffset;
        if (innerNameMatch) {
          const innerIdx = wMatch[0].indexOf(inner);
          if (innerIdx >= 0) {
            busLocOffset = absOffset + innerIdx + innerNameMatch.index + innerNameMatch[0].lastIndexOf(busName);
          }
        } else if (attrNameMatch) {
          const attrsIdx = wMatch[0].indexOf(wAttrs);
          if (attrsIdx >= 0) {
            busLocOffset = absOffset + attrsIdx + attrNameMatch.index + attrNameMatch[0].lastIndexOf(busName);
          }
        }
        const loc = offsetToLineCol(lineStarts, busLocOffset);
        const vbaseStr =
          /<param\s+name\s*=\s*["'](?:BaseKV|VBase|vbase)["']\s+value\s*=\s*["']([^"']+)["']/i.exec(inner)?.[1] || "0";
        const vbase = parseFloat(vbaseStr);
        const startPt = vertices[0] ?? { x: wireX, y: wireY };
        const endPt = vertices[vertices.length - 1] ?? { x: wireX + 50, y: wireY };
        const segLen = distance(startPt, endPt) || 50;

        mod.buses.push({
          id: busId,
          name: busName,
          voltageBaseKv: vbase > 0 ? vbase : undefined,
          position: startPt,
          length: segLen,
          vertices: vertices.length >= 2 ? vertices : undefined,
          phaseCount: 3,
          line: loc.line,
          column: loc.column,
          sourceRange: { startOffset: absOffset, endOffset: absOffset + wMatch[0].length },
        });
        continue;
      }

      if (vertices.length >= 2) {
        const attrWireId = /\bid\s*=\s*["']([^"']+)["']/i.exec(wAttrs)?.[1];
        const wLoc = offsetToLineCol(lineStarts, absOffset);
        mod.wires.push({
          id: attrWireId || `wire_${wireId++}`,
          vertices,
          connectedPortIds: [],
          line: wLoc.line,
          sourceRange: { startOffset: absOffset, endOffset: absOffset + wMatch[0].length },
        });
      }
    }

    // 4. Extract Stickies (canvas banners & descriptive notes common in .pslx libraries)
    const stickyRegex = /<Sticky\s+([^>]*?)>([\s\S]*?)<\/Sticky>/gi;
    let sMatch: RegExpExecArray | null;
    let stickyId = 1;
    const stickies: PscxSticky[] = [];
    while ((sMatch = stickyRegex.exec(xmlSlice)) !== null) {
      const absOffset = baseOffset + sMatch.index;
      if (skipRanges.length > 0 && isOffsetInRanges(absOffset, skipRanges)) continue;

      const sAttrs = sMatch[1]!;
      const sInner = sMatch[2]!;
      const sx = parseFloat(/\bx\s*=\s*["']([^"']+)["']/i.exec(sAttrs)?.[1] || "0");
      const sy = parseFloat(/\by\s*=\s*["']([^"']+)["']/i.exec(sAttrs)?.[1] || "0");
      const sw = parseFloat(/\bw\s*=\s*["']([^"']+)["']/i.exec(sAttrs)?.[1] || "200");
      const sh = parseFloat(/\bh\s*=\s*["']([^"']+)["']/i.exec(sAttrs)?.[1] || "100");
      const sid = /\bid\s*=\s*["']([^"']+)["']/i.exec(sAttrs)?.[1] || `sticky_${stickyId++}`;

      let text = "";
      const cdataMatch = /<!\[CDATA\[([\s\S]*?)\]\]>/i.exec(sInner);
      if (cdataMatch) {
        text = cdataMatch[1]!.trim();
      } else {
        text = sInner.replace(/<[^>]+>/g, "").trim();
      }

      if (text) {
        stickies.push({
          id: sid,
          position: { x: sx, y: sy },
          width: sw,
          height: sh,
          text,
        });
      }
    }
    if (stickies.length > 0) {
      mod.stickies = stickies;
    }

    // Resolve spatial wire connectivity
    snapWireConnections(mod);
    return mod;
  }

  const rootModule = parseModuleFromXml("Main", "Main", xmlContent, 0, excludedRanges);
  const subModules = new Map<string, PscxModule>();
  for (const sub of subModuleDefs) {
    subModules.set(sub.name, parseModuleFromXml(sub.name, sub.name, sub.xml, sub.baseOffset, []));
  }

  return {
    name: projectName,
    version,
    projectType,
    settings,
    rootModule,
    subModules,
    linkedLibraries,
  };
}

/**
 * Snaps wire endpoints to nearby component ports, buses, and chained wires within SNAP_TOLERANCE.
 */
const SNAP_TOLERANCE = 15.0; // 15 pixels/units snap radius

/**
 * Euclidean distance between two 2D schematic canvas points.
 */
function distance(p1: Point2D, p2: Point2D): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Shortest Euclidean distance from point p to line segment [a, b].
 */
function pointToSegmentDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

/**
 * Computes world coordinates of a component port accounting for rotation and mirroring.
 */
export function computePortWorldPosition(
  cmpPos: Point2D,
  portOffset: Point2D,
  rotationDeg = 0,
  mirror = false,
): Point2D {
  // Apply horizontal reflection before 2D rotation matrix R(theta)
  const lx = mirror ? -portOffset.x : portOffset.x;
  const ly = portOffset.y;
  const rad = ((rotationDeg % 360) * Math.PI) / 180;
  const cos = Math.round(Math.cos(rad) * 1e6) / 1e6;
  const sin = Math.round(Math.sin(rad) * 1e6) / 1e6;
  return {
    x: cmpPos.x + (lx * cos - ly * sin),
    y: cmpPos.y + (lx * sin + ly * cos),
  };
}

/**
 * Resolves schematic electrical and control connectivity by snapping `<Wire>` vertices
 * to component ports and `<Bus>` segments within `SNAP_TOLERANCE`, grouping wireless
 * Data Labels / XNodes by name, and merging transitive multi-segment wire chains via Union-Find.
 */
function snapWireConnections(mod: PscxModule): void {
  // Precompute world positions for all component ports
  const allPorts: { id: string; world: Point2D }[] = [];
  for (const cmp of mod.components) {
    for (const port of cmp.ports) {
      allPorts.push({
        id: port.id,
        world: computePortWorldPosition(cmp.position, port.position, cmp.rotation ?? 0, Boolean(cmp.mirror)),
      });
    }
  }

  const rawJunctions: Point2D[] = [];
  const addJunction = (pt: Point2D) => {
    if (!rawJunctions.some((j) => distance(j, pt) <= 6.0)) {
      rawJunctions.push({ x: Math.round(pt.x), y: Math.round(pt.y) });
    }
  };

  for (const wire of mod.wires) {
    if (wire.vertices.length < 2) continue;
    const start = wire.vertices[0]!;
    const end = wire.vertices[wire.vertices.length - 1]!;
    const connectedSet = new Set<string>(wire.connectedPortIds);
    let bestStartDist = SNAP_TOLERANCE + 1;
    let bestEndDist = SNAP_TOLERANCE + 1;

    for (const p of allPorts) {
      const dStart = distance(start, p.world);
      const dEnd = distance(end, p.world);
      if (dStart <= SNAP_TOLERANCE) {
        connectedSet.add(p.id);
        if (dStart < bestStartDist) {
          bestStartDist = dStart;
          wire.startPortId = p.id;
        }
      }
      if (dEnd <= SNAP_TOLERANCE) {
        connectedSet.add(p.id);
        if (dEnd < bestEndDist) {
          bestEndDist = dEnd;
          wire.endPortId = p.id;
        }
      }
      if (dStart > SNAP_TOLERANCE && dEnd > SNAP_TOLERANCE) {
        for (let k = 0; k < wire.vertices.length - 1; k++) {
          if (pointToSegmentDistance(p.world, wire.vertices[k]!, wire.vertices[k + 1]!) <= SNAP_TOLERANCE) {
            connectedSet.add(p.id);
            addJunction(p.world);
            break;
          }
        }
      }
    }

    for (const bus of mod.buses) {
      if (bus.vertices && bus.vertices.length >= 2) {
        for (let k = 0; k < bus.vertices.length - 1; k++) {
          const segA = bus.vertices[k]!;
          const segB = bus.vertices[k + 1]!;
          const dStart = pointToSegmentDistance(start, segA, segB);
          const dEnd = pointToSegmentDistance(end, segA, segB);
          if (dStart <= SNAP_TOLERANCE || dEnd <= SNAP_TOLERANCE) {
            connectedSet.add(bus.id);
            if (dStart <= SNAP_TOLERANCE && !wire.startPortId) wire.startPortId = bus.id;
            if (dEnd <= SNAP_TOLERANCE && !wire.endPortId) wire.endPortId = bus.id;
            break;
          }
        }
      } else {
        const busStart = bus.position;
        const busEnd: Point2D = { x: bus.position.x + (bus.length ?? 50), y: bus.position.y };
        const dStart = pointToSegmentDistance(start, busStart, busEnd);
        const dEnd = pointToSegmentDistance(end, busStart, busEnd);

        // Check true point-to-segment distance along the entire busbar
        if (dStart <= SNAP_TOLERANCE || dEnd <= SNAP_TOLERANCE) {
          connectedSet.add(bus.id);
          if (dStart <= SNAP_TOLERANCE && !wire.startPortId) wire.startPortId = bus.id;
          if (dEnd <= SNAP_TOLERANCE && !wire.endPortId) wire.endPortId = bus.id;
        }
      }
    }

    wire.connectedPortIds = Array.from(connectedSet);
  }

  // Group wireless Data Label / XNode / Pin components by shared label name
  const wirelessNetMap = new Map<string, Set<string>>();
  for (const cmp of mod.components) {
    const cleanDef = (
      cmp.definitionName.includes(":") ? cmp.definitionName.split(":").pop()! : cmp.definitionName
    ).toLowerCase();
    const isWirelessNode =
      cleanDef === "datalabel" ||
      cleanDef === "data_label" ||
      cleanDef === "xnode" ||
      cleanDef === "pin" ||
      cleanDef === "radio_link";
    if (isWirelessNode) {
      const labelName = String(
        cmp.parameters["Name"] ?? cmp.parameters["name"] ?? cmp.parameters["Label"] ?? cmp.instanceName ?? "",
      ).trim();
      if (labelName) {
        let portSet = wirelessNetMap.get(labelName);
        if (!portSet) {
          portSet = new Set<string>();
          wirelessNetMap.set(labelName, portSet);
        }
        for (const p of cmp.ports) {
          portSet.add(p.id);
        }
        // Also snap any colocated component port within SNAP_TOLERANCE of the wireless label
        for (const ap of allPorts) {
          if (distance(cmp.position, ap.world) <= SNAP_TOLERANCE) {
            portSet.add(ap.id);
          }
        }
      }
    }
  }

  if (wirelessNetMap.size > 0) {
    const wirelessRecord: Record<string, string[]> = {};
    for (const [label, pSet] of wirelessNetMap.entries()) {
      wirelessRecord[label] = Array.from(pSet);
    }
    mod.wirelessNets = wirelessRecord;
  }

  // Propagate connectivity across multi-segment wire chains / T-junctions & wireless nets
  const nWires = mod.wires.length;
  if (nWires >= 1) {
    const parent = Array.from({ length: nWires }, (_, i) => i);
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]!]!;
        i = parent[i]!;
      }
      return i;
    };
    const union = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };

    // Track endpoint clustering for 3+ wire junctions
    const endpointCounts: { pt: Point2D; count: number }[] = [];
    for (let i = 0; i < nWires; i++) {
      const w = mod.wires[i]!;
      if (w.vertices.length < 2) continue;
      for (const ep of [w.vertices[0]!, w.vertices[w.vertices.length - 1]!]) {
        const existing = endpointCounts.find((e) => distance(e.pt, ep) <= SNAP_TOLERANCE);
        if (existing) existing.count++;
        else endpointCounts.push({ pt: ep, count: 1 });
      }
    }
    for (const ec of endpointCounts) {
      if (ec.count >= 3) addJunction(ec.pt);
    }

    for (let i = 0; i < nWires; i++) {
      const wA = mod.wires[i]!;
      if (wA.vertices.length < 2) continue;
      const aStart = wA.vertices[0]!;
      const aEnd = wA.vertices[wA.vertices.length - 1]!;

      for (let j = i + 1; j < nWires; j++) {
        const wB = mod.wires[j]!;
        if (wB.vertices.length < 2) continue;
        const bStart = wB.vertices[0]!;
        const bEnd = wB.vertices[wB.vertices.length - 1]!;

        let touches = false;
        for (let k = 0; k < wB.vertices.length - 1; k++) {
          const segStart = wB.vertices[k]!;
          const segEnd = wB.vertices[k + 1]!;
          if (pointToSegmentDistance(aStart, segStart, segEnd) <= SNAP_TOLERANCE) {
            touches = true;
            if (distance(aStart, bStart) > SNAP_TOLERANCE && distance(aStart, bEnd) > SNAP_TOLERANCE) {
              addJunction(aStart);
            }
            break;
          }
          if (pointToSegmentDistance(aEnd, segStart, segEnd) <= SNAP_TOLERANCE) {
            touches = true;
            if (distance(aEnd, bStart) > SNAP_TOLERANCE && distance(aEnd, bEnd) > SNAP_TOLERANCE) {
              addJunction(aEnd);
            }
            break;
          }
        }
        if (!touches) {
          for (let k = 0; k < wA.vertices.length - 1; k++) {
            const segStart = wA.vertices[k]!;
            const segEnd = wA.vertices[k + 1]!;
            if (pointToSegmentDistance(bStart, segStart, segEnd) <= SNAP_TOLERANCE) {
              touches = true;
              if (distance(bStart, aStart) > SNAP_TOLERANCE && distance(bStart, aEnd) > SNAP_TOLERANCE) {
                addJunction(bStart);
              }
              break;
            }
            if (pointToSegmentDistance(bEnd, segStart, segEnd) <= SNAP_TOLERANCE) {
              touches = true;
              if (distance(bEnd, aStart) > SNAP_TOLERANCE && distance(bEnd, aEnd) > SNAP_TOLERANCE) {
                addJunction(bEnd);
              }
              break;
            }
          }
        }
        if (touches) {
          union(i, j);
        }
      }
    }

    // Union wires that connect to the same wireless Data Label / XNode net
    if (wirelessNetMap.size > 0) {
      for (const [, portSet] of wirelessNetMap.entries()) {
        if (portSet.size < 2) continue;
        const matchingWireIndices: number[] = [];
        for (let i = 0; i < nWires; i++) {
          if (mod.wires[i]!.connectedPortIds.some((pid) => portSet.has(pid))) {
            matchingWireIndices.push(i);
          }
        }
        for (let k = 1; k < matchingWireIndices.length; k++) {
          union(matchingWireIndices[0]!, matchingWireIndices[k]!);
        }
      }
    }

    const groupPorts = new Map<number, Set<string>>();
    for (let i = 0; i < nWires; i++) {
      const root = find(i);
      let set = groupPorts.get(root);
      if (!set) {
        set = new Set<string>();
        groupPorts.set(root, set);
      }
      for (const pid of mod.wires[i]!.connectedPortIds) {
        set.add(pid);
      }
    }
    for (let i = 0; i < nWires; i++) {
      const root = find(i);
      mod.wires[i]!.connectedPortIds = Array.from(groupPorts.get(root)!);
    }
  }

  if (rawJunctions.length > 0) {
    mod.junctions = rawJunctions;
  }
}

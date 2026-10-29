// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fast PSCAD .pscx / .pslx / .pswx / .psmx XML Parser.
 *
 * Parses PSCAD project files into typed PscxProject structures,
 * preserving schematic coordinates, component definitions, parameters,
 * source line/column locations, and electrical connectivity.
 */

import { parseXml, type XmlAttribute, type XmlElement } from "@modelscript/dsl/xml";
import { EXTRA_MASTER_PORT_LAYOUTS } from "../catalog/master-port-layouts.js";
import { readDefinitionForm } from "../model/definition-form.js";
import { buildProjectModel, type ExternalDefinitions, type ModelDefinition } from "../model/pscad-model.js";
import { refineModulePorts } from "../model/refine-ports.js";
import { registeredExternalDefinitions } from "../model/workspace-registry.js";
import { parseChecksSegment, parseFlyBySegment, parseScriptElement } from "../script/script-parser.js";
import type {
  Point2D,
  PortKind,
  PscadCheckRule,
  PscadFlyByDoc,
  PscadScriptSegment,
  PscxDefinitionGraphic,
  PscxLine,
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
    { name: "N1", kind: "electrical", dim: 3, x: -54, y: 0 },
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
    { name: "in1", kind: "signal", dim: 1, x: 0, y: 0 },
    { name: "in2", kind: "signal", dim: 1, x: 0, y: 36 },
    { name: "out", kind: "signal", dim: 1, x: 72, y: 0 },
  ],
  pgb: [{ name: "in", kind: "signal", dim: 1, x: -18, y: 0 }],
  datalabel: [{ name: "port", kind: "signal", dim: 1, x: 0, y: 0 }],
  xnode: [{ name: "port", kind: "electrical", dim: 3, x: 0, y: 0 }],
  pin: [{ name: "port", kind: "electrical", dim: 3, x: 0, y: 0 }],
  load: [{ name: "N", kind: "electrical", dim: 3, x: 0, y: -18 }],
  fixed_load: [{ name: "N", kind: "electrical", dim: 3, x: 0, y: -18 }],
  // Offsets derived from wire-end statistics of real PSCAD 5 projects (not vendor documentation).
  voltmeter: [
    { name: "N1", kind: "electrical", dim: 3, x: 0, y: 0 },
    { name: "out", kind: "signal", dim: 1, x: 0, y: 36 },
  ],
  ammeter: [
    { name: "N1", kind: "electrical", dim: 3, x: 0, y: 0 },
    { name: "N2", kind: "electrical", dim: 3, x: 36, y: 0 },
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

function attr(el: XmlElement, name: string): string | undefined {
  const lower = name.toLowerCase();
  return el.attributes.find((a) => a.name.toLowerCase() === lower)?.value;
}

function attrObj(el: XmlElement, name: string): XmlAttribute | undefined {
  const lower = name.toLowerCase();
  return el.attributes.find((a) => a.name.toLowerCase() === lower);
}

/**
 * Parses a PSCAD project using the DSL-generated lossless XML CST (@modelscript/dsl/xml).
 */
export function parsePscxCst(xmlContent: string, options?: { external?: ExternalDefinitions }): PscxProject {
  const doc = parseXml(xmlContent);
  if (!doc.root) {
    throw new Error("PSCAD XML has no root element");
  }

  let modelDefs: Map<string, ModelDefinition> | undefined;
  try {
    modelDefs = buildProjectModel(xmlContent, options?.external ?? registeredExternalDefinitions()).definitions;
  } catch {
    modelDefs = undefined;
  }

  const lineStarts = computeLineStarts(xmlContent);
  const settings: PscxProjectSettings = {
    timeStepUs: 50.0,
    durationSec: 1.0,
    startType: "flat",
    frequencyHz: 60.0,
  };

  const rootEl = doc.root;
  const projectName = attr(rootEl, "name") ?? "Untitled";
  const version = attr(rootEl, "version") ?? "5.0";
  const targetOrType = attr(rootEl, "type") || attr(rootEl, "target") || "";
  const projectType: "case" | "library" = targetOrType.toLowerCase().includes("library") ? "library" : "case";
  const linkedLibraries: string[] = [];

  // Traverse all elements for filepath attributes
  function collectFilepaths(el: XmlElement) {
    const fp = attr(el, "filepath");
    if (fp) linkedLibraries.push(fp);
    for (const c of el.children) collectFilepaths(c);
  }
  collectFilepaths(rootEl);

  // Settings
  function collectSettingsParams(el: XmlElement): XmlElement[] {
    const lower = el.name.toLowerCase();
    if (lower === "paramlist" && attr(el, "name")?.toLowerCase() === "settings") {
      return el.children.filter((c) => c.name.toLowerCase() === "param");
    }
    for (const c of el.children) {
      const res = collectSettingsParams(c);
      if (res.length > 0) return res;
    }
    return [];
  }

  let settingParams = collectSettingsParams(rootEl);
  if (settingParams.length === 0) {
    settingParams = rootEl.children.filter((c) => c.name.toLowerCase() === "param");
  }

  for (const p of settingParams) {
    const nameAttr = attr(p, "name");
    const valAttr = attr(p, "value") ?? p.text.trim();
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

  // Find all definitions
  const definitionPorts = new Map<string, PscxPort[]>();
  const projectDefinitions = new Map<string, PscxDefinitionGraphic>();
  const excludedElements = new Set<XmlElement>();
  const subModuleDefs: { name: string; element: XmlElement }[] = [];

  function findDefinitions(el: XmlElement): XmlElement[] {
    const out: XmlElement[] = [];
    if (el.name.toLowerCase() === "definition") {
      out.push(el);
    }
    for (const c of el.children) {
      out.push(...findDefinitions(c));
    }
    return out;
  }

  function findStationCanvases(el: XmlElement): XmlElement[] {
    const out: XmlElement[] = [];
    if (el.name.toLowerCase() === "schematic" && attr(el, "classid")?.toLowerCase() === "stationcanvas") {
      out.push(el);
    }
    for (const c of el.children) {
      out.push(...findStationCanvases(c));
    }
    return out;
  }

  for (const sc of findStationCanvases(rootEl)) {
    excludedElements.add(sc);
  }

  const allDefinitions = findDefinitions(rootEl);
  for (const defEl of allDefinitions) {
    const defName = attr(defEl, "name");
    const classId = attr(defEl, "classid");
    const defType = attr(defEl, "type");

    if (classId === "StationDefn" || defName === "DS") {
      excludedElements.add(defEl);
      continue;
    }

    if (defName && classId === "UserCmpDefn") {
      const defPorts: PscxPort[] = [];
      const seenPortNames = new Set<string>();

      function findPorts(el: XmlElement) {
        if (el.name.toLowerCase() === "port") {
          const portX = parseFloat(attr(el, "x") || "0");
          const portY = parseFloat(attr(el, "y") || "0");

          let pName = "p";
          let pDim = 1;
          let pElectype: string | undefined;
          let pMode: string | undefined;

          function readPortParams(pel: XmlElement) {
            if (pel.name.toLowerCase() === "param") {
              const pname = attr(pel, "name")?.toLowerCase();
              const pval = attr(pel, "value") ?? pel.text.trim();
              if (pname === "name" && pval) pName = pval;
              else if (pname === "dim" && pval) pDim = parseInt(pval, 10);
              else if (pname === "electype") pElectype = pval;
              else if (pname === "mode") pMode = pval;
            }
            for (const pc of pel.children) readPortParams(pc);
          }
          readPortParams(el);

          if (!seenPortNames.has(pName)) {
            seenPortNames.add(pName);
            const kind: PortKind =
              pMode !== undefined
                ? pMode === "3"
                  ? "electrical"
                  : "signal"
                : pElectype === "0" || pElectype === "signal"
                  ? "signal"
                  : "electrical";

            defPorts.push({
              id: pName,
              name: pName,
              kind,
              dimension: isNaN(pDim) ? 1 : pDim,
              position: { x: portX, y: portY },
            });
          }
        }
        for (const c of el.children) findPorts(c);
      }
      findPorts(defEl);

      if (defPorts.length > 0) {
        definitionPorts.set(defName, defPorts);
      }
    }

    if (defName && (classId === "UserCmpDefn" || defType === "module")) {
      let svgXml: string | undefined;
      let graphicsXml: string | undefined;
      let desc: string | undefined;
      let scriptSegments: Map<string, PscadScriptSegment> | undefined;
      let flyBy: PscadFlyByDoc | undefined;
      let checks: PscadCheckRule[] | undefined;

      for (const c of defEl.children) {
        const cname = c.name.toLowerCase();
        if (cname === "svg") {
          svgXml = xmlContent.slice(c.start, c.end);
        } else if (cname === "graphics") {
          graphicsXml = xmlContent.slice(c.start, c.end);
        } else if (cname === "paramlist") {
          for (const p of c.children) {
            if (attr(p, "name")?.toLowerCase() === "description") {
              desc = attr(p, "value") ?? p.text.trim();
            }
          }
        } else if (cname === "script") {
          scriptSegments = parseScriptElement(c, xmlContent);
          const flyByText = scriptSegments.get("flyby")?.content;
          if (flyByText) {
            flyBy = parseFlyBySegment(flyByText);
          }
          const checksText = scriptSegments.get("checks")?.content;
          if (checksText) {
            checks = parseChecksSegment(checksText);
          }
        }
      }

      // If description was empty or unset, fall back to the first line of the FlyBy summary
      if ((!desc || !desc.trim()) && flyBy?.summary) {
        desc = flyBy.summary.split("\n")[0]?.trim();
      }

      projectDefinitions.set(defName, {
        name: defName,
        description: desc,
        svgXml,
        graphicsXml,
        scriptSegments,
        flyBy,
        checks,
      });
    }

    const hasSchematic = defEl.children.some((c) => c.name.toLowerCase() === "schematic");
    if (defName && defName !== "Main" && (classId === "UserCmpDefn" || defType === "module") && hasSchematic) {
      subModuleDefs.push({ name: defName, element: defEl });
      excludedElements.add(defEl);
    }
  }

  function parseModule(modId: string, modName: string, container: XmlElement, skipExcluded: boolean): PscxModule {
    const mod: PscxModule = {
      id: modId,
      name: modName,
      components: [],
      buses: [],
      wires: [],
    };

    let autoIdCounter = 1;
    let wireId = 1;
    let stickyId = 1;
    let lineId = 1;
    const stickies: PscxSticky[] = [];
    const lines: PscxLine[] = [];

    function walk(el: XmlElement) {
      if (skipExcluded && excludedElements.has(el)) return;

      const tag = el.name.toLowerCase();
      if (tag === "svg" || tag === "graphics" || tag === "form" || tag === "script") return;

      if (tag === "user" || tag === "component") {
        const defn = attr(el, "defn") || attr(el, "name") || attr(el, "type") || "Component";
        const idAttr = attrObj(el, "id");
        const id = idAttr?.value || String(autoIdCounter++);
        const cmpLocOffset = idAttr ? (idAttr.valueStart ?? idAttr.start) : el.start + 1;
        const cmpTokenLen = idAttr ? idAttr.value.length : el.name.length;
        const loc = offsetToLineCol(lineStarts, cmpLocOffset);
        const posX = parseFloat(attr(el, "x") || "0");
        const posY = parseFloat(attr(el, "y") || "0");
        const width = parseFloat(attr(el, "w") || "0");
        const height = parseFloat(attr(el, "h") || "0");
        const orientRaw = parseInt(attr(el, "orient") || "0", 10);
        const zRaw = parseInt(attr(el, "z") || "0", 10);
        const z = isNaN(zRaw) ? 0 : zRaw;
        const mirrorAttr = attr(el, "mirror");
        const mirror = mirrorAttr === "true" || mirrorAttr === "1" || (orientRaw >= 4 && orientRaw <= 7);
        const disableAttr = attr(el, "disable");
        const disabled = disableAttr === "true" || disableAttr === "1";

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

        function collectCmpChildren(c: XmlElement) {
          const cTag = c.name.toLowerCase();
          if (cTag === "param") {
            const pNameAttr = attrObj(c, "name");
            const pName = pNameAttr?.value;
            const pVal = attr(c, "value") ?? c.text.trim();
            if (pName && pVal !== undefined) {
              params[pName] = parseParamValue(pVal);
              const nameOffsetInParam = pNameAttr ? (pNameAttr.valueStart ?? pNameAttr.start) : c.start + 1;
              paramLocations[pName] = offsetToLineCol(lineStarts, nameOffsetInParam);
            }
          } else if (cTag === "port") {
            const portName = attr(c, "name") || "p";
            const posVal = attr(c, "pos");
            const kindVal = (attr(c, "kind") as PortKind) || "electrical";
            const dimVal = parseInt(attr(c, "dim") || "3", 10);
            ports.push({
              id: `${id}_${portName}`,
              name: portName,
              kind: kindVal,
              dimension: isNaN(dimVal) ? 3 : dimVal,
              position: parsePoint(posVal),
            });
          } else {
            for (const child of c.children) collectCmpChildren(child);
          }
        }
        for (const child of el.children) collectCmpChildren(child);

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
            const masterPorts =
              MASTER_LIBRARY_PORTS[cleanDefn.toLowerCase()] ?? EXTRA_MASTER_PORT_LAYOUTS[cleanDefn.toLowerCase()];
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

        const nameAttr = attr(el, "name");
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
          disabled: disabled || undefined,
          z,
          parameters: params,
          paramLocations,
          ports,
          line: loc.line,
          column: loc.column,
          endColumn: loc.column + Math.max(1, cmpTokenLen),
          sourceRange: { startOffset: el.start, endOffset: el.end },
        });
        return;
      }

      if (tag === "bus") {
        const busNameAttr = attrObj(el, "name");
        const busIdAttr = attrObj(el, "id");
        const busName = busNameAttr?.value || `Bus_${autoIdCounter++}`;
        const busId = busIdAttr?.value || busName;
        const busLocOffset = busNameAttr
          ? (busNameAttr.valueStart ?? busNameAttr.start)
          : busIdAttr
            ? (busIdAttr.valueStart ?? busIdAttr.start)
            : el.start + 1;
        const busTokenLen = busNameAttr
          ? busNameAttr.value.length
          : busIdAttr
            ? busIdAttr.value.length
            : el.name.length;
        const loc = offsetToLineCol(lineStarts, busLocOffset);
        const posX = parseFloat(attr(el, "x") || "0");
        const posY = parseFloat(attr(el, "y") || "0");
        const vbase = parseFloat(attr(el, "vbase") || attr(el, "v_base") || "0");
        const length = parseFloat(attr(el, "length") || "50");

        mod.buses.push({
          id: busId,
          name: busName,
          voltageBaseKv: vbase > 0 ? vbase : undefined,
          position: { x: posX, y: posY },
          length,
          phaseCount: 3,
          line: loc.line,
          column: loc.column,
          endColumn: loc.column + Math.max(1, busTokenLen),
          sourceRange: { startOffset: el.start, endOffset: el.end },
        });
        return;
      }

      if (tag === "wire") {
        const classId = attr(el, "classid") || "";
        if (classId.toLowerCase() === "branch") {
          for (const c of el.children) walk(c);
          return;
        }

        const wireX = parseFloat(attr(el, "x") || "0");
        const wireY = parseFloat(attr(el, "y") || "0");
        const vertices: Point2D[] = [];

        function collectVertices(wel: XmlElement) {
          if (wel.name.toLowerCase() === "vertex") {
            const vx = parseFloat(attr(wel, "x") || "0") + wireX;
            const vy = parseFloat(attr(wel, "y") || "0") + wireY;
            vertices.push({ x: vx, y: vy });
          }
          for (const c of wel.children) collectVertices(c);
        }
        collectVertices(el);

        if (vertices.length === 0) {
          const x1Attr = attr(el, "x1") ?? attr(el, "x");
          const y1Attr = attr(el, "y1") ?? attr(el, "y");
          const x2Attr = attr(el, "x2");
          const y2Attr = attr(el, "y2");
          const wAttr = attr(el, "w");
          const hAttr = attr(el, "h");
          if (x2Attr !== undefined || y2Attr !== undefined) {
            const x1 = parseFloat(x1Attr || "0");
            const y1 = parseFloat(y1Attr || "0");
            const x2 = parseFloat(x2Attr ?? x1Attr ?? "0");
            const y2 = parseFloat(y2Attr ?? y1Attr ?? "0");
            vertices.push({ x: isNaN(x1) ? 0 : x1, y: isNaN(y1) ? 0 : y1 });
            vertices.push({ x: isNaN(x2) ? 0 : x2, y: isNaN(y2) ? 0 : y2 });
          } else if (wAttr !== undefined || hAttr !== undefined) {
            const dw = parseFloat(wAttr || "0");
            const dh = parseFloat(hAttr || "0");
            if ((dw !== 0 && !isNaN(dw)) || (dh !== 0 && !isNaN(dh))) {
              vertices.push({ x: wireX, y: wireY });
              vertices.push({ x: wireX + (isNaN(dw) ? 0 : dw), y: wireY + (isNaN(dh) ? 0 : dh) });
            }
          }
        }

        if (classId.toLowerCase() === "bus") {
          let innerName: string | undefined;
          let innerNameOffset: number | undefined;
          let innerNameLen: number | undefined;
          let vbaseStr = "0";

          function findWireBusParams(wel: XmlElement) {
            if (wel.name.toLowerCase() === "param") {
              const pname = attr(wel, "name");
              const pvalAttr = attrObj(wel, "value");
              const pval = pvalAttr?.value ?? wel.text.trim();
              if (pname && pname.toLowerCase() === "name") {
                innerName = pval;
                innerNameOffset = pvalAttr ? (pvalAttr.valueStart ?? pvalAttr.start) : wel.start + 1;
                innerNameLen = pval.length;
              } else if (pname && ["basekv", "vbase"].includes(pname.toLowerCase())) {
                vbaseStr = pval;
              }
            }
            for (const c of wel.children) findWireBusParams(c);
          }
          findWireBusParams(el);

          const attrNameAttr = attrObj(el, "name");
          const attrIdAttr = attrObj(el, "id");
          const busName = innerName || attrNameAttr?.value || `Bus_${autoIdCounter++}`;
          const busId = attrIdAttr?.value || busName;
          const busLocOffset =
            innerNameOffset ??
            (attrNameAttr ? (attrNameAttr.valueStart ?? attrNameAttr.start) : undefined) ??
            (attrIdAttr ? (attrIdAttr.valueStart ?? attrIdAttr.start) : undefined) ??
            el.start + 1;
          const busTokenLen = innerNameLen ?? attrNameAttr?.value.length ?? attrIdAttr?.value.length ?? el.name.length;
          const loc = offsetToLineCol(lineStarts, busLocOffset);
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
            endColumn: loc.column + Math.max(1, busTokenLen),
            sourceRange: { startOffset: el.start, endOffset: el.end },
          });
          return;
        }

        if (vertices.length >= 2) {
          const attrWireId = attr(el, "id");
          const wLoc = offsetToLineCol(lineStarts, el.start);
          mod.wires.push({
            id: attrWireId || `wire_${wireId++}`,
            vertices,
            connectedPortIds: [],
            line: wLoc.line,
            sourceRange: { startOffset: el.start, endOffset: el.end },
          });
        }
        return;
      }

      if (tag === "sticky") {
        const sx = parseFloat(attr(el, "x") || "0");
        const sy = parseFloat(attr(el, "y") || "0");
        const sw = parseFloat(attr(el, "w") || "200");
        const sh = parseFloat(attr(el, "h") || "100");
        const sid = attr(el, "id") || `sticky_${stickyId++}`;

        let text = "";
        if (el.cdata.length > 0) {
          text = el.cdata[0]!.text.trim();
        } else {
          let prev: string;
          let stripped = el.text;
          do {
            prev = stripped;
            stripped = stripped.replace(/<[^><]+>/g, "");
          } while (stripped !== prev);
          text = stripped.trim();
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
        return;
      }

      if (tag === "line") {
        const classId = attr(el, "classid") || "";
        if (classId.toLowerCase() !== "divider") return;
        const lx = parseFloat(attr(el, "x") || "0");
        const ly = parseFloat(attr(el, "y") || "0");
        const lw = parseFloat(attr(el, "w") || "0");
        const lh = parseFloat(attr(el, "h") || "0");
        const lid = attr(el, "id") || `line_${lineId++}`;
        lines.push({
          id: lid,
          classId,
          x1: lx,
          y1: ly,
          x2: lx + lw,
          y2: ly + lh,
          sourceRange: { startOffset: el.start, endOffset: el.end },
        });
        return;
      }

      for (const c of el.children) walk(c);
    }

    walk(container);

    if (stickies.length > 0) {
      mod.stickies = stickies;
    }
    if (lines.length > 0) {
      mod.lines = lines;
    }

    const modelDef = modelDefs?.get(modName);
    refineModulePorts(mod, modelDef);
    if (modelDef) {
      const form = readDefinitionForm(modelDef);
      if (form) {
        const defaults: Record<string, string> = {};
        for (const cat of form.categories) for (const p of cat.parameters) defaults[p.name] = p.defaultValue;
        mod.parameterDefaults = defaults;
      }
    }
    snapWireConnections(mod);
    return mod;
  }

  const rootModule = parseModule("Main", "Main", rootEl, true);
  const subModules = new Map<string, PscxModule>();
  for (const sub of subModuleDefs) {
    subModules.set(sub.name, parseModule(sub.name, sub.name, sub.element, false));
  }

  return {
    name: projectName,
    version,
    projectType,
    settings,
    rootModule,
    subModules,
    linkedLibraries,
    definitions: projectDefinitions,
  };
}

/**
 * Parses a PSCAD `.pscx` / `.pslx` / `.pswx` XML string into a structured `PscxProject`
 * using the lossless XML CST parser from `@modelscript/dsl/xml`.
 */
export function parsePscx(xmlContent: string, options?: { external?: ExternalDefinitions }): PscxProject {
  return parsePscxCst(xmlContent, options);
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
        // Bundle taps (datatap) sit up to one 18-unit grid step off the end of their wire.
        const segTol = p.id.endsWith("_tap") ? 19 : SNAP_TOLERANCE;
        for (let k = 0; k < wire.vertices.length - 1; k++) {
          if (pointToSegmentDistance(p.world, wire.vertices[k]!, wire.vertices[k + 1]!) <= segTol) {
            connectedSet.add(p.id);
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

  // A ground voltmeter dropped on top of a wire (terminal unconnected, origin on the wire) taps that wire.
  for (const cmp of mod.components) {
    if (!cmp.definitionName.toLowerCase().endsWith(":voltmetergnd")) continue;
    const port = cmp.ports.find((p) => p.kind === "electrical");
    if (!port || mod.wires.some((w) => w.connectedPortIds.includes(port.id))) continue;
    for (const w of mod.wires) {
      let onWire = false;
      for (let k = 0; k < w.vertices.length - 1 && !onWire; k++) {
        onWire = pointToSegmentDistance(cmp.position, w.vertices[k]!, w.vertices[k + 1]!) <= 2;
      }
      if (onWire) {
        w.connectedPortIds = [...w.connectedPortIds, port.id];
        break;
      }
    }
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

    const getOrCreateJunctionId = (pt: Point2D) => {
      addJunction(pt);
      return `junc_${Math.round(pt.x)}_${Math.round(pt.y)}`;
    };

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
            const jId = getOrCreateJunctionId(aStart);
            if (!wA.startPortId) wA.startPortId = jId;
            break;
          }
          if (pointToSegmentDistance(aEnd, segStart, segEnd) <= SNAP_TOLERANCE) {
            touches = true;
            const jId = getOrCreateJunctionId(aEnd);
            if (!wA.endPortId) wA.endPortId = jId;
            break;
          }
        }
        if (!touches) {
          for (let k = 0; k < wA.vertices.length - 1; k++) {
            const segStart = wA.vertices[k]!;
            const segEnd = wA.vertices[k + 1]!;
            if (pointToSegmentDistance(bStart, segStart, segEnd) <= SNAP_TOLERANCE) {
              touches = true;
              const jId = getOrCreateJunctionId(bStart);
              if (!wB.startPortId) wB.startPortId = jId;
              break;
            }
            if (pointToSegmentDistance(bEnd, segStart, segEnd) <= SNAP_TOLERANCE) {
              touches = true;
              const jId = getOrCreateJunctionId(bEnd);
              if (!wB.endPortId) wB.endPortId = jId;
              break;
            }
          }
        }
        if (distance(aStart, bStart) <= SNAP_TOLERANCE) {
          touches = true;
          const jId = getOrCreateJunctionId(aStart);
          if (!wA.startPortId) wA.startPortId = jId;
          if (!wB.startPortId) wB.startPortId = jId;
        }
        if (distance(aStart, bEnd) <= SNAP_TOLERANCE) {
          touches = true;
          const jId = getOrCreateJunctionId(aStart);
          if (!wA.startPortId) wA.startPortId = jId;
          if (!wB.endPortId) wB.endPortId = jId;
        }
        if (distance(aEnd, bStart) <= SNAP_TOLERANCE) {
          touches = true;
          const jId = getOrCreateJunctionId(aEnd);
          if (!wA.endPortId) wA.endPortId = jId;
          if (!wB.startPortId) wB.startPortId = jId;
        }
        if (distance(aEnd, bEnd) <= SNAP_TOLERANCE) {
          touches = true;
          const jId = getOrCreateJunctionId(aEnd);
          if (!wA.endPortId) wA.endPortId = jId;
          if (!wB.endPortId) wB.endPortId = jId;
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

/**
 * Resolves flat solver variable names to hierarchical PSCAD-style paths.
 * Example: 'i_CB1_a' -> 'Main:CB1:i'
 *
 * @param flatName The flat variable name produced by the solver (e.g., 'i_CB1_a', 'v_Bus1_a', 'i_Branch1')
 * @param project Optional parsed PSCAD project for component/bus identity resolution
 * @param defaultModule Default root module name (defaults to "Main")
 */
export function resolvePscadHierarchicalPath(
  flatName: string,
  project?: PscxProject,
  defaultModule: string = "Main",
): string {
  if (!flatName) return "";

  // 1. Identify signal prefix kind (v: voltage, i: current, etc.)
  const match = /^(v|i|sig)_([a-zA-Z0-9_]+?)(?:_([abcABC]))?$/.exec(flatName);
  if (!match) {
    // If not matching typical v_... or i_..., format with default module if not already prefixed
    return flatName.includes(":") ? flatName : `${defaultModule}:${flatName}`;
  }

  const [, kind, rawEntity, phase] = match;
  let moduleName = defaultModule;
  let entityName = rawEntity!;

  // 2. Check if rawEntity contains a qualified module prefix (e.g., SubMod_Cmp)
  if (project) {
    const rootMod = project.rootModule;
    const findComponentOrBus = (mod: PscxModule, idOrName: string) => {
      return (
        mod.components.find((c) => c.id === idOrName || c.instanceName === idOrName) ||
        mod.buses.find((b) => b.id === idOrName || b.name === idOrName)
      );
    };

    // Check if directly in root module
    const rootEntity = findComponentOrBus(rootMod, rawEntity!);
    if (rootEntity) {
      moduleName = rootMod.name || defaultModule;
      entityName = rootEntity.id;
    } else {
      // Check submodules
      for (const [subName, subMod] of project.subModules) {
        if (rawEntity!.startsWith(`${subName}_`)) {
          const subEntityId = rawEntity!.slice(subName.length + 1);
          const found = findComponentOrBus(subMod, subEntityId);
          if (found) {
            moduleName = `${defaultModule}:${subName}`;
            entityName = found.id;
            break;
          }
        }
      }
    }
  }

  const signalQuantity = kind!.toLowerCase();
  const phaseSuffix = phase && phase.toLowerCase() !== "a" ? `:${phase.toLowerCase()}` : "";
  // If user requested 'i_CB1_a' -> 'Main:CB1:i' exactly without phase or matching phase:
  const result = phase
    ? `${moduleName}:${entityName}:${signalQuantity}${phaseSuffix}`
    : `${moduleName}:${entityName}:${signalQuantity}`;
  return result;
}

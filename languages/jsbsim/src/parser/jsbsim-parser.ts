// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/jsbsim — Zero-Regex JSBSim 2.0 XML Aircraft Model Parser and Serializer.
 *
 * Uses @modelscript/dsl/xml to parse JSBSim aircraft configuration:
 * metrics, mass balance, inertia tensor, landing gear, propulsion, flight controls, and aerodynamics.
 */

import { parseXml, type XmlElement } from "@modelscript/dsl/xml";
import type {
  JsbsimAeroCoeff,
  JsbsimAeroExpr,
  JsbsimAeroTable,
  JsbsimDocument,
  JsbsimEngine,
  JsbsimFcsChannel,
  JsbsimInertia,
  JsbsimLandingGear,
  JsbsimLocation,
  JsbsimMetrics,
  JsbsimModel,
  JsbsimRange,
} from "../types.js";

function getAttr(elem: XmlElement, name: string): string | undefined {
  const a = elem.attributes.find((attr) => attr.name.toLowerCase() === name.toLowerCase());
  return a?.value;
}

function findChild(elem: XmlElement, name: string): XmlElement | undefined {
  return elem.children.find((c) => c.name.toLowerCase() === name.toLowerCase());
}

function findChildren(elem: XmlElement, name: string): XmlElement[] {
  return elem.children.filter((c) => c.name.toLowerCase() === name.toLowerCase());
}

function getChildText(elem: XmlElement, childName: string): string | undefined {
  const c = findChild(elem, childName);
  return c?.text?.trim();
}

function getChildNum(elem: XmlElement, childName: string, defaultValue = 0): number {
  const text = getChildText(elem, childName);
  if (!text) return defaultValue;
  const num = parseFloat(text);
  return isNaN(num) ? defaultValue : num;
}

function parseLocation(elem?: XmlElement): JsbsimLocation {
  if (!elem) return { x: 0, y: 0, z: 0 };
  const locElem = elem.name.toLowerCase() === "location" ? elem : findChild(elem, "location");
  if (!locElem) return { x: 0, y: 0, z: 0 };

  return {
    x: getChildNum(locElem, "x", 0),
    y: getChildNum(locElem, "y", 0),
    z: getChildNum(locElem, "z", 0),
  };
}

function computeRange(source: string, elem: XmlElement): JsbsimRange {
  let line = 1;
  let col = 1;
  let startLine = 1;
  let startCol = 1;
  let endLine = 1;
  let endCol = 1;

  const start = elem.start;
  const end = elem.end;

  for (let i = 0; i < source.length; i++) {
    if (i === start) {
      startLine = line;
      startCol = col;
    }
    if (i === end) {
      endLine = line;
      endCol = col;
      break;
    }
    if (source[i] === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
  }

  return {
    startLine,
    startColumn: startCol,
    endLine: endLine >= startLine ? endLine : startLine,
    endColumn: endCol,
    startOffset: start,
    endOffset: end,
  };
}

export function parseJsbsim(source: string, filename?: string): JsbsimDocument {
  const doc = parseXml(source);
  const root = doc.root;

  if (!root || root.name.toLowerCase() !== "fdm_config") {
    throw new Error("Invalid JSBSim XML: root element must be <fdm_config>");
  }

  const name = getAttr(root, "name") ?? "";
  const version = getAttr(root, "version") ?? "2.0";
  const modelRange = computeRange(source, root);

  // Fileheader
  const fileHeaderElem = findChild(root, "fileheader");
  let fileHeader: string | undefined;
  if (fileHeaderElem) {
    const desc = getChildText(fileHeaderElem, "description");
    const author = getChildText(fileHeaderElem, "author");
    fileHeader = [author, desc].filter(Boolean).join(" - ");
  }

  // Metrics
  const metricsElem = findChild(root, "metrics");
  const metrics: JsbsimMetrics = {
    wingArea: metricsElem ? getChildNum(metricsElem, "wingarea", 174.0) : 174.0,
    wingspan: metricsElem ? getChildNum(metricsElem, "wingspan", 36.0) : 36.0,
    chord: metricsElem ? getChildNum(metricsElem, "chord", 4.9) : 4.9,
    htailArea: metricsElem ? getChildNum(metricsElem, "htailarea", 22.0) : undefined,
    htailArm: metricsElem ? getChildNum(metricsElem, "htailarm", 15.0) : undefined,
    vtailArea: metricsElem ? getChildNum(metricsElem, "vtailarea", 16.0) : undefined,
    vtailArm: metricsElem ? getChildNum(metricsElem, "vtailarm", 15.0) : undefined,
    aeroCenter: parseLocation(metricsElem),
    range: metricsElem ? computeRange(source, metricsElem) : undefined,
  };

  // Mass Balance & Inertia
  const massElem = findChild(root, "mass_balance");
  const massBalance: JsbsimInertia = {
    emptyWeight: massElem ? getChildNum(massElem, "emptywt", 1500.0) : 1500.0,
    cgLocation: parseLocation(massElem),
    ixx: massElem ? getChildNum(massElem, "ixx", 1000.0) : 1000.0,
    iyy: massElem ? getChildNum(massElem, "iyy", 1500.0) : 1500.0,
    izz: massElem ? getChildNum(massElem, "izz", 2000.0) : 2000.0,
    ixz: massElem ? getChildNum(massElem, "ixz", 0.0) : 0.0,
    range: massElem ? computeRange(source, massElem) : undefined,
  };

  // Ground Reactions (Landing Gear)
  const groundElem = findChild(root, "ground_reactions");
  const groundReactions: JsbsimLandingGear[] = [];
  if (groundElem) {
    for (const cElem of findChildren(groundElem, "contact")) {
      const gName = getAttr(cElem, "name") ?? "GEAR";
      const rawGType = getAttr(cElem, "type")?.toUpperCase();
      const gType: JsbsimLandingGear["type"] =
        rawGType === "STRUCTURE" || rawGType === "NOSE" || rawGType === "TAIL" ? rawGType : "BOGEY";
      const steerable = getChildText(cElem, "steerable") === "1" || getChildText(cElem, "steerable") === "true";
      const rawBg = getChildText(cElem, "brake_group")?.toUpperCase();
      const bg: JsbsimLandingGear["brakeGroup"] =
        rawBg === "NONE" || rawBg === "LEFT" || rawBg === "RIGHT" || rawBg === "NOSE" ? rawBg : undefined;

      groundReactions.push({
        name: gName,
        type: gType,
        location: parseLocation(cElem),
        springCoeff: getChildNum(cElem, "spring_coeff", 2000.0),
        dampingCoeff: getChildNum(cElem, "damping_coeff", 500.0),
        staticFriction: getChildNum(cElem, "static_friction", 0.8),
        dynamicFriction: getChildNum(cElem, "dynamic_friction", 0.5),
        steerable,
        brakeGroup: bg,
        range: computeRange(source, cElem),
      });
    }
  }

  // Propulsion (Engines)
  const propElem = findChild(root, "propulsion");
  const engines: JsbsimEngine[] = [];
  if (propElem) {
    for (const eElem of findChildren(propElem, "engine")) {
      const eName = getAttr(eElem, "file") ?? getAttr(eElem, "name") ?? "Engine";
      engines.push({
        name: eName,
        type: "PISTON",
        location: parseLocation(eElem),
        maxThrust: getChildNum(eElem, "max_thrust", 160.0 * 2.5), // approx lbs thrust
        range: computeRange(source, eElem),
      });
    }
  }

  // Flight Control System (FCS Channels)
  const fcsElem = findChild(root, "flight_control") ?? findChild(root, "autopilot");
  const fcsChannels: JsbsimFcsChannel[] = [];
  if (fcsElem) {
    for (const chElem of findChildren(fcsElem, "channel")) {
      const chName = getAttr(chElem, "name") ?? "Channel";
      const inputs: string[] = [];

      for (const comp of chElem.children) {
        for (const inElem of findChildren(comp, "input")) {
          if (inElem.text) inputs.push(inElem.text.trim());
        }
      }

      fcsChannels.push({
        name: chName,
        type: chName.toUpperCase(),
        inputs,
        output: `fcs/${chName.toLowerCase()}-pos-rad`,
        range: computeRange(source, chElem),
      });
    }
  }

  function splitNumbers(line: string): number[] {
    const out: number[] = [];
    let cur = "";
    for (let i = 0; i < line.length; i++) {
      const ch = line.charCodeAt(i);
      if (ch === 32 || ch === 9 || ch === 13 || ch === 44) {
        if (cur.length > 0) {
          const val = Number.parseFloat(cur);
          if (!Number.isNaN(val)) out.push(val);
          cur = "";
        }
      } else {
        cur += line[i];
      }
    }
    if (cur.length > 0) {
      const val = Number.parseFloat(cur);
      if (!Number.isNaN(val)) out.push(val);
    }
    return out;
  }

  function parseTableElement(tblElem: XmlElement): JsbsimAeroTable {
    const independentVars: JsbsimAeroTable["independentVars"] = [];
    for (const iv of findChildren(tblElem, "independentVar")) {
      const prop = iv.text?.trim() ?? "";
      const rawLookup = getAttr(iv, "lookup")?.toLowerCase();
      const lookup: "row" | "column" | "table" | undefined =
        rawLookup === "row" || rawLookup === "column" || rawLookup === "table" ? rawLookup : undefined;
      if (prop) independentVars.push({ lookup, property: prop });
    }

    const tdElem = findChild(tblElem, "tableData") ?? tblElem;
    const rawText = tdElem.text ?? "";
    const rawLines = rawText.split("\n");
    const numericRows: number[][] = [];
    for (const rawLine of rawLines) {
      const trimmed = rawLine.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
      const nums = splitNumbers(trimmed);
      if (nums.length > 0) numericRows.push(nums);
    }

    const is2D =
      independentVars.length >= 2 ||
      independentVars.some((v) => v.lookup === "column") ||
      (numericRows.length >= 2 && (numericRows[0]?.length ?? 0) >= 2 && (numericRows[1]?.length ?? 0) >= 3);

    if (is2D && numericRows.length >= 2) {
      const header = numericRows[0]!;
      const dataFirstLen = numericRows[1]!.length;
      const breakpointsCol = header.length === dataFirstLen ? header.slice(1) : header;
      const breakpointsRow: number[] = [];
      const values: number[][] = [];
      for (let r = 1; r < numericRows.length; r++) {
        const row = numericRows[r]!;
        if (row.length >= 2) {
          breakpointsRow.push(row[0]!);
          values.push(row.slice(1));
        }
      }
      return {
        independentVars,
        breakpointsRow,
        breakpointsCol,
        values,
      };
    }

    // 1D table: each line is [x, y]
    const breakpointsRow: number[] = [];
    const rowVals: number[] = [];
    for (const row of numericRows) {
      if (row.length >= 2) {
        breakpointsRow.push(row[0]!);
        rowVals.push(row[1]!);
      } else if (row.length === 1) {
        breakpointsRow.push(breakpointsRow.length);
        rowVals.push(row[0]!);
      }
    }
    return {
      independentVars,
      breakpointsRow,
      values: [rowVals],
    };
  }

  function parseAeroExprNode(elem: XmlElement): JsbsimAeroExpr | undefined {
    const tag = elem.name.toLowerCase();
    if (tag === "value" || tag === "v") {
      const val = Number.parseFloat(elem.text?.trim() ?? "0");
      return { kind: "value", value: Number.isNaN(val) ? 0 : val };
    }
    if (tag === "property" || tag === "p") {
      return { kind: "property", property: elem.text?.trim() ?? "" };
    }
    if (tag === "table" || tag === "tabledata") {
      return { kind: "table", table: parseTableElement(elem) };
    }
    if (tag === "product" || tag === "sum" || tag === "difference" || tag === "quotient" || tag === "pow") {
      const children: JsbsimAeroExpr[] = [];
      for (const child of elem.children) {
        const parsed = parseAeroExprNode(child);
        if (parsed) children.push(parsed);
      }
      return { kind: tag, children };
    }
    return undefined;
  }

  function collectExprMetadata(
    expr: JsbsimAeroExpr | undefined,
    terms: { property: string; factor: number }[],
  ): { firstValue: number | undefined; firstTable: JsbsimAeroTable | undefined } {
    if (!expr) return { firstValue: undefined, firstTable: undefined };
    if (expr.kind === "value") return { firstValue: expr.value, firstTable: undefined };
    if (expr.kind === "property") {
      if (expr.property) terms.push({ property: expr.property, factor: 1.0 });
      return { firstValue: undefined, firstTable: undefined };
    }
    if (expr.kind === "table") {
      for (const iv of expr.table.independentVars) {
        if (iv.property) terms.push({ property: iv.property, factor: 1.0 });
      }
      return { firstValue: undefined, firstTable: expr.table };
    }
    let firstValue: number | undefined;
    let firstTable: JsbsimAeroTable | undefined;
    for (const child of expr.children) {
      const sub = collectExprMetadata(child, terms);
      if (firstValue === undefined && sub.firstValue !== undefined) firstValue = sub.firstValue;
      if (firstTable === undefined && sub.firstTable !== undefined) firstTable = sub.firstTable;
    }
    return { firstValue, firstTable };
  }

  // Aerodynamics
  const aeroElem = findChild(root, "aerodynamics");
  const aeroCoefficients: JsbsimAeroCoeff[] = [];
  if (aeroElem) {
    for (const axisElem of findChildren(aeroElem, "axis")) {
      const rawAxis = getAttr(axisElem, "name")?.toUpperCase();
      const axisName: JsbsimAeroCoeff["axis"] =
        rawAxis === "DRAG" || rawAxis === "SIDE" || rawAxis === "ROLL" || rawAxis === "PITCH" || rawAxis === "YAW"
          ? rawAxis
          : "LIFT";
      for (const fnElem of findChildren(axisElem, "function")) {
        const fnName = getAttr(fnElem, "name") ?? "coeff";
        const terms: { property: string; factor: number }[] = [];

        let rootExpr: JsbsimAeroExpr | undefined;
        for (const child of fnElem.children) {
          const parsed = parseAeroExprNode(child);
          if (parsed) {
            rootExpr = parsed;
            break;
          }
        }

        const { firstValue, firstTable } = collectExprMetadata(rootExpr, terms);
        const baseVal = firstValue ?? 0.0;

        aeroCoefficients.push({
          name: fnName,
          axis: axisName,
          baseValue: baseVal,
          terms,
          ...(rootExpr ? { expr: rootExpr } : {}),
          ...(firstTable ? { table: firstTable } : {}),
          range: computeRange(source, fnElem),
        });
      }
    }
  }

  const model: JsbsimModel = {
    name,
    version,
    fileHeader,
    metrics,
    massBalance,
    groundReactions,
    engines,
    fcsChannels,
    aeroCoefficients,
    range: modelRange,
  };

  return {
    model,
    sourceFile: filename,
  };
}

export function serializeJsbsim(doc: JsbsimDocument): string {
  const m = doc.model;
  const lines: string[] = [];

  lines.push(`<?xml version="1.0"?>`);
  lines.push(`<fdm_config name="${m.name}" version="${m.version}" release="BETA">`);

  if (m.fileHeader) {
    lines.push(`  <fileheader>`);
    lines.push(`    <description>${m.fileHeader}</description>`);
    lines.push(`  </fileheader>`);
  }

  // Metrics
  lines.push(`  <metrics>`);
  lines.push(`    <wingarea unit="FT2"> ${m.metrics.wingArea} </wingarea>`);
  lines.push(`    <wingspan unit="FT"> ${m.metrics.wingspan} </wingspan>`);
  lines.push(`    <chord unit="FT"> ${m.metrics.chord} </chord>`);
  if (m.metrics.htailArea) lines.push(`    <htailarea unit="FT2"> ${m.metrics.htailArea} </htailarea>`);
  if (m.metrics.htailArm) lines.push(`    <htailarm unit="FT"> ${m.metrics.htailArm} </htailarm>`);
  if (m.metrics.vtailArea) lines.push(`    <vtailarea unit="FT2"> ${m.metrics.vtailArea} </vtailarea>`);
  if (m.metrics.vtailArm) lines.push(`    <vtailarm unit="FT"> ${m.metrics.vtailArm} </vtailarm>`);
  lines.push(`    <location name="AERORP" unit="IN">`);
  lines.push(`      <x> ${m.metrics.aeroCenter.x} </x>`);
  lines.push(`      <y> ${m.metrics.aeroCenter.y} </y>`);
  lines.push(`      <z> ${m.metrics.aeroCenter.z} </z>`);
  lines.push(`    </location>`);
  lines.push(`  </metrics>`);

  // Mass Balance
  lines.push(`  <mass_balance>`);
  lines.push(`    <emptywt unit="LBS"> ${m.massBalance.emptyWeight} </emptywt>`);
  lines.push(`    <location name="CG" unit="IN">`);
  lines.push(`      <x> ${m.massBalance.cgLocation.x} </x>`);
  lines.push(`      <y> ${m.massBalance.cgLocation.y} </y>`);
  lines.push(`      <z> ${m.massBalance.cgLocation.z} </z>`);
  lines.push(`    </location>`);
  lines.push(`    <ixx unit="SLUG*FT2"> ${m.massBalance.ixx} </ixx>`);
  lines.push(`    <iyy unit="SLUG*FT2"> ${m.massBalance.iyy} </iyy>`);
  lines.push(`    <izz unit="SLUG*FT2"> ${m.massBalance.izz} </izz>`);
  lines.push(`    <ixz unit="SLUG*FT2"> ${m.massBalance.ixz} </ixz>`);
  lines.push(`  </mass_balance>`);

  // Ground Reactions
  if (m.groundReactions.length > 0) {
    lines.push(`  <ground_reactions>`);
    for (const g of m.groundReactions) {
      lines.push(`    <contact type="${g.type}" name="${g.name}">`);
      lines.push(
        `      <location unit="IN"> <x> ${g.location.x} </x> <y> ${g.location.y} </y> <z> ${g.location.z} </z> </location>`,
      );
      lines.push(`      <static_friction> ${g.staticFriction} </static_friction>`);
      lines.push(`      <dynamic_friction> ${g.dynamicFriction} </dynamic_friction>`);
      lines.push(`      <spring_coeff unit="LBS/FT"> ${g.springCoeff} </spring_coeff>`);
      lines.push(`      <damping_coeff unit="LBS/FT/SEC"> ${g.dampingCoeff} </damping_coeff>`);
      if (g.steerable) lines.push(`      <steerable> 1 </steerable>`);
      if (g.brakeGroup) lines.push(`      <brake_group> ${g.brakeGroup} </brake_group>`);
      lines.push(`    </contact>`);
    }
    lines.push(`  </ground_reactions>`);
  }

  // Propulsion
  if (m.engines.length > 0) {
    lines.push(`  <propulsion>`);
    for (const e of m.engines) {
      lines.push(`    <engine file="${e.name}">`);
      lines.push(
        `      <location unit="IN"> <x> ${e.location.x} </x> <y> ${e.location.y} </y> <z> ${e.location.z} </z> </location>`,
      );
      lines.push(`    </engine>`);
    }
    lines.push(`  </propulsion>`);
  }

  // Flight Control
  if (m.fcsChannels.length > 0) {
    lines.push(`  <flight_control name="FCS">`);
    for (const ch of m.fcsChannels) {
      lines.push(`    <channel name="${ch.name}">`);
      lines.push(`      <summer name="${ch.name} Summer">`);
      for (const inProp of ch.inputs) {
        lines.push(`        <input> ${inProp} </input>`);
      }
      lines.push(`      </summer>`);
      lines.push(`    </channel>`);
    }
    lines.push(`  </flight_control>`);
  }

  // Aerodynamics
  if (m.aeroCoefficients.length > 0) {
    lines.push(`  <aerodynamics>`);
    const axes = ["LIFT", "DRAG", "SIDE", "ROLL", "PITCH", "YAW"] as const;
    for (const axis of axes) {
      const coeffs = m.aeroCoefficients.filter((c) => c.axis === axis);
      if (coeffs.length > 0) {
        lines.push(`    <axis name="${axis}">`);
        for (const c of coeffs) {
          lines.push(`      <function name="${c.name}">`);
          lines.push(`        <product>`);
          lines.push(`          <property>aero/qbar-psf</property>`);
          lines.push(`          <property>metrics/Sw-sqft</property>`);
          lines.push(`          <value> ${c.baseValue} </value>`);
          lines.push(`        </product>`);
          lines.push(`      </function>`);
        }
        lines.push(`    </axis>`);
      }
    }
    lines.push(`  </aerodynamics>`);
  }

  lines.push(`</fdm_config>`);
  return lines.join("\n");
}

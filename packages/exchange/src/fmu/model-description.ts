// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FMU modelDescription.xml parser.
 *
 * Parses the FMI 2.0 modelDescription.xml from an uploaded FMU archive
 * to extract metadata, scalar variables, and experiment annotations.
 * This is the reverse of fmi.ts in @modelscript/core (which generates XML).
 *
 * We use a simple SAX-like approach with regex-based XML element extraction
 * since we only need a subset of the FMI schema and don't want a full XML
 * parser dependency.
 */

import type { FmiCausality, FmiScalarVariable, FmiVariability } from "./fmi.js";
export type { FmiCausality, FmiScalarVariable, FmiVariability };

/** Default experiment from modelDescription.xml. */
export interface FmiDefaultExperiment {
  startTime: number | undefined;
  stopTime: number | undefined;
  tolerance: number | undefined;
  stepSize: number | undefined;
}

/** FMI ModelStructure output dependency descriptor. */
export interface FmiModelStructureOutputDependency {
  outputIndexOrVr: number;
  dependencies?: number[] | undefined;
  dependenciesKind?: string[] | undefined;
}

/** Parsed FMU model description. */
export interface FmiModelDescription {
  /** FMI version string (e.g. "2.0" or "3.0"). */
  fmiVersion: string;
  /** Model name. */
  modelName: string;
  /** Globally unique identifier (or instantiationToken in FMI 3.0). */
  guid: string;
  /** FMI 3.0 instantiationToken if present. */
  instantiationToken?: string | undefined;
  /** Description of the model. */
  description: string | undefined;
  /** Author. */
  author: string | undefined;
  /** Generation tool. */
  generationTool: string | undefined;
  /** Model identifier for co-simulation. */
  coSimulationModelIdentifier: string | undefined;
  /** Model identifier for model exchange. */
  modelExchangeModelIdentifier: string | undefined;
  /** Model identifier for scheduled execution (FMI 3.0). */
  scheduledExecutionModelIdentifier?: string | undefined;
  /** Whether co-simulation is supported. */
  supportsCoSimulation: boolean;
  /** Whether model exchange is supported. */
  supportsModelExchange: boolean;
  /** Whether scheduled execution is supported (FMI 3.0). */
  supportsScheduledExecution?: boolean | undefined;
  /** Default experiment settings. */
  defaultExperiment: FmiDefaultExperiment | undefined;
  /** All scalar variables. */
  variables: FmiScalarVariable[];
  /** Number of event indicators. */
  numberOfEventIndicators: number | undefined;
  /** Parsed ModelStructure section (outputs, derivatives, initialUnknowns, outputDependencies). */
  modelStructure?:
    | {
        outputs: number[];
        derivatives: number[];
        initialUnknowns: number[];
        outputDependencies?: FmiModelStructureOutputDependency[] | undefined;
      }
    | undefined;
  /** FMI 3.0 Terminals and Icons (if present in modelDescription or archive). */
  terminals?: FmiTerminal[] | undefined;
}

/**
 * Parse a modelDescription.xml string into structured metadata.
 *
 * @param xml The raw XML content of modelDescription.xml
 * @returns Parsed model description
 */
export function parseModelDescription(xml: string): FmiModelDescription {
  // Extract root attributes
  const fmiVersion = extractAttr(xml, "fmiModelDescription", "fmiVersion") ?? "2.0";
  const modelName = extractAttr(xml, "fmiModelDescription", "modelName") ?? "Unknown";
  const rawGuid = extractAttr(xml, "fmiModelDescription", "guid");
  const instantiationToken = extractAttr(xml, "fmiModelDescription", "instantiationToken");
  const guid = rawGuid ?? instantiationToken ?? "";
  const description = extractAttr(xml, "fmiModelDescription", "description");
  const author = extractAttr(xml, "fmiModelDescription", "author");
  const generationTool = extractAttr(xml, "fmiModelDescription", "generationTool");
  const numberOfEventIndicatorsStr = extractAttr(xml, "fmiModelDescription", "numberOfEventIndicators");

  // Co-Simulation support
  const csBlock = extractTagBlock(xml, "CoSimulation");
  const supportsCoSimulation = csBlock !== null;
  const coSimulationModelIdentifier = csBlock ? extractAttrFromStr(csBlock.attrs, "modelIdentifier") : undefined;

  // Model Exchange support
  const meBlock = extractTagBlock(xml, "ModelExchange");
  const supportsModelExchange = meBlock !== null;
  const modelExchangeModelIdentifier = meBlock ? extractAttrFromStr(meBlock.attrs, "modelIdentifier") : undefined;

  // Scheduled Execution support (FMI 3.0)
  const seBlock = extractTagBlock(xml, "ScheduledExecution");
  const supportsScheduledExecution = seBlock !== null;
  const scheduledExecutionModelIdentifier = seBlock ? extractAttrFromStr(seBlock.attrs, "modelIdentifier") : undefined;

  // Default experiment
  const expBlock = extractTagBlock(xml, "DefaultExperiment");
  let defaultExperiment: FmiDefaultExperiment | undefined;
  if (expBlock) {
    const attrs = expBlock.attrs;
    const startTimeStr = extractAttrFromStr(attrs, "startTime");
    const stopTimeStr = extractAttrFromStr(attrs, "stopTime");
    const toleranceStr = extractAttrFromStr(attrs, "tolerance");
    const stepSizeStr = extractAttrFromStr(attrs, "stepSize");
    defaultExperiment = {
      startTime: startTimeStr !== undefined ? parseFloat(startTimeStr) : undefined,
      stopTime: stopTimeStr !== undefined ? parseFloat(stopTimeStr) : undefined,
      tolerance: toleranceStr !== undefined ? parseFloat(toleranceStr) : undefined,
      stepSize: stepSizeStr !== undefined ? parseFloat(stepSizeStr) : undefined,
    };
  }

  // Parse scalar variables (FMI 2.0)
  const variables: FmiScalarVariable[] = [];
  const svElements = extractTagElements(xml, "ScalarVariable");

  for (const { attrs, body } of svElements) {
    const name = extractAttrFromStr(attrs, "name") ?? "";
    const valueReference = parseInt(extractAttrFromStr(attrs, "valueReference") ?? "0", 10);
    const svDescription = extractAttrFromStr(attrs, "description");
    const causality = (extractAttrFromStr(attrs, "causality") ?? "local") as FmiCausality;
    const variability = (extractAttrFromStr(attrs, "variability") ?? "continuous") as FmiVariability;
    const initial = extractAttrFromStr(attrs, "initial") as FmiScalarVariable["initial"];

    // Determine type and start value from child element
    let type: FmiScalarVariable["type"] = "Real";
    let start: number | string | boolean | undefined;
    let unit: string | undefined;
    let displayUnit: string | undefined;
    let derivative: number | undefined;

    let typeBlock: { attrs: string; body: string } | null = null;
    for (const t of ["Real", "Integer", "Boolean", "String", "Enumeration"] as const) {
      const b = extractTagBlock(body, t);
      if (b) {
        type = t;
        typeBlock = b;
        break;
      }
    }
    if (typeBlock) {
      const typeAttrs = typeBlock.attrs;
      const startStr = extractAttrFromStr(typeAttrs, "start");
      if (startStr !== undefined) {
        if (type === "Real") {
          start = parseFloat(startStr);
        } else if (type === "Integer" || type === "Enumeration") {
          start = parseInt(startStr, 10);
        } else if (type === "Boolean") {
          start = startStr === "true" || startStr === "1";
        } else {
          start = startStr;
        }
      }

      unit = extractAttrFromStr(typeAttrs, "unit");
      displayUnit = extractAttrFromStr(typeAttrs, "displayUnit");
      const derStr = extractAttrFromStr(typeAttrs, "derivative");
      if (derStr !== undefined) {
        derivative = parseInt(derStr, 10);
      }
    }

    variables.push({
      name,
      valueReference,
      description: svDescription,
      causality,
      variability,
      type,
      start,
      unit,
      displayUnit,
      initial,
      derivative,
    });
  }

  // Parse FMI 3.0 typed variables (Float64, Float32, Int32, Boolean, Clock, etc.)
  const fmi3TypeTags: { tag: string; moType: FmiScalarVariable["type"] }[] = [
    { tag: "Float32", moType: "Real" },
    { tag: "Float64", moType: "Real" },
    { tag: "Int8", moType: "Integer" },
    { tag: "Int16", moType: "Integer" },
    { tag: "Int32", moType: "Integer" },
    { tag: "Int64", moType: "Integer" },
    { tag: "UInt8", moType: "Integer" },
    { tag: "UInt16", moType: "Integer" },
    { tag: "UInt32", moType: "Integer" },
    { tag: "UInt64", moType: "Integer" },
    { tag: "Boolean", moType: "Boolean" },
    { tag: "String", moType: "String" },
    { tag: "Binary", moType: "String" },
    { tag: "Enumeration", moType: "Enumeration" },
    { tag: "Clock", moType: "Clock" },
  ];

  const pendingDims: { sv: FmiScalarVariable; dims: { start?: number; vr?: number }[] }[] = [];

  for (const { tag, moType } of fmi3TypeTags) {
    const elements = extractTagElements(xml, tag);
    for (const { attrs, body } of elements) {
      const name = extractAttrFromStr(attrs, "name");
      const vrStr = extractAttrFromStr(attrs, "valueReference");
      // Ensure this is a ModelVariable element (has name and valueReference)
      if (!name || vrStr === undefined) continue;

      const valueReference = parseInt(vrStr, 10);
      const svDescription = extractAttrFromStr(attrs, "description");
      const causality = (extractAttrFromStr(attrs, "causality") ?? "local") as FmiCausality;
      const variability = (extractAttrFromStr(attrs, "variability") ?? "continuous") as FmiVariability;
      const initial = extractAttrFromStr(attrs, "initial") as FmiScalarVariable["initial"];
      const unit = extractAttrFromStr(attrs, "unit");
      const displayUnit = extractAttrFromStr(attrs, "displayUnit");
      const derStr = extractAttrFromStr(attrs, "derivative");
      const derivative = derStr !== undefined ? parseInt(derStr, 10) : undefined;

      let start: number | string | boolean | undefined;
      let startStr = extractAttrFromStr(attrs, "start");
      if (startStr === undefined && body) {
        const startBlock = extractTagBlock(body, "Start");
        if (startBlock) {
          startStr = extractAttrFromStr(startBlock.attrs, "value");
        }
      }
      if (startStr !== undefined) {
        const firstToken = startStr.trim().split(/\s+/)[0] ?? startStr;
        if (moType === "Real") {
          start = parseFloat(firstToken);
        } else if (moType === "Integer" || moType === "Enumeration") {
          start = parseInt(firstToken, 10);
        } else if (moType === "Boolean") {
          start = firstToken === "true" || firstToken === "1";
        } else {
          start = startStr;
        }
      }

      const sv: FmiScalarVariable = {
        name,
        valueReference,
        description: svDescription,
        causality,
        variability,
        type: moType,
        start,
        unit,
        displayUnit,
        initial,
        derivative,
        index: variables.length + 1,
      };
      if (body) {
        const dimElems = extractTagElements(body, "Dimension");
        if (dimElems.length > 0) {
          const dims: { start?: number; vr?: number }[] = [];
          for (const d of dimElems) {
            const dStart = extractAttrFromStr(d.attrs, "start");
            const dVr = extractAttrFromStr(d.attrs, "valueReference");
            if (dStart !== undefined) {
              dims.push({ start: parseInt(dStart, 10) });
            } else if (dVr !== undefined) {
              dims.push({ vr: parseInt(dVr, 10) });
            }
          }
          if (dims.length > 0) {
            pendingDims.push({ sv, dims });
          }
        }
      }
      variables.push(sv);
    }
  }

  if (pendingDims.length > 0) {
    const byVr = new Map<number, FmiScalarVariable>();
    for (const v of variables) byVr.set(v.valueReference, v);
    for (const { sv, dims } of pendingDims) {
      sv.dimensions = dims.map((d) => {
        if (d.start !== undefined && d.start > 0) return d.start;
        if (d.vr !== undefined) {
          const refVar = byVr.get(d.vr);
          const n = Number(refVar?.start ?? 1);
          return Number.isFinite(n) && n > 0 ? n : 1;
        }
        return 1;
      });
    }
  }

  // Parse ModelStructure (FMI 2.0 and FMI 3.0)
  const outputs: number[] = [];
  const derivatives: number[] = [];
  const initialUnknowns: number[] = [];
  const outputDependencies: FmiModelStructureOutputDependency[] = [];
  const msBlock = extractTagBlock(xml, "ModelStructure");
  if (msBlock) {
    const outputsBlock = extractTagBlock(msBlock.body, "Outputs");
    if (outputsBlock) {
      for (const u of extractTagElements(outputsBlock.body, "Unknown")) {
        const idx = extractAttrFromStr(u.attrs, "index");
        if (idx !== undefined) {
          const parsedIdx = parseInt(idx, 10);
          outputs.push(parsedIdx);
          const depStr = extractAttrFromStr(u.attrs, "dependencies");
          const depKindStr = extractAttrFromStr(u.attrs, "dependenciesKind");
          outputDependencies.push({
            outputIndexOrVr: parsedIdx,
            dependencies:
              depStr !== undefined
                ? depStr.trim() === ""
                  ? []
                  : depStr
                      .trim()
                      .split(/\s+/)
                      .map((s) => parseInt(s, 10))
                : undefined,
            dependenciesKind: depKindStr !== undefined ? depKindStr.trim().split(/\s+/) : undefined,
          });
        }
      }
    }
    const derivsBlock = extractTagBlock(msBlock.body, "Derivatives");
    if (derivsBlock) {
      for (const u of extractTagElements(derivsBlock.body, "Unknown")) {
        const idx = extractAttrFromStr(u.attrs, "index");
        if (idx !== undefined) derivatives.push(parseInt(idx, 10));
      }
    }
    const initBlock = extractTagBlock(msBlock.body, "InitialUnknowns");
    if (initBlock) {
      for (const u of extractTagElements(initBlock.body, "Unknown")) {
        const idx = extractAttrFromStr(u.attrs, "index");
        if (idx !== undefined) initialUnknowns.push(parseInt(idx, 10));
      }
    }
    // FMI 3.0 tags
    for (const o of extractTagElements(msBlock.body, "Output")) {
      const vr = extractAttrFromStr(o.attrs, "valueReference");
      if (vr !== undefined) {
        const parsedVr = parseInt(vr, 10);
        outputs.push(parsedVr);
        const depStr = extractAttrFromStr(o.attrs, "dependencies");
        const depKindStr = extractAttrFromStr(o.attrs, "dependenciesKind");
        outputDependencies.push({
          outputIndexOrVr: parsedVr,
          dependencies:
            depStr !== undefined
              ? depStr.trim() === ""
                ? []
                : depStr
                    .trim()
                    .split(/\s+/)
                    .map((s) => parseInt(s, 10))
              : undefined,
          dependenciesKind: depKindStr !== undefined ? depKindStr.trim().split(/\s+/) : undefined,
        });
      }
    }
    for (const d of extractTagElements(msBlock.body, "ContinuousStateDerivative")) {
      const vr = extractAttrFromStr(d.attrs, "valueReference");
      if (vr !== undefined) derivatives.push(parseInt(vr, 10));
    }
    for (const iu of extractTagElements(msBlock.body, "InitialUnknown")) {
      const vr = extractAttrFromStr(iu.attrs, "valueReference");
      if (vr !== undefined) initialUnknowns.push(parseInt(vr, 10));
    }
  }

  // Sort variables by valueReference
  variables.sort((a, b) => a.valueReference - b.valueReference);

  // Embedded terminals (FMI 3.0)
  let terminals: FmiTerminal[] | undefined;
  if (xml.includes("<Terminal") || xml.includes("<fmiTerminalsAndIcons")) {
    const parsed = parseTerminalsAndIcons(xml);
    if (parsed.length > 0) {
      terminals = parsed;
    }
  }

  return {
    fmiVersion,
    modelName,
    guid,
    instantiationToken,
    description,
    author,
    generationTool,
    coSimulationModelIdentifier,
    modelExchangeModelIdentifier,
    scheduledExecutionModelIdentifier,
    supportsCoSimulation,
    supportsModelExchange,
    supportsScheduledExecution,
    defaultExperiment,
    variables,
    numberOfEventIndicators: numberOfEventIndicatorsStr ? parseInt(numberOfEventIndicatorsStr, 10) : undefined,
    modelStructure: { outputs, derivatives, initialUnknowns, outputDependencies },
    terminals,
  };
}

// ── Helpers ──────────────────────────────────────────────────────

function extractTagBlock(xml: string, tag: string): { attrs: string; body: string } | null {
  const openTag = `<${tag}`;
  let pos = 0;
  while (pos < xml.length) {
    const startIdx = xml.indexOf(openTag, pos);
    if (startIdx === -1) return null;
    const charAfter = xml[startIdx + openTag.length];
    if (
      charAfter !== undefined &&
      charAfter !== " " &&
      charAfter !== "\t" &&
      charAfter !== "\r" &&
      charAfter !== "\n" &&
      charAfter !== ">" &&
      charAfter !== "/"
    ) {
      pos = startIdx + openTag.length;
      continue;
    }
    const tagEnd = xml.indexOf(">", startIdx + openTag.length);
    if (tagEnd === -1) return null;
    const isSelfClosing = xml[tagEnd - 1] === "/";
    const rawAttrs = xml.slice(startIdx + openTag.length, tagEnd);
    const attrs = isSelfClosing ? rawAttrs.slice(0, -1).trim() : rawAttrs.trim();
    if (isSelfClosing) {
      return { attrs, body: "" };
    }
    const closeTag = `</${tag}>`;
    const endIdx = xml.indexOf(closeTag, tagEnd + 1);
    if (endIdx === -1) {
      return { attrs, body: "" };
    }
    const body = xml.slice(tagEnd + 1, endIdx);
    return { attrs, body };
  }
  return null;
}

function extractTagElements(xml: string, tag: string): { attrs: string; body: string }[] {
  const result: { attrs: string; body: string }[] = [];
  const openTag = `<${tag}`;
  const closeTag = `</${tag}>`;
  let pos = 0;
  while (pos < xml.length) {
    const startIdx = xml.indexOf(openTag, pos);
    if (startIdx === -1) break;
    const charAfter = xml[startIdx + openTag.length];
    if (
      charAfter !== undefined &&
      charAfter !== " " &&
      charAfter !== "\t" &&
      charAfter !== "\r" &&
      charAfter !== "\n" &&
      charAfter !== ">" &&
      charAfter !== "/"
    ) {
      pos = startIdx + openTag.length;
      continue;
    }
    const tagEnd = xml.indexOf(">", startIdx + openTag.length);
    if (tagEnd === -1) break;
    const isSelfClosing = xml[tagEnd - 1] === "/";
    const rawAttrs = xml.slice(startIdx + openTag.length, tagEnd);
    const attrs = isSelfClosing ? rawAttrs.slice(0, -1).trim() : rawAttrs.trim();
    if (isSelfClosing) {
      result.push({ attrs, body: "" });
      pos = tagEnd + 1;
    } else {
      const endIdx = xml.indexOf(closeTag, tagEnd + 1);
      if (endIdx === -1) {
        result.push({ attrs, body: "" });
        pos = tagEnd + 1;
      } else {
        result.push({ attrs, body: xml.slice(tagEnd + 1, endIdx) });
        pos = endIdx + closeTag.length;
      }
    }
  }
  return result;
}

/** Extract an attribute value from the first occurrence of an XML element. */
function extractAttr(xml: string, element: string, attr: string): string | undefined {
  const block = extractTagBlock(xml, element);
  if (!block) return undefined;
  return extractAttrFromStr(block.attrs, attr);
}

/** Extract an attribute value from a raw attribute string. */
function extractAttrFromStr(attrs: string, attr: string): string | undefined {
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = attrs.match(new RegExp(`\\b${escaped}\\s*=\\s*"([^"]*)"`));
  if (match) return match[1];
  const singleMatch = attrs.match(new RegExp(`\\b${escaped}\\s*=\\s*'([^']*)'`));
  return singleMatch ? singleMatch[1] : undefined;
}

// ── FMI 3.0 Terminals and Icons ──────────────────────────────────

/** Graphical placement coordinates for an FMI 3.0 Terminal. */
export interface FmiTerminalGraphicalRepresentation {
  x1?: number | undefined;
  y1?: number | undefined;
  x2?: number | undefined;
  y2?: number | undefined;
  x?: number | undefined;
  y?: number | undefined;
}

/** Member variable of an FMI 3.0 Terminal. */
export interface FmiTerminalMemberVariable {
  variableName: string;
  memberName: string;
  variableKind: "potential" | "flow" | "stream" | "signal" | string;
}

/** FMI 3.0 Graphical Terminal node. */
export interface FmiTerminal {
  name: string;
  terminalKind?: string | undefined;
  matchingRule?: string | undefined;
  description?: string | undefined;
  memberVariables: FmiTerminalMemberVariable[];
  graphicalRepresentation?: FmiTerminalGraphicalRepresentation | undefined;
}

/**
 * Parse a terminalsAndIcons.xml string into structured Terminal nodes.
 *
 * @param xml The raw XML content of terminalsAndIcons.xml
 * @returns Array of parsed FMI 3.0 Terminals
 */
export function parseTerminalsAndIcons(xml: string): FmiTerminal[] {
  if (!xml || typeof xml !== "string" || !xml.includes("<")) return [];

  const terminals: FmiTerminal[] = [];
  const termElements = extractTagElements(xml, "Terminal");

  for (const { attrs, body } of termElements) {
    const name = extractAttrFromStr(attrs, "name") ?? "Unknown";
    const terminalKind = extractAttrFromStr(attrs, "terminalKind");
    const matchingRule = extractAttrFromStr(attrs, "matchingRule");
    const description = extractAttrFromStr(attrs, "description");

    const memberVariables: FmiTerminalMemberVariable[] = [];
    const mvElements = extractTagElements(body, "TerminalMemberVariable");

    for (const mv of mvElements) {
      const mvAttrs = mv.attrs;
      const variableName = extractAttrFromStr(mvAttrs, "variableName") ?? "";
      const memberName = extractAttrFromStr(mvAttrs, "memberName") ?? "";
      const variableKind = (extractAttrFromStr(mvAttrs, "variableKind") ??
        "signal") as FmiTerminalMemberVariable["variableKind"];

      memberVariables.push({ variableName, memberName, variableKind });
    }

    // Check for inline graphical representation / placement
    let graphicalRepresentation: FmiTerminalGraphicalRepresentation | undefined;
    const posBlock =
      extractTagBlock(body, "Position") ??
      extractTagBlock(body, "Placement") ??
      extractTagBlock(body, "TerminalGraphicalRepresentation");
    if (posBlock) {
      graphicalRepresentation = parsePositionAttrs(posBlock.attrs);
    }

    const terminal: FmiTerminal = {
      name,
      memberVariables,
    };
    if (terminalKind !== undefined) terminal.terminalKind = terminalKind;
    if (matchingRule !== undefined) terminal.matchingRule = matchingRule;
    if (description !== undefined) terminal.description = description;
    if (graphicalRepresentation !== undefined) terminal.graphicalRepresentation = graphicalRepresentation;

    terminals.push(terminal);
  }

  // Parse external TerminalsGraphicalRepresentation section if present
  const termGraphRepElements = extractTagElements(xml, "TerminalGraphicalRepresentation");
  for (const { attrs, body } of termGraphRepElements) {
    const termName = extractAttrFromStr(attrs, "terminalName") ?? extractAttrFromStr(attrs, "name");
    if (!termName) continue;
    const term = terminals.find((t) => t.name === termName);
    if (term) {
      const posBlock = extractTagBlock(body, "Position") ?? extractTagBlock(body, "Placement");
      const attrsToParse = posBlock ? posBlock.attrs : attrs;
      const coords = parsePositionAttrs(attrsToParse);
      if (coords) {
        term.graphicalRepresentation = coords;
      }
    }
  }

  return terminals;
}

function parsePositionAttrs(attrs: string): FmiTerminalGraphicalRepresentation | undefined {
  const x1Str = extractAttrFromStr(attrs, "x1");
  const y1Str = extractAttrFromStr(attrs, "y1");
  const x2Str = extractAttrFromStr(attrs, "x2");
  const y2Str = extractAttrFromStr(attrs, "y2");
  const xStr = extractAttrFromStr(attrs, "x");
  const yStr = extractAttrFromStr(attrs, "y");

  const rep: FmiTerminalGraphicalRepresentation = {};
  let hasData = false;
  if (x1Str !== undefined) {
    rep.x1 = parseFloat(x1Str);
    hasData = true;
  }
  if (y1Str !== undefined) {
    rep.y1 = parseFloat(y1Str);
    hasData = true;
  }
  if (x2Str !== undefined) {
    rep.x2 = parseFloat(x2Str);
    hasData = true;
  }
  if (y2Str !== undefined) {
    rep.y2 = parseFloat(y2Str);
    hasData = true;
  }
  if (xStr !== undefined) {
    rep.x = parseFloat(xStr);
    hasData = true;
  }
  if (yStr !== undefined) {
    rep.y = parseFloat(yStr);
    hasData = true;
  }

  return hasData ? rep : undefined;
}

/**
 * Extracts a map of direct feedthrough dependencies from a parsed FMU model description:
 * output variable name -> Set of input variable names it directly depends on.
 *
 * In FMI co-simulation:
 * - If dependencies attribute is not present for an output (FMI 2.0 default), it depends on ALL inputs.
 * - If dependencies attribute is present but empty (""), it has NO direct feedthrough.
 * - If dependencies attribute lists indices/VRs, it depends only on those specific inputs.
 */
export function extractDirectFeedthroughFromModelDescription(desc: FmiModelDescription): Map<string, Set<string>> {
  const feedthrough = new Map<string, Set<string>>();
  if (!desc.modelStructure) return feedthrough;

  const inputs = desc.variables.filter((v) => v.causality === "input");
  const allInputNames = new Set(inputs.map((v) => v.name));

  const inputByIndex = new Map<number, string>();
  const inputByVr = new Map<number, string>();
  for (const inv of inputs) {
    if (inv.index !== undefined) inputByIndex.set(inv.index, inv.name);
    inputByVr.set(inv.valueReference, inv.name);
  }

  const varByIndex = new Map<number, FmiScalarVariable>();
  const varByVr = new Map<number, FmiScalarVariable>();
  for (const v of desc.variables) {
    if (v.index !== undefined) varByIndex.set(v.index, v);
    varByVr.set(v.valueReference, v);
  }

  const depsList = desc.modelStructure.outputDependencies;
  if (!depsList || depsList.length === 0) {
    for (const outRef of desc.modelStructure.outputs) {
      const outVar = varByIndex.get(outRef) ?? varByVr.get(outRef);
      if (outVar && outVar.causality === "output") {
        feedthrough.set(outVar.name, new Set(allInputNames));
      }
    }
    return feedthrough;
  }

  for (const entry of depsList) {
    const outVar = varByIndex.get(entry.outputIndexOrVr) ?? varByVr.get(entry.outputIndexOrVr);
    if (!outVar) continue;

    if (entry.dependencies === undefined) {
      feedthrough.set(outVar.name, new Set(allInputNames));
    } else if (entry.dependencies.length === 0) {
      feedthrough.set(outVar.name, new Set<string>());
    } else {
      const depInputs = new Set<string>();
      for (const depId of entry.dependencies) {
        const inName = inputByIndex.get(depId) ?? inputByVr.get(depId);
        if (inName) {
          depInputs.add(inName);
        }
      }
      feedthrough.set(outVar.name, depInputs);
    }
  }

  return feedthrough;
}

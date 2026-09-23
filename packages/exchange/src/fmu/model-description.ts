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

/** Parsed FMU model description. */
export interface FmiModelDescription {
  /** FMI version string (e.g. "2.0"). */
  fmiVersion: string;
  /** Model name. */
  modelName: string;
  /** Globally unique identifier. */
  guid: string;
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
  /** Whether co-simulation is supported. */
  supportsCoSimulation: boolean;
  /** Whether model exchange is supported. */
  supportsModelExchange: boolean;
  /** Default experiment settings. */
  defaultExperiment: FmiDefaultExperiment | undefined;
  /** All scalar variables. */
  variables: FmiScalarVariable[];
  /** Number of event indicators. */
  numberOfEventIndicators: number | undefined;
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
  const guid = extractAttr(xml, "fmiModelDescription", "guid") ?? "";
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

  // Parse scalar variables
  const variables: FmiScalarVariable[] = [];
  const svElements = extractTagElements(xml, "ScalarVariable");

  for (const { attrs, body } of svElements) {
    const name = extractAttrFromStr(attrs, "name") ?? "";
    const valueReference = parseInt(extractAttrFromStr(attrs, "valueReference") ?? "0", 10);
    const svDescription = extractAttrFromStr(attrs, "description");
    const causality = (extractAttrFromStr(attrs, "causality") ?? "local") as FmiCausality;
    const variability = (extractAttrFromStr(attrs, "variability") ?? "continuous") as FmiVariability;

    // Determine type and start value from child element
    let type: FmiScalarVariable["type"] = "Real";
    let start: number | string | boolean | undefined;
    let unit: string | undefined;
    let displayUnit: string | undefined;

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
    });
  }

  return {
    fmiVersion,
    modelName,
    guid,
    description,
    author,
    generationTool,
    coSimulationModelIdentifier,
    modelExchangeModelIdentifier,
    supportsCoSimulation,
    supportsModelExchange,
    defaultExperiment,
    variables,
    numberOfEventIndicators: numberOfEventIndicatorsStr ? parseInt(numberOfEventIndicatorsStr, 10) : undefined,
  };
}

// ── Helpers ──────────────────────────────────────────────────────

function extractTagBlock(xml: string, tag: string): { attrs: string; body: string } | null {
  const openTag = `<${tag}`;
  const startIdx = xml.indexOf(openTag);
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
    return null;
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

/** Member variable of an FMI 3.0 Terminal. */
export interface FmiTerminalMemberVariable {
  variableName: string;
  memberName: string;
  variableKind: string;
}

/** FMI 3.0 Graphical Terminal node. */
export interface FmiTerminal {
  name: string;
  terminalKind?: string;
  description?: string;
  memberVariables: FmiTerminalMemberVariable[];
}

/**
 * Parse a terminalsAndIcons.xml string into structured Terminal nodes.
 *
 * @param xml The raw XML content of terminalsAndIcons.xml
 * @returns Array of parsed FMI 3.0 Terminals
 */
export function parseTerminalsAndIcons(xml: string): FmiTerminal[] {
  const terminals: FmiTerminal[] = [];
  const termElements = extractTagElements(xml, "Terminal");

  for (const { attrs, body } of termElements) {
    const name = extractAttrFromStr(attrs, "name") ?? "Unknown";
    const terminalKind = extractAttrFromStr(attrs, "terminalKind");
    const description = extractAttrFromStr(attrs, "description");

    const memberVariables: FmiTerminalMemberVariable[] = [];
    const mvElements = extractTagElements(body, "TerminalMemberVariable");

    for (const mv of mvElements) {
      const mvAttrs = mv.attrs;
      const variableName = extractAttrFromStr(mvAttrs, "variableName") ?? "";
      const memberName = extractAttrFromStr(mvAttrs, "memberName") ?? "";
      const variableKind = extractAttrFromStr(mvAttrs, "variableKind") ?? "signal";

      memberVariables.push({ variableName, memberName, variableKind });
    }

    const terminal: FmiTerminal = {
      name,
      memberVariables,
    };
    if (terminalKind !== undefined) terminal.terminalKind = terminalKind;
    if (description !== undefined) terminal.description = description;

    terminals.push(terminal);
  }

  return terminals;
}

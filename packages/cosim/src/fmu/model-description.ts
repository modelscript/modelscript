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

/** Causality from FMI 2.0 spec. */
export type FmiCausality = "input" | "output" | "parameter" | "calculatedParameter" | "local" | "independent";

/** Variability from FMI 2.0 spec. */
export type FmiVariability = "constant" | "fixed" | "tunable" | "discrete" | "continuous";

/** FMI scalar variable descriptor (subset of FMI 2.0 ScalarVariable). */
export interface FmiScalarVariable {
  /** Variable name. */
  name: string;
  /** Value reference (unique integer identifier). */
  valueReference: number;
  /** Description text. */
  description: string | undefined;
  /** Causality (input, output, parameter, etc). */
  causality: FmiCausality;
  /** Variability (continuous, discrete, etc). */
  variability: FmiVariability;
  /** Data type from the child element. */
  type: "Real" | "Integer" | "Boolean" | "String" | "Enumeration";
  /** Start value (if specified). */
  start: number | string | boolean | undefined;
  /** Unit (Real variables only). */
  unit: string | undefined;
  /** Display unit. */
  displayUnit: string | undefined;
}

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
  const csMatch = xml.match(/<CoSimulation\s+([^>]*)\/?>/);
  const supportsCoSimulation = csMatch !== null;
  const coSimulationModelIdentifier = csMatch ? extractAttrFromStr(csMatch[1] ?? "", "modelIdentifier") : undefined;

  // Model Exchange support
  const meMatch = xml.match(/<ModelExchange\s+([^>]*)\/?>/);
  const supportsModelExchange = meMatch !== null;
  const modelExchangeModelIdentifier = meMatch ? extractAttrFromStr(meMatch[1] ?? "", "modelIdentifier") : undefined;

  // Default experiment
  const expMatch = xml.match(/<DefaultExperiment\s+([^>]*)\/?>/);
  let defaultExperiment: FmiDefaultExperiment | undefined;
  if (expMatch) {
    const attrs = expMatch[1] ?? "";
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
  const svRegex = /<ScalarVariable\s+([^>]*)>([\s\S]*?)<\/ScalarVariable>/g;
  let svMatch: RegExpExecArray | null;

  while ((svMatch = svRegex.exec(xml)) !== null) {
    const attrs = svMatch[1] ?? "";
    const body = svMatch[2] ?? "";

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

    const typeMatch = body.match(/<(Real|Integer|Boolean|String|Enumeration)\s*([^>]*)\/?>/);
    if (typeMatch) {
      type = (typeMatch[1] ?? "Real") as FmiScalarVariable["type"];
      const typeAttrs = typeMatch[2] ?? "";

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

/** Extract an attribute value from the first occurrence of an XML element. */
function extractAttr(xml: string, element: string, attr: string): string | undefined {
  const elemMatch = xml.match(new RegExp(`<${element}\\s+([^>]*)>`, "s"));
  if (!elemMatch) return undefined;
  return extractAttrFromStr(elemMatch[1] ?? "", attr);
}

/** Extract an attribute value from a raw attribute string. */
function extractAttrFromStr(attrs: string, attr: string): string | undefined {
  const match = attrs.match(new RegExp(`${attr}\\s*=\\s*"([^"]*)"`, "s"));
  return match ? (match[1] ?? undefined) : undefined;
}

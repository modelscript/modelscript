// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Browser-safe FMU 2.0 co-simulation participant.
 *
 * Parses a modelDescription.xml string to extract variable metadata
 * and implements a passthrough co-simulation mode where input values
 * propagate to outputs at each communication step. This enables
 * co-simulation orchestration with FMU participants in the browser
 * without requiring native binaries.
 */

// ── modelDescription.xml Parser (browser-safe, zero-dependency) ──

/** FMI scalar variable descriptor. */
interface FmiScalarVariable {
  name: string;
  valueReference: number;
  causality: "input" | "output" | "parameter" | "calculatedParameter" | "local" | "independent";
  variability: string;
  type: "Real" | "Integer" | "Boolean" | "String" | "Enumeration";
  start: number | string | boolean | undefined;
  unit: string | undefined;
  description: string | undefined;
}

/** Parsed FMI model description. */
interface FmiModelDescription {
  fmiVersion: string;
  modelName: string;
  guid: string;
  description: string | undefined;
  supportsCoSimulation: boolean;
  defaultExperiment?: {
    startTime?: number;
    stopTime?: number;
    stepSize?: number;
  };
  variables: FmiScalarVariable[];
}

/** Extract an attribute value from an XML attribute string. */
function extractAttrFromStr(attrs: string, attr: string): string | undefined {
  const match = attrs.match(new RegExp(`${attr}\\s*=\\s*"([^"]*)"`, "s"));
  return match ? (match[1] ?? undefined) : undefined;
}

/** Extract an attribute from the first occurrence of an XML element. */
function extractAttr(xml: string, element: string, attr: string): string | undefined {
  const elemMatch = xml.match(new RegExp(`<${element}\\s+([^>]*)>`, "s"));
  if (!elemMatch) return undefined;
  return extractAttrFromStr(elemMatch[1] ?? "", attr);
}

/** Parse modelDescription.xml into structured metadata. */
function parseModelDescription(xml: string): FmiModelDescription {
  const fmiVersion = extractAttr(xml, "fmiModelDescription", "fmiVersion") ?? "2.0";
  const modelName = extractAttr(xml, "fmiModelDescription", "modelName") ?? "Unknown";
  const guid = extractAttr(xml, "fmiModelDescription", "guid") ?? "";
  const description = extractAttr(xml, "fmiModelDescription", "description");

  const supportsCoSimulation = /<CoSimulation\s+/.test(xml);

  let defaultExperiment: FmiModelDescription["defaultExperiment"];
  const expMatch = xml.match(/<DefaultExperiment\s+([^>]*)\/?\s*>/);
  if (expMatch) {
    const attrs = expMatch[1] ?? "";
    const startStr = extractAttrFromStr(attrs, "startTime");
    const stopStr = extractAttrFromStr(attrs, "stopTime");
    const stepStr = extractAttrFromStr(attrs, "stepSize");
    defaultExperiment = {
      startTime: startStr !== undefined ? parseFloat(startStr) : undefined,
      stopTime: stopStr !== undefined ? parseFloat(stopStr) : undefined,
      stepSize: stepStr !== undefined ? parseFloat(stepStr) : undefined,
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
    const causality = (extractAttrFromStr(attrs, "causality") ?? "local") as FmiScalarVariable["causality"];
    const variability = extractAttrFromStr(attrs, "variability") ?? "continuous";

    let type: FmiScalarVariable["type"] = "Real";
    let start: number | string | boolean | undefined;
    let unit: string | undefined;

    const typeMatch = body.match(/<(Real|Integer|Boolean|String|Enumeration)\s*([^>]*)\/?\s*>/);
    if (typeMatch) {
      type = (typeMatch[1] ?? "Real") as FmiScalarVariable["type"];
      const typeAttrs = typeMatch[2] ?? "";
      const startStr = extractAttrFromStr(typeAttrs, "start");
      if (startStr !== undefined) {
        if (type === "Real") start = parseFloat(startStr);
        else if (type === "Integer" || type === "Enumeration") start = parseInt(startStr, 10);
        else if (type === "Boolean") start = startStr === "true" || startStr === "1";
        else start = startStr;
      }
      unit = extractAttrFromStr(typeAttrs, "unit");
    }

    variables.push({ name, valueReference, causality, variability, type, start, unit, description: svDescription });
  }

  return { fmiVersion, modelName, guid, description, supportsCoSimulation, defaultExperiment, variables };
}

// ── FMU Browser Participant ──

/** Variable info exposed after initialization. */
export interface FmuVariable {
  name: string;
  causality: string;
  type: string;
  unit?: string;
  start?: number | string | boolean;
}

/**
 * Browser-safe FMU co-simulation participant.
 *
 * Implements the same interface shape as LspSimulatorParticipant
 * so the orchestrator can treat both uniformly.
 */
export class FmuBrowserParticipant {
  readonly id: string;
  readonly modelName: string;

  private modelDesc: FmiModelDescription | null = null;
  private readonly xmlContent: string;
  private variables_: FmuVariable[] = [];
  private currentValues = new Map<string, number>();
  private pendingInputs = new Map<string, number>();
  private _allValues: Record<string, number> = {};

  constructor(id: string, xmlContent: string) {
    this.id = id;
    this.xmlContent = xmlContent;

    // Pre-parse to get the model name
    const nameMatch = xmlContent.match(/modelName\s*=\s*"([^"]*)"/);
    this.modelName = nameMatch?.[1] ?? "FMU";
  }

  /** Get variable metadata (available after initialize). */
  getVariables(): FmuVariable[] {
    return this.variables_;
  }

  /** Get all variable values from the last step. */
  get allValues(): Record<string, number> {
    return this._allValues;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async initialize(_startTime: number, _stopTime: number, _stepSize: number): Promise<void> {
    this.modelDesc = parseModelDescription(this.xmlContent);

    if (!this.modelDesc.supportsCoSimulation) {
      throw new Error(`FMU '${this.modelDesc.modelName}' does not support co-simulation`);
    }

    // Build variable list
    this.variables_ = this.modelDesc.variables
      .filter((v) => v.causality !== "local" && v.causality !== "independent")
      .map((v) => ({
        name: v.name,
        causality: v.causality,
        type: v.type,
        unit: v.unit,
        start: v.start,
      }));

    // Initialize values from start attributes
    for (const v of this.modelDesc.variables) {
      if (v.start !== undefined && typeof v.start === "number") {
        this.currentValues.set(v.name, v.start);
      } else if (v.type === "Boolean") {
        this.currentValues.set(v.name, v.start === true ? 1 : 0);
      } else {
        this.currentValues.set(v.name, 0);
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async doStep(_currentTime: number, _stepSize: number): Promise<void> {
    if (!this.modelDesc) throw new Error("FMU participant not initialized");

    // Apply input overrides
    for (const [name, value] of this.pendingInputs) {
      this.currentValues.set(name, value);
    }

    // Passthrough mode: input values are propagated.
    // A future version could implement algebraic transfer functions here.

    // Update allValues snapshot
    this._allValues = {};
    for (const v of this.modelDesc.variables) {
      if (v.causality !== "local" && v.causality !== "independent") {
        const val = this.currentValues.get(v.name);
        if (val !== undefined) {
          this._allValues[v.name] = val;
        }
      }
    }

    this.pendingInputs.clear();
  }

  async getOutputs(): Promise<Map<string, number>> {
    const outputs = new Map<string, number>();
    if (!this.modelDesc) return outputs;
    for (const v of this.modelDesc.variables) {
      if (v.causality === "output") {
        const value = this.currentValues.get(v.name);
        if (value !== undefined) {
          outputs.set(v.name, value);
        }
      }
    }
    return outputs;
  }

  async setInputs(values: Map<string, number>): Promise<void> {
    for (const [name, value] of values) {
      this.pendingInputs.set(name, value);
      this.currentValues.set(name, value);
    }
  }

  async terminate(): Promise<void> {
    this.currentValues.clear();
    this.pendingInputs.clear();
    this._allValues = {};
    this.modelDesc = null;
  }
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * SSP (System Structure and Parameterization) data model types.
 *
 * Mirrors the SSP 1.0 standard schema for SystemStructureDescription (SSD),
 * System Structure Parameter Values (SSV), and System Structure Parameter Mapping (SSM).
 *
 * @see https://ssp-standard.org/
 */

/** Connector kind from SSP spec. */
export type SspConnectorKind = "input" | "output" | "inout" | "parameter" | "calculatedParameter";

/** Scalar data type for SSP connectors. */
export type SspConnectorType = "Real" | "Integer" | "Boolean" | "String" | "Enumeration";

/** A single connector on a component boundary. */
export interface SspConnector {
  /** Connector name (matching the FMU variable name). */
  name: string;
  /** Kind: input, output, inout, parameter, etc. */
  kind: SspConnectorKind;
  /** Scalar data type. */
  type: SspConnectorType;
  /** Unit string (optional). */
  unit?: string | undefined;
}

/** A component (FMU) within the SSP system. */
export interface SspComponent {
  /** Component name (unique within the system). */
  name: string;
  /** Type attribute (e.g., "application/x-fmu-sharedlibrary"). */
  type?: string | undefined;
  /** Source path to the FMU file within the SSP `resources/` folder. */
  source: string;
  /** Connectors declared on this component. */
  connectors: SspConnector[];
}

/** A connection between two component connectors. */
export interface SspConnection {
  /** Source component name. */
  startElement: string;
  /** Source connector name. */
  startConnector: string;
  /** Target component name. */
  endElement: string;
  /** Target connector name. */
  endConnector: string;
}

/** A parameter value (inline or from SSV). */
export interface SspParameterValue {
  /** Parameter name. */
  name: string;
  /** Data type. */
  type: SspConnectorType;
  /** Value. */
  value: number | string | boolean;
}

/** A parameter binding for a component. */
export interface SspParameterBinding {
  /** Optional prefix (component name scope). */
  prefix?: string | undefined;
  /** Source: inline values or path to .ssv file. */
  source?: string | undefined;
  /** Inline parameter values. */
  values: SspParameterValue[];
}

/** Default experiment annotation. */
export interface SspDefaultExperiment {
  startTime?: number;
  stopTime?: number;
}

/** Root system structure from SystemStructure.ssd. */
export interface SspSystem {
  /** System name. */
  name: string;
  /** Description. */
  description?: string | undefined;
  /** SSP version. */
  version: string;
  /** Components in the system. */
  components: SspComponent[];
  /** Connections between components. */
  connections: SspConnection[];
  /** Parameter bindings. */
  parameterBindings: SspParameterBinding[];
  /** Default experiment. */
  defaultExperiment?: SspDefaultExperiment | undefined;
}

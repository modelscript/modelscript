// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * SSP (System Structure and Parameterization) data model types.
 *
 * Mirrors the SSP 1.0/2.0 standard schema for SystemStructureDescription (SSD),
 * System Structure Parameter Values (SSV), and System Structure Parameter Mapping (SSM).
 *
 * @see https://ssp-standard.org/
 */

/** Connector kind from SSP spec. */
export type SspConnectorKind = "input" | "output" | "inout" | "parameter" | "calculatedParameter";

/** Scalar data type for SSP connectors. */
export type SspConnectorType = "Real" | "Integer" | "Boolean" | "String" | "Enumeration";

/** Bounding-box geometry from `<ssd:ElementGeometry>` or `<ssd:SystemGeometry>`. */
export interface SspElementGeometry {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  rotation?: number | undefined;
}

/** Normalized or coordinate position from `<ssd:ConnectorGeometry>`. */
export interface SspConnectorGeometry {
  x: number;
  y: number;
}

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
  /** Optional connector placement from `<ssd:ConnectorGeometry>`. */
  geometry?: SspConnectorGeometry | undefined;
  /** 1-based line number in the SSD XML source. */
  line?: number | undefined;
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
  /** Optional bounding box from `<ssd:ElementGeometry>`. */
  geometry?: SspElementGeometry | undefined;
  /** 1-based line number of the opening `<ssd:Component>` tag. */
  line?: number | undefined;
  /** 1-based line number of `<ssd:ElementGeometry>` if present. */
  geometryLine?: number | undefined;
}

/** A connection between two component connectors. */
export interface SspConnection {
  /** Source component name (empty string for system boundary connector). */
  startElement: string;
  /** Source connector name. */
  startConnector: string;
  /** Target component name (empty string for system boundary connector). */
  endElement: string;
  /** Target connector name. */
  endConnector: string;
  /** Intermediate routing waypoints from `<ssd:ConnectionGeometry>`. */
  points?: { x: number; y: number }[] | undefined;
  /** 1-based line number of the `<ssd:Connection>` tag. */
  line?: number | undefined;
}

/** A parameter value (inline or from SSV). */
export interface SspParameterValue {
  /** Parameter name. */
  name: string;
  /** Data type. */
  type: SspConnectorType;
  /** Value. */
  value: number | string | boolean;
  /** 1-based line number in XML source. */
  line?: number | undefined;
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
  startTime?: number | undefined;
  stopTime?: number | undefined;
}

/** Root system structure from SystemStructure.ssd. */
export interface SspSystem {
  /** System name. */
  name: string;
  /** Description. */
  description?: string | undefined;
  /** SSP version. */
  version: string;
  /** System-level boundary connectors. */
  connectors?: SspConnector[] | undefined;
  /** Components in the system. */
  components: SspComponent[];
  /** Connections between components. */
  connections: SspConnection[];
  /** Parameter bindings. */
  parameterBindings: SspParameterBinding[];
  /** Default experiment. */
  defaultExperiment?: SspDefaultExperiment | undefined;
  /** Optional `<ssd:SystemGeometry>` extent. */
  geometry?: SspElementGeometry | undefined;
}

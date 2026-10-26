// SPDX-License-Identifier: AGPL-3.0-or-later

export interface SourceRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export type AutosarPortDirection = "provided" | "required" | "provided-required";

export interface AutosarDataElement {
  shortName: string;
  typeRef: string;
  initValue?: number | string | undefined;
  range?: SourceRange | undefined;
}

export interface AutosarOperationArgument {
  name: string;
  direction: "IN" | "OUT" | "INOUT";
  typeRef: string;
}

export interface AutosarClientServerOperation {
  shortName: string;
  arguments: AutosarOperationArgument[];
  range?: SourceRange | undefined;
}

export interface AutosarPortInterface {
  shortName: string;
  kind: "SENDER-RECEIVER-INTERFACE" | "CLIENT-SERVER-INTERFACE" | "TRIGGER-INTERFACE" | "MODE-SWITCH-INTERFACE";
  dataElements?: AutosarDataElement[] | undefined;
  operations?: AutosarClientServerOperation[] | undefined;
  range?: SourceRange | undefined;
}

export interface AutosarPortPrototype {
  shortName: string;
  direction: AutosarPortDirection;
  interfaceRef: string;
  range?: SourceRange | undefined;
}

export interface AutosarDataAccess {
  port: string;
  dataElement: string;
}

export interface AutosarRunnableEntity {
  shortName: string;
  symbol?: string | undefined;
  executionTimeWcet?: number | undefined; // In seconds
  canBeInvokedConcurrently?: boolean | undefined;
  dataReadAccess: AutosarDataAccess[];
  dataWriteAccess: AutosarDataAccess[];
  range?: SourceRange | undefined;
}

export type AutosarRteEventKind = "TIMING-EVENT" | "DATA-RECEIVED-EVENT" | "INIT-EVENT" | "OPERATION-INVOKED-EVENT";

export interface AutosarRteEvent {
  shortName: string;
  kind: AutosarRteEventKind;
  startOnEventRef: string; // Runnable short-name
  period?: number | undefined; // In seconds (for TIMING-EVENT)
  dataReceivePointRef?: AutosarDataAccess | undefined;
  operationRef?: string | undefined;
  range?: SourceRange | undefined;
}

export interface AutosarInternalBehavior {
  shortName: string;
  runnables: Map<string, AutosarRunnableEntity>;
  events: AutosarRteEvent[];
  range?: SourceRange | undefined;
}

export interface AutosarSwcPrototype {
  shortName: string;
  typeRef: string;
  range?: SourceRange | undefined;
}

export interface AutosarPortRef {
  component?: string | undefined;
  port: string;
}

export interface AutosarConnector {
  shortName: string;
  kind: "ASSEMBLY-SW-CONNECTOR" | "DELEGATION-SW-CONNECTOR";
  provider?: AutosarPortRef | undefined;
  requirer?: AutosarPortRef | undefined;
  outerPort?: string | undefined;
  innerPort?: AutosarPortRef | undefined;
  range?: SourceRange | undefined;
}

export type SwComponentKind =
  | "APPLICATION-SW-COMPONENT-TYPE"
  | "SENSOR-ACTUATOR-SW-COMPONENT-TYPE"
  | "COMPLEX-DEVICE-DRIVER-SW-COMPONENT-TYPE"
  | "COMPOSITION-SW-COMPONENT-TYPE"
  | "SERVICE-SW-COMPONENT-TYPE"
  | "ECU-ABSTRACTION-SW-COMPONENT-TYPE";

export interface AutosarSwComponent {
  shortName: string;
  kind: SwComponentKind;
  ports: Map<string, AutosarPortPrototype>;
  internalBehavior?: AutosarInternalBehavior | undefined;
  subComponents?: Map<string, AutosarSwcPrototype> | undefined;
  connectors?: AutosarConnector[] | undefined;
  range?: SourceRange | undefined;
}

export interface AutosarSignal {
  shortName: string;
  length: number; // In bits
  startBit: number;
  dataType?: string | undefined;
  byteOrder?: "MOST-SIGNIFICANT-BYTE-FIRST" | "LEAST-SIGNIFICANT-BYTE-FIRST" | undefined;
  range?: SourceRange | undefined;
}

export interface AutosarPdu {
  shortName: string;
  byteLength: number; // In bytes
  signals: AutosarSignal[];
  range?: SourceRange | undefined;
}

export interface AutosarCanFrame {
  shortName: string;
  frameId: number;
  length: number; // Payload size in bytes (e.g. 8 for Classic CAN, 64 for CAN-FD)
  pduRef?: string | undefined;
  period?: number | undefined; // In seconds
  range?: SourceRange | undefined;
}

export type AutosarElement = AutosarSwComponent | AutosarPortInterface | AutosarPdu | AutosarCanFrame;

export interface AutosarPackage {
  shortName: string;
  elements: Map<string, AutosarElement>;
  subPackages: Map<string, AutosarPackage>;
  range?: SourceRange | undefined;
}

export interface AutosarModel {
  packages: Map<string, AutosarPackage>;
  components: Map<string, AutosarSwComponent>;
  interfaces: Map<string, AutosarPortInterface>;
  pdus: Map<string, AutosarPdu>;
  frames: Map<string, AutosarCanFrame>;
}

export interface AutosarQuickFix {
  title: string;
  edit: {
    text: string;
    range: SourceRange;
  };
}

export interface AutosarDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  range: SourceRange;
  elementName?: string | undefined;
  quickFix?: AutosarQuickFix | undefined;
}

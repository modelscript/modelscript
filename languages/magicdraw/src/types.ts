// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/magicdraw — Core Typed IR for MagicDraw / Cameo (.mdzip, .mdxml, .xmi).
 *
 * Represents OMG UML 2.x / SysML 1.x model elements, applied stereotypes,
 * relationships, parametric constraints, state machines, and MagicDraw
 * diagram layout metadata (`mdOwnedViews`).
 */

export interface SourceSpan {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export type ArchiveStatus = "ok" | "corrupt" | "encrypted" | "twc-stub" | "empty";

export interface MagicDrawArchiveMetadata {
  format: "mdzip" | "mdxml" | "xmi";
  status: ArchiveStatus;
  statusMessage?: string | undefined;
  projectName?: string | undefined;
  magicDrawVersion?: string | undefined;
  umlVersion?: string | undefined;
  xmiVersion?: string | undefined;
  primaryEntryPath?: string | undefined;
  entries: string[];
  mountedModules: string[];
}

export type SysmlPropertyCompartment =
  | "parts"
  | "references"
  | "values"
  | "constraints"
  | "flowProperties"
  | "ports"
  | "attributes";

export interface StereotypeApplication {
  id: string;
  profilePrefix: string;
  name: string;
  qualifiedName: string;
  targetId: string;
  baseAttr: string;
  tags: Record<string, string>;
  span?: SourceSpan | undefined;
}

export interface TypeReference {
  rawId?: string | undefined;
  href?: string | undefined;
  resolvedName?: string | undefined;
  resolvedId?: string | undefined;
  unit?: string | undefined;
  isPrimitive?: boolean | undefined;
  isExternalUnresolved?: boolean | undefined;
}

export interface Multiplicity {
  lower: string;
  upper: string;
}

export interface UmlProperty {
  id: string;
  name: string;
  ownerId: string;
  aggregation: "none" | "shared" | "composite";
  visibility: "public" | "private" | "protected" | "package";
  typeRef?: TypeReference | undefined;
  defaultValue?: string | undefined;
  multiplicity?: Multiplicity | undefined;
  isReadOnly?: boolean | undefined;
  isDerived?: boolean | undefined;
  direction?: "in" | "out" | "inout" | undefined;
  compartment: SysmlPropertyCompartment;
  stereotypes: StereotypeApplication[];
  span?: SourceSpan | undefined;
}

export interface UmlPort {
  id: string;
  name: string;
  ownerId: string;
  typeRef?: TypeReference | undefined;
  isConjugated: boolean;
  isBehavior?: boolean | undefined;
  isService?: boolean | undefined;
  portKind: "proxy" | "full" | "flow" | "standard";
  direction?: "in" | "out" | "inout" | undefined;
  stereotypes: StereotypeApplication[];
  span?: SourceSpan | undefined;
}

export interface UmlOperation {
  id: string;
  name: string;
  ownerId: string;
  parameters: Array<{
    id: string;
    name: string;
    direction: "in" | "out" | "inout" | "return";
    typeRef?: TypeReference | undefined;
  }>;
  stereotypes: StereotypeApplication[];
  span?: SourceSpan | undefined;
}

export interface UmlConstraint {
  id: string;
  name: string;
  ownerId: string;
  language: string;
  body: string;
  constrainedElementIds: string[];
  span?: SourceSpan | undefined;
}

export interface UmlConnectorEnd {
  id: string;
  roleId?: string | undefined;
  partWithPortId?: string | undefined;
  nestedPropertyPath?: string[] | undefined;
}

export interface UmlConnector {
  id: string;
  name: string;
  ownerId: string;
  kind: "assembly" | "delegation" | "binding";
  ends: UmlConnectorEnd[];
  itemFlowLabel?: string | undefined;
  stereotypes: StereotypeApplication[];
  span?: SourceSpan | undefined;
}

export type UmlClassifierKind =
  | "Block"
  | "InterfaceBlock"
  | "ValueType"
  | "ConstraintBlock"
  | "Requirement"
  | "Class"
  | "Interface"
  | "DataType"
  | "Enumeration"
  | "Signal";

export interface UmlClassifier {
  id: string;
  name: string;
  qualifiedName: string;
  ownerId: string;
  umlType: string;
  kind: UmlClassifierKind;
  isAbstract: boolean;
  isEncapsulated?: boolean | undefined;
  documentation?: string | undefined;
  requirementId?: string | undefined;
  requirementText?: string | undefined;
  unit?: string | undefined;
  quantityKind?: string | undefined;
  generalizationIds: string[];
  generalizationHrefs: string[];
  properties: UmlProperty[];
  ports: UmlPort[];
  operations: UmlOperation[];
  constraints: UmlConstraint[];
  connectors: UmlConnector[];
  literals: string[];
  stereotypes: StereotypeApplication[];
  span?: SourceSpan | undefined;
}

export type UmlRelationshipKind =
  | "generalization"
  | "composition"
  | "aggregation"
  | "association"
  | "satisfy"
  | "verify"
  | "deriveReqt"
  | "refine"
  | "trace"
  | "copy"
  | "allocate"
  | "dependency"
  | "containment";

export interface UmlRelationship {
  id: string;
  name?: string | undefined;
  kind: UmlRelationshipKind;
  sourceId: string;
  targetId: string;
  sourceHref?: string | undefined;
  targetHref?: string | undefined;
  stereotypeName?: string | undefined;
  span?: SourceSpan | undefined;
}

export interface UmlState {
  id: string;
  name: string;
  kind: "state" | "initial" | "final" | "choice" | "fork" | "join";
  entryAction?: string | undefined;
  doAction?: string | undefined;
  exitAction?: string | undefined;
  span?: SourceSpan | undefined;
}

export interface UmlTransition {
  id: string;
  name?: string | undefined;
  sourceId: string;
  targetId: string;
  trigger?: string | undefined;
  guard?: string | undefined;
  effect?: string | undefined;
  span?: SourceSpan | undefined;
}

export interface UmlStateMachine {
  id: string;
  name: string;
  qualifiedName: string;
  ownerId: string;
  states: UmlState[];
  transitions: UmlTransition[];
  span?: SourceSpan | undefined;
}

export interface UmlActivityNode {
  id: string;
  name: string;
  kind: "action" | "initial" | "final" | "decision" | "fork" | "join" | "object";
  span?: SourceSpan | undefined;
}

export interface UmlActivityEdge {
  id: string;
  name?: string | undefined;
  sourceId: string;
  targetId: string;
  guard?: string | undefined;
  isObjectFlow?: boolean | undefined;
  span?: SourceSpan | undefined;
}

export interface UmlActivity {
  id: string;
  name: string;
  qualifiedName: string;
  ownerId: string;
  nodes: UmlActivityNode[];
  edges: UmlActivityEdge[];
  span?: SourceSpan | undefined;
}

export interface UmlLifeline {
  id: string;
  name: string;
  representsId?: string | undefined;
  span?: SourceSpan | undefined;
}

export interface UmlMessage {
  id: string;
  name: string;
  sourceLifelineId: string;
  targetLifelineId: string;
  messageSort: "synchCall" | "asynchCall" | "reply" | "createMessage" | "deleteMessage";
  span?: SourceSpan | undefined;
}

export interface UmlInteraction {
  id: string;
  name: string;
  qualifiedName: string;
  ownerId: string;
  lifelines: UmlLifeline[];
  messages: UmlMessage[];
  span?: SourceSpan | undefined;
}

export interface UmlPackage {
  id: string;
  name: string;
  qualifiedName: string;
  ownerId?: string | undefined;
  isModel: boolean;
  childPackageIds: string[];
  classifierIds: string[];
  stateMachineIds: string[];
  activityIds?: string[] | undefined;
  interactionIds?: string[] | undefined;
  diagramIds: string[];
  span?: SourceSpan | undefined;
}

export type MagicDrawDiagramKind =
  | "BDD"
  | "IBD"
  | "REQ"
  | "PAR"
  | "STM"
  | "ACT"
  | "SEQ"
  | "PKG"
  | "TABLE"
  | "MATRIX"
  | "OTHER";

export interface DiagramViewBounds {
  elementId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiagramEdgePoints {
  elementId: string;
  points: Array<{ x: number; y: number }>;
}

export interface DiagramViewStyle {
  elementId: string;
  fillColor?: string | undefined;
  strokeColor?: string | undefined;
  suppressedCompartments: string[];
}

export interface MagicDrawDiagramMeta {
  id: string;
  name: string;
  diagramType: string;
  kind: MagicDrawDiagramKind;
  ownerId: string;
  elementIds: string[];
  viewBounds: DiagramViewBounds[];
  edgePoints?: DiagramEdgePoints[] | undefined;
  viewStyles?: DiagramViewStyle[] | undefined;
  frameBounds?: DiagramViewBounds | undefined;
  streamContentId?: string | undefined;
  viewLoaded?: boolean | undefined;
  span?: SourceSpan | undefined;
}

export type MagicDrawBinaryKind = "diagram-view" | "image" | "svg" | "pdf" | "archive" | "xml" | "binary";

export interface MagicDrawBinaryAttachment {
  entryName: string;
  ownerResource?: string | undefined;
  kind: MagicDrawBinaryKind;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  readBytes: () => Uint8Array | null;
  toDataUri: () => string | null;
}

export interface MagicDrawDocument {
  metadata: MagicDrawArchiveMetadata;
  rootPackageId?: string | undefined;
  packages: Map<string, UmlPackage>;
  classifiers: Map<string, UmlClassifier>;
  stateMachines: Map<string, UmlStateMachine>;
  activities: Map<string, UmlActivity>;
  interactions: Map<string, UmlInteraction>;
  relationships: UmlRelationship[];
  stereotypes: StereotypeApplication[];
  diagrams: MagicDrawDiagramMeta[];
  elementsById: Map<
    string,
    { id: string; name: string; qualifiedName: string; kind: string; span?: SourceSpan | undefined }
  >;
  duplicateIds: Array<{ id: string; span?: SourceSpan | undefined }>;
  unresolvedHrefs: Array<{ href: string; ownerId: string; span?: SourceSpan | undefined }>;
  orphanStereotypes: StereotypeApplication[];
  binaries?: MagicDrawBinaryAttachment[] | undefined;
  readBinaryEntry?: ((entryName: string) => string | undefined) | undefined;
  readBinaryBytes?: ((entryName: string) => Uint8Array | null) | undefined;
}

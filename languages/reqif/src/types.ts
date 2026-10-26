// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/reqif — Core Type Definitions.
 *
 * Implements standard OMG ReqIF 1.2 / 1.1 / 1.0 (ISO/IEC 17506) data model
 * with exact source location tracking, formal contracts, and V-Model traceability.
 */

export interface SourceSpan {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export interface ReqIfHeader {
  identifier: string;
  creationTime?: string | undefined;
  repositoryId?: string | undefined;
  reqIfToolId?: string | undefined;
  reqIfVersion: string;
  sourceToolId?: string | undefined;
  title: string;
  comment?: string | undefined;
}

export type ReqIfDataTypeKind = "STRING" | "INTEGER" | "REAL" | "BOOLEAN" | "ENUMERATION" | "XHTML" | "DATE";

export interface ReqIfEnumValue {
  identifier: string;
  longName?: string | undefined;
  key?: number | undefined;
}

export interface ReqIfDataType {
  identifier: string;
  longName?: string | undefined;
  kind: ReqIfDataTypeKind;
  enumValues?: ReqIfEnumValue[] | undefined;
  min?: number | undefined;
  max?: number | undefined;
}

export interface ReqIfAttributeDefinition {
  identifier: string;
  longName?: string | undefined;
  dataTypeRef: string;
  kind: ReqIfDataTypeKind;
  defaultValue?: string | number | boolean | undefined;
  isMandatory?: boolean | undefined;
}

export type ReqIfSpecTypeKind =
  | "SPEC-OBJECT-TYPE"
  | "SPECIFICATION-TYPE"
  | "SPEC-RELATION-TYPE"
  | "RELATION-GROUP-TYPE";

export interface ReqIfSpecType {
  identifier: string;
  longName?: string | undefined;
  kind: ReqIfSpecTypeKind;
  attributeDefinitions: Map<string, ReqIfAttributeDefinition>;
}

export interface ReqIfAttributeValue {
  definitionRef: string;
  name: string;
  kind: ReqIfDataTypeKind;
  value: string | number | boolean;
  span?: SourceSpan | undefined;
}

export type AsilLevel = "QM" | "ASIL-A" | "ASIL-B" | "ASIL-C" | "ASIL-D";
export type RequirementStatus = "Draft" | "Review" | "Approved" | "Verified" | "Violated";
export type ContractComparator = "<=" | "<" | ">=" | ">" | "==" | "!=";

export interface ReqIfContract {
  variable: string;
  comparator: ContractComparator;
  limitValue: number;
  unit?: string | undefined;
}

export interface ReqIfSpecObject {
  identifier: string;
  longName?: string | undefined;
  lastChange?: string | undefined;
  typeRef?: string | undefined;
  attributes: Map<string, ReqIfAttributeValue>;
  text: string;
  span?: SourceSpan | undefined;
  contract?: ReqIfContract | undefined;
  asilLevel?: AsilLevel | undefined;
  status?: RequirementStatus | undefined;
}

export type ReqIfRelationKind = "satisfies" | "verifies" | "allocates" | "refines" | "conflicts" | "derives" | string;

export interface ReqIfSpecRelation {
  identifier: string;
  longName?: string | undefined;
  typeRef?: string | undefined;
  relationType: ReqIfRelationKind;
  sourceId: string;
  targetId: string;
  span?: SourceSpan | undefined;
}

export interface ReqIfSpecHierarchy {
  identifier: string;
  objectRef: string;
  children: ReqIfSpecHierarchy[];
  span?: SourceSpan | undefined;
}

export interface ReqIfSpecification {
  identifier: string;
  longName?: string | undefined;
  lastChange?: string | undefined;
  typeRef?: string | undefined;
  children: ReqIfSpecHierarchy[];
  span?: SourceSpan | undefined;
}

export interface ReqIfDocument {
  header: ReqIfHeader;
  dataTypes: Map<string, ReqIfDataType>;
  specTypes: Map<string, ReqIfSpecType>;
  specObjects: Map<string, ReqIfSpecObject>;
  specRelations: ReqIfSpecRelation[];
  specifications: ReqIfSpecification[];
  rawXml?: string | undefined;
}

export interface ReqIfQuickFix {
  title: string;
  replacement: string;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export interface ReqIfDiagnostic {
  code: number;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  span?: SourceSpan | undefined;
  quickFix?: ReqIfQuickFix | undefined;
}

export interface ReqIfEntailmentResult {
  isEntailed: boolean;
  parentReqId: string;
  childReqIds: string[];
  proofManifestId?: string | undefined;
  diagnosticMessage?: string | undefined;
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/oscal — Domain types for NIST Open Security Controls Assessment Language (OSCAL 1.1.x).
 *
 * Covers all 7 NIST OSCAL models:
 * 1. Catalog
 * 2. Profile
 * 3. Component Definition
 * 4. System Security Plan (SSP)
 * 5. Assessment Plan (AP)
 * 6. Assessment Results (AR)
 * 7. Plan of Action and Milestones (POA&M)
 */

export interface OscalSourceRange {
  startOffset: number;
  endOffset: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export type OscalDiagnosticSeverity = "error" | "warning" | "info";

export interface OscalDiagnostic {
  code: string;
  rule: string;
  severity: OscalDiagnosticSeverity;
  message: string;
  range: OscalSourceRange;
}

export type OscalDocumentKind =
  | "catalog"
  | "profile"
  | "component-definition"
  | "system-security-plan"
  | "assessment-plan"
  | "assessment-results"
  | "plan-of-action-and-milestones";

export interface OscalProperty {
  name: string;
  value: string;
  ns?: string | undefined;
  class?: string | undefined;
  range?: OscalSourceRange | undefined;
}

export interface OscalLink {
  href: string;
  rel?: string | undefined;
  text?: string | undefined;
}

export interface OscalMetadata {
  title: string;
  version: string;
  oscalVersion?: string | undefined;
  lastModified?: string | undefined;
  published?: string | undefined;
  roles?: { id: string; title: string }[] | undefined;
  parties?: { uuid: string; type: string; name: string }[] | undefined;
  responsibleParties?: { roleId: string; partyUuids: string[] }[] | undefined;
  props?: OscalProperty[] | undefined;
  range?: OscalSourceRange | undefined;
}

export interface OscalParameter {
  id: string;
  label?: string | undefined;
  usage?: string | undefined;
  guidelines?: string[] | undefined;
  values?: string[] | undefined;
  select?:
    | {
        howMany?: "one" | "one-or-more" | undefined;
        choice: string[];
      }
    | undefined;
  props?: OscalProperty[] | undefined;
  range?: OscalSourceRange | undefined;
}

export interface OscalPart {
  id?: string | undefined;
  name: string;
  title?: string | undefined;
  prose?: string | undefined;
  props?: OscalProperty[] | undefined;
  parts?: OscalPart[] | undefined;
  range?: OscalSourceRange | undefined;
}

export interface OscalControl {
  id: string;
  class?: string | undefined;
  title: string;
  params?: OscalParameter[] | undefined;
  props?: OscalProperty[] | undefined;
  links?: OscalLink[] | undefined;
  parts?: OscalPart[] | undefined;
  controls?: OscalControl[] | undefined;
  family?: string | undefined;
  isOtOverlay?: boolean | undefined;
  baselines?: ("low" | "moderate" | "high" | "ot-ics")[] | undefined;
  range?: OscalSourceRange | undefined;
}

export interface OscalGroup {
  id: string;
  class?: string | undefined;
  title: string;
  props?: OscalProperty[] | undefined;
  params?: OscalParameter[] | undefined;
  parts?: OscalPart[] | undefined;
  groups?: OscalGroup[] | undefined;
  controls?: OscalControl[] | undefined;
  range?: OscalSourceRange | undefined;
}

export interface OscalProfileImport {
  href: string;
  includeAll?: boolean | undefined;
  includeControls?: string[] | undefined;
  excludeControls?: string[] | undefined;
  range?: OscalSourceRange | undefined;
}

export interface OscalSetParameter {
  paramId: string;
  values: string[];
  label?: string | undefined;
  usage?: string | undefined;
  range?: OscalSourceRange | undefined;
}

export interface OscalAlterAdd {
  position?: "before" | "after" | "starting" | "ending" | undefined;
  byId?: string | undefined;
  parts?: OscalPart[] | undefined;
  props?: OscalProperty[] | undefined;
}

export interface OscalAlterRemove {
  byName?: string | undefined;
  byId?: string | undefined;
  byClass?: string | undefined;
}

export interface OscalAlter {
  controlId: string;
  adds?: OscalAlterAdd[] | undefined;
  removes?: OscalAlterRemove[] | undefined;
  range?: OscalSourceRange | undefined;
}

export interface OscalModify {
  setParameters?: OscalSetParameter[] | undefined;
  alters?: OscalAlter[] | undefined;
}

export type OscalComponentType =
  | "hardware"
  | "software"
  | "service"
  | "interconnection"
  | "policy"
  | "ot-controller"
  | "plc"
  | "ied";

export interface OscalProtocol {
  uuid?: string | undefined;
  name: string;
  title?: string | undefined;
  portRanges?: { start: number; end: number; transport: "TCP" | "UDP" }[] | undefined;
}

export interface OscalByComponent {
  componentUuid: string;
  uuid: string;
  description: string;
  setParameters?: OscalSetParameter[] | undefined;
  implementationStatus?: "implemented" | "partial" | "planned" | "alternative" | "not-applicable" | undefined;
  range?: OscalSourceRange | undefined;
}

export interface OscalStatementImplementation {
  statementId: string;
  uuid: string;
  description?: string | undefined;
  byComponents?: OscalByComponent[] | undefined;
  range?: OscalSourceRange | undefined;
}

export interface OscalImplementedRequirement {
  uuid: string;
  controlId: string;
  description?: string | undefined;
  setParameters?: OscalSetParameter[] | undefined;
  byComponents?: OscalByComponent[] | undefined;
  statements?: OscalStatementImplementation[] | undefined;
  props?: OscalProperty[] | undefined;
  range?: OscalSourceRange | undefined;
}

export interface OscalComponentControlImplementation {
  uuid: string;
  source: string;
  description?: string | undefined;
  setParameters?: OscalSetParameter[] | undefined;
  implementedRequirements: OscalImplementedRequirement[];
}

export interface OscalComponent {
  uuid: string;
  title: string;
  description?: string | undefined;
  type: OscalComponentType;
  status?: "operational" | "under-development" | "disposition" | "other" | undefined;
  props?: OscalProperty[] | undefined;
  protocols?: OscalProtocol[] | undefined;
  responsibleRoles?: { roleId: string; partyUuids?: string[] | undefined }[] | undefined;
  controlImplementations?: OscalComponentControlImplementation[] | undefined;
  range?: OscalSourceRange | undefined;
}

export interface OscalInventoryItem {
  uuid: string;
  description: string;
  props?: OscalProperty[] | undefined;
  implementedComponents?: { componentUuid: string }[] | undefined;
  range?: OscalSourceRange | undefined;
}

export type OscalFindingSeverity = "low" | "moderate" | "high" | "critical";
export type OscalFindingStatus = "open" | "satisfied";

export interface OscalFinding {
  uuid: string;
  title: string;
  description?: string | undefined;
  targetControlId: string;
  severity: OscalFindingSeverity;
  status: OscalFindingStatus;
  relatedObservationUuids?: string[] | undefined;
  range?: OscalSourceRange | undefined;
}

export interface OscalMilestone {
  uuid: string;
  title: string;
  description?: string | undefined;
  dueDate?: string | undefined;
}

export interface OscalPoamItem {
  uuid: string;
  title: string;
  description?: string | undefined;
  relatedFindingUuid?: string | undefined;
  targetControlId?: string | undefined;
  milestones?: OscalMilestone[] | undefined;
  status: "open" | "closed" | "in-progress" | "delayed";
  range?: OscalSourceRange | undefined;
}

export interface OscalSystemCharacteristics {
  systemIds?: string[] | undefined;
  systemName: string;
  description?: string | undefined;
  securitySensitivityLevel?: "low" | "moderate" | "high" | undefined;
  status?: string | undefined;
  authorizationBoundary?: string | undefined;
}

export interface OscalSystemImplementation {
  components: OscalComponent[];
  inventoryItems?: OscalInventoryItem[] | undefined;
}

export interface OscalControlImplementation {
  description?: string | undefined;
  setParameters?: OscalSetParameter[] | undefined;
  implementedRequirements: OscalImplementedRequirement[];
}

export interface OscalDocument {
  kind: OscalDocumentKind;
  uuid: string;
  metadata: OscalMetadata;
  range: OscalSourceRange;
  uuidRange?: OscalSourceRange | undefined;

  // Catalog payload
  groups?: OscalGroup[] | undefined;
  controls?: OscalControl[] | undefined;
  params?: OscalParameter[] | undefined;

  // Profile payload
  imports?: OscalProfileImport[] | undefined;
  merge?:
    | {
        combine?: { method: "use-first" | "merge" | "keep" } | undefined;
        flat?: boolean | undefined;
        asIs?: boolean | undefined;
      }
    | undefined;
  modify?: OscalModify | undefined;

  // Component Definition payload
  components?: OscalComponent[] | undefined;

  // System Security Plan (SSP) payload
  importProfile?: { href: string; range?: OscalSourceRange | undefined } | undefined;
  systemCharacteristics?: OscalSystemCharacteristics | undefined;
  systemImplementation?: OscalSystemImplementation | undefined;
  controlImplementation?: OscalControlImplementation | undefined;

  // Assessment Plan (AP) payload
  importSsp?: { href: string } | undefined;
  reviewedControls?:
    | {
        includeAll?: boolean | undefined;
        includeControls?: string[] | undefined;
        excludeControls?: string[] | undefined;
      }
    | undefined;

  // Assessment Results (AR) & POA&M payload
  importAp?: { href: string } | undefined;
  findings?: OscalFinding[] | undefined;
  poamItems?: OscalPoamItem[] | undefined;
}

export interface OscalResolvedControl extends OscalControl {
  resolvedProse: string;
  resolvedParameters: Record<string, string>;
  unresolvedParameters: string[];
}

export interface OscalResolvedCatalog {
  uuid: string;
  metadata: OscalMetadata;
  controls: OscalResolvedControl[];
  groups: OscalGroup[];
  parameterValues: Record<string, string>;
  unresolvedControlIds: string[];
}

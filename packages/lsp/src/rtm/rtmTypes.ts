// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Domain categories participating in the multi-tier Digital Thread.
 */
export type RtmDomain =
  | "hazard"
  | "requirement"
  | "sysml_logical"
  | "sysml_port"
  | "sysml_activity"
  | "physical_component"
  | "modelica_physics"
  | "verification_case"
  | "test_run";

/**
 * Semantic kind of traceability connection.
 */
export type RtmLinkKind = "mitigate" | "satisfy" | "verify" | "allocate" | "refine" | "derive" | "connect";

/**
 * Standard MBSE 2D matrix configuration presets.
 */
export type RtmPresetKind =
  | "allocations"
  | "requirements_satisfy"
  | "verification_matrix"
  | "interface_n2"
  | "derivation_matrix"
  | "risk_mitigation";

export interface RtmPresetDefinition {
  id: RtmPresetKind;
  title: string;
  rowDomain: RtmDomain;
  colDomain: RtmDomain;
  defaultLinkKind: RtmLinkKind;
  description: string;
}

export const STANDARD_MATRIX_PRESETS: RtmPresetDefinition[] = [
  {
    id: "allocations",
    title: "Allocation Matrix (Logical vs Physical)",
    rowDomain: "sysml_logical",
    colDomain: "physical_component",
    defaultLinkKind: "allocate",
    description:
      "Allocates logical functions, actions, and architectural parts to physical hardware/software components.",
  },
  {
    id: "requirements_satisfy",
    title: "Requirements Satisfaction Matrix",
    rowDomain: "sysml_logical",
    colDomain: "requirement",
    defaultLinkKind: "satisfy",
    description: "Maps architectural blocks and behavioral elements to the requirements they satisfy.",
  },
  {
    id: "verification_matrix",
    title: "Verification & Analysis Matrix",
    rowDomain: "verification_case",
    colDomain: "requirement",
    defaultLinkKind: "verify",
    description: "Tracks verification cases, analysis cases, and test benches verifying system requirements.",
  },
  {
    id: "interface_n2",
    title: "Interface N² Connectivity Matrix",
    rowDomain: "sysml_port",
    colDomain: "sysml_port",
    defaultLinkKind: "connect",
    description: "Displays port-to-port connections and flow interfaces across subsystem boundaries.",
  },
  {
    id: "derivation_matrix",
    title: "Requirements Derivation & Refinement",
    rowDomain: "requirement",
    colDomain: "requirement",
    defaultLinkKind: "refine",
    description: "Visualizes parent-child requirement derivation and decomposition hierarchies.",
  },
  {
    id: "risk_mitigation",
    title: "Risk & Hazard Mitigation Matrix (ISO 14971)",
    rowDomain: "hazard",
    colDomain: "requirement",
    defaultLinkKind: "mitigate",
    description: "Correlates ISO 14971 hazards with the functional safety requirements mitigating them.",
  },
];

/**
 * Live verification and health status of a trace link.
 */
export type RtmLinkStatus = "passed" | "failed" | "pending" | "suspect" | "unverified";

/**
 * ISO 14971 quantitative risk evaluation and mitigation record.
 */
export interface Iso14971Hazard {
  id: string;
  hazardId: string;
  name: string;
  description?: string;
  initialSeverity: number; // 1-5 (Negligible to Catastrophic)
  initialProbability: number; // 1-5 (Improbable to Frequent)
  initialRpn: number; // Severity * Probability (1-25)
  initialAcceptability: "Broadly Acceptable" | "ALARP" | "Unacceptable";
  mitigationRequirementIds: string[];
  mitigationRequirements?: string[];
  residualSeverity: number;
  residualProbability: number;
  residualRpn: number;
  residualAcceptability: "Broadly Acceptable" | "ALARP" | "Unacceptable";
  status: "Unmitigated" | "Mitigated" | "Verified";
}

/**
 * FMECA Failure Mode, Effects, and Criticality Analysis line item.
 */
export interface FmecaRiskRecord {
  itemOrFunction: string;
  failureMode: string;
  potentialEffects: string;
  causes: string;
  initialSeverity: number;
  initialOccurrence: number;
  initialRpn: number;
  mitigationMeasure: string;
  mitigationRequirementId?: string;
  residualSeverity: number;
  residualOccurrence: number;
  residualRpn: number;
  rpnReductionPercentage: number;
  status: "open" | "mitigated" | "verified";
}

/**
 * An indexed element participating as a row or column in the RTM.
 */
export interface RtmElement {
  id: number;
  qualifiedName: string;
  name: string;
  domain: RtmDomain;
  type: string;
  uri: string;
  startByte: number;
  endByte: number;
  metadata: {
    reqId?: string;
    hazardId?: string;
    text?: string;
    category?: string;
    allocatedTo?: string[];
    iso14971?: Partial<Iso14971Hazard>;
    [key: string]: any;
  };
}

/**
 * Quantitative verification evidence attached to a trace link.
 */
export interface RtmVerificationEvidence {
  solverType: "simplex_smt" | "sundials_dae" | "fuml" | "flowpipe_reachability" | "structural";
  isSatisfied: boolean;
  margin?: number;
  peakValue?: number;
  limitValue?: number;
  violationTime?: number;
  counterexample?: Record<string, number> | number;
  unsatCore?: string[];
  reason?: string;
  timestamp: number;
}

/**
 * A directional link between two elements across the digital thread.
 */
export interface RtmLink {
  id: string;
  linkKind: RtmLinkKind;
  sourceId: number;
  sourceName: string;
  sourceUri: string;
  targetId: number;
  targetName: string;
  targetUri: string;
  status: RtmLinkStatus;
  evidence?: RtmVerificationEvidence;
  isSuspect: boolean;
  suspectReason?: string;
  declarationUri?: string;
  declarationStartByte?: number;
  declarationEndByte?: number;
}

/**
 * Aggregate metrics and digital thread health analytics.
 */
export interface RtmAnalytics {
  totalRequirements: number;
  satisfiedCount: number;
  satisfiedPercentage: number;
  verifiedCount: number;
  verifiedPercentage: number;
  orphanRequirements: string[];
  unallocatedComponents: string[];
  suspectLinkCount: number;
  failingLinkCount: number;
  // ISO 14971 Risk Analytics
  totalHazards?: number;
  mitigatedHazardsCount?: number;
  unmitigatedHazardsCount?: number;
  unacceptableResidualRiskCount?: number;
  averageRpnReduction?: number;
}

/**
 * The 2D matrix payload sent to the interactive webview.
 */
export interface RtmMatrixPayload {
  rowDomain: RtmDomain;
  colDomain: RtmDomain;
  rows: RtmElement[];
  cols: RtmElement[];
  links: Record<string, RtmLink>;
  analytics: RtmAnalytics;
}

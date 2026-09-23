// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Domain categories participating in the multi-tier Digital Thread.
 */
export type RtmDomain = "requirement" | "sysml_logical" | "modelica_physics" | "verification_case" | "test_run";

/**
 * Semantic kind of traceability connection.
 */
export type RtmLinkKind = "satisfy" | "verify" | "allocate" | "refine" | "derive";

/**
 * Live verification and health status of a trace link.
 */
export type RtmLinkStatus = "passed" | "failed" | "pending" | "suspect" | "unverified";

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
    text?: string;
    category?: string;
    allocatedTo?: string[];
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

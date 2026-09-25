// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * OASIS SARIF (Static Analysis Results Interchange Format) v2.1.0 Reporter
 * for ModelScript Unified Verification.
 *
 * Produces standard SARIF output compatible with GitHub code scanning,
 * CI/CD security tabs, and static analysis dashboards.
 */

export interface SarifPhysicalLocation {
  artifactLocation: {
    uri: string;
    uriBaseId?: string;
  };
  region?: {
    startLine?: number;
    startColumn?: number;
    endLine?: number;
    endColumn?: number;
  };
}

export interface SarifResult {
  ruleId: string;
  ruleIndex?: number;
  level: "error" | "warning" | "note" | "none";
  message: {
    text: string;
  };
  locations?: {
    physicalLocation: SarifPhysicalLocation;
  }[];
  properties?: Record<string, any>;
}

export interface SarifRule {
  id: string;
  name: string;
  shortDescription: {
    text: string;
  };
  fullDescription?: {
    text: string;
  };
  defaultConfiguration?: {
    level: "error" | "warning" | "note";
  };
  helpUri?: string;
}

export interface SarifReport {
  $schema: "https://json.schemastore.org/sarif-2.1.0.json";
  version: "2.1.0";
  runs: {
    tool: {
      driver: {
        name: string;
        version: string;
        informationUri: string;
        rules: SarifRule[];
      };
    };
    results: SarifResult[];
  }[];
}

export interface SarifVerificationReportInput {
  target?: string;
  stages: Record<
    string,
    {
      stage: string;
      name: string;
      passed: boolean;
      certified?: boolean;
      violations?: {
        id?: string;
        message: string;
        severity?: "error" | "warning" | "note";
        location?: {
          uri?: string;
          line?: number;
          column?: number;
          endLine?: number;
          endColumn?: number;
        };
        witness?: any;
      }[];
    }
  >;
}

/**
 * Standard SARIF rules for formal verification checks.
 */
const DEFAULT_RULES: Record<string, SarifRule> = {
  "MSC-VERIFY-DECISION-GAP": {
    id: "MSC-VERIFY-DECISION-GAP",
    name: "DecisionTableUncoveredGap",
    shortDescription: { text: "Uncovered operational gap in decision table logic." },
    fullDescription: {
      text: "The decision logic fails to handle one or more valid input state combinations, creating an uncovered boundary condition.",
    },
    defaultConfiguration: { level: "error" },
  },
  "MSC-VERIFY-DECISION-OVERLAP": {
    id: "MSC-VERIFY-DECISION-OVERLAP",
    name: "DecisionTableNonDeterministicOverlap",
    shortDescription: { text: "Non-deterministic overlapping branches in decision table logic." },
    defaultConfiguration: { level: "error" },
  },
  "MSC-VERIFY-CONTRACT-VIOLATION": {
    id: "MSC-VERIFY-CONTRACT-VIOLATION",
    name: "ContractRefinementViolation",
    shortDescription: { text: "Assume-Guarantee contract compatibility or refinement failure." },
    defaultConfiguration: { level: "error" },
  },
  "MSC-VERIFY-STATE-DEADLOCK": {
    id: "MSC-VERIFY-STATE-DEADLOCK",
    name: "StateMachineDeadlockOrSoundnessViolation",
    shortDescription: { text: "Deadlock, unreachable state, or activity workflow soundness violation." },
    defaultConfiguration: { level: "error" },
  },
  "MSC-VERIFY-FLOWPIPE-UNSAFE": {
    id: "MSC-VERIFY-FLOWPIPE-UNSAFE",
    name: "ReachabilityFlowpipeSafetyViolation",
    shortDescription: { text: "Continuous or hybrid reachability tube violates invariant safety bounds." },
    defaultConfiguration: { level: "error" },
  },
  "MSC-VERIFY-BARRIER-FAILURE": {
    id: "MSC-VERIFY-BARRIER-FAILURE",
    name: "BarrierCertificateInfeasible",
    shortDescription: { text: "Sum-of-squares barrier or Lyapunov certificate could not be synthesized." },
    defaultConfiguration: { level: "warning" },
  },
  "MSC-VERIFY-TRAJECTORY-VIOLATION": {
    id: "MSC-VERIFY-TRAJECTORY-VIOLATION",
    name: "TrajectoryRequirementViolation",
    shortDescription: { text: "Dynamic simulation trajectory violates a formal requirement constraint." },
    defaultConfiguration: { level: "error" },
  },
  "MSC-VERIFY-CAD-COLLISION": {
    id: "MSC-VERIFY-CAD-COLLISION",
    name: "AssemblyClearanceCollision",
    shortDescription: { text: "Geometric collision or clearance violation between physical parts." },
    defaultConfiguration: { level: "error" },
  },
  "MSC-VERIFY-ALGO-DEFECT": {
    id: "MSC-VERIFY-ALGO-DEFECT",
    name: "AlgorithmicDefiniteRunTimeError",
    shortDescription: {
      text: "Definite run-time defect (array out-of-bounds, division-by-zero, invalid math domain, or uninitialized read) formally proven.",
    },
    fullDescription: {
      text: "Abstract interpretation proved that this operation will always or unconditionally fail at run-time.",
    },
    defaultConfiguration: { level: "error" },
  },
  "MSC-VERIFY-ALGO-UNPROVEN": {
    id: "MSC-VERIFY-ALGO-UNPROVEN",
    name: "AlgorithmicUnprovenCondition",
    shortDescription: { text: "Potential run-time error could not be formally proven safe." },
    fullDescription: {
      text: "Abstract interpretation domain reached a state where safety invariants could not be strictly guaranteed.",
    },
    defaultConfiguration: { level: "warning" },
  },
  "MSC-VERIFY-GENERAL": {
    id: "MSC-VERIFY-GENERAL",
    name: "FormalVerificationViolation",
    shortDescription: { text: "Formal verification safety violation." },
    defaultConfiguration: { level: "error" },
  },
};

/**
 * Generates an OASIS SARIF v2.1.0 object from verification report input.
 */
export function generateSarifReport(report: SarifVerificationReportInput, toolVersion: string = "0.1.0"): SarifReport {
  const rulesMap = new Map<string, SarifRule>(Object.entries(DEFAULT_RULES));
  const results: SarifResult[] = [];

  for (const [stageKey, stageResult] of Object.entries(report.stages)) {
    if (!stageResult.violations || stageResult.violations.length === 0) continue;

    for (const v of stageResult.violations) {
      let ruleId = v.id || `MSC-VERIFY-${stageKey.toUpperCase()}`;
      if (!rulesMap.has(ruleId)) {
        // Fallback or mapped rule
        if (stageKey === "decisions") ruleId = "MSC-VERIFY-DECISION-GAP";
        else if (stageKey === "contracts") ruleId = "MSC-VERIFY-CONTRACT-VIOLATION";
        else if (stageKey === "stateMachines") ruleId = "MSC-VERIFY-STATE-DEADLOCK";
        else if (stageKey === "flowpipes") ruleId = "MSC-VERIFY-FLOWPIPE-UNSAFE";
        else if (stageKey === "barriers") ruleId = "MSC-VERIFY-BARRIER-FAILURE";
        else if (stageKey === "trajectories" || stageKey === "simulation") ruleId = "MSC-VERIFY-TRAJECTORY-VIOLATION";
        else if (stageKey === "clearance") ruleId = "MSC-VERIFY-CAD-COLLISION";
        else if (stageKey === "algorithms")
          ruleId = v.severity === "error" ? "MSC-VERIFY-ALGO-DEFECT" : "MSC-VERIFY-ALGO-UNPROVEN";
        else ruleId = "MSC-VERIFY-GENERAL";
      }

      const level: "error" | "warning" | "note" =
        v.severity === "warning" ? "warning" : v.severity === "note" ? "note" : "error";

      const locUri = v.location?.uri || report.target || "workspace";
      const sarifResult: SarifResult = {
        ruleId,
        level,
        message: { text: v.message },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: locUri },
              region: v.location?.line
                ? {
                    startLine: v.location.line,
                    startColumn: v.location.column || 1,
                    endLine: v.location.endLine || v.location.line,
                    endColumn: v.location.endColumn || 80,
                  }
                : undefined,
            },
          },
        ],
        properties: {
          stage: stageKey,
          stageName: stageResult.name,
          witness: v.witness,
        },
      };

      results.push(sarifResult);
    }
  }

  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "ModelScript Formal Verifier",
            version: toolVersion,
            informationUri: "https://modelscript.dev/docs/formal-verification",
            rules: Array.from(rulesMap.values()),
          },
        },
        results,
      },
    ],
  };
}

/**
 * Returns serialized JSON string of the SARIF report.
 */
export function exportToSarifString(report: SarifVerificationReportInput, toolVersion: string = "0.1.0"): string {
  return JSON.stringify(generateSarifReport(report, toolVersion), null, 2);
}

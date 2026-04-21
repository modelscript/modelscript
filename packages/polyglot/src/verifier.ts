import type { QueryDB, SymbolEntry } from "./runtime.js";
import type { SimulationResult } from "./simulation.js";

/**
 * Result of verifying a requirement constraint against a dynamic simulation run.
 */
export interface VerificationResult {
  requirementId: number;
  constraintId: number;
  isSatisfied: boolean;
  /** Array of boolean values over time, or a single boolean if static */
  timeSeriesResult?: boolean[];
  message?: string;
}

/**
 * Orchestrator that uses a query engine to extract SysML v2 topologies,
 * delegates to a simulator (Modelica) to get time-series results, and then
 * evaluates the SysML v2 VerificationCase usages against the trajectories.
 */
export class VerificationRunner {
  constructor(private db: QueryDB) {}

  /**
   * Evaluates a constraint AST against a specific timestep of simulation results.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  evaluateConstraintAtTime(constraint: SymbolEntry, simResult: SimulationResult, timeIndex: number): boolean {
    // Basic simulation-backed evaluator stub.
    // In a full implementation, this parses the constraint expression AST
    // and looks up variables in the `simResult.states` list to get the value
    // at `simResult.y[timeIndex]`.
    return true;
  }

  /**
   * Run a full verification suite against a VerificationCaseUsage symbol.
   */
  verifyCase(verifyCaseId: number, simResult: SimulationResult): VerificationResult[] {
    const results: VerificationResult[] = [];
    const db = this.db;

    // 1. Find all `VerifyRequirementUsage` children
    const verifyMembers = db.childrenOf(verifyCaseId).filter((c) => c.ruleName === "VerifyRequirementUsage");

    for (const vMember of verifyMembers) {
      if (!vMember.name) continue;

      // 2. Discover target Requirement
      const targets = db.byName(vMember.name);
      const reqTarget = targets.find(
        (t) => t.ruleName === "RequirementDefinition" || t.ruleName === "RequirementUsage",
      );

      if (!reqTarget) continue;

      // 3. Find requirement constraints
      const reqConstraints = db.childrenOf(reqTarget.id).filter((c) => c.ruleName === "RequirementConstraintUsage");

      // 4. Evaluate each constraint against simulation timeline
      for (const constraint of reqConstraints) {
        let allMet = true;
        const timeSeriesResult: boolean[] = [];

        for (let i = 0; i < simResult.t.length; i++) {
          const metAtTime = this.evaluateConstraintAtTime(constraint, simResult, i);
          timeSeriesResult.push(metAtTime);
          if (!metAtTime) allMet = false;
        }

        results.push({
          requirementId: reqTarget.id,
          constraintId: constraint.id,
          isSatisfied: allMet,
          timeSeriesResult,
        });
      }
    }

    return results;
  }
}

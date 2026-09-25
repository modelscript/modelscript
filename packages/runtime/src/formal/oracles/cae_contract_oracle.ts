// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — CAE Simulation & Surrogate Contract Verification Oracle.
 *
 * Implements a First-Order Logic (FOL) formal contract theory oracle for the
 * Generalized Nelson-Oppen SemanticTheoryCoordinator. Verifies:
 *   1. FEA Structural Integrity contracts (e.g. max von Mises stress <= allowable limit).
 *   2. CFD Aerodynamic Performance contracts (e.g. drag coefficient Cd <= target, lift-to-drag L/D >= min).
 *   3. Deflection & Clearance contracts (max displacement <= limit).
 *   4. Synchronization with DigitalThreadHypergraph for closed-loop multi-domain alignment.
 */

import { DigitalThreadHypergraph, ThreadRelation } from "../../interop/thread_hypergraph.js";
import {
  type ConflictClause,
  type SharedEquality,
  type TheoryLiteral,
  type TheoryOracle,
} from "../theory_coordinator.js";

export interface CaeScalarContractSpec {
  contractId: string;
  metricName: string;
  actualValue: number;
  threshold: number;
  operator: "<=" | "<" | ">=" | ">" | "==";
  unit?: string;
  sourceRunId?: string | number;
  partName?: string;
  sysmlRequirementId?: string;
  hypergraphThreadId?: number;
}

export interface CaeContractStatus {
  contractId: string;
  metricName: string;
  actualValue: number;
  threshold: number;
  operator: string;
  unit?: string;
  isSatisfied: boolean;
  marginPercent: number;
  explanation: string;
}

export class CaeContractOracle implements TheoryOracle {
  public readonly name = "CaeContractOracle";
  public readonly domain = "spatial_physics" as const;

  private contracts = new Map<string, CaeScalarContractSpec>();
  private externalBounds = new Map<string, [number, number]>();
  private assertedLiterals = new Map<number, TheoryLiteral>();
  private nextLiteralId = 30000;

  private levelStack: {
    contracts: Map<string, CaeScalarContractSpec>;
    externalBounds: Map<string, [number, number]>;
    assertedLitIds: number[];
  }[] = [];

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.contracts.clear();
    this.externalBounds.clear();
    this.assertedLiterals.clear();
    this.levelStack = [];
  }

  public pushLevel(): void {
    this.levelStack.push({
      contracts: new Map(this.contracts),
      externalBounds: new Map(this.externalBounds),
      assertedLitIds: [],
    });
  }

  public popLevel(): void {
    const top = this.levelStack.pop();
    if (!top) return;
    this.contracts = top.contracts;
    this.externalBounds = top.externalBounds;
    for (const litId of top.assertedLitIds) {
      this.assertedLiterals.delete(litId);
    }
  }

  /**
   * Strongly typed assertion for a CAE scalar simulation contract.
   */
  public assertContract(spec: CaeScalarContractSpec): void {
    this.assertLiteral({
      id: this.nextLiteralId++,
      predicate: "caeContract",
      args: [spec],
      domain: this.domain,
    });
  }

  // --- TheoryOracle implementation ---

  public assertLiteral(lit: TheoryLiteral): boolean {
    this.assertedLiterals.set(lit.id, lit);
    if (this.levelStack.length > 0) {
      this.levelStack[this.levelStack.length - 1]!.assertedLitIds.push(lit.id);
    }

    if (lit.predicate === "caeContract") {
      const spec = lit.args[0] as CaeScalarContractSpec;
      if (spec && spec.contractId) {
        this.contracts.set(spec.contractId, { ...spec });
      }
    }
    return true;
  }

  public retractLiteral(litId: number): void {
    if (!this.assertedLiterals.has(litId)) return;
    this.assertedLiterals.delete(litId);
    const remaining = Array.from(this.assertedLiterals.values());
    this.reset();
    for (const lit of remaining) {
      this.assertLiteral(lit);
    }
  }

  public checkSat(): { isSat: boolean; conflict?: ConflictClause } {
    for (const [id, spec] of this.contracts.entries()) {
      const isSatisfied = this.evaluateCondition(spec.actualValue, spec.operator, spec.threshold);
      if (!isSatisfied) {
        const culprits = [id];
        if (spec.partName) culprits.push(spec.partName);
        if (spec.sysmlRequirementId) culprits.push(spec.sysmlRequirementId);
        if (spec.sourceRunId !== undefined) culprits.push(`Run#${spec.sourceRunId}`);

        const unitStr = spec.unit ? ` ${spec.unit}` : "";
        const delta = Math.abs(spec.actualValue - spec.threshold);
        return {
          isSat: false,
          conflict: {
            literals: Array.from(this.assertedLiterals.values()).filter((l) =>
              l.args.some((a) => a?.contractId === id),
            ),
            explanation: `CAE Contract Violation: Contract '${id}' on '${spec.metricName}' failed. Actual simulated value ${spec.actualValue}${unitStr} violates requirement ${spec.operator} ${spec.threshold}${unitStr} by ${delta.toFixed(4)}${unitStr}.`,
            culpritEntities: culprits,
            theoryName: this.name,
          },
        };
      }
    }

    return { isSat: true };
  }

  public propagateEqualities(): SharedEquality[] {
    const equalities: SharedEquality[] = [];
    for (const [id, spec] of this.contracts.entries()) {
      equalities.push({
        varA: `${id}.${spec.metricName}`,
        varB: `${id}.${spec.metricName}`,
        domain: "interval",
        bounds: [spec.actualValue, spec.actualValue],
        explanation: `Simulated CAE output ${spec.metricName} = ${spec.actualValue} for contract '${id}'`,
        sourceOracle: this.name,
      });
    }
    return equalities;
  }

  public onSharedEquality(eq: SharedEquality): void {
    if (eq.bounds) {
      this.externalBounds.set(eq.varA, [...eq.bounds]);
    }
  }

  public getModel(): Record<string, CaeContractStatus> {
    const model: Record<string, CaeContractStatus> = {};
    for (const [id, spec] of this.contracts.entries()) {
      const isSatisfied = this.evaluateCondition(spec.actualValue, spec.operator, spec.threshold);
      let margin = 0.0;
      if (spec.threshold !== 0) {
        margin = ((spec.threshold - spec.actualValue) / Math.abs(spec.threshold)) * 100.0;
      }
      const unitStr = spec.unit ? ` ${spec.unit}` : "";
      model[id] = {
        contractId: id,
        metricName: spec.metricName,
        actualValue: spec.actualValue,
        threshold: spec.threshold,
        operator: spec.operator,
        unit: spec.unit,
        isSatisfied,
        marginPercent: margin,
        explanation: isSatisfied
          ? `Contract '${id}' SATISFIED (${spec.actualValue}${unitStr} ${spec.operator} ${spec.threshold}${unitStr}, margin: ${margin.toFixed(1)}%)`
          : `Contract '${id}' VIOLATED (${spec.actualValue}${unitStr} violates ${spec.operator} ${spec.threshold}${unitStr})`,
      };
    }
    return model;
  }

  /**
   * Synchronizes contract verdicts directly into a DigitalThreadHypergraph instance.
   */
  public syncToHypergraph(hypergraph: DigitalThreadHypergraph): {
    syncedThreads: number[];
    conflictedThreads: number[];
  } {
    const syncedThreads: number[] = [];
    const conflictedThreads: number[] = [];

    for (const [id, spec] of this.contracts.entries()) {
      if (spec.hypergraphThreadId !== undefined) {
        let slot = hypergraph.findSlotByThreadId(spec.hypergraphThreadId);
        if (slot === undefined) {
          slot = hypergraph.createThread(spec.hypergraphThreadId, 0, ThreadRelation.Verifies);
        }

        const isSatisfied = this.evaluateCondition(spec.actualValue, spec.operator, spec.threshold);
        if (isSatisfied) {
          hypergraph.recordTheorySat(slot);
          syncedThreads.push(spec.hypergraphThreadId);
        } else {
          hypergraph.recordTheoryConflict(slot, {
            theoryName: this.name,
            explanation: `Contract '${id}' violated: ${spec.actualValue} exceeds threshold ${spec.threshold}`,
            culpritEntities: [id],
            literals: [],
          });
          conflictedThreads.push(spec.hypergraphThreadId);
        }
      }
    }

    return {
      syncedThreads,
      conflictedThreads,
    };
  }

  private evaluateCondition(actual: number, op: string, threshold: number): boolean {
    switch (op) {
      case "<=":
        return actual <= threshold + 1e-9;
      case "<":
        return actual < threshold;
      case ">=":
        return actual >= threshold - 1e-9;
      case ">":
        return actual > threshold;
      case "==":
        return Math.abs(actual - threshold) < 1e-6;
      default:
        return false;
    }
  }
}

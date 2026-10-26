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
  unit?: string | undefined;
  sourceRunId?: string | number | undefined;
  partName?: string | undefined;
  sysmlRequirementId?: string | undefined;
  hypergraphThreadId?: number | undefined;
}

export interface CaeContractStatus {
  contractId: string;
  metricName: string;
  actualValue: number;
  threshold: number;
  operator: string;
  unit?: string | undefined;
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

  /**
   * Asserts an FEA structural stress / yield contract (von Mises stress <= yield strength or limit).
   */
  public assertFeaStressContract(spec: {
    partName?: string | undefined;
    contractId?: string | undefined;
    maxVonMisesStressPa: number;
    yieldStrengthPa: number;
    maxDisplacementM?: number | undefined;
    maxAllowableDisplacementM?: number | undefined;
    sysmlRequirementId?: string | undefined;
  }): void {
    const part = spec.partName || "part";
    const cid = spec.contractId || `FEA_${part}_Stress`;
    this.assertContract({
      contractId: cid,
      metricName: "von_mises_stress",
      actualValue: spec.maxVonMisesStressPa,
      threshold: spec.yieldStrengthPa,
      operator: "<=",
      unit: "Pa",
      partName: part,
      sysmlRequirementId: spec.sysmlRequirementId,
    });

    if (spec.maxDisplacementM !== undefined && spec.maxAllowableDisplacementM !== undefined) {
      this.assertContract({
        contractId: `${cid}_Displacement`,
        metricName: "max_displacement",
        actualValue: spec.maxDisplacementM,
        threshold: spec.maxAllowableDisplacementM,
        operator: "<=",
        unit: "m",
        partName: part,
        sysmlRequirementId: spec.sysmlRequirementId,
      });
    }
  }

  /**
   * Asserts a CFD aerodynamic contract (drag coefficient <= target, L/D >= min, etc.).
   */
  public assertCfdAerodynamicContract(spec: {
    partName?: string | undefined;
    contractId?: string | undefined;
    dragCoeff?: number | undefined;
    maxDragCoeff?: number | undefined;
    liftDragRatio?: number | undefined;
    minLiftDragRatio?: number | undefined;
    pressureDropPa?: number | undefined;
    maxPressureDropPa?: number | undefined;
    machNumber?: number | undefined;
    maxMachNumber?: number | undefined;
    sysmlRequirementId?: string | undefined;
  }): void {
    const part = spec.partName || "aerodynamic_body";
    const baseId = spec.contractId || `CFD_${part}`;

    if (spec.dragCoeff !== undefined && spec.maxDragCoeff !== undefined) {
      this.assertContract({
        contractId: `${baseId}_Cd`,
        metricName: "drag_coeff",
        actualValue: spec.dragCoeff,
        threshold: spec.maxDragCoeff,
        operator: "<=",
        unit: "",
        partName: part,
        sysmlRequirementId: spec.sysmlRequirementId,
      });
    }

    if (spec.liftDragRatio !== undefined && spec.minLiftDragRatio !== undefined) {
      this.assertContract({
        contractId: `${baseId}_LiftDrag`,
        metricName: "lift_drag_ratio",
        actualValue: spec.liftDragRatio,
        threshold: spec.minLiftDragRatio,
        operator: ">=",
        unit: "",
        partName: part,
        sysmlRequirementId: spec.sysmlRequirementId,
      });
    }

    if (spec.pressureDropPa !== undefined && spec.maxPressureDropPa !== undefined) {
      this.assertContract({
        contractId: `${baseId}_DeltaP`,
        metricName: "pressure_drop",
        actualValue: spec.pressureDropPa,
        threshold: spec.maxPressureDropPa,
        operator: "<=",
        unit: "Pa",
        partName: part,
        sysmlRequirementId: spec.sysmlRequirementId,
      });
    }

    if (spec.machNumber !== undefined && spec.maxMachNumber !== undefined) {
      this.assertContract({
        contractId: `${baseId}_Mach`,
        metricName: "mach_number",
        actualValue: spec.machNumber,
        threshold: spec.maxMachNumber,
        operator: "<=",
        unit: "",
        partName: part,
        sysmlRequirementId: spec.sysmlRequirementId,
      });
    }
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

  public checkSat(): { isSat: boolean; conflict?: ConflictClause | undefined } {
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

      // Check cross-theory external bounds from cooperating oracles (Nelson-Oppen consistency)
      const contractVar = `${id}.${spec.metricName}`;
      const physicalVar = spec.partName ? `${spec.partName}.${spec.metricName}` : spec.metricName;
      const extBound =
        this.externalBounds.get(contractVar) ??
        this.externalBounds.get(physicalVar) ??
        this.externalBounds.get(spec.metricName);

      if (extBound) {
        const [lo, hi] = extBound;
        if (spec.actualValue < lo - 1e-6 || spec.actualValue > hi + 1e-6) {
          const culprits = [id];
          if (spec.partName) culprits.push(spec.partName);
          return {
            isSat: false,
            conflict: {
              literals: Array.from(this.assertedLiterals.values()).filter((l) =>
                l.args.some((a) => a?.contractId === id),
              ),
              explanation: `CAE Contract Cross-Theory Bound Violation: Contract '${id}' on '${spec.metricName}' has actual simulated value ${spec.actualValue}, violating external cooperating theory bounds [${lo}, ${hi}].`,
              culpritEntities: culprits,
              theoryName: this.name,
            },
          };
        }
      }
    }

    return { isSat: true };
  }

  public propagateEqualities(): SharedEquality[] {
    const equalities: SharedEquality[] = [];
    for (const [id, spec] of this.contracts.entries()) {
      const contractVar = `${id}.${spec.metricName}`;
      const physicalVar = spec.partName ? `${spec.partName}.${spec.metricName}` : spec.metricName;

      // 1. Relational equality between contract endpoint and physical property
      equalities.push({
        varA: contractVar,
        varB: physicalVar,
        domain: "real",
        bounds: [spec.actualValue, spec.actualValue],
        explanation: `Simulated CAE output ${spec.metricName} = ${spec.actualValue} for contract '${id}' on '${physicalVar}'`,
        sourceOracle: this.name,
      });

      // 2. Canonical interval bound on physical entity property if distinct
      if (physicalVar !== contractVar) {
        equalities.push({
          varA: physicalVar,
          varB: physicalVar,
          domain: "interval",
          bounds: [spec.actualValue, spec.actualValue],
          explanation: `Simulated CAE bound on '${physicalVar}' = [${spec.actualValue}, ${spec.actualValue}]`,
          sourceOracle: this.name,
        });
      }

      // 3. Domain-prefixed metric aliases for multi-domain requirements
      if (spec.metricName === "von_mises_stress" || spec.metricName === "max_displacement") {
        equalities.push({
          varA: `fea.${spec.metricName}`,
          varB: physicalVar,
          domain: "real",
          bounds: [spec.actualValue, spec.actualValue],
          explanation: `FEA global ${spec.metricName} is ${spec.actualValue}`,
          sourceOracle: this.name,
        });
      } else if (
        spec.metricName === "drag_coeff" ||
        spec.metricName === "lift_drag_ratio" ||
        spec.metricName === "pressure_drop" ||
        spec.metricName === "mach_number"
      ) {
        equalities.push({
          varA: `cfd.${spec.metricName}`,
          varB: physicalVar,
          domain: "real",
          bounds: [spec.actualValue, spec.actualValue],
          explanation: `CFD global ${spec.metricName} is ${spec.actualValue}`,
          sourceOracle: this.name,
        });
      }
    }
    return equalities;
  }

  public onSharedEquality(eq: SharedEquality): void {
    if (eq.bounds) {
      this.externalBounds.set(eq.varA, [...eq.bounds]);
      if (eq.varB && eq.varB !== eq.varA) {
        this.externalBounds.set(eq.varB, [...eq.bounds]);
      }
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

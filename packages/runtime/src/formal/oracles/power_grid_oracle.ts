// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Power Grid & High-Voltage Theory Oracle.
 *
 * Implements a First-Order Logic (FOL) decision procedure for the Generalized
 * Nelson-Oppen SemanticTheoryCoordinator. Verifies:
 *   1. PSS/E AC power flow bus voltage boundaries (V_min <= V_m <= V_max, nominal 0.95–1.05 p.u.).
 *   2. Generator reactive power capability limits (Q_min <= Q_g <= Q_max).
 *   3. Transmission line / transformer MVA thermal branch loading (Loading <= 100%).
 *   4. IEEE 2800-2022 / NERC PRC-029-1 grid-code transmission ride-through contracts:
 *      - Low-Voltage Ride-Through (LVRT) & High-Voltage Ride-Through (HVRT)
 *      - Frequency Ride-Through (FRT: 47.5 Hz <= f <= 52.0 Hz)
 *      - Symmetrical negative-sequence reactive current injection droop (k2 >= 2.0)
 *      - Total Harmonic Distortion limits (THD <= 5.0%)
 *
 * Exchanges shared bounds, equalities, and conflict clauses via the Nelson-Oppen bus.
 */

import type { ConflictClause, SharedEquality, TheoryLiteral, TheoryOracle } from "../theory_coordinator.js";

export interface BusVoltageSpec {
  busId: string | number;
  actualVm: number; // Voltage magnitude in p.u.
  minVm: number; // Allowable lower bound in p.u. (default: 0.95)
  maxVm: number; // Allowable upper bound in p.u. (default: 1.05)
  baseKv?: number | undefined;
  busName?: string | undefined;
}

export interface ReactivePowerSpec {
  genId: string | number;
  busId: string | number;
  actualQgMvar: number;
  minQgMvar: number;
  maxQgMvar: number;
}

export interface BranchLoadingSpec {
  fromBus: number;
  toBus: number;
  circuitId?: string | undefined;
  actualMva: number;
  rateMva: number;
  loadingPercent: number; // actualMva / rateMva * 100
}

export interface Ieee2800ClauseSpec {
  clause: string;
  name: string;
  isCompliant: boolean;
  actualValue: number;
  threshold: number;
  operator: "<=" | "<" | ">=" | ">" | "==";
  unit: string;
  explanation?: string | undefined;
}

export class PowerGridTheoryOracle implements TheoryOracle {
  public readonly name = "PowerGridTheoryOracle";
  public readonly domain = "constraint" as const;

  private busVoltages = new Map<string, BusVoltageSpec>();
  private reactivePowers = new Map<string, ReactivePowerSpec>();
  private branchLoadings = new Map<string, BranchLoadingSpec>();
  private ieee2800Clauses = new Map<string, Ieee2800ClauseSpec>();
  private externalBounds = new Map<string, [number, number]>();
  private assertedLiterals = new Map<number, TheoryLiteral>();
  private nextLitId = 40000;

  private levelStack: {
    busVoltages: Map<string, BusVoltageSpec>;
    reactivePowers: Map<string, ReactivePowerSpec>;
    branchLoadings: Map<string, BranchLoadingSpec>;
    ieee2800Clauses: Map<string, Ieee2800ClauseSpec>;
    externalBounds: Map<string, [number, number]>;
    assertedLitIds: number[];
  }[] = [];

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.busVoltages.clear();
    this.reactivePowers.clear();
    this.branchLoadings.clear();
    this.ieee2800Clauses.clear();
    this.externalBounds.clear();
    this.assertedLiterals.clear();
    this.levelStack = [];
  }

  public pushLevel(): void {
    this.levelStack.push({
      busVoltages: new Map(this.busVoltages),
      reactivePowers: new Map(this.reactivePowers),
      branchLoadings: new Map(this.branchLoadings),
      ieee2800Clauses: new Map(this.ieee2800Clauses),
      externalBounds: new Map(this.externalBounds),
      assertedLitIds: [],
    });
  }

  public popLevel(): void {
    const top = this.levelStack.pop();
    if (!top) return;
    this.busVoltages = top.busVoltages;
    this.reactivePowers = top.reactivePowers;
    this.branchLoadings = top.branchLoadings;
    this.ieee2800Clauses = top.ieee2800Clauses;
    this.externalBounds = top.externalBounds;
    for (const id of top.assertedLitIds) {
      this.assertedLiterals.delete(id);
    }
  }

  // --- Strongly typed domain ingestion APIs ---

  /**
   * Asserts a bus voltage magnitude result into the oracle.
   */
  public assertBusVoltage(spec: BusVoltageSpec): void {
    this.assertLiteral({
      id: this.nextLitId++,
      predicate: "busVoltage",
      args: [spec],
      domain: this.domain,
    });
  }

  /**
   * Asserts generator reactive power output into the oracle.
   */
  public assertReactivePower(spec: ReactivePowerSpec): void {
    this.assertLiteral({
      id: this.nextLitId++,
      predicate: "reactivePower",
      args: [spec],
      domain: this.domain,
    });
  }

  /**
   * Asserts branch thermal loading into the oracle.
   */
  public assertBranchLoading(spec: BranchLoadingSpec): void {
    this.assertLiteral({
      id: this.nextLitId++,
      predicate: "branchLoading",
      args: [spec],
      domain: this.domain,
    });
  }

  /**
   * Asserts an IEEE 2800-2022 / NERC PRC-029-1 compliance clause result.
   */
  public assertIeee2800Clause(spec: Ieee2800ClauseSpec): void {
    this.assertLiteral({
      id: this.nextLitId++,
      predicate: "ieee2800Clause",
      args: [spec],
      domain: this.domain,
    });
  }

  /**
   * Bulk-ingests a power flow solution from @modelscript/psse or equivalent.
   */
  public ingestPowerFlowSolution(solution: {
    buses?: { busNumber: number; name?: string; vm: number; baseKv?: number; qgMvar?: number }[];
    branches?: {
      fromBus: number;
      toBus: number;
      ckt?: string;
      mvaFlow?: number;
      rateMva?: number;
      loadingPercent?: number;
    }[];
  }): void {
    if (solution.buses) {
      for (const b of solution.buses) {
        this.assertBusVoltage({
          busId: b.busNumber,
          busName: b.name,
          actualVm: b.vm,
          minVm: 0.95,
          maxVm: 1.05,
          baseKv: b.baseKv,
        });
      }
    }
    if (solution.branches) {
      for (const br of solution.branches) {
        if (br.rateMva && br.rateMva > 0 && br.mvaFlow !== undefined) {
          const loadingPercent = br.loadingPercent ?? (br.mvaFlow / br.rateMva) * 100;
          this.assertBranchLoading({
            fromBus: br.fromBus,
            toBus: br.toBus,
            circuitId: br.ckt,
            actualMva: br.mvaFlow,
            rateMva: br.rateMva,
            loadingPercent,
          });
        }
      }
    }
  }

  /**
   * Bulk-ingests an IEEE 2800 compliance report from @modelscript/pscad.
   */
  public ingestIeee2800Report(report: {
    overallStatus: string;
    checks: {
      clause: string;
      name: string;
      status: "PASS" | "FAIL";
      value?: number;
      actualValue?: number;
      limit?: number;
      threshold?: number;
      operator?: string;
      unit?: string;
      message?: string;
    }[];
  }): void {
    for (const c of report.checks) {
      const val = c.actualValue ?? c.value ?? 0;
      const lim = c.threshold ?? c.limit ?? 0;
      const op = (c.operator as any) || "<=";
      this.assertIeee2800Clause({
        clause: c.clause,
        name: c.name,
        isCompliant: c.status === "PASS",
        actualValue: val,
        threshold: lim,
        operator: op,
        unit: c.unit || "",
        explanation: c.message,
      });
    }
  }

  // --- TheoryOracle implementation ---

  public assertLiteral(lit: TheoryLiteral): boolean {
    this.assertedLiterals.set(lit.id, lit);
    if (this.levelStack.length > 0) {
      this.levelStack[this.levelStack.length - 1]!.assertedLitIds.push(lit.id);
    }

    const { predicate, args } = lit;
    if (predicate === "busVoltage") {
      const spec = args[0] as BusVoltageSpec;
      if (spec) this.busVoltages.set(String(spec.busId), spec);
    } else if (predicate === "reactivePower") {
      const spec = args[0] as ReactivePowerSpec;
      if (spec) this.reactivePowers.set(String(spec.genId), spec);
    } else if (predicate === "branchLoading") {
      const spec = args[0] as BranchLoadingSpec;
      if (spec) this.branchLoadings.set(`${spec.fromBus}_${spec.toBus}`, spec);
    } else if (predicate === "ieee2800Clause") {
      const spec = args[0] as Ieee2800ClauseSpec;
      if (spec) this.ieee2800Clauses.set(spec.clause, spec);
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
    // 1. Check Bus Voltage Boundaries
    for (const [id, spec] of this.busVoltages.entries()) {
      // Check internal bounds
      if (spec.actualVm < spec.minVm || spec.actualVm > spec.maxVm) {
        const delta = spec.actualVm < spec.minVm ? spec.minVm - spec.actualVm : spec.actualVm - spec.maxVm;
        const dir = spec.actualVm < spec.minVm ? "under-voltage" : "over-voltage";
        return {
          isSat: false,
          conflict: {
            literals: Array.from(this.assertedLiterals.values()).filter((l) =>
              l.args.some((a) => a?.busId === spec.busId),
            ),
            explanation: `Power Grid Violation: Bus '${spec.busName || id}' voltage magnitude ${spec.actualVm.toFixed(4)} p.u. violates allowable boundary [${spec.minVm}, ${spec.maxVm}] p.u. (${dir} by ${delta.toFixed(4)} p.u.).`,
            culpritEntities: [String(id), spec.busName || `Bus#${id}`],
            theoryName: this.name,
          },
        };
      }

      // Check external bounds from Nelson-Oppen cooperation (e.g. from ReqIF requirement)
      const varNames = [`grid.bus_voltage.${id}`, `grid.bus_voltage`, "voltage_pu", "bus_voltage"];
      for (const vn of varNames) {
        const ext = this.externalBounds.get(vn);
        if (ext) {
          const [lo, hi] = ext;
          if (spec.actualVm < lo - 1e-5 || spec.actualVm > hi + 1e-5) {
            return {
              isSat: false,
              conflict: {
                literals: Array.from(this.assertedLiterals.values()).filter((l) =>
                  l.args.some((a) => a?.busId === spec.busId),
                ),
                explanation: `Nelson-Oppen Grid Requirement Conflict: Bus '${spec.busName || id}' voltage ${spec.actualVm.toFixed(4)} p.u. breaches formal requirement bound [${lo}, ${hi}] p.u.`,
                culpritEntities: [String(id), vn],
                theoryName: this.name,
              },
            };
          }
        }
      }
    }

    // 2. Check Generator Reactive Power Limits
    for (const [id, spec] of this.reactivePowers.entries()) {
      if (spec.actualQgMvar < spec.minQgMvar || spec.actualQgMvar > spec.maxQgMvar) {
        const dir = spec.actualQgMvar < spec.minQgMvar ? "underexcited" : "overexcited";
        return {
          isSat: false,
          conflict: {
            literals: Array.from(this.assertedLiterals.values()).filter((l) =>
              l.args.some((a) => a?.genId === spec.genId),
            ),
            explanation: `Power Grid Violation: Generator '${id}' reactive power output ${spec.actualQgMvar.toFixed(2)} MVAR exceeds capability limits [${spec.minQgMvar}, ${spec.maxQgMvar}] MVAR (${dir}).`,
            culpritEntities: [String(id), `Gen#${id}`],
            theoryName: this.name,
          },
        };
      }
    }

    // 3. Check Branch Thermal Loading Limits
    for (const [id, spec] of this.branchLoadings.entries()) {
      if (spec.loadingPercent > 100.0) {
        return {
          isSat: false,
          conflict: {
            literals: Array.from(this.assertedLiterals.values()).filter((l) =>
              l.args.some((a) => a?.fromBus === spec.fromBus && a?.toBus === spec.toBus),
            ),
            explanation: `Power Grid Violation: Branch ${spec.fromBus}->${spec.toBus} thermal loading ${spec.loadingPercent.toFixed(1)}% exceeds 100% MVA continuous rating (${spec.actualMva.toFixed(1)} / ${spec.rateMva.toFixed(1)} MVA).`,
            culpritEntities: [id, `Branch_${id}`],
            theoryName: this.name,
          },
        };
      }
    }

    // 4. Check IEEE 2800-2022 Grid Code Clauses
    for (const [clauseId, spec] of this.ieee2800Clauses.entries()) {
      if (!spec.isCompliant) {
        return {
          isSat: false,
          conflict: {
            literals: Array.from(this.assertedLiterals.values()).filter((l) =>
              l.args.some((a) => a?.clause === clauseId),
            ),
            explanation: `IEEE 2800-2022 Non-Compliance: Clause '${clauseId}' (${spec.name}) failed. Value ${spec.actualValue}${spec.unit} does not satisfy condition ${spec.operator} ${spec.threshold}${spec.unit}. ${spec.explanation || ""}`,
            culpritEntities: [clauseId, spec.name],
            theoryName: this.name,
          },
        };
      }
    }

    return { isSat: true };
  }

  public propagateEqualities(): SharedEquality[] {
    const eqs: SharedEquality[] = [];

    // Propagate bus voltage bounds
    for (const [id, spec] of this.busVoltages.entries()) {
      eqs.push({
        varA: `grid.bus_voltage.${id}`,
        varB: String(spec.actualVm),
        domain: "real",
        bounds: [spec.actualVm, spec.actualVm],
        explanation: `Power grid bus #${id} voltage magnitude is ${spec.actualVm} p.u.`,
        sourceOracle: this.name,
      });
    }

    // Propagate aggregate voltage bounds
    if (this.busVoltages.size > 0) {
      let minV = Infinity;
      let maxV = -Infinity;
      for (const spec of this.busVoltages.values()) {
        if (spec.actualVm < minV) minV = spec.actualVm;
        if (spec.actualVm > maxV) maxV = spec.actualVm;
      }
      eqs.push({
        varA: "grid.min_bus_voltage",
        varB: String(minV),
        domain: "real",
        bounds: [minV, minV],
        explanation: `System minimum bus voltage is ${minV} p.u.`,
        sourceOracle: this.name,
      });
      eqs.push({
        varA: "grid.max_bus_voltage",
        varB: String(maxV),
        domain: "real",
        bounds: [maxV, maxV],
        explanation: `System maximum bus voltage is ${maxV} p.u.`,
        sourceOracle: this.name,
      });
    }

    // Propagate IEEE 2800 metrics
    for (const [clauseId, spec] of this.ieee2800Clauses.entries()) {
      eqs.push({
        varA: `grid.ieee2800.${clauseId}`,
        varB: String(spec.actualValue),
        domain: "real",
        bounds: [spec.actualValue, spec.actualValue],
        explanation: `IEEE 2800 clause ${clauseId} measured value: ${spec.actualValue} ${spec.unit}`,
        sourceOracle: this.name,
      });
    }

    return eqs;
  }

  public onSharedEquality(eq: SharedEquality): void {
    if (!eq.varA) return;

    if (eq.bounds) {
      this.externalBounds.set(eq.varA, eq.bounds);
      if (eq.varB && isNaN(Number(eq.varB))) {
        this.externalBounds.set(eq.varB, eq.bounds);
      }
    }
  }
}

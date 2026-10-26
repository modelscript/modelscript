// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Multi-Domain Formal Verification Coordinator.
 *
 * Implements an automated, multi-domain cyber-physical contract verifier
 * powered by the Generalized Nelson-Oppen SemanticTheoryCoordinator.
 *
 * Coordinates:
 *   - Formal Requirements (ReqIF 1.2 / SysML v2 contracts)
 *   - High-voltage power grid reactive and bus voltage limits (PSS/E & PSCAD IEEE 2800)
 *   - Offshore marine safety margins & mooring tension (SIMA DNV-OS-E301)
 *   - Structural stress and yield limits (FEA von Mises & displacement)
 *   - Aerodynamic performance & pressure drop limits (CFD drag & lift)
 *
 * Exchanges shared equalities, bounds, and conflict clauses across theory oracles
 * until reaching a mutual Nelson-Oppen satisfiability fixpoint or finding a proof gap.
 */

import {
  CaeContractOracle,
  ConstraintTheoryOracle,
  EntailmentTheoryOracle,
  MarineMooringTheoryOracle,
  PowerGridTheoryOracle,
} from "./oracles/index.js";
import { ProofManifestGenerator, type DigitalThreadProofManifest } from "./proof_manifest.js";
import { SemanticTheoryCoordinator, type ConflictClause, type CoordinatorSatResult } from "./theory_coordinator.js";

export interface RequirementContractSpec {
  id: string;
  variable: string;
  operator: "<=" | "<" | ">=" | ">" | "==" | "!=";
  limitValue: number;
  unit?: string | undefined;
  description?: string | undefined;
}

export interface MultiDomainDecks {
  powerGrid?:
    | {
        powerFlow?:
          | {
              buses?: { busNumber: number; name?: string; vm: number; baseKv?: number; qgMvar?: number }[];
              branches?: {
                fromBus: number;
                toBus: number;
                ckt?: string;
                mvaFlow?: number;
                rateMva?: number;
                loadingPercent?: number;
              }[];
            }
          | undefined;
        ieee2800?:
          | {
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
            }
          | undefined;
        busOverrides?:
          | { busId: string | number; actualVm: number; minVm?: number; maxVm?: number; busName?: string }[]
          | undefined;
      }
    | undefined;

  marineMooring?:
    | {
        dnvReport?:
          | {
              standard?: string;
              summary?: { minSafetyFactor?: number; allPassed?: boolean };
              lines?: {
                lineId: string;
                lineName?: string;
                mbl: number;
                tensionIntact: number;
                safetyFactorIntact: number;
                passedIntact: boolean;
                tensionDamaged?: number;
                safetyFactorDamaged?: number;
                passedDamaged?: boolean;
                anchorUpliftDeg?: number;
                anchorUpliftPassed?: boolean;
              }[];
            }
          | undefined;
        consequenceClass?: 1 | 2 | undefined;
        lineOverrides?:
          | {
              lineId: string;
              lineName?: string;
              mbl: number;
              tensionIntact: number;
              safetyFactorIntact?: number;
              consequenceClass?: 1 | 2;
            }[]
          | undefined;
        floaterOffset?:
          | {
              floaterId: string;
              actualOffsetMeters: number;
              maxAllowableOffsetMeters: number;
            }
          | undefined;
      }
    | undefined;

  fea?:
    | {
        parts?:
          | {
              partName: string;
              maxVonMisesStressPa: number;
              yieldStrengthPa: number;
              maxDisplacementM?: number;
              maxAllowableDisplacementM?: number;
              contractId?: string;
            }[]
          | undefined;
      }
    | undefined;

  cfd?:
    | {
        aerodynamics?:
          | {
              partName?: string;
              dragCoeff?: number;
              maxDragCoeff?: number;
              liftDragRatio?: number;
              minLiftDragRatio?: number;
              pressureDropPa?: number;
              maxPressureDropPa?: number;
              machNumber?: number;
              maxMachNumber?: number;
              contractId?: string;
            }[]
          | undefined;
      }
    | undefined;

  customBounds?: { variable: string; bounds: [number, number]; explanation?: string }[] | undefined;
  aliases?: [string, string][] | undefined;
}

export interface DomainCheckResult {
  domain: "power_grid" | "marine_mooring" | "fea_structural" | "cfd_aerodynamics" | "requirements";
  name: string;
  passed: boolean;
  actualValue?: number | string | undefined;
  expectedCondition?: string | undefined;
  unit?: string | undefined;
  diagnostic?: string | undefined;
}

export interface MultiDomainVerificationReport {
  isCertified: boolean;
  status: "CERTIFIED_SAFE" | "CONTRACT_VIOLATION" | "INCONCLUSIVE";
  summary: {
    totalRequirements: number;
    satisfiedRequirements: number;
    violatedRequirements: number;
    domainsEvaluated: string[];
    durationMs: number;
    nelsonOppenIterations: number;
  };
  domainChecks: DomainCheckResult[];
  proofManifest?: DigitalThreadProofManifest | undefined;
  conflict?: ConflictClause | undefined;
  diagnosticMessage?: string | undefined;
  satResult: CoordinatorSatResult;
}

/**
 * Standard variable name mapping aliases bridging high-level requirement names to physical domain metrics.
 */
const DEFAULT_VARIABLE_MAPPINGS: [string, string[]][] = [
  // Power Grid
  ["grid.bus_voltage", ["voltage_pu", "bus_voltage", "grid_voltage", "voltage_magnitude"]],
  ["grid.min_bus_voltage", ["min_voltage_pu", "min_bus_voltage", "undervoltage_limit"]],
  ["grid.max_bus_voltage", ["max_voltage_pu", "max_bus_voltage", "overvoltage_limit"]],
  ["grid.reactive_power", ["reactive_power_mvar", "reactive_power", "qg_mvar"]],

  // Marine Mooring
  ["mooring.safety_factor", ["mooring_safety_factor", "safety_factor", "mooring_sf", "sf_intact"]],
  ["mooring.min_sf", ["min_mooring_safety_factor", "min_safety_factor", "min_sf"]],
  ["mooring.max_tension", ["max_line_tension", "max_tension_n", "line_tension_n", "mooring_tension"]],
  ["floater.offset", ["floater_offset_m", "floater_offset", "platform_offset", "surge_offset"]],

  // FEA Structural
  ["fea.von_mises_stress", ["von_mises_stress", "von_mises_stress_pa", "stress_pa", "max_stress"]],
  ["fea.max_displacement", ["max_displacement", "max_displacement_m", "deflection_m"]],

  // CFD Aerodynamics
  ["cfd.drag_coeff", ["drag_coeff", "drag_coefficient", "cd", "aero_drag"]],
  ["cfd.lift_drag_ratio", ["lift_drag_ratio", "l_d_ratio", "aerodynamic_efficiency"]],
  ["cfd.pressure_drop", ["pressure_drop", "pressure_drop_pa", "delta_p"]],
  ["cfd.mach_number", ["mach_number", "critical_mach", "mach"]],
];

export class MultiDomainVerificationCoordinator {
  private coordinator: SemanticTheoryCoordinator;
  private reqOracle: EntailmentTheoryOracle;
  private gridOracle: PowerGridTheoryOracle;
  private mooringOracle: MarineMooringTheoryOracle;
  private caeOracle: CaeContractOracle;
  private constraintOracle: ConstraintTheoryOracle;

  constructor() {
    this.coordinator = new SemanticTheoryCoordinator();
    this.reqOracle = new EntailmentTheoryOracle();
    this.gridOracle = new PowerGridTheoryOracle();
    this.mooringOracle = new MarineMooringTheoryOracle();
    this.caeOracle = new CaeContractOracle();
    this.constraintOracle = new ConstraintTheoryOracle();

    this.coordinator.registerOracle(this.reqOracle);
    this.coordinator.registerOracle(this.gridOracle);
    this.coordinator.registerOracle(this.mooringOracle);
    this.coordinator.registerOracle(this.caeOracle);
    this.coordinator.registerOracle(this.constraintOracle);
  }

  /**
   * Runs end-to-end multi-domain formal verification linking requirements with engineering decks.
   */
  public verify(requirements: RequirementContractSpec[], decks: MultiDomainDecks): MultiDomainVerificationReport {
    const t0 = performance.now();
    const domainChecks: DomainCheckResult[] = [];
    const domainsEvaluated: string[] = [];

    // 1. Setup default variable aliases and equivalence classes in Nelson-Oppen
    this.setupVariableAliases(decks.aliases);

    // 2. Assert requirements into Entailment & Constraint oracles
    let litId = 1000;
    for (const req of requirements) {
      const op = req.operator === "!=" ? "<=" : req.operator;
      this.reqOracle.assertLiteral({
        id: litId++,
        predicate: "requirement",
        args: [req.id, req.variable, op, req.limitValue],
      });

      // Propagate requirement bounds into coordinator canonical space
      const [lo, hi] = this.operatorToBounds(op, req.limitValue);
      this.coordinator.enqueueEvent({
        kind: "bound",
        varName: req.variable,
        bounds: [lo, hi],
        explanation: `Requirement ${req.id}: ${req.variable} ${op} ${req.limitValue}`,
        sourceOracle: this.reqOracle.name,
      });

      // Also directly inform oracles for all matching aliases
      this.propagateBoundToAliases(req.variable, [lo, hi]);
    }

    // 3. Ingest Power Grid Decks (@modelscript/psse, @modelscript/pscad)
    if (decks.powerGrid) {
      domainsEvaluated.push("Power Grid (PSS/E & PSCAD)");
      if (decks.powerGrid.powerFlow) {
        this.gridOracle.ingestPowerFlowSolution(decks.powerGrid.powerFlow);
      }
      if (decks.powerGrid.ieee2800) {
        this.gridOracle.ingestIeee2800Report(decks.powerGrid.ieee2800);
      }
      if (decks.powerGrid.busOverrides) {
        for (const b of decks.powerGrid.busOverrides) {
          this.gridOracle.assertBusVoltage({
            busId: b.busId,
            busName: b.busName,
            actualVm: b.actualVm,
            minVm: b.minVm ?? 0.95,
            maxVm: b.maxVm ?? 1.05,
          });
        }
      }
    }

    // 4. Ingest Marine Mooring Decks (@modelscript/sima)
    if (decks.marineMooring) {
      domainsEvaluated.push("Marine Mooring (SIMA / DNV-OS-E301)");
      const cc = decks.marineMooring.consequenceClass ?? 2;
      if (decks.marineMooring.dnvReport) {
        this.mooringOracle.ingestDnvReport(decks.marineMooring.dnvReport, cc);
      }
      if (decks.marineMooring.lineOverrides) {
        for (const l of decks.marineMooring.lineOverrides) {
          const reqSf = (l.consequenceClass ?? cc) === 1 ? 1.5 : 1.67;
          const sf = l.safetyFactorIntact ?? l.mbl / l.tensionIntact;
          this.mooringOracle.assertMooringLine({
            lineId: l.lineId,
            lineName: l.lineName,
            mbl: l.mbl,
            tensionIntact: l.tensionIntact,
            safetyFactorIntact: sf,
            passedIntact: sf >= reqSf,
            consequenceClass: l.consequenceClass ?? cc,
          });
        }
      }
      if (decks.marineMooring.floaterOffset) {
        this.mooringOracle.assertFloaterExcursion(decks.marineMooring.floaterOffset);
      }
    }

    // 5. Ingest FEA Structural Decks (@modelscript/fea)
    if (decks.fea && decks.fea.parts) {
      domainsEvaluated.push("Structural Mechanics (FEA)");
      for (const p of decks.fea.parts) {
        this.caeOracle.assertFeaStressContract({
          partName: p.partName,
          contractId: p.contractId,
          maxVonMisesStressPa: p.maxVonMisesStressPa,
          yieldStrengthPa: p.yieldStrengthPa,
          maxDisplacementM: p.maxDisplacementM,
          maxAllowableDisplacementM: p.maxAllowableDisplacementM,
        });
      }
    }

    // 6. Ingest CFD Aerodynamic Decks (@modelscript/cfd)
    if (decks.cfd && decks.cfd.aerodynamics) {
      domainsEvaluated.push("Aerodynamics & Fluid Dynamics (CFD)");
      for (const a of decks.cfd.aerodynamics) {
        this.caeOracle.assertCfdAerodynamicContract({
          partName: a.partName,
          contractId: a.contractId,
          dragCoeff: a.dragCoeff,
          maxDragCoeff: a.maxDragCoeff,
          liftDragRatio: a.liftDragRatio,
          minLiftDragRatio: a.minLiftDragRatio,
          pressureDropPa: a.pressureDropPa,
          maxPressureDropPa: a.maxPressureDropPa,
          machNumber: a.machNumber,
          maxMachNumber: a.maxMachNumber,
        });
      }
    }

    // 7. Custom bounds
    if (decks.customBounds) {
      for (const b of decks.customBounds) {
        this.coordinator.enqueueEvent({
          kind: "bound",
          varName: b.variable,
          bounds: b.bounds,
          explanation: b.explanation || `Custom bound on ${b.variable}`,
          sourceOracle: "custom",
        });
      }
    }

    // 8. Execute Nelson-Oppen Fixpoint Coordination Loop
    const satResult = this.coordinator.checkSat(50);
    const durationMs = performance.now() - t0;

    // 9. Collect domain checks and evaluate status
    const isSat = satResult.isSat;
    let proofManifest: DigitalThreadProofManifest | undefined;
    let diagnosticMessage: string | undefined;

    if (isSat) {
      proofManifest = ProofManifestGenerator.generateManifest(
        [
          {
            domain: "formal_proof",
            identifier: "NelsonOppen::MultiDomainVerification",
            sha256: ProofManifestGenerator.hashContent(
              `MultiDomain:${requirements.map((r) => r.id).join(",")}:${domainsEvaluated.join(",")}`,
            ),
            verificationStatus: "CERTIFIED_SAFE",
            engine: "NelsonOppenSemanticTheoryCoordinator",
          },
        ],
        "HEAD",
      );
    } else {
      diagnosticMessage = satResult.conflict?.explanation || "Multi-domain formal contract violation detected.";
    }

    // Populate individual domain check records for reporting
    for (const req of requirements) {
      const isViolated =
        satResult.conflict?.culpritEntities.includes(req.id) ||
        satResult.conflict?.culpritEntities.includes(req.variable);
      domainChecks.push({
        domain: this.categorizeRequirementDomain(req.variable),
        name: req.id,
        passed: !isViolated && isSat,
        expectedCondition: `${req.variable} ${req.operator} ${req.limitValue}${req.unit ? " " + req.unit : ""}`,
        unit: req.unit,
        diagnostic: isViolated ? satResult.conflict?.explanation : undefined,
      });
    }

    const satisfiedCount = domainChecks.filter((c) => c.passed).length;
    const violatedCount = domainChecks.filter((c) => !c.passed).length;

    return {
      isCertified: isSat,
      status: isSat ? "CERTIFIED_SAFE" : "CONTRACT_VIOLATION",
      summary: {
        totalRequirements: requirements.length,
        satisfiedRequirements: satisfiedCount,
        violatedRequirements: violatedCount,
        domainsEvaluated,
        durationMs,
        nelsonOppenIterations: satResult.iterations,
      },
      domainChecks,
      proofManifest,
      conflict: satResult.conflict,
      diagnosticMessage,
      satResult,
    };
  }

  private setupVariableAliases(customAliases?: [string, string][]): void {
    for (const [canonical, aliases] of DEFAULT_VARIABLE_MAPPINGS) {
      for (const alias of aliases) {
        this.coordinator.enqueueEvent({
          kind: "equality",
          varA: canonical,
          varB: alias,
          domain: "real",
          explanation: `Default multi-domain ontology alias: ${alias} == ${canonical}`,
          sourceOracle: "MultiDomainCoordinator",
        });
      }
    }

    if (customAliases) {
      for (const [a, b] of customAliases) {
        this.coordinator.enqueueEvent({
          kind: "equality",
          varA: a,
          varB: b,
          domain: "real",
          explanation: `User-specified variable alias: ${a} == ${b}`,
          sourceOracle: "MultiDomainCoordinator",
        });
      }
    }
  }

  private propagateBoundToAliases(variable: string, bounds: [number, number]): void {
    // Notify oracles that directly understand bound events
    this.gridOracle.onSharedEquality({
      varA: variable,
      varB: variable,
      domain: "interval",
      bounds,
      sourceOracle: "ReqIF",
    });
    this.mooringOracle.onSharedEquality({
      varA: variable,
      varB: variable,
      domain: "interval",
      bounds,
      sourceOracle: "ReqIF",
    });
    this.caeOracle.onSharedEquality({
      varA: variable,
      varB: variable,
      domain: "interval",
      bounds,
      sourceOracle: "ReqIF",
    });

    // Check alias mappings to also propagate canonical names
    for (const [canonical, aliases] of DEFAULT_VARIABLE_MAPPINGS) {
      if (aliases.includes(variable) || canonical === variable) {
        this.gridOracle.onSharedEquality({
          varA: canonical,
          varB: canonical,
          domain: "interval",
          bounds,
          sourceOracle: "ReqIF",
        });
        this.mooringOracle.onSharedEquality({
          varA: canonical,
          varB: canonical,
          domain: "interval",
          bounds,
          sourceOracle: "ReqIF",
        });
        this.caeOracle.onSharedEquality({
          varA: canonical,
          varB: canonical,
          domain: "interval",
          bounds,
          sourceOracle: "ReqIF",
        });
      }
    }
  }

  private operatorToBounds(op: string, val: number): [number, number] {
    switch (op) {
      case "<=":
      case "<":
        return [-Infinity, val];
      case ">=":
      case ">":
        return [val, Infinity];
      case "==":
        return [val, val];
      default:
        return [-Infinity, Infinity];
    }
  }

  private categorizeRequirementDomain(variable: string): DomainCheckResult["domain"] {
    const v = variable.toLowerCase();
    if (
      v.includes("volt") ||
      v.includes("reactive") ||
      v.includes("grid") ||
      v.includes("frequency") ||
      v.includes("thd")
    ) {
      return "power_grid";
    }
    if (
      v.includes("mooring") ||
      v.includes("tension") ||
      v.includes("floater") ||
      v.includes("offset") ||
      v.includes("safety_factor")
    ) {
      return "marine_mooring";
    }
    if (v.includes("stress") || v.includes("yield") || v.includes("displacement") || v.includes("deflection")) {
      return "fea_structural";
    }
    if (v.includes("drag") || v.includes("lift") || v.includes("pressure") || v.includes("mach")) {
      return "cfd_aerodynamics";
    }
    return "requirements";
  }
}

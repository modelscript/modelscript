// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/psse — Standard Diagnostic Error Codes (P1001–P4010).
 */

export const PsseErrorCode = {
  BUS_NOT_FOUND: {
    code: "P1001",
    rule: "bus-not-found",
    severity: "error" as const,
    message: (entityKind: string, id: string, busRole: string, busId: number) =>
      `${entityKind} '${id}' references non-existent ${busRole}bus ${busId}.`,
  },
  GENERATOR_NEGATIVE_POWER: {
    code: "P1002",
    rule: "generator-negative-power",
    severity: "warning" as const,
    message: (genId: string, busId: number, pg: number) =>
      `Generator '${genId}' at bus ${busId} has negative active power output (${pg} MW).`,
  },
  DUPLICATE_EQUIPMENT_ID: {
    code: "P1003",
    rule: "duplicate-equipment-id",
    severity: "error" as const,
    message: (genId: string, busId: number) => `Duplicate generator ID '${genId}' at bus ${busId}.`,
    branchMessage: (fromBus: number, toBus: number, ckt: string) =>
      `Duplicate transmission branch between bus ${fromBus} and ${toBus} with circuit ID '${ckt}'.`,
  },
  ISOLATED_BUS: {
    code: "P2001",
    rule: "isolated-bus",
    severity: "warning" as const,
    message: (busId: number, busName: string) =>
      `Bus ${busId} ('${busName}') is isolated with 0 in-service connecting branches or transformers.`,
  },
  MISSING_SLACK_BUS: {
    code: "P2002",
    rule: "missing-slack-bus",
    severity: "error" as const,
    message: () =>
      `Power network base case contains 0 slack/swing buses (Bus Type 3). Power flow solution cannot be anchored.`,
  },
  MULTIPLE_SLACK_BUSES: {
    code: "P2003",
    rule: "multiple-slack-buses",
    severity: "warning" as const,
    message: (count: number) =>
      `Power network base case contains ${count} swing buses without explicit multi-island partitioning.`,
  },
  VOLTAGE_OUT_OF_BOUNDS: {
    code: "P2004",
    rule: "voltage-out-of-bounds",
    severity: "warning" as const,
    message: (busId: number, vm: number) =>
      `Initial voltage magnitude at bus ${busId} (${vm.toFixed(3)} pu) is outside standard operational limits [0.8, 1.2 pu].`,
  },
  GENERATOR_REACTIVE_LIMITS_INVERTED: {
    code: "P3001",
    rule: "generator-reactive-limits-inverted",
    severity: "error" as const,
    message: (genId: string, busId: number, qMin: number, qMax: number) =>
      `Generator '${genId}' at bus ${busId} has inverted reactive limits: Qmin (${qMin} MVAR) > Qmax (${qMax} MVAR).`,
  },
  GENERATOR_POWER_LIMITS_INVERTED: {
    code: "P3002",
    rule: "generator-power-limits-inverted",
    severity: "error" as const,
    message: (genId: string, busId: number, pMin: number, pMax: number) =>
      `Generator '${genId}' at bus ${busId} has inverted active power limits: Pmin (${pMin} MW) > Pmax (${pMax} MW).`,
  },
  GENERATOR_SCHEDULED_VOLTAGE_BOUNDS: {
    code: "P3003",
    rule: "generator-scheduled-voltage-bounds",
    severity: "warning" as const,
    message: (genId: string, vs: number) =>
      `Generator '${genId}' scheduled voltage Vs = ${vs} p.u. is outside the typical operating band [0.8, 1.2].`,
  },
  BRANCH_INVALID_REACTANCE: {
    code: "P4001",
    rule: "branch-invalid-reactance",
    severity: "error" as const,
    message: (ckt: string, fromBus: number, toBus: number, x: number) =>
      `Transmission branch '${ckt}' between bus ${fromBus} and ${toBus} has zero or negative reactance X = ${x} p.u.`,
  },
  BRANCH_BASE_KV_MISMATCH: {
    code: "P4002",
    rule: "branch-base-kv-mismatch",
    severity: "warning" as const,
    message: (ckt: string, fromBus: number, fromKv: number, toBus: number, toKv: number) =>
      `Branch '${ckt}' connects bus ${fromBus} (${fromKv} kV) to bus ${toBus} (${toKv} kV) without a transformer.`,
  },
  TRANSFORMER_TAP_OUT_OF_BOUNDS: {
    code: "P4003",
    rule: "transformer-tap-out-of-bounds",
    severity: "warning" as const,
    message: (ckt: string, fromBus: number, toBus: number, ratio: number) =>
      `Transformer '${ckt}' between bus ${fromBus} and ${toBus} has off-nominal tap ratio ${ratio} outside typical limits [0.7, 1.3].`,
  },
  SUBSTATION_VOLTAGE_VIOLATION_NERC: {
    code: "P2005",
    rule: "substation-voltage-violation-nerc",
    severity: "warning" as const,
    message: (busId: number, vm: number) =>
      `Bus ${busId} voltage magnitude (${vm.toFixed(3)} pu) violates NERC standard transmission bounds [0.90, 1.10 pu].`,
  },
  ZERO_INERTIA_DYNAMIC_BUS: {
    code: "P3004",
    rule: "zero-inertia-dynamic-bus",
    severity: "error" as const,
    message: (busId: number) =>
      `Synchronous machine dynamic record at bus ${busId} specifies zero inertia constant (H <= 0).`,
  },
  BRANCH_THERMAL_RATING_ZERO: {
    code: "P4004",
    rule: "branch-thermal-rating-zero",
    severity: "warning" as const,
    message: (ckt: string, fromBus: number, toBus: number) =>
      `Transmission branch '${ckt}' between bus ${fromBus} and ${toBus} has zero MVA thermal rating.`,
  },
  TYPE4_BUS_WITH_INSERVICE_EQUIPMENT: {
    code: "P2006",
    rule: "type4-bus-with-inservice-equipment",
    severity: "error" as const,
    message: (busId: number, equipDesc: string) =>
      `Isolated bus ${busId} (IDE = 4) has in-service ${equipDesc}, creating a TREE topology inconsistency.`,
  },
  PV_BUS_WITHOUT_REACTIVE_SOURCE: {
    code: "P2007",
    rule: "pv-bus-without-online-reactive-source",
    severity: "warning" as const,
    message: (busId: number, busName: string) =>
      `PV/Swing bus ${busId} ('${busName}') has no in-service generator or regulating reactive source.`,
  },
  GENERATOR_ON_PQ_BUS: {
    code: "P2008",
    rule: "generator-on-pq-bus",
    severity: "warning" as const,
    message: (genId: string, busId: number) =>
      `In-service generator '${genId}' is attached to PQ bus ${busId} (IDE = 1) and will not regulate voltage.`,
  },
  CONFLICTING_REMOTE_REGULATION: {
    code: "P2009",
    rule: "conflicting-remote-voltage-regulation",
    severity: "warning" as const,
    message: (busId: number, reason: string) =>
      `Remote voltage regulation conflict at regulated bus ${busId}: ${reason}.`,
  },
  BRANCH_EXTREME_IMPEDANCE: {
    code: "P4005",
    rule: "branch-extreme-impedance",
    severity: "warning" as const,
    message: (ckt: string, fromBus: number, toBus: number, detail: string) =>
      `Transmission branch '${ckt}' between bus ${fromBus} and ${toBus} has ${detail}.`,
  },
  BRANCH_RATING_HIERARCHY_INVERTED: {
    code: "P4006",
    rule: "branch-rating-hierarchy-inverted",
    severity: "warning" as const,
    message: (ckt: string, fromBus: number, toBus: number, rateA: number, rateB: number, rateC: number) =>
      `Branch '${ckt}' (${fromBus}-${toBus}) thermal ratings violate RATEA <= RATEB <= RATEC (${rateA}, ${rateB}, ${rateC}).`,
  },
  LINE_CHARGING_MVAR_SUSPECT: {
    code: "P4007",
    rule: "line-charging-mvar-vs-pu-confusion",
    severity: "warning" as const,
    message: (ckt: string, fromBus: number, toBus: number, b: number) =>
      `Branch '${ckt}' (${fromBus}-${toBus}) charging susceptance B = ${b} p.u. is unusually large (> 5.0); verify MVAR vs p.u. units.`,
  },
  THREE_WINDING_NEGATIVE_STAR_REACTANCE: {
    code: "P4009",
    rule: "three-winding-star-point-negative-reactance",
    severity: "warning" as const,
    message: (ckt: string, i: number, j: number, k: number, xStar: number) =>
      `3-winding transformer '${ckt}' (${i}-${j}-${k}) star-equivalent reactance X1 = ${xStar.toFixed(4)} p.u. is strongly negative.`,
  },
  SWITCHED_SHUNT_BAND_INVERTED: {
    code: "P4010",
    rule: "switched-shunt-band-inverted",
    severity: "error" as const,
    message: (busId: number, vswlo: number, vswhi: number) =>
      `Switched shunt at bus ${busId} has inverted voltage band: VSWLO (${vswlo}) >= VSWHI (${vswhi}).`,
  },
  DYR_PARAM_COUNT_MISMATCH: {
    code: "P5001",
    rule: "dyr-param-count-schema-mismatch",
    severity: "warning" as const,
    message: (model: string, busId: number, actual: number, expected: number) =>
      `Dynamic model '${model}' at Bus ${busId} specifies ${actual} CON parameters, expected ${expected}.`,
  },
  DYR_DUPLICATE_SLOT: {
    code: "P5002",
    rule: "dyr-duplicate-slot-assignment",
    severity: "error" as const,
    message: (category: string, busId: number, id: string) =>
      `Duplicate dynamic ${category} model assigned to machine (${busId}, '${id}').`,
  },
  DYR_ORPHAN_CONTROLLER: {
    code: "P5003",
    rule: "dyr-orphan-controller",
    severity: "warning" as const,
    message: (model: string, category: string, busId: number, id: string) =>
      `Dynamic ${category} '${model}' for (${busId}, '${id}') has no matching generator/IBR dynamic model.`,
  },
  DYR_MISSING_GENERATOR_DYNAMICS: {
    code: "P5004",
    rule: "dyr-online-gen-missing-dynamics",
    severity: "warning" as const,
    message: (genId: string, busId: number, pg: number) =>
      `In-service generator '${genId}' at bus ${busId} (Pg=${pg.toFixed(1)} MW) has no dynamic model in .dyr.`,
  },
  DYR_REACTANCE_HIERARCHY: {
    code: "P5005",
    rule: "dyr-reactance-timeconstant-hierarchy",
    severity: "error" as const,
    message: (model: string, busId: number, detail: string) =>
      `Dynamic machine '${model}' at bus ${busId} violates physical parameter ordering: ${detail}.`,
  },
  DYR_RAW_SOURCE_IMPEDANCE_MISMATCH: {
    code: "P5006",
    rule: "dyr-raw-source-impedance-mismatch",
    severity: "warning" as const,
    message: (genId: string, busId: number, rawZx: number, dyrX: number) =>
      `Generator '${genId}' at bus ${busId} has RAW ZX=${rawZx.toFixed(4)} p.u. vs DYR subtransient/transient reactance ${dyrX.toFixed(4)} p.u.`,
  },
  CON_TARGET_NOT_FOUND: {
    code: "P5009",
    rule: "con-target-not-found",
    severity: "warning" as const,
    message: (contId: string, detail: string) => `Contingency '${contId}' references unresolved element: ${detail}.`,
  },
  DYR_BUS_NOT_FOUND: {
    code: "P5010",
    rule: "dyr-bus-not-found",
    severity: "error" as const,
    message: (model: string, busId: number, rawUri: string) =>
      `DYR model '${model}' references bus ${busId}, which does not exist in RAW case '${rawUri}'.`,
  },
  DYR_MACHINE_NOT_FOUND: {
    code: "P5011",
    rule: "dyr-machine-not-found",
    severity: "warning" as const,
    message: (model: string, busId: number, id: string) =>
      `DYR model '${model}' references machine (${busId}, '${id}') not present in RAW generators.`,
  },
  SEQ_BUS_NOT_FOUND: {
    code: "P5012",
    rule: "seq-bus-not-found",
    severity: "error" as const,
    message: (busId: number, rawUri: string) =>
      `SEQ record references bus ${busId}, which does not exist in RAW case '${rawUri}'.`,
  },
  UNANCHORED_ENERGIZED_ISLAND: {
    code: "P6001",
    rule: "unanchored-energized-island",
    severity: "error" as const,
    message: (islandSize: number, sampleBus: number) =>
      `Energized network island (${islandSize} bus(es), including bus ${sampleBus}) contains no swing/slack bus (IDE = 3).`,
  },
  SINGLE_BRANCH_CUT_BRIDGE: {
    code: "P6002",
    rule: "single-branch-cut-bridge",
    severity: "info" as const,
    message: (kind: string, ckt: string, fromBus: number, toBus: number, mwAtRisk: number) =>
      `${kind} '${ckt}' (${fromBus}-${toBus}) is a topological N-1 cut bridge; its outage islands ${mwAtRisk.toFixed(1)} MW of generation/load.`,
  },
  DYR_INITIAL_CONDITION_SUSPECT: {
    code: "P7001",
    rule: "dyr-initial-condition-limit-violation",
    severity: "warning" as const,
    message: (genId: string, busId: number, reason: string) =>
      `INITIAL CONDITIONS SUSPECT for generator '${genId}' at bus ${busId}: ${reason}.`,
  },
  UNTERMINATED_RAW_SECTION: {
    code: "P1005",
    rule: "unterminated-raw-section",
    severity: "warning" as const,
    message: (sectionIndex: number) =>
      `PSS/E RAW section ${sectionIndex} reached EOF without a terminating '0 / END OF ...' delimiter.`,
  },
  INVALID_AREA_REF: {
    code: "P1006",
    rule: "invalid-area-zone-owner-ref",
    severity: "warning" as const,
    message: (entityDesc: string, areaId: number) =>
      `${entityDesc} references area ${areaId}, which is not declared in Area Interchange Data.`,
  },
  TRANSFORMER_UNIT_MISMATCH: {
    code: "P4008",
    rule: "transformer-cz-cw-cm-unit-mismatch",
    severity: "warning" as const,
    message: (ckt: string, fromBus: number, toBus: number, detail: string) =>
      `Transformer '${ckt}' (${fromBus}-${toBus}) unit code mismatch: ${detail}.`,
  },
  SEQ_IMPEDANCE_GAP: {
    code: "P5007",
    rule: "seq-zero-negative-sequence-gaps",
    severity: "warning" as const,
    message: (detail: string) => `Sequence data (.seq) gap: ${detail}.`,
  },
  SEQ_VECTOR_GROUP_INVALID: {
    code: "P5008",
    rule: "seq-transformer-vector-group-invalid",
    severity: "warning" as const,
    message: (iBus: number, jBus: number, ckt: string, detail: string) =>
      `Transformer (${iBus}-${jBus} CKT '${ckt}') zero-sequence connection invalid: ${detail}.`,
  },
  WEAK_GRID_IBR_SCR: {
    code: "P6003",
    rule: "pocket-short-circuit-ratio-weak-ibr",
    severity: "warning" as const,
    message: (busId: number, scr: number, mvaIbr: number, sScMva: number) =>
      `IBR POI bus ${busId} has low driving-point Short-Circuit Ratio (SCR = ${scr.toFixed(2)} < 1.5; S_sc = ${sScMva.toFixed(1)} MVA for ${mvaIbr.toFixed(1)} MVA IBR).`,
  },
  DAE_STRUCTURAL_IMBALANCE: {
    code: "P6005",
    rule: "dae-structural-singularity-or-high-index",
    severity: "error" as const,
    message: (varCount: number, eqCount: number) =>
      `Lowered PSS/E DAE system is structurally unbalanced (${varCount} variables vs ${eqCount} equations).`,
  },
  POORLY_DAMPED_MODE: {
    code: "P6006",
    rule: "poorly-damped-interarea-or-local-mode",
    severity: "warning" as const,
    message: (unstableCount: number, minDampingPct: number, freqHz: number, machine: string) =>
      `Small-signal eigenvalue check detected ${unstableCount} unstable / poorly damped mode(s) (min damping ζ=${minDampingPct.toFixed(2)}% at ${freqHz.toFixed(2)} Hz, dominant: ${machine}).`,
  },
  GENERATOR_CAPABILITY_OVERLOAD: {
    code: "P7002",
    rule: "generator-d-curve-reactive-infeasibility",
    severity: "warning" as const,
    message: (genId: string, busId: number, detail: string) =>
      `Generator '${genId}' at bus ${busId} violates nameplate capability envelope: ${detail}.`,
  },
  IBR_CONTROL_CONFLICT: {
    code: "P7004",
    rule: "ibr-control-priority-conflict",
    severity: "error" as const,
    message: (model: string, busId: number, detail: string) =>
      `IBR control model '${model}' at bus ${busId} has conflicting limit/deadband settings: ${detail}.`,
  },
  RAW_VERSION_COLUMN_MISMATCH: {
    code: "P1004",
    rule: "raw-version-column-mismatch",
    severity: "warning" as const,
    message: (rev: number, detail: string) => `PSS/E RAW revision mismatch (REV=${rev}): ${detail}.`,
  },
  JACOBIAN_VOLTAGE_COLLAPSE: {
    code: "P6004",
    rule: "jacobian-high-condition-number-voltage-collapse",
    severity: "warning" as const,
    message: (sigmaMin: number, weakestBus: number, vSensMax: number) =>
      `Reduced Q-V Jacobian indicates proximity to voltage collapse (min eigenvalue σ_min=${sigmaMin.toFixed(4)}, max dV/dQ=${vSensMax.toFixed(2)} pu/pu at bus ${weakestBus}).`,
  },
  UNSOLVABLE_LOAD_POCKET: {
    code: "P7003",
    rule: "powerflow-unsolvable-pocket-certificate",
    severity: "error" as const,
    message: (busId: number, demandMva: number, maxTransferMva: number) =>
      `Load pocket at bus ${busId} requires ${demandMva.toFixed(1)} MVA, exceeding theoretical static transfer capacity (${maxTransferMva.toFixed(1)} MVA) across incident lines.`,
  },
  IDV_SCRIPT_HAZARD: {
    code: "P7005",
    rule: "idv-psspy-script-mutation-hazards",
    severity: "warning" as const,
    message: (lineNo: number, cmd: string, detail: string) =>
      `PSS/E IDV script hazard at line ${lineNo} (${cmd}): ${detail}.`,
  },
  RAS_SPS_RACE_CONDITION: {
    code: "P8001",
    rule: "ras-sps-chattering-or-race-condition",
    severity: "error" as const,
    message: (target: string, schemeA: string, schemeB: string) =>
      `Formal BMC/SAT check proved contradictory RAS/SPS race on '${target}': '${schemeA}' and '${schemeB}' can trigger opposing actions simultaneously.`,
  },
  FREQUENCY_NADIR_UFLS_BREACH: {
    code: "P8003",
    rule: "frequency-nadir-ufls-reachability",
    severity: "warning" as const,
    message: (worstFreqHz: number, uflsHz: number, lossMw: number, hEq: number) =>
      `Zonotope reachability proves largest contingency loss (${lossMw.toFixed(1)} MW, H_eq=${hEq.toFixed(2)} s) can drive frequency nadir to ${worstFreqHz.toFixed(2)} Hz <= UFLS stage (${uflsHz.toFixed(2)} Hz).`,
  },
  NERC_PRC_STL_VIOLATION: {
    code: "P8004",
    rule: "nerc-prc-voltage-frequency-stl-robustness",
    severity: "warning" as const,
    message: (signal: string, rho: number, tCritSec: number) =>
      `NERC PRC-024/029 STL specification violated on '${signal}' (robustness ρ=${rho.toFixed(4)} at t=${tCritSec.toFixed(3)} s).`,
  },
  CRITICAL_CLEARING_BARRIER: {
    code: "P8002",
    rule: "transient-critical-clearing-barrier-violation",
    severity: "warning" as const,
    message: (busId: number, genId: string, cctMs: number, clearingMs: number) =>
      `Generator '${genId}' at bus ${busId} critical clearing time (${cctMs.toFixed(1)} ms) < clearing time (${clearingMs.toFixed(1)} ms); post-fault swing breaches Lyapunov/SOS barrier.`,
  },
  DYR_ICON_INVALID_VALUE: {
    code: "P5013",
    rule: "dyr-icon-invalid-value",
    severity: "error" as const,
    message: (model: string, busId: number, iconName: string, actual: string, valid: string) =>
      `Dynamic model '${model}' at bus ${busId} has invalid ICON '${iconName}' = ${actual} (expected one of: ${valid}).`,
  },
  DYR_CON_PHYSICAL_BOUNDS: {
    code: "P5014",
    rule: "dyr-con-physical-bounds",
    severity: "warning" as const,
    message: (model: string, busId: number, paramName: string, actual: number, min: number, max: number) =>
      `Dynamic model '${model}' at bus ${busId} parameter '${paramName}' = ${actual} is outside expected physical bounds [${min}, ${max}].`,
  },
  DYR_LEADLAG_RATIO_EXTREME: {
    code: "P5015",
    rule: "dyr-leadlag-ratio-extreme",
    severity: "warning" as const,
    message: (model: string, busId: number, tcName: string, tbName: string, ratio: number) =>
      `Dynamic model '${model}' at bus ${busId} has extreme lead/lag ratio ${tcName}/${tbName} = ${ratio.toFixed(1)} (> 25.0).`,
  },
  DYR_SATURATION_NON_MONOTONIC: {
    code: "P5016",
    rule: "dyr-saturation-non-monotonic",
    severity: "error" as const,
    message: (model: string, busId: number, s10: number, s12: number) =>
      `Dynamic model '${model}' at bus ${busId} has non-monotonic saturation factors: S(1.0)=${s10}, S(1.2)=${s12}.`,
  },
  DYR_COMPOSITE_LOAD_FRACTION_SUM: {
    code: "P5017",
    rule: "dyr-composite-load-fraction-sum",
    severity: "error" as const,
    message: (model: string, busId: number, totalFrac: number) =>
      `Dynamic composite load '${model}' at bus ${busId} motor/electronic fractions sum to ${totalFrac.toFixed(3)} (must be within [0, 1.0]).`,
  },
  DYR_REMOTE_BUS_NOT_FOUND: {
    code: "P5018",
    rule: "dyr-remote-bus-not-found",
    severity: "error" as const,
    message: (model: string, busId: number, iconName: string, remoteBus: number) =>
      `Dynamic model '${model}' at bus ${busId} ICON '${iconName}' references non-existent bus ${remoteBus}.`,
  },
  DYR_HVDC_FACTS_LINK_NOT_FOUND: {
    code: "P5019",
    rule: "dyr-hvdc-facts-link-not-found",
    severity: "error" as const,
    message: (model: string, deviceName: string) =>
      `Dynamic HVDC/FACTS model '${model}' references '${deviceName}', which is not declared in .raw DC/FACTS sections.`,
  },
  DYR_USRMDL_UNMAPPED_CUSTOM: {
    code: "P5020",
    rule: "dyr-usrmdl-unmapped-custom",
    severity: "info" as const,
    message: (model: string, busId: number) =>
      `User-defined USRMDL '${model}' at bus ${busId} is not a standard built-in alias; attach an AssemblyScript/FMU/DLL module for active stepping.`,
  },
} as const;

export type PsseErrorCodeKey = keyof typeof PsseErrorCode;

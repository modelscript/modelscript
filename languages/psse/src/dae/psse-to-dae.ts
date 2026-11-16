// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/psse — Full Linear-Memory DAE Arena Lowering for PSS/E Transmission Grids.
 *
 * Compiles full multi-machine transient stability, IEEE 421.5 exciters/PSS/limiters,
 * steam/hydro/gas/wind turbine-governors, WECC IBRs (`REGC`/`REEC`/`REPC`/`DER_A`/`REGFM`),
 * composite/induction loads (`CMPLDW`/`CIM5`/`CLOD`/`IEEL`), FACTS/HVDC, and relays directly
 * into ModelScript's zero-GC WebAssembly `DAEBuilder` struct-of-arrays arena.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import { getPsseModelPortSpecs, PSSE_MODEL_DEFAULTS } from "../builtins.js";
import { extractPowerFlowNetlist } from "../netlist/powerflow-netlist.js";
import { DYR_MODEL_SCHEMAS, resolveDyrModelSchema, type DaeArchetypeId } from "../schema/index.js";
import type { PsseCase, PsseDyrRecord } from "../types.js";
import {
  add,
  addReal,
  div,
  emitClamp,
  emitFirstOrderLag,
  emitLeadLag,
  emitMax,
  emitWashout,
  mul,
  sub,
  sumExprs,
  type DaeBlockContext,
} from "./blocks.js";
import { computeSteadyStateInit, getBusInit } from "./init-steady-state.js";
import { lowerExciterUnitToDae } from "./models/exciters.js";
import { lowerGeneratorUnitToDae } from "./models/generators.js";
import { lowerGovernorUnitToDae } from "./models/governors.js";
import { lowerBusFreqEstimatorToDae, lowerFactsOrHvdcToDae, lowerRelayToDae } from "./models/hvdc-facts-relays.js";
import { lowerIbrUnitToDae } from "./models/ibr.js";
import { lowerDynamicLoadToDae } from "./models/loads.js";
import { lowerStabilizerUnitToDae } from "./models/stabilizers.js";

export interface PsseDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
  baseFrequency?: number | undefined; // Hz (default: 60.0)
  /**
   * `"transient"` (default when `.dyr` records exist on a bus): switches `.dyr`-equipped
   * buses to exact Kirchhoff nodal current balance; `"powerflow"`: preserves PV/Slack constraints.
   */
  mode?: "transient" | "powerflow" | undefined;
  /**
   * When true, uses C-infinity smooth epsilon-clamping instead of piecewise `IfElse`
   * limiters for continuous Jacobian / small-signal modal analysis.
   */
  smoothLimits?: boolean | undefined;
}

function findUnitDyrRecord(
  records: PsseDyrRecord[],
  map: Map<string, PsseDyrRecord> | undefined,
  busNum: number,
  genId: string,
  category: PsseDyrRecord["category"],
  excludeLimiters = false,
): PsseDyrRecord | undefined {
  const key = `${busNum}_${genId}`;
  const candidate =
    map?.get(key) ??
    map?.get(String(busNum)) ??
    records.find((r) => {
      if (r.ibus !== busNum || r.category !== category) return false;
      const rid = r.id.trim() || "1";
      return rid === genId || rid === "*";
    });
  if (!candidate) return undefined;
  if (excludeLimiters) {
    const sub = resolveDyrModelSchema(candidate.model)?.subCategory;
    if (sub === "oel" || sub === "uel" || sub === "vhz" || sub === "compensator") {
      return records.find((r) => {
        if (r.ibus !== busNum || r.category !== category) return false;
        const rSub = resolveDyrModelSchema(r.model)?.subCategory;
        if (rSub === "oel" || rSub === "uel" || rSub === "vhz" || rSub === "compensator") return false;
        const rid = r.id.trim() || "1";
        return rid === genId || rid === "*";
      });
    }
  }
  return candidate;
}

export function lowerPsseToDae(psseCase: PsseCase, options?: PsseDaeOptions): DAEBuilder {
  const modelName = (options?.modelName ?? (psseCase.title1 || "TransmissionGrid")).replace(/[^a-zA-Z0-9_]/g, "_");
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);
  const steady = computeSteadyStateInit(psseCase);
  const freq = options?.baseFrequency ?? steady.basfrq;
  const sbase = steady.sbase;
  const omega0 = 2 * Math.PI * freq;
  const netlist = extractPowerFlowNetlist(psseCase);
  const ctx: DaeBlockContext = {
    dae,
    smoothLimits: Boolean(options?.smoothLimits),
  };
  const forcePowerFlowMode = options?.mode === "powerflow";
  const dyrRecords = psseCase.dyr?.records ?? [];

  // 1. Declare bus voltage & nodal power injection variables (4 per bus)
  const busFreqExprByBus = new Map<number, number>();
  for (const [busNum, bus] of psseCase.buses) {
    const bInit = getBusInit(steady, busNum, bus);
    dae.addVariable(`V_${busNum}_r`, VarType.Real, Variability.Continuous, Causality.Local, bInit.vr);
    dae.addVariable(`V_${busNum}_i`, VarType.Real, Variability.Continuous, Causality.Local, bInit.vi);
    dae.addVariable(`P_${busNum}_inj`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`Q_${busNum}_inj`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  }

  // Per-bus current injection accumulators (used on buses with .dyr dynamic equipment)
  const busDynamicIrTerms = new Map<number, number[]>();
  const busDynamicIiTerms = new Map<number, number[]>();
  const dynamicBuses = new Set<number>();

  const pushBusCurrent = (busNum: number, irExpr: number, iiExpr: number): void => {
    let irArr = busDynamicIrTerms.get(busNum);
    let iiArr = busDynamicIiTerms.get(busNum);
    if (!irArr) {
      irArr = [];
      busDynamicIrTerms.set(busNum, irArr);
    }
    if (!iiArr) {
      iiArr = [];
      busDynamicIiTerms.set(busNum, iiArr);
    }
    irArr.push(irExpr);
    iiArr.push(iiExpr);
  };

  // Optional explicit BUSFRQ estimators declared in .dyr
  for (const rec of dyrRecords) {
    const schema = resolveDyrModelSchema(rec.model);
    if (schema?.daeArchetype === "meas_bus_freq" && psseCase.buses.has(rec.ibus) && !busFreqExprByBus.has(rec.ibus)) {
      const bInit = getBusInit(steady, rec.ibus, psseCase.buses.get(rec.ibus));
      const vrExpr = dae.addNameExpr(`V_${rec.ibus}_r`);
      const viExpr = dae.addNameExpr(`V_${rec.ibus}_i`);
      busFreqExprByBus.set(
        rec.ibus,
        lowerBusFreqEstimatorToDae(
          ctx,
          rec.ibus,
          vrExpr,
          viExpr,
          bInit.vaRad,
          omega0,
          rec.namedParams["Tf"] ?? 0.04,
          rec.namedParams["Tw"] ?? 0.02,
        ),
      );
    }
  }

  const getBusFreqPuExpr = (busNum: number): number => {
    const existing = busFreqExprByBus.get(busNum);
    if (existing !== undefined) return existing;
    const bInit = getBusInit(steady, busNum, psseCase.buses.get(busNum));
    const vrExpr = dae.addNameExpr(`V_${busNum}_r`);
    const viExpr = dae.addNameExpr(`V_${busNum}_i`);
    const est = lowerBusFreqEstimatorToDae(ctx, busNum, vrExpr, viExpr, bInit.vaRad, omega0);
    busFreqExprByBus.set(busNum, est);
    return est;
  };

  // 2. Lower online generators & attached .dyr chains (PSS -> OEL/UEL/COMP -> Exciter -> Generator <- Governor)
  for (const gen of psseCase.generators) {
    if (gen.stat === 0) continue;
    const cleanId = gen.id.trim() || "1";
    const genId = `${gen.i}_${cleanId}`;
    const genInit = steady.gens.get(genId);
    if (!genInit) continue;

    const dyrGen = findUnitDyrRecord(dyrRecords, psseCase.dyr?.generatorsByBusId, gen.i, cleanId, "generator");
    const dyrExc = findUnitDyrRecord(dyrRecords, psseCase.dyr?.excitersByBusId, gen.i, cleanId, "exciter", true);
    const dyrGov = findUnitDyrRecord(dyrRecords, psseCase.dyr?.governorsByBusId, gen.i, cleanId, "governor");
    const dyrPss = findUnitDyrRecord(dyrRecords, psseCase.dyr?.stabilizersByBusId, gen.i, cleanId, "stabilizer");
    const limiters = psseCase.dyr?.limitersByBusId?.get(genId) ?? [];

    const bus = psseCase.buses.get(gen.i);
    const vrBusExpr = bus ? dae.addNameExpr(`V_${gen.i}_r`) : addReal(dae, 1.0);
    const viBusExpr = bus ? dae.addNameExpr(`V_${gen.i}_i`) : addReal(dae, 0.0);

    const genSchema = dyrGen ? resolveDyrModelSchema(dyrGen.model) : undefined;
    const genArch: DaeArchetypeId =
      genSchema?.daeArchetype ?? (dyrGen ? "sync_subtrans_round_6o" : "sync_classical_2o");

    if (!forcePowerFlowMode && dyrGen) {
      dynamicBuses.add(gen.i);

      // Check for WECC IBR / DER / Grid-Forming converter
      if (genInit.isIbr) {
        const freqPu = getBusFreqPuExpr(gen.i);
        const ibrPort = lowerIbrUnitToDae(
          ctx,
          genInit,
          dyrGen,
          dyrExc,
          dyrGov,
          genArch,
          sbase,
          omega0,
          vrBusExpr,
          viBusExpr,
          freqPu,
        );
        dae.addVariable(`Pe_${genId}`, VarType.Real, Variability.Continuous, Causality.Local, genInit.pgMw);
        dae.addEquation(EqKind.Simple, dae.addNameExpr(`Pe_${genId}`), ibrPort.pOutMwExpr);
        pushBusCurrent(gen.i, ibrPort.irSysExpr, ibrPort.iiSysExpr);
        continue;
      }

      // Full synchronous / induction machine with coupled network current injection
      // Declare forward-referenced signal wires for closed-loop PSS + Exciter + Governor <-> Machine
      const omegaRefName = `omega_${genId}`;
      const vtWireName = `Vt_gen_${genId}`;
      const peWireName = `Pe_${genId}`;
      const ifdWireName = `Ifd_gen_${genId}`;
      const idWireName = `Id_${genId}`;
      const iqWireName = `Iq_${genId}`;

      dae.addVariable(vtWireName, VarType.Real, Variability.Continuous, Causality.Local, genInit.vt);
      dae.addVariable(ifdWireName, VarType.Real, Variability.Continuous, Causality.Local, genInit.efd0);

      const vtWireExpr = dae.addNameExpr(vtWireName);
      const ifdWireExpr = dae.addNameExpr(ifdWireName);
      const omegaWireExpr = dae.addNameExpr(omegaRefName);
      const peWireExpr = dae.addNameExpr(peWireName);
      const idWireExpr = dae.addNameExpr(idWireName);
      const iqWireExpr = dae.addNameExpr(iqWireName);

      // Stabilizer (optional)
      let vsPssExpr = addReal(dae, 0.0);
      if (dyrPss) {
        const pssArch = resolveDyrModelSchema(dyrPss.model)?.daeArchetype ?? "pss_single_leadlag";
        vsPssExpr = lowerStabilizerUnitToDae(ctx, genInit, dyrPss, pssArch, omega0, omegaWireExpr, peWireExpr);
      }

      // Exciter + Limiters (optional; otherwise constant Efd = Efd0)
      let efdExpr: number;
      if (dyrExc) {
        const excArch = resolveDyrModelSchema(dyrExc.model)?.daeArchetype ?? "exc_ieee_st";
        efdExpr = lowerExciterUnitToDae(
          ctx,
          genInit,
          dyrExc,
          excArch,
          vtWireExpr,
          vsPssExpr,
          ifdWireExpr,
          idWireExpr,
          iqWireExpr,
          limiters,
        );
      } else {
        efdExpr = addReal(dae, genInit.efd0);
      }

      // Governor (optional; otherwise constant Pm = Tm0 * mbase)
      let pmExpr: number;
      if (dyrGov) {
        const govArch = resolveDyrModelSchema(dyrGov.model)?.daeArchetype ?? "gov_steam_simple";
        pmExpr = lowerGovernorUnitToDae(ctx, genInit, dyrGov, govArch, omega0, omegaWireExpr, peWireExpr);
      } else {
        pmExpr = addReal(dae, genInit.tm0 * genInit.mbase);
      }

      // Machine unit
      const machPort = lowerGeneratorUnitToDae(
        ctx,
        genInit,
        dyrGen,
        genArch,
        sbase,
        omega0,
        vrBusExpr,
        viBusExpr,
        pmExpr,
        efdExpr,
      );

      // Tie forward algebraic wires to machine ports
      dae.addEquation(EqKind.Simple, vtWireExpr, machPort.vtExpr);
      dae.addEquation(EqKind.Simple, ifdWireExpr, machPort.ifdExpr);

      // Optional generator trip relay
      const unitRelays = psseCase.dyr?.relaysByKey?.get(genId) ?? [];
      let tripScaleExpr = addReal(dae, 1.0);
      if (unitRelays.length > 0) {
        const freqHzExpr = mul(dae, getBusFreqPuExpr(gen.i), addReal(dae, freq));
        const tripFactors = unitRelays.map((r, rIdx) => {
          const rArch = resolveDyrModelSchema(r.model)?.daeArchetype ?? "relay_gen_trip";
          return lowerRelayToDae(ctx, r, rArch, machPort.vtExpr, freqHzExpr, rIdx);
        });
        tripScaleExpr = tripFactors.reduce((a, b) => mul(dae, a, b));
      }

      pushBusCurrent(gen.i, mul(dae, tripScaleExpr, machPort.irSysExpr), mul(dae, tripScaleExpr, machPort.iiSysExpr));
      continue;
    }

    // Legacy / PowerFlow / No-DYR classical generator representation (keeps pure-.raw tests 100% compatible)
    const H = dyrGen?.namedParams["H"] !== undefined && dyrGen.namedParams["H"] > 0 ? dyrGen.namedParams["H"] : 3.5;
    const D = dyrGen?.namedParams["D"] !== undefined && dyrGen.namedParams["D"] >= 0 ? dyrGen.namedParams["D"] : 1.0;
    const xdp = genInit.xdp;
    const deltaVar = dae.addVariable(
      `delta_${genId}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      genInit.delta0,
    );
    const omegaVar = dae.addVariable(`omega_${genId}`, VarType.Real, Variability.Continuous, Causality.Local, omega0);
    dae.addVariable(`Pe_${genId}`, VarType.Real, Variability.Continuous, Causality.Local, genInit.pgMw);

    const omegaExpr = dae.addNameExpr(`omega_${genId}`);
    const omegaDiff = sub(dae, omegaExpr, addReal(dae, omega0));
    dae.addEquation(EqKind.Simple, dae.addDerExpr(deltaVar), omegaDiff);

    const pmExpr = addReal(dae, genInit.pgMw);
    const lhsSwing = mul(dae, addReal(dae, (2.0 * H) / omega0), dae.addDerExpr(omegaVar));
    const peExpr = dae.addNameExpr(`Pe_${genId}`);
    const dampTerm = mul(dae, addReal(dae, (D * sbase) / omega0), omegaDiff);
    dae.addEquation(EqKind.Simple, lhsSwing, sub(dae, sub(dae, pmExpr, peExpr), dampTerm));

    const vtBusExpr = bus
      ? dae.addCallExpr("sqrt", [add(dae, mul(dae, vrBusExpr, vrBusExpr), mul(dae, viBusExpr, viBusExpr))])
      : addReal(dae, 1.0);
    const thetaBusExpr = bus ? dae.addCallExpr("atan2", [viBusExpr, vrBusExpr]) : addReal(dae, 0.0);
    const deltaExpr = dae.addNameExpr(`delta_${genId}`);
    const sinAngleDiff = dae.addCallExpr("sin", [sub(dae, deltaExpr, thetaBusExpr)]);
    const peCouple = mul(dae, mul(dae, addReal(dae, (1.05 * sbase) / xdp), vtBusExpr), sinAngleDiff);
    dae.addEquation(EqKind.Simple, peExpr, peCouple);
  }

  // 3. Lower Dynamic Loads, FACTS, and HVDC records onto buses when in transient mode
  const dynamicLoadConsumedBus = new Set<number>();
  if (!forcePowerFlowMode && dyrRecords.length > 0) {
    let fIdx = 0;
    for (const rec of dyrRecords) {
      const schema = resolveDyrModelSchema(rec.model);
      if (!schema) continue;

      if (rec.category === "load" && psseCase.buses.has(rec.ibus)) {
        const bus = psseCase.buses.get(rec.ibus)!;
        const bInit = getBusInit(steady, rec.ibus, bus);
        const busLoads = psseCase.loads.filter((l) => l.i === rec.ibus && l.status !== 0);
        const pLoadMw = busLoads.reduce((s, l) => s + l.pl, 0.0);
        const qLoadMvar = busLoads.reduce((s, l) => s + l.ql, 0.0);
        if (Math.abs(pLoadMw) > 1e-6 || Math.abs(qLoadMvar) > 1e-6) {
          dynamicBuses.add(rec.ibus);
          dynamicLoadConsumedBus.add(rec.ibus);
          const vrExpr = dae.addNameExpr(`V_${rec.ibus}_r`);
          const viExpr = dae.addNameExpr(`V_${rec.ibus}_i`);
          const freqPu = getBusFreqPuExpr(rec.ibus);
          const ldPort = lowerDynamicLoadToDae(
            ctx,
            rec.ibus,
            rec.id,
            rec,
            schema.daeArchetype,
            pLoadMw,
            qLoadMvar,
            bInit.vm,
            sbase,
            vrExpr,
            viExpr,
            freqPu,
          );
          // Load draws current from the bus -> negative nodal injection
          pushBusCurrent(
            rec.ibus,
            mul(dae, addReal(dae, -1.0), ldPort.irSysExpr),
            mul(dae, addReal(dae, -1.0), ldPort.iiSysExpr),
          );
        }
      } else if (
        (rec.category === "facts" || rec.category === "hvdc") &&
        rec.ibus > 0 &&
        psseCase.buses.has(rec.ibus)
      ) {
        dynamicBuses.add(rec.ibus);
        const bInit = getBusInit(steady, rec.ibus, psseCase.buses.get(rec.ibus));
        const vrExpr = dae.addNameExpr(`V_${rec.ibus}_r`);
        const viExpr = dae.addNameExpr(`V_${rec.ibus}_i`);
        const fPort = lowerFactsOrHvdcToDae(ctx, rec, schema.daeArchetype, bInit.vm, sbase, vrExpr, viExpr, fIdx++);
        pushBusCurrent(rec.ibus, fPort.irSysExpr, fPort.iiSysExpr);
      }
    }
  }

  // 4. Emit Nodal AC Kirchhoff Balance for every bus (4 equations per bus)
  for (let i = 0; i < netlist.nBuses; i++) {
    const busNum = netlist.busNumbers[i]!;
    const bus = psseCase.buses.get(busNum)!;
    const vrExpr = dae.addNameExpr(`V_${busNum}_r`);
    const viExpr = dae.addNameExpr(`V_${busNum}_i`);
    const pInj = dae.addNameExpr(`P_${busNum}_inj`);
    const qInj = dae.addNameExpr(`Q_${busNum}_inj`);

    // Construct nodal current injection expressions from Ybus:
    // I_ybus_r = sum_k (G_ik * V_k_r - B_ik * V_k_i)
    // I_ybus_i = sum_k (B_ik * V_k_r + G_ik * V_k_i)
    const rowG = netlist.ybus.g.get(i);
    const rowB = netlist.ybus.b.get(i);
    const neighbors = Array.from(new Set([...(rowG?.keys() ?? []), ...(rowB?.keys() ?? [])])).sort((a, b) => a - b);

    const irTerms: number[] = [];
    const iiTerms: number[] = [];

    for (const k of neighbors) {
      const g = rowG?.get(k) ?? 0.0;
      const b = rowB?.get(k) ?? 0.0;
      if (Math.abs(g) < 1e-12 && Math.abs(b) < 1e-12) continue;
      const kBusNum = netlist.busNumbers[k]!;
      const vkr = dae.addNameExpr(`V_${kBusNum}_r`);
      const vki = dae.addNameExpr(`V_${kBusNum}_i`);

      irTerms.push(sub(dae, mul(dae, addReal(dae, g), vkr), mul(dae, addReal(dae, b), vki)));
      iiTerms.push(add(dae, mul(dae, addReal(dae, b), vkr), mul(dae, addReal(dae, g), vki)));
    }

    const irSumExpr = irTerms.length > 0 ? sumExprs(dae, irTerms) : vrExpr;
    const iiSumExpr = iiTerms.length > 0 ? sumExprs(dae, iiTerms) : viExpr;

    if (dynamicBuses.has(busNum)) {
      // Dynamic Kirchhoff Nodal Current Balance:
      // Include any static online generators or static loads on this bus not already modeled dynamically
      const busStaticGens = psseCase.generators.filter((g) => {
        if (g.i !== busNum || g.stat === 0) return false;
        const cleanId = g.id.trim() || "1";
        return !findUnitDyrRecord(dyrRecords, psseCase.dyr?.generatorsByBusId, g.i, cleanId, "generator");
      });
      const v2Expr = emitMax(ctx, addReal(dae, 1e-4), add(dae, mul(dae, vrExpr, vrExpr), mul(dae, viExpr, viExpr)));

      for (const sg of busStaticGens) {
        const sgInit = steady.gens.get(`${sg.i}_${sg.id.trim() || "1"}`);
        const pPu = (sgInit?.pgMw ?? sg.pg) / sbase;
        const qPu = (sgInit?.qgMvar ?? sg.qg) / sbase;
        pushBusCurrent(
          busNum,
          div(dae, add(dae, mul(dae, addReal(dae, pPu), vrExpr), mul(dae, addReal(dae, qPu), viExpr)), v2Expr),
          div(dae, sub(dae, mul(dae, addReal(dae, pPu), viExpr), mul(dae, addReal(dae, qPu), vrExpr)), v2Expr),
        );
      }

      if (!dynamicLoadConsumedBus.has(busNum)) {
        const busLoads = psseCase.loads.filter((l) => l.i === busNum && l.status !== 0);
        const totalPlPu = busLoads.reduce((sum, l) => sum + l.pl, 0.0) / sbase;
        const totalQlPu = busLoads.reduce((sum, l) => sum + l.ql, 0.0) / sbase;
        if (Math.abs(totalPlPu) > 1e-9 || Math.abs(totalQlPu) > 1e-9) {
          // Static constant-impedance conversion at initial bus voltage
          const bInit = getBusInit(steady, busNum, bus);
          const v02 = Math.max(1e-4, bInit.vm * bInit.vm);
          const gLoad = totalPlPu / v02;
          const bLoad = totalQlPu / v02;
          pushBusCurrent(
            busNum,
            mul(
              dae,
              addReal(dae, -1.0),
              add(dae, mul(dae, addReal(dae, gLoad), vrExpr), mul(dae, addReal(dae, bLoad), viExpr)),
            ),
            mul(
              dae,
              addReal(dae, -1.0),
              sub(dae, mul(dae, addReal(dae, gLoad), viExpr), mul(dae, addReal(dae, bLoad), vrExpr)),
            ),
          );
        }
      }

      const eqIrTerms = busDynamicIrTerms.get(busNum) ?? [];
      const eqIiTerms = busDynamicIiTerms.get(busNum) ?? [];
      const netEquipIr = sumExprs(dae, eqIrTerms);
      const netEquipIi = sumExprs(dae, eqIiTerms);

      // Bus Eq 1 & 2: Exact rectangular nodal current balance Ybus * V = I_equip
      dae.addEquation(EqKind.Simple, irSumExpr, netEquipIr);
      dae.addEquation(EqKind.Simple, iiSumExpr, netEquipIi);

      // Bus Eq 3 & 4: Nodal active/reactive power injection telemetry P_inj, Q_inj
      const pCalcMw = mul(dae, addReal(dae, sbase), add(dae, mul(dae, vrExpr, irSumExpr), mul(dae, viExpr, iiSumExpr)));
      const qCalcMvar = mul(
        dae,
        addReal(dae, sbase),
        sub(dae, mul(dae, viExpr, irSumExpr), mul(dae, vrExpr, iiSumExpr)),
      );
      dae.addEquation(EqKind.Simple, pInj, pCalcMw);
      dae.addEquation(EqKind.Simple, qInj, qCalcMvar);
    } else {
      // Static power-flow / no-DYR bus balance (preserves PV/Slack constraints)
      const busGens = psseCase.generators.filter((g) => g.i === busNum && g.stat !== 0);
      const totalQg = busGens.reduce(
        (sum, g) => sum + (steady.gens.get(`${g.i}_${g.id.trim() || "1"}`)?.qgMvar ?? g.qg),
        0.0,
      );
      const busLoads = psseCase.loads.filter((l) => l.i === busNum && l.status !== 0);
      const totalPl = busLoads.reduce((sum, l) => sum + l.pl, 0.0);
      const totalQl = busLoads.reduce((sum, l) => sum + l.ql, 0.0);

      let pGenSumExpr = addReal(dae, 0.0);
      for (const g of busGens) {
        const genId = `${g.i}_${g.id.trim() || "1"}`;
        pGenSumExpr = add(dae, pGenSumExpr, dae.addNameExpr(`Pe_${genId}`));
      }
      const pNetExpr = sub(dae, pGenSumExpr, addReal(dae, totalPl));
      const qNet = totalQg - totalQl;

      dae.addEquation(EqKind.Simple, pInj, pNetExpr);
      dae.addEquation(EqKind.Simple, qInj, addReal(dae, qNet));

      const pCalcPu = add(dae, mul(dae, vrExpr, irSumExpr), mul(dae, viExpr, iiSumExpr));
      dae.addEquation(EqKind.Simple, pCalcPu, div(dae, pInj, addReal(dae, sbase)));

      if (bus.ide === 2 || bus.ide === 3) {
        const bInit = getBusInit(steady, busNum, bus);
        const vSet = bInit.vm > 0 ? bInit.vm : 1.0;
        const vMag2 = add(dae, mul(dae, vrExpr, vrExpr), mul(dae, viExpr, viExpr));
        dae.addEquation(EqKind.Simple, vMag2, addReal(dae, vSet * vSet));
      } else {
        const qCalcPu = sub(dae, mul(dae, viExpr, irSumExpr), mul(dae, vrExpr, iiSumExpr));
        dae.addEquation(EqKind.Simple, qCalcPu, div(dae, qInj, addReal(dae, sbase)));
      }
    }
  }

  return dae;
}

export interface PsseComponentParamOverride {
  value?: number | undefined;
  exprId?: number | undefined;
}

export interface PsseDeferredInputDefault {
  varName: string;
  rhsExprId: number;
}

export interface PsseComponentLowerOptions {
  paramOverrides?: Record<string, PsseComponentParamOverride> | undefined;
  connectedInputPorts?: ReadonlySet<string> | undefined;
  deferInputDefaults?: boolean | undefined;
  smoothLimits?: boolean | undefined;
}

/**
 * Lowers a single PSS/E standard dynamic model instance (any of the ~366 schemas in `DYR_MODEL_SCHEMAS`)
 * directly into linear-memory `DAEBuilder` variables and equations.
 *
 * Maintains exact `nVars === nEqs` structural balance both standalone and when wired in Modelica / SysML v2.
 */
export function lowerPsseComponentToDae(
  dae: DAEBuilder,
  modelName: string,
  instancePrefix: string,
  options?: PsseComponentLowerOptions,
): PsseDeferredInputDefault[] {
  const upperModel = modelName.toUpperCase();
  const schema = resolveDyrModelSchema(upperModel) ?? DYR_MODEL_SCHEMAS["GENROU"]!;
  const defaults = {
    ...(PSSE_MODEL_DEFAULTS[upperModel] ?? PSSE_MODEL_DEFAULTS[schema.model] ?? PSSE_MODEL_DEFAULTS["GENROU"]!),
  };
  const overrides = options?.paramOverrides ?? {};
  const connected = options?.connectedInputPorts ?? new Set<string>();
  const deferredDefaults: PsseDeferredInputDefault[] = [];
  const ctx: DaeBlockContext = { dae, smoothLimits: Boolean(options?.smoothLimits) };

  const p = (localName: string): string => (instancePrefix ? `${instancePrefix}.${localName}` : localName);

  // 1. Emit declared DYR + operating-point parameters as Variability.Parameter
  const numericParams: Record<string, number> = { ...defaults };
  const allParamNames = new Set<string>(schema.params.map((sp) => sp.name));
  for (const k of Object.keys(defaults)) {
    allParamNames.add(k);
  }
  for (const k of Object.keys(overrides)) {
    allParamNames.add(k);
  }

  for (const paramName of allParamNames) {
    const ov = overrides[paramName];
    const startVal = ov?.value !== undefined && Number.isFinite(ov.value) ? ov.value : (defaults[paramName] ?? 0.0);
    numericParams[paramName] = startVal;
    const varIdx = dae.addVariable(p(paramName), VarType.Real, Variability.Parameter, Causality.Local, startVal);
    const bindExpr = ov?.exprId !== undefined ? ov.exprId : addReal(dae, startVal);
    dae.setVarExpression(varIdx, bindExpr);
  }

  const ensureParamExpr = (paramName: string, fallbackVal: number): number => {
    if (allParamNames.has(paramName)) {
      return dae.addNameExpr(p(paramName));
    }
    return addReal(dae, fallbackVal);
  };

  // 2. Emit connectable signal ports
  const portSpecs = getPsseModelPortSpecs(upperModel, schema.category);
  const portStartVal = (portName: string): number => {
    switch (portName) {
      case "Pm_in":
      case "Pm_out":
      case "Pe_out":
      case "Pcmd_in":
      case "Ip_out":
      case "P_out":
      case "Pdc_out":
        return numericParams["P0"] ?? 0.8;
      case "Qcmd_in":
      case "Iq_out":
      case "Q_out":
        return numericParams["Q0"] ?? 0.0;
      case "Efd_in":
      case "Efd_out":
        return numericParams["Efd0"] ?? 1.05;
      case "Vt_in":
      case "Vr_in":
      case "Vi_in":
      case "Signal_in":
        return numericParams["V0"] ?? 1.0;
      case "omega_in":
      case "omega_out":
        return numericParams["omega0"] ?? 376.99111843077515;
      case "Trip_out":
        return 1.0;
      default:
        return 0.0;
    }
  };

  for (const port of portSpecs) {
    dae.addVariable(p(port.name), VarType.Real, Variability.Continuous, Causality.Local, portStartVal(port.name));
  }

  const bindUnconnectedInput = (portName: string, defaultRhsExpr: number): void => {
    if (connected.has(portName)) return;
    if (options?.deferInputDefaults) {
      deferredDefaults.push({ varName: p(portName), rhsExprId: defaultRhsExpr });
      return;
    }
    dae.addEquation(EqKind.Simple, dae.addNameExpr(p(portName)), defaultRhsExpr);
  };

  // 3. Emit archetype-specific balanced linear-memory differential & algebraic equations
  const arch = schema.daeArchetype;

  if (arch === "ibr_regc_converter" || arch === "ibr_dera_aggregate" || arch === "ibr_regfm_vsm") {
    const p0Val = numericParams["P0"] ?? 0.8;
    const q0Val = numericParams["Q0"] ?? 0.0;
    const v0Val = Math.max(0.1, numericParams["V0"] ?? 1.0);
    bindUnconnectedInput("Pcmd_in", ensureParamExpr("P0", p0Val));
    bindUnconnectedInput("Qcmd_in", ensureParamExpr("Q0", q0Val));
    bindUnconnectedInput("Vt_in", ensureParamExpr("V0", v0Val));

    const tgNum = Math.max(0.005, numericParams["Tg"] ?? numericParams["Tp"] ?? 0.02);
    const tfltrNum = Math.max(0.005, numericParams["Tfltr"] ?? numericParams["Tiq"] ?? 0.02);
    const tgExpr = allParamNames.has("Tg") ? dae.addNameExpr(p("Tg")) : addReal(dae, tgNum);
    const tfltrExpr = allParamNames.has("Tfltr") ? dae.addNameExpr(p("Tfltr")) : addReal(dae, tfltrNum);
    const v0Expr = ensureParamExpr("V0", v0Val);
    const khvExpr = ensureParamExpr("Khv", 0.7);

    const ipExpr = emitFirstOrderLag(
      ctx,
      p("Ip"),
      div(dae, dae.addNameExpr(p("Pcmd_in")), v0Expr),
      addReal(dae, 1.0),
      tgExpr,
      tgNum,
      p0Val / v0Val,
    );
    const iqTarget = add(
      dae,
      div(dae, dae.addNameExpr(p("Qcmd_in")), v0Expr),
      mul(dae, khvExpr, sub(dae, v0Expr, dae.addNameExpr(p("Vt_in")))),
    );
    const iqExpr = emitFirstOrderLag(ctx, p("Iq"), iqTarget, addReal(dae, 1.0), tfltrExpr, tfltrNum, q0Val / v0Val);
    dae.addEquation(EqKind.Simple, dae.addNameExpr(p("Ip_out")), ipExpr);
    dae.addEquation(EqKind.Simple, dae.addNameExpr(p("Iq_out")), iqExpr);
    return deferredDefaults;
  }

  if (schema.category === "generator") {
    const omega0Val = Math.max(1.0, numericParams["omega0"] ?? 376.99111843077515);
    const p0Val = numericParams["P0"] ?? 0.8;
    const v0Val = Math.max(0.1, numericParams["V0"] ?? 1.0);
    const efd0Val = Math.max(0.1, numericParams["Efd0"] ?? 1.05);
    const xdpVal = Math.max(0.05, numericParams["Xdp"] ?? 0.25);
    const delta0Val = (p0Val * xdpVal) / (efd0Val * v0Val);

    bindUnconnectedInput("Pm_in", ensureParamExpr("P0", p0Val));
    bindUnconnectedInput("Efd_in", ensureParamExpr("Efd0", efd0Val));
    bindUnconnectedInput("Vt_in", ensureParamExpr("V0", v0Val));

    dae.addVariable(p("delta"), VarType.Real, Variability.Continuous, Causality.Local, delta0Val);
    dae.addVariable(p("omega"), VarType.Real, Variability.Continuous, Causality.Local, omega0Val);

    const omega0Expr = ensureParamExpr("omega0", omega0Val);
    const hExpr = ensureParamExpr("H", Math.max(0.1, numericParams["H"] || 3.5));
    const dExpr = ensureParamExpr("D", numericParams["D"] ?? 1.0);
    const xdpExpr = ensureParamExpr("Xdp", xdpVal);
    const p0Expr = ensureParamExpr("P0", p0Val);
    const v0Expr = ensureParamExpr("V0", v0Val);

    const omegaDiff = sub(dae, dae.addNameExpr(p("omega")), omega0Expr);
    dae.addEquation(EqKind.Simple, dae.addDerExpr(dae.addNameExpr(p("delta"))), omegaDiff);

    const mInertia = div(dae, mul(dae, addReal(dae, 2.0), hExpr), omega0Expr);
    const lhsSwing = mul(dae, mInertia, dae.addDerExpr(dae.addNameExpr(p("omega"))));
    const pAccel = sub(dae, dae.addNameExpr(p("Pm_in")), dae.addNameExpr(p("Pe_out")));
    const dampTerm = mul(dae, dExpr, div(dae, omegaDiff, omega0Expr));
    dae.addEquation(EqKind.Simple, lhsSwing, sub(dae, pAccel, dampTerm));

    const sinDeltaDev = dae.addCallExpr("sin", [sub(dae, dae.addNameExpr(p("delta")), addReal(dae, delta0Val))]);

    if (arch === "sync_classical_2o") {
      const kSync = div(dae, mul(dae, dae.addNameExpr(p("Efd_in")), dae.addNameExpr(p("Vt_in"))), xdpExpr);
      dae.addEquation(EqKind.Simple, dae.addNameExpr(p("Pe_out")), add(dae, p0Expr, mul(dae, kSync, sinDeltaDev)));
    } else {
      dae.addVariable(p("Eqp"), VarType.Real, Variability.Continuous, Causality.Local, efd0Val);
      dae.addVariable(p("Edp"), VarType.Real, Variability.Continuous, Causality.Local, 0.0);

      const td0pNum = Math.max(0.05, numericParams["Td0p"] ?? numericParams["T0p"] ?? 6.5);
      const tq0pNum = Math.max(0.05, numericParams["Tq0p"] ?? numericParams["Tq0pp"] ?? numericParams["T0pp"] ?? 0.5);
      const td0pExpr = allParamNames.has("Td0p") ? dae.addNameExpr(p("Td0p")) : addReal(dae, td0pNum);
      const tq0pExpr = allParamNames.has("Tq0p") ? dae.addNameExpr(p("Tq0p")) : addReal(dae, tq0pNum);
      const xdExpr = ensureParamExpr("Xd", Math.max(xdpVal, numericParams["Xd"] ?? 1.8));
      const xqExpr = ensureParamExpr("Xq", Math.max(xdpVal, numericParams["Xq"] ?? 1.7));
      const xqpExpr = allParamNames.has("Xqp")
        ? dae.addNameExpr(p("Xqp"))
        : addReal(dae, Math.max(0.05, numericParams["Xdpp"] ?? 0.25));
      const efd0Expr = ensureParamExpr("Efd0", efd0Val);

      const lhsEqp = mul(dae, td0pExpr, dae.addDerExpr(dae.addNameExpr(p("Eqp"))));
      const armDrop = mul(
        dae,
        div(dae, sub(dae, xdExpr, xdpExpr), xdExpr),
        sub(dae, v0Expr, dae.addNameExpr(p("Vt_in"))),
      );
      dae.addEquation(
        EqKind.Simple,
        lhsEqp,
        sub(dae, sub(dae, dae.addNameExpr(p("Efd_in")), dae.addNameExpr(p("Eqp"))), armDrop),
      );

      const lhsEdp = mul(dae, tq0pExpr, dae.addDerExpr(dae.addNameExpr(p("Edp"))));
      const qGain = div(dae, sub(dae, xqExpr, xqpExpr), xqExpr);
      dae.addEquation(EqKind.Simple, lhsEdp, sub(dae, mul(dae, qGain, sinDeltaDev), dae.addNameExpr(p("Edp"))));

      const fluxScale = mul(
        dae,
        div(dae, dae.addNameExpr(p("Eqp")), efd0Expr),
        div(dae, dae.addNameExpr(p("Vt_in")), v0Expr),
      );
      const syncAmp = div(dae, mul(dae, dae.addNameExpr(p("Eqp")), dae.addNameExpr(p("Vt_in"))), xdpExpr);
      dae.addEquation(
        EqKind.Simple,
        dae.addNameExpr(p("Pe_out")),
        add(dae, mul(dae, p0Expr, fluxScale), mul(dae, syncAmp, sinDeltaDev)),
      );
    }

    dae.addEquation(EqKind.Simple, dae.addNameExpr(p("omega_out")), dae.addNameExpr(p("omega")));
    return deferredDefaults;
  }

  if (schema.category === "exciter") {
    const v0Val = numericParams["V0"] ?? 1.0;
    const efd0Val = numericParams["Efd0"] ?? 1.05;

    bindUnconnectedInput("Vt_in", ensureParamExpr("V0", v0Val));
    bindUnconnectedInput("Vs_in", addReal(dae, 0.0));

    const kaNum = Math.max(
      1.0,
      numericParams["KA"] ?? numericParams["K"] ?? numericParams["KPR"] ?? numericParams["Kvp"] ?? 100.0,
    );
    const taNum = Math.max(0.01, numericParams["TA"] ?? numericParams["TE"] ?? numericParams["Tiq"] ?? 0.05);
    const kaExpr = allParamNames.has("KA")
      ? dae.addNameExpr(p("KA"))
      : allParamNames.has("K")
        ? dae.addNameExpr(p("K"))
        : addReal(dae, kaNum);
    const taExpr = allParamNames.has("TA")
      ? dae.addNameExpr(p("TA"))
      : allParamNames.has("TE")
        ? dae.addNameExpr(p("TE"))
        : addReal(dae, taNum);
    const v0Expr = ensureParamExpr("V0", v0Val);
    const efd0Expr = ensureParamExpr("Efd0", efd0Val);
    const vrMaxExpr = addReal(dae, Math.max(efd0Val + 1.0, numericParams["VRMAX"] ?? numericParams["EMAX"] ?? 5.0));
    const vrMinExpr = addReal(dae, Math.min(0.0, numericParams["VRMIN"] ?? numericParams["EMIN"] ?? -4.0));

    const vErr = add(dae, sub(dae, v0Expr, dae.addNameExpr(p("Vt_in"))), dae.addNameExpr(p("Vs_in")));
    const regTarget = add(dae, efd0Expr, mul(dae, kaExpr, vErr));
    const tcNum = Math.max(0.0, numericParams["TC"] ?? 0.0);
    const tbNum = Math.max(0.0, numericParams["TB"] ?? 0.0);
    const tgrOut = emitLeadLag(ctx, p("x_tgr"), regTarget, addReal(dae, tcNum), addReal(dae, tbNum), tbNum, efd0Val);
    dae.addVariable(p("Efd"), VarType.Real, Variability.Continuous, Causality.Local, efd0Val);
    dae.addEquation(
      EqKind.Simple,
      mul(dae, taExpr, dae.addDerExpr(dae.addNameExpr(p("Efd")))),
      sub(dae, emitClamp(ctx, tgrOut, vrMinExpr, vrMaxExpr), dae.addNameExpr(p("Efd"))),
    );
    dae.addEquation(EqKind.Simple, dae.addNameExpr(p("Efd_out")), dae.addNameExpr(p("Efd")));
    return deferredDefaults;
  }

  if (schema.category === "governor") {
    const p0Val = numericParams["P0"] ?? 0.8;
    const omega0Val = Math.max(1.0, numericParams["omega0"] ?? 376.99111843077515);

    bindUnconnectedInput("omega_in", ensureParamExpr("omega0", omega0Val));

    const tGovNum = Math.max(
      0.02,
      numericParams["T1"] ?? numericParams["Tg"] ?? numericParams["Tact"] ?? numericParams["Tp"] ?? 0.5,
    );
    const tGovExpr = allParamNames.has("T1")
      ? dae.addNameExpr(p("T1"))
      : allParamNames.has("Tg")
        ? dae.addNameExpr(p("Tg"))
        : addReal(dae, tGovNum);
    const droopGainExpr = allParamNames.has("R")
      ? div(dae, addReal(dae, 1.0), dae.addNameExpr(p("R")))
      : allParamNames.has("K")
        ? dae.addNameExpr(p("K"))
        : addReal(dae, 20.0);
    const p0Expr = ensureParamExpr("P0", p0Val);
    const omega0Expr = ensureParamExpr("omega0", omega0Val);

    const speedPuErr = div(dae, sub(dae, dae.addNameExpr(p("omega_in")), omega0Expr), omega0Expr);
    const pCmd = sub(dae, p0Expr, mul(dae, droopGainExpr, speedPuErr));
    const pmExpr = emitFirstOrderLag(ctx, p("Pm"), pCmd, addReal(dae, 1.0), tGovExpr, tGovNum, p0Val);
    dae.addEquation(EqKind.Simple, dae.addNameExpr(p("Pm_out")), pmExpr);
    return deferredDefaults;
  }

  if (schema.category === "stabilizer") {
    const omega0Val = Math.max(1.0, numericParams["omega0"] ?? 376.99111843077515);
    bindUnconnectedInput("omega_in", ensureParamExpr("omega0", omega0Val));

    const twNum = Math.max(
      0.05,
      numericParams["T6"] ?? numericParams["Tw1"] ?? numericParams["T"] ?? numericParams["T2"] ?? 5.0,
    );
    const ksNum = numericParams["KS"] ?? numericParams["Ks1"] ?? numericParams["K"] ?? numericParams["KL"] ?? 10.0;
    const twExpr = allParamNames.has("T6")
      ? dae.addNameExpr(p("T6"))
      : allParamNames.has("Tw1")
        ? dae.addNameExpr(p("Tw1"))
        : addReal(dae, twNum);
    const ksExpr = allParamNames.has("KS")
      ? dae.addNameExpr(p("KS"))
      : allParamNames.has("Ks1")
        ? dae.addNameExpr(p("Ks1"))
        : addReal(dae, ksNum);
    const omega0Expr = ensureParamExpr("omega0", omega0Val);
    const speedPu = div(dae, sub(dae, dae.addNameExpr(p("omega_in")), omega0Expr), omega0Expr);
    const washDiff = emitWashout(ctx, p("x_wash"), speedPu, ksExpr, twExpr, twNum, 0.0, ksNum);
    dae.addEquation(EqKind.Simple, dae.addNameExpr(p("Vs_out")), washDiff);
    return deferredDefaults;
  }

  if (schema.category === "load") {
    const v0Val = Math.max(0.1, numericParams["V0"] ?? 1.0);
    const p0Val = numericParams["P0"] ?? 0.8;
    const q0Val = numericParams["Q0"] ?? 0.0;
    const omega0Val = Math.max(1.0, numericParams["omega0"] ?? 376.99111843077515);
    bindUnconnectedInput("Vt_in", ensureParamExpr("V0", v0Val));
    bindUnconnectedInput("omega_in", ensureParamExpr("omega0", omega0Val));

    const vRatio = div(dae, dae.addNameExpr(p("Vt_in")), ensureParamExpr("V0", v0Val));
    const v2 = mul(dae, vRatio, vRatio);
    if (arch === "load_static_zipf") {
      dae.addEquation(EqKind.Simple, dae.addNameExpr(p("P_out")), mul(dae, ensureParamExpr("P0", p0Val), v2));
      dae.addEquation(EqKind.Simple, dae.addNameExpr(p("Q_out")), mul(dae, ensureParamExpr("Q0", q0Val), v2));
    } else {
      const s0 = 0.02;
      const slipExpr = emitFirstOrderLag(
        ctx,
        p("slip"),
        mul(dae, addReal(dae, s0), div(dae, addReal(dae, 1.0), emitMax(ctx, addReal(dae, 0.2), v2))),
        addReal(dae, 1.0),
        addReal(dae, 0.5),
        0.5,
        s0,
      );
      dae.addEquation(
        EqKind.Simple,
        dae.addNameExpr(p("P_out")),
        mul(dae, ensureParamExpr("P0", p0Val), mul(dae, v2, div(dae, slipExpr, addReal(dae, s0)))),
      );
      dae.addEquation(EqKind.Simple, dae.addNameExpr(p("Q_out")), mul(dae, ensureParamExpr("Q0", q0Val), v2));
    }
    return deferredDefaults;
  }

  if (schema.category === "facts") {
    const v0Val = Math.max(0.1, numericParams["V0"] ?? 1.0);
    bindUnconnectedInput("Vt_in", ensureParamExpr("V0", v0Val));
    const kGain = Math.max(0.1, numericParams["K"] ?? numericParams["Kp"] ?? 20.0);
    const trNum = Math.max(0.01, numericParams["Tr"] ?? numericParams["T3"] ?? 0.02);
    const qCmd = mul(dae, addReal(dae, kGain), sub(dae, ensureParamExpr("V0", v0Val), dae.addNameExpr(p("Vt_in"))));
    const qFilt = emitFirstOrderLag(ctx, p("Q_svc"), qCmd, addReal(dae, 1.0), addReal(dae, trNum), trNum, 0.0);
    dae.addEquation(EqKind.Simple, dae.addNameExpr(p("Q_out")), qFilt);
    return deferredDefaults;
  }

  if (schema.category === "hvdc") {
    const v0Val = Math.max(0.1, numericParams["V0"] ?? 1.0);
    const p0Val = numericParams["P0"] ?? 0.8;
    bindUnconnectedInput("Vr_in", ensureParamExpr("V0", v0Val));
    bindUnconnectedInput("Vi_in", ensureParamExpr("V0", v0Val));
    const tpNum = Math.max(0.01, numericParams["Tp"] ?? numericParams["Tidc"] ?? 0.02);
    const pDc = emitFirstOrderLag(
      ctx,
      p("P_dc"),
      ensureParamExpr("P0", p0Val),
      addReal(dae, 1.0),
      addReal(dae, tpNum),
      tpNum,
      p0Val,
    );
    dae.addEquation(EqKind.Simple, dae.addNameExpr(p("Pdc_out")), pDc);
    return deferredDefaults;
  }

  // Relay / measurement fallback
  const v0Val = numericParams["V0"] ?? 1.0;
  bindUnconnectedInput("Signal_in", ensureParamExpr("V0", v0Val));
  dae.addVariable(p("tripState"), VarType.Real, Variability.Continuous, Causality.Local, 1.0);
  dae.addEquation(EqKind.Simple, dae.addNameExpr(p("tripState")), addReal(dae, 1.0));
  dae.addEquation(EqKind.Simple, dae.addNameExpr(p("Trip_out")), dae.addNameExpr(p("tripState")));
  void BinOp;
  return deferredDefaults;
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/aspen — Direct Linear-Memory DAE Arena Lowering for Chemical Process Flowsheets.
 *
 * Compiles Aspen Plus unit operations (Flash drums, RadFrac columns, Pumps, Compressors,
 * Heat Exchangers) and multi-component mass/energy balance equations directly into
 * ModelScript's zero-GC WebAssembly DAEBuilder struct-of-arrays arena:
 *   1. Stream state variables: Molar flows (F_{stream}), Temperatures (T_{stream}), Pressures (P_{stream})
 *   2. Component species mass balances: F_{stream, comp} = F_{stream} * z_{comp}
 *   3. Flash equilibrium: F_{in} = F_{vap} + F_{liq}, VLE stage splits
 *   4. Mechanical equipment: Pressure differential DeltaP and shaft work W
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import { solveFlashRachfordRice } from "../solvers/flash-solver.js";
import type { AspenDeck } from "../types.js";

export interface AspenDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
}

export function lowerAspenToDae(deck: AspenDeck, options?: AspenDaeOptions): DAEBuilder {
  const modelName = (options?.modelName ?? (deck.title || "ChemicalFlowsheet")).replace(/[^a-zA-Z0-9_]/g, "_");
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  // Track which variables have received a governing equation to guarantee structural squareness (N_vars === N_eqs)
  const assignedVars = new Set<number>();
  const varDefaultVal = new Map<number, number>();

  const declareVar = (
    name: string,
    type: VarType,
    variability: Variability,
    causality: Causality,
    startVal: number,
  ): number => {
    const existing = dae.lookupVariable(name);
    if (existing !== -1) return existing;
    const id = dae.addVariable(name, type, variability, causality, startVal);
    varDefaultVal.set(id, startVal);
    return id;
  };

  const assignEq = (targetVarId: number, lhsExpr: number, rhsExpr: number): void => {
    if (targetVarId === -1 || assignedVars.has(targetVarId)) return;
    assignedVars.add(targetVarId);
    dae.addEquation(EqKind.Simple, lhsExpr, rhsExpr);
  };

  // 1. Declare components list
  let compList = Array.from(deck.components.keys());
  if (compList.length === 0) {
    compList = ["METHANOL", "WATER"];
  }

  // Combine streams from FLOWSHEET and explicit STREAM blocks
  const allStreamIds = new Set<string>();
  const producedStreams = new Set<string>();
  for (const sId of deck.streams.keys()) allStreamIds.add(sId);
  for (const entry of deck.flowsheet) {
    for (const s of entry.inlets) allStreamIds.add(s);
    for (const s of entry.outlets) {
      allStreamIds.add(s);
      producedStreams.add(s);
    }
  }

  for (const sId of allStreamIds) {
    const sDef = deck.streams.get(sId);
    const flow = sDef?.moleFlow ?? 100.0;
    const tempC = sDef?.temperature ?? 25.0;
    const pres = sDef?.pressure ?? 1.0;

    declareVar(`F_${sId}`, VarType.Real, Variability.Continuous, Causality.Local, flow);
    declareVar(`T_${sId}`, VarType.Real, Variability.Continuous, Causality.Local, tempC + 273.15);
    declareVar(`P_${sId}`, VarType.Real, Variability.Continuous, Causality.Local, pres);

    // Component molar flow variables
    for (const comp of compList) {
      const frac = sDef?.moleFractions.get(comp) ?? 1.0 / compList.length;
      declareVar(`F_${sId}_${comp}`, VarType.Real, Variability.Continuous, Causality.Local, flow * frac);
    }
  }

  // 2. Emit boundary equations for external feed streams (streams not produced by any block)
  for (const sId of allStreamIds) {
    if (producedStreams.has(sId)) continue;
    const sDef = deck.streams.get(sId);
    const flow = sDef?.moleFlow ?? 100.0;
    const tempK = (sDef?.temperature ?? 25.0) + 273.15;
    const pres = sDef?.pressure ?? 1.0;

    const fVar = dae.lookupVariable(`F_${sId}`);
    const tVar = dae.lookupVariable(`T_${sId}`);
    const pVar = dae.lookupVariable(`P_${sId}`);

    assignEq(fVar, dae.addName(fVar), dae.addRealLiteral(flow));
    assignEq(tVar, dae.addName(tVar), dae.addRealLiteral(tempK));
    assignEq(pVar, dae.addName(pVar), dae.addRealLiteral(pres));

    for (const comp of compList) {
      const frac = sDef?.moleFractions.get(comp) ?? 1.0 / compList.length;
      const fCompVar = dae.lookupVariable(`F_${sId}_${comp}`);
      if (fCompVar !== -1 && fVar !== -1) {
        const rhs = dae.addBinaryExpr(BinOp.Mul, dae.addName(fVar), dae.addRealLiteral(frac));
        assignEq(fCompVar, dae.addName(fCompVar), rhs);
      }
    }
  }

  // 3. Lower FLOWSHEET unit operations
  for (const entry of deck.flowsheet) {
    const blockId = entry.blockId;
    const block = deck.blocks.get(blockId);
    const bType = block?.type ?? "FLASH2";

    if (bType === "FLASH2" || bType === "FLASH3") {
      const inStream = entry.inlets[0] ?? "FEED";
      const vapStream = entry.outlets[0] ?? `${blockId}_VAP`;
      const liqStream = entry.outlets[1] ?? `${blockId}_LIQ`;

      const tFlashC = Number(block?.params["TEMP"] ?? 75.0);
      const tFlash = tFlashC + 273.15;
      const pFlash = Number(block?.params["PRES"] ?? 1.2);

      // Compute equilibrium VLE flash K-values and vapor fraction
      const feedDef = deck.streams.get(inStream);
      const zFeed = compList.map((c) => feedDef?.moleFractions.get(c) ?? 1.0 / compList.length);
      const flashRes = solveFlashRachfordRice({
        temperature: tFlashC,
        pressure: pFlash,
        components: compList,
        moleFractions: zFeed,
        propertyMethod: deck.propertyMethod,
      });
      const psiEq =
        flashRes.state === "TWO_PHASE" ? flashRes.vaporFraction : flashRes.state === "SUPERHEATED_VAPOR" ? 0.99 : 0.5;

      const psiVar = declareVar(`psi_${blockId}`, VarType.Real, Variability.Continuous, Causality.Local, psiEq);
      const qVar = declareVar(`Q_${blockId}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

      assignEq(psiVar, dae.addName(psiVar), dae.addRealLiteral(psiEq));

      // Overall mass balance: F_in = F_vap + F_liq and F_vap = F_in * psi
      const fInVar = dae.lookupVariable(`F_${inStream}`);
      const fVapVar = dae.lookupVariable(`F_${vapStream}`);
      const fLiqVar = dae.lookupVariable(`F_${liqStream}`);

      if (fInVar !== -1 && fVapVar !== -1 && fLiqVar !== -1) {
        const sumVapLiq = dae.addBinaryExpr(BinOp.Add, dae.addName(fVapVar), dae.addName(fLiqVar));
        assignEq(fLiqVar, dae.addName(fInVar), sumVapLiq);

        const vapCalc = dae.addBinaryExpr(BinOp.Mul, dae.addName(fInVar), dae.addName(psiVar));
        assignEq(fVapVar, dae.addName(fVapVar), vapCalc);
      }

      // Component mass balances & VLE phase split:
      //   F_in_comp = F_vap_comp + F_liq_comp
      //   F_vap_comp = split_i * F_in_comp, where split_i = (K_i * psi) / (1 + psi * (K_i - 1))
      for (let i = 0; i < compList.length; i++) {
        const comp = compList[i]!;
        const fInComp = dae.lookupVariable(`F_${inStream}_${comp}`);
        const fVapComp = dae.lookupVariable(`F_${vapStream}_${comp}`);
        const fLiqComp = dae.lookupVariable(`F_${liqStream}_${comp}`);
        const Ki = flashRes.kValues[i] ?? 1.0;
        const splitFactor = Math.max(0.0, Math.min(1.0, (Ki * psiEq) / Math.max(1e-6, 1.0 + psiEq * (Ki - 1.0))));

        if (fInComp !== -1 && fVapComp !== -1 && fLiqComp !== -1) {
          const sumComp = dae.addBinaryExpr(BinOp.Add, dae.addName(fVapComp), dae.addName(fLiqComp));
          assignEq(fLiqComp, dae.addName(fInComp), sumComp);

          const vapCompExpr = dae.addBinaryExpr(BinOp.Mul, dae.addName(fInComp), dae.addRealLiteral(splitFactor));
          assignEq(fVapComp, dae.addName(fVapComp), vapCompExpr);
        }
      }

      // Pressure and temperature balance
      const tIn = dae.lookupVariable(`T_${inStream}`);
      const tVap = dae.lookupVariable(`T_${vapStream}`);
      const tLiq = dae.lookupVariable(`T_${liqStream}`);
      const pVap = dae.lookupVariable(`P_${vapStream}`);
      const pLiq = dae.lookupVariable(`P_${liqStream}`);

      if (tVap !== -1) assignEq(tVap, dae.addName(tVap), dae.addRealLiteral(tFlash));
      if (tLiq !== -1) assignEq(tLiq, dae.addName(tLiq), dae.addRealLiteral(tFlash));
      if (pVap !== -1) assignEq(pVap, dae.addName(pVap), dae.addRealLiteral(pFlash));
      if (pLiq !== -1) assignEq(pLiq, dae.addName(pLiq), dae.addRealLiteral(pFlash));

      // Flash heat duty: Q = F_in * Cp * (T_vap - T_in) + F_vap * dH_vap
      if (fInVar !== -1 && tIn !== -1 && tVap !== -1 && fVapVar !== -1) {
        const dT = dae.addBinaryExpr(BinOp.Sub, dae.addName(tVap), dae.addName(tIn));
        const sensible = dae.addBinaryExpr(
          BinOp.Mul,
          dae.addName(fInVar),
          dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(0.075), dT),
        );
        const latent = dae.addBinaryExpr(BinOp.Mul, dae.addName(fVapVar), dae.addRealLiteral(35.0));
        assignEq(qVar, dae.addName(qVar), dae.addBinaryExpr(BinOp.Add, sensible, latent));
      } else {
        assignEq(qVar, dae.addName(qVar), dae.addRealLiteral(0.0));
      }
    } else if (bType === "PUMP" || bType === "COMPR" || bType === "VALVE") {
      const inStream = entry.inlets[0] ?? `${blockId}_IN`;
      const outStream = entry.outlets[0] ?? `${blockId}_OUT`;

      const presTarget = Number(block?.params["PRES"] ?? 3.0);
      const deltaP = Number(block?.params["DELTAP"] ?? 2.0);

      const fIn = dae.lookupVariable(`F_${inStream}`);
      const fOut = dae.lookupVariable(`F_${outStream}`);
      const tIn = dae.lookupVariable(`T_${inStream}`);
      const tOut = dae.lookupVariable(`T_${outStream}`);
      const pIn = dae.lookupVariable(`P_${inStream}`);
      const pOut = dae.lookupVariable(`P_${outStream}`);

      // F_out = F_in
      if (fIn !== -1 && fOut !== -1) {
        assignEq(fOut, dae.addName(fOut), dae.addName(fIn));
      }

      // T_out = T_in
      if (tIn !== -1 && tOut !== -1) {
        assignEq(tOut, dae.addName(tOut), dae.addName(tIn));
      }

      // P_out = presTarget or P_in + deltaP
      if (pOut !== -1) {
        if (block?.params["PRES"] != null) {
          assignEq(pOut, dae.addName(pOut), dae.addRealLiteral(presTarget));
        } else if (pIn !== -1) {
          const calcP = dae.addBinaryExpr(BinOp.Add, dae.addName(pIn), dae.addRealLiteral(deltaP));
          assignEq(pOut, dae.addName(pOut), calcP);
        }
      }

      // Component molar flow conservation: F_out_comp = F_in_comp
      for (const comp of compList) {
        const fInComp = dae.lookupVariable(`F_${inStream}_${comp}`);
        const fOutComp = dae.lookupVariable(`F_${outStream}_${comp}`);
        if (fInComp !== -1 && fOutComp !== -1) {
          assignEq(fOutComp, dae.addName(fOutComp), dae.addName(fInComp));
        }
      }

      // Pump work W = F_in * v_molar * (P_out - P_in)
      const wPump = declareVar(`W_pump_${blockId}`, VarType.Real, Variability.Continuous, Causality.Local, 15.0);
      if (fIn !== -1 && pIn !== -1 && pOut !== -1) {
        const dpExpr = dae.addBinaryExpr(BinOp.Sub, dae.addName(pOut), dae.addName(pIn));
        const workExpr = dae.addBinaryExpr(
          BinOp.Mul,
          dae.addName(fIn),
          dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(0.018), dpExpr),
        );
        assignEq(wPump, dae.addName(wPump), workExpr);
      } else {
        assignEq(wPump, dae.addName(wPump), dae.addRealLiteral(15.0));
      }
    } else if (bType === "RADFRAC") {
      const nStages = block?.nStages ?? 15;
      const rr = Number(block?.colSpecs?.["RR"] ?? 2.5);

      const inStream = entry.inlets[0] ?? "FEED";
      const distStream = entry.outlets[0] ?? "DISTIL";
      const bottStream = entry.outlets[1] ?? "BOTT";

      const fIn = dae.lookupVariable(`F_${inStream}`);
      const fDist = dae.lookupVariable(`F_${distStream}`);
      const fBott = dae.lookupVariable(`F_${bottStream}`);

      // Component balances and Fenske-type stage separation
      let distTotalExpr: number | null = null;
      for (let i = 0; i < compList.length; i++) {
        const comp = compList[i]!;
        const fInComp = dae.lookupVariable(`F_${inStream}_${comp}`);
        const fDistComp = dae.lookupVariable(`F_${distStream}_${comp}`);
        const fBottComp = dae.lookupVariable(`F_${bottStream}_${comp}`);

        // Light key recovery vs heavy key recovery across N stages
        const isLight = i === 0;
        const recovery = isLight
          ? Math.min(0.99, 1.0 - Math.pow(0.5, nStages / 3.0))
          : Math.max(0.01, Math.pow(0.5, nStages / 3.0));

        if (fInComp !== -1 && fDistComp !== -1 && fBottComp !== -1) {
          const sumComp = dae.addBinaryExpr(BinOp.Add, dae.addName(fDistComp), dae.addName(fBottComp));
          assignEq(fBottComp, dae.addName(fInComp), sumComp);

          const distCompCalc = dae.addBinaryExpr(BinOp.Mul, dae.addName(fInComp), dae.addRealLiteral(recovery));
          assignEq(fDistComp, dae.addName(fDistComp), distCompCalc);

          distTotalExpr =
            distTotalExpr === null
              ? dae.addName(fDistComp)
              : dae.addBinaryExpr(BinOp.Add, distTotalExpr, dae.addName(fDistComp));
        }
      }

      if (fIn !== -1 && fDist !== -1 && fBott !== -1) {
        const sumProd = dae.addBinaryExpr(BinOp.Add, dae.addName(fDist), dae.addName(fBott));
        assignEq(fBott, dae.addName(fIn), sumProd);

        if (distTotalExpr !== null) {
          assignEq(fDist, dae.addName(fDist), distTotalExpr);
        } else {
          assignEq(fDist, dae.addName(fDist), dae.addBinaryExpr(BinOp.Mul, dae.addName(fIn), dae.addRealLiteral(0.5)));
        }
      }

      // Distillate and Bottoms T and P
      const pIn = dae.lookupVariable(`P_${inStream}`);
      const tDist = dae.lookupVariable(`T_${distStream}`);
      const tBott = dae.lookupVariable(`T_${bottStream}`);
      const pDist = dae.lookupVariable(`P_${distStream}`);
      const pBott = dae.lookupVariable(`P_${bottStream}`);

      if (tDist !== -1) assignEq(tDist, dae.addName(tDist), dae.addRealLiteral(337.85)); // ~64.7 C (Methanol bp)
      if (tBott !== -1) assignEq(tBott, dae.addName(tBott), dae.addRealLiteral(373.15)); // ~100.0 C (Water bp)
      if (pDist !== -1) {
        assignEq(pDist, dae.addName(pDist), pIn !== -1 ? dae.addName(pIn) : dae.addRealLiteral(1.0));
      }
      if (pBott !== -1) {
        assignEq(
          pBott,
          dae.addName(pBott),
          pIn !== -1
            ? dae.addBinaryExpr(BinOp.Add, dae.addName(pIn), dae.addRealLiteral(0.05 * nStages))
            : dae.addRealLiteral(1.2),
        );
      }

      // Condenser duty, reboiler duty, and reflux ratio
      const qCond = declareVar(`Q_cond_${blockId}`, VarType.Real, Variability.Continuous, Causality.Local, -500.0);
      const qReb = declareVar(`Q_reb_${blockId}`, VarType.Real, Variability.Continuous, Causality.Local, 600.0);
      const rrVar = declareVar(`RR_${blockId}`, VarType.Real, Variability.Parameter, Causality.Local, rr);

      assignEq(rrVar, dae.addName(rrVar), dae.addRealLiteral(rr));
      if (fDist !== -1) {
        // Q_cond = -F_dist * (1 + RR) * dH_vap
        const onePlusRR = dae.addBinaryExpr(BinOp.Add, dae.addRealLiteral(1.0), dae.addName(rrVar));
        const vapLoad = dae.addBinaryExpr(BinOp.Mul, dae.addName(fDist), onePlusRR);
        assignEq(qCond, dae.addName(qCond), dae.addBinaryExpr(BinOp.Mul, vapLoad, dae.addRealLiteral(-35.0)));
        assignEq(qReb, dae.addName(qReb), dae.addBinaryExpr(BinOp.Mul, dae.addName(qCond), dae.addRealLiteral(-1.1)));
      } else {
        assignEq(qCond, dae.addName(qCond), dae.addRealLiteral(-500.0));
        assignEq(qReb, dae.addName(qReb), dae.addRealLiteral(600.0));
      }

      // Stage temperature profile
      const nTrackedStages = Math.min(nStages, 5);
      for (let j = 1; j <= nTrackedStages; j++) {
        const tStageVal = 340.0 + j * 3.0;
        const tStageVar = declareVar(
          `T_${blockId}_stage_${j}`,
          VarType.Real,
          Variability.Continuous,
          Causality.Local,
          tStageVal,
        );
        if (tDist !== -1 && tBott !== -1 && nStages > 1) {
          const frac = (j - 1) / (nStages - 1);
          const dTCol = dae.addBinaryExpr(BinOp.Sub, dae.addName(tBott), dae.addName(tDist));
          const stageExpr = dae.addBinaryExpr(
            BinOp.Add,
            dae.addName(tDist),
            dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(frac), dTCol),
          );
          assignEq(tStageVar, dae.addName(tStageVar), stageExpr);
        } else {
          assignEq(tStageVar, dae.addName(tStageVar), dae.addRealLiteral(tStageVal));
        }
      }
    } else if (bType === "HEATX" || bType === "HEATER") {
      const inStream = entry.inlets[0] ?? `${blockId}_IN`;
      const outStream = entry.outlets[0] ?? `${blockId}_OUT`;

      const fIn = dae.lookupVariable(`F_${inStream}`);
      const fOut = dae.lookupVariable(`F_${outStream}`);
      const tIn = dae.lookupVariable(`T_${inStream}`);
      const tOut = dae.lookupVariable(`T_${outStream}`);
      const pIn = dae.lookupVariable(`P_${inStream}`);
      const pOut = dae.lookupVariable(`P_${outStream}`);

      if (fIn !== -1 && fOut !== -1) {
        assignEq(fOut, dae.addName(fOut), dae.addName(fIn));
      }

      const tTarget = block?.params["TEMP"] != null ? Number(block.params["TEMP"]) + 273.15 : 350.0;
      if (tOut !== -1) {
        assignEq(tOut, dae.addName(tOut), dae.addRealLiteral(tTarget));
      }
      if (pOut !== -1) {
        assignEq(pOut, dae.addName(pOut), pIn !== -1 ? dae.addName(pIn) : dae.addRealLiteral(1.0));
      }

      for (const comp of compList) {
        const fInComp = dae.lookupVariable(`F_${inStream}_${comp}`);
        const fOutComp = dae.lookupVariable(`F_${outStream}_${comp}`);
        if (fInComp !== -1 && fOutComp !== -1) {
          assignEq(fOutComp, dae.addName(fOutComp), dae.addName(fInComp));
        }
      }

      const qDuty = declareVar(`Q_duty_${blockId}`, VarType.Real, Variability.Continuous, Causality.Local, 100.0);
      if (fIn !== -1 && tIn !== -1 && tOut !== -1) {
        const dT = dae.addBinaryExpr(BinOp.Sub, dae.addName(tOut), dae.addName(tIn));
        assignEq(
          qDuty,
          dae.addName(qDuty),
          dae.addBinaryExpr(BinOp.Mul, dae.addName(fIn), dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(0.075), dT)),
        );
      } else {
        assignEq(qDuty, dae.addName(qDuty), dae.addRealLiteral(100.0));
      }
    }
  }

  // 4. Ensure any remaining unassigned variables have governing boundary equations
  for (const [varId, defaultVal] of varDefaultVal) {
    if (!assignedVars.has(varId)) {
      assignEq(varId, dae.addName(varId), dae.addRealLiteral(defaultVal));
    }
  }

  return dae;
}

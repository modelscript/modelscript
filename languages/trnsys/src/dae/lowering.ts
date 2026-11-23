// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for TRNSYS (.dck) Thermal & Solar Component Networks.
 *
 * Lowers TRNSYS units (Type 1 Solar Collector, Type 2 Differential Controller,
 * Type 3 Pump, Type 4 Stratified Storage Tank, Type 14 Forcing Function,
 * Type 15 Weather Data, Type 56 Multi-Zone Building) and inter-unit INPUTS
 * connections directly into `@modelscript/runtime`'s `IDaeBuilder` linear memory
 * representation without allocating intermediate AST wrappers.
 */

import { BinOp, Causality, EqKind, type IDaeBuilder, VarType, Variability } from "@modelscript/runtime";
import { ensureBuiltInTrnsysLibraryRegistered } from "../catalog/library-package-adapter.js";
import type { TrnsysDeck, TrnsysUnit, TrnsysValue } from "../types.js";

export interface TrnsysDaeLoweringResult {
  stateVarIndices: number[];
  equationCount: number;
  variableMap: Map<string, number>;
}

function numParam(unit: TrnsysUnit, idx: number, fallback: number): number {
  const p: TrnsysValue | undefined = unit.parameters[idx];
  if (p && p.kind === "number" && Number.isFinite(p.value)) return p.value;
  return fallback;
}

function numInit(unit: TrnsysUnit, idx: number, fallback: number): number {
  const v: TrnsysValue | undefined = unit.initialInputs[idx];
  if (v && v.kind === "number" && Number.isFinite(v.value)) return v.value;
  return fallback;
}

/**
 * Lowers a parsed `TrnsysDeck` directly into a `DAEBuilder` (`IDaeBuilder`).
 */
export function lowerTrnsysToDae(builder: IDaeBuilder, deck: TrnsysDeck): TrnsysDaeLoweringResult {
  ensureBuiltInTrnsysLibraryRegistered();

  const variableMap = new Map<string, number>();
  const stateVarIndices: number[] = [];
  let equationCount = 0;

  function getOrAddVar(
    name: string,
    variability: Variability = Variability.Continuous,
    startVal: number = 0.0,
  ): number {
    const key = name.toUpperCase();
    const mapped = variableMap.get(key);
    if (mapped !== undefined) return mapped;

    const existing = builder.lookupVariable(name);
    if (existing !== -1) {
      variableMap.set(key, existing);
      return existing;
    }

    const idx = builder.addVariable(name, VarType.Real, variability, Causality.Local, startVal);
    variableMap.set(key, idx);
    return idx;
  }

  // 1. Register deck CONSTANTS as Parameters
  for (const c of deck.constants) {
    const val = c.value ?? 0.0;
    getOrAddVar(`const_${c.name}`, Variability.Parameter, val);
  }

  // 2. Lower each TRNSYS UNIT
  for (const unit of deck.units) {
    const prefix = `u${unit.unitNumber}`;

    switch (unit.typeNumber) {
      case 1: {
        // Type 1: Hottel-Whillier-Bliss flat-plate solar collector
        const area = numParam(unit, 0, 4.0);
        const cp = numParam(unit, 1, 4.19);
        const frTauAlpha = numParam(unit, 2, 0.75);
        const frUl = numParam(unit, 3, 15.0);

        const tIn = getOrAddVar(`${prefix}_in1`, Variability.Continuous, numInit(unit, 0, 20.0));
        const mDot = getOrAddVar(`${prefix}_in2`, Variability.Continuous, numInit(unit, 1, 200.0));
        const tAmb = getOrAddVar(`${prefix}_in3`, Variability.Continuous, numInit(unit, 2, 20.0));
        const it = getOrAddVar(`${prefix}_in4`, Variability.Continuous, numInit(unit, 3, 0.0));

        const tOut = getOrAddVar(`${prefix}_out1`, Variability.Continuous, numInit(unit, 0, 20.0));
        const mDotOut = getOrAddVar(`${prefix}_out2`, Variability.Continuous, numInit(unit, 1, 200.0));
        const qu = getOrAddVar(`${prefix}_out3`, Variability.Continuous, 0.0);

        // Qu = area * (frTauAlpha * It - frUl * (Tin - Tamb))
        const solarTerm = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(frTauAlpha), builder.addName(it));
        const dT = builder.addBinaryExpr(BinOp.Sub, builder.addName(tIn), builder.addName(tAmb));
        const lossTerm = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(frUl), dT);
        const netFlux = builder.addBinaryExpr(BinOp.Sub, solarTerm, lossTerm);
        const quRhs = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(area), netFlux);
        builder.addEquation(EqKind.Simple, builder.addName(qu), quRhs);
        equationCount++;

        // mDotOut = mDot
        builder.addEquation(EqKind.Simple, builder.addName(mDotOut), builder.addName(mDot));
        equationCount++;

        // mDot * cp * (Tout - Tin) = Qu
        const mCp = builder.addBinaryExpr(BinOp.Mul, builder.addName(mDot), builder.addRealLiteral(cp));
        const dTFluid = builder.addBinaryExpr(BinOp.Sub, builder.addName(tOut), builder.addName(tIn));
        const lhsEnergy = builder.addBinaryExpr(BinOp.Mul, mCp, dTFluid);
        builder.addEquation(EqKind.Simple, lhsEnergy, builder.addName(qu));
        equationCount++;
        break;
      }

      case 2: {
        // Type 2: Differential Controller
        const gammaIn = getOrAddVar(`${prefix}_in4`, Variability.Continuous, numInit(unit, 3, 0.0));
        const gammaOut = getOrAddVar(`${prefix}_out1`, Variability.Continuous, numInit(unit, 3, 0.0));
        builder.addEquation(EqKind.Simple, builder.addName(gammaOut), builder.addName(gammaIn));
        equationCount++;
        break;
      }

      case 3: {
        // Type 3: Circulation Pump
        const mDotMax = numParam(unit, 0, 200.0);
        const pMax = numParam(unit, 2, 180.0);

        const tIn = getOrAddVar(`${prefix}_in1`, Variability.Continuous, numInit(unit, 0, 20.0));
        const gamma = getOrAddVar(`${prefix}_in3`, Variability.Continuous, numInit(unit, 2, 1.0));

        const tOut = getOrAddVar(`${prefix}_out1`, Variability.Continuous, numInit(unit, 0, 20.0));
        const mDotOut = getOrAddVar(`${prefix}_out2`, Variability.Continuous, mDotMax);
        const power = getOrAddVar(`${prefix}_out3`, Variability.Continuous, pMax);

        // mDotOut = gamma * mDotMax
        builder.addEquation(
          EqKind.Simple,
          builder.addName(mDotOut),
          builder.addBinaryExpr(BinOp.Mul, builder.addName(gamma), builder.addRealLiteral(mDotMax)),
        );
        equationCount++;

        // power = gamma * pMax
        builder.addEquation(
          EqKind.Simple,
          builder.addName(power),
          builder.addBinaryExpr(BinOp.Mul, builder.addName(gamma), builder.addRealLiteral(pMax)),
        );
        equationCount++;

        // Tout = Tin
        builder.addEquation(EqKind.Simple, builder.addName(tOut), builder.addName(tIn));
        equationCount++;
        break;
      }

      case 4: {
        // Type 4: Stratified Storage Tank (N-node ODE energy balance)
        const volume = Math.max(1e-4, numParam(unit, 0, 0.3));
        const cp = Math.max(1e-3, numParam(unit, 1, 4.19));
        const rho = Math.max(1.0, numParam(unit, 2, 1000.0));
        const uLoss = Math.max(0.0, numParam(unit, 3, 1.5));
        const height = Math.max(0.1, numParam(unit, 4, 1.5));
        const nNodes = Math.max(1, Math.min(6, Math.round(numParam(unit, 5, 3))));

        const tHotIn = getOrAddVar(`${prefix}_in1`, Variability.Continuous, numInit(unit, 0, 20.0));
        const mDotHot = getOrAddVar(`${prefix}_in2`, Variability.Continuous, numInit(unit, 1, 0.0));
        const tColdIn = getOrAddVar(`${prefix}_in3`, Variability.Continuous, numInit(unit, 2, 20.0));
        const mDotLoad = getOrAddVar(`${prefix}_in4`, Variability.Continuous, numInit(unit, 3, 0.0));
        const tEnv = getOrAddVar(`${prefix}_in5`, Variability.Continuous, numInit(unit, 4, 20.0));

        const radius = Math.sqrt(volume / (Math.PI * height));
        const sideAreaNode = (2.0 * Math.PI * radius * height) / nNodes;
        const capArea = Math.PI * radius * radius;
        const capNode = ((rho * volume) / nNodes) * cp;

        const nodeVars: number[] = [];
        for (let i = 0; i < nNodes; i++) {
          const derivInit = unit.derivatives[i];
          const t0 =
            derivInit && derivInit.kind === "number" ? derivInit.value : numParam(unit, 6, numInit(unit, 4, 20.0));
          const tNode = getOrAddVar(`${prefix}_T${i + 1}`, Variability.Continuous, t0);
          nodeVars.push(tNode);
          stateVarIndices.push(tNode);
        }

        let lossSumExpr: number | undefined;
        let tSumExpr: number | undefined;

        for (let i = 0; i < nNodes; i++) {
          const tNode = nodeVars[i]!;
          let areaNode = sideAreaNode;
          if (i === 0) areaNode += capArea;
          if (i === nNodes - 1) areaNode += capArea;
          const uaNode = uLoss * areaNode;

          const tAbove = i === 0 ? tHotIn : nodeVars[i - 1]!;
          const tBelow = i === nNodes - 1 ? tColdIn : nodeVars[i + 1]!;

          // qHot = mDotHot * cp * (tAbove - tNode)
          const qHot = builder.addBinaryExpr(
            BinOp.Mul,
            builder.addBinaryExpr(BinOp.Mul, builder.addName(mDotHot), builder.addRealLiteral(cp)),
            builder.addBinaryExpr(BinOp.Sub, builder.addName(tAbove), builder.addName(tNode)),
          );
          // qLoad = mDotLoad * cp * (tBelow - tNode)
          const qLoad = builder.addBinaryExpr(
            BinOp.Mul,
            builder.addBinaryExpr(BinOp.Mul, builder.addName(mDotLoad), builder.addRealLiteral(cp)),
            builder.addBinaryExpr(BinOp.Sub, builder.addName(tBelow), builder.addName(tNode)),
          );
          // qLoss_i = uaNode * (tNode - tEnv)
          const qLossNode = builder.addBinaryExpr(
            BinOp.Mul,
            builder.addRealLiteral(uaNode),
            builder.addBinaryExpr(BinOp.Sub, builder.addName(tNode), builder.addName(tEnv)),
          );

          // capNode * der(T_i) = qHot + qLoad - qLoss_i
          const netQ = builder.addBinaryExpr(BinOp.Sub, builder.addBinaryExpr(BinOp.Add, qHot, qLoad), qLossNode);
          const lhs = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(capNode), builder.addDer(tNode));
          builder.addEquation(EqKind.Simple, lhs, netQ);
          equationCount++;

          lossSumExpr =
            lossSumExpr === undefined ? qLossNode : builder.addBinaryExpr(BinOp.Add, lossSumExpr, qLossNode);
          tSumExpr =
            tSumExpr === undefined
              ? builder.addName(tNode)
              : builder.addBinaryExpr(BinOp.Add, tSumExpr, builder.addName(tNode));
        }

        // Tank outputs: out1=T_bot, out2=mDotHot, out3=T_top, out4=mDotLoad, out5=Qloss, out6=Tavg
        const out1 = getOrAddVar(`${prefix}_out1`, Variability.Continuous, 20.0);
        const out2 = getOrAddVar(`${prefix}_out2`, Variability.Continuous, 0.0);
        const out3 = getOrAddVar(`${prefix}_out3`, Variability.Continuous, 20.0);
        const out4 = getOrAddVar(`${prefix}_out4`, Variability.Continuous, 0.0);
        const out5 = getOrAddVar(`${prefix}_out5`, Variability.Continuous, 0.0);
        const out6 = getOrAddVar(`${prefix}_out6`, Variability.Continuous, 20.0);

        builder.addEquation(EqKind.Simple, builder.addName(out1), builder.addName(nodeVars[nNodes - 1]!));
        builder.addEquation(EqKind.Simple, builder.addName(out2), builder.addName(mDotHot));
        builder.addEquation(EqKind.Simple, builder.addName(out3), builder.addName(nodeVars[0]!));
        builder.addEquation(EqKind.Simple, builder.addName(out4), builder.addName(mDotLoad));
        builder.addEquation(EqKind.Simple, builder.addName(out5), lossSumExpr ?? builder.addRealLiteral(0.0));
        builder.addEquation(
          EqKind.Simple,
          builder.addName(out6),
          builder.addBinaryExpr(BinOp.Div, tSumExpr ?? builder.addRealLiteral(20.0), builder.addRealLiteral(nNodes)),
        );
        equationCount += 6;
        break;
      }

      case 14: {
        // Type 14: Forcing Function
        const v0 = numParam(unit, 1, 0.0);
        const out1 = getOrAddVar(`${prefix}_out1`, Variability.Continuous, v0);
        const out2 = getOrAddVar(`${prefix}_out2`, Variability.Continuous, v0);
        builder.addEquation(EqKind.Simple, builder.addName(out1), builder.addRealLiteral(v0));
        builder.addEquation(EqKind.Simple, builder.addName(out2), builder.addName(out1));
        equationCount += 2;
        break;
      }

      case 15: {
        // Type 15: Weather Data
        const tMean = numParam(unit, 0, 20.0);
        const iPeak = numParam(unit, 2, 2880.0);
        const out1 = getOrAddVar(`${prefix}_out1`, Variability.Continuous, tMean);
        const out2 = getOrAddVar(`${prefix}_out2`, Variability.Continuous, iPeak);
        const out3 = getOrAddVar(`${prefix}_out3`, Variability.Continuous, 50.0);
        const out4 = getOrAddVar(`${prefix}_out4`, Variability.Continuous, 2.0);
        builder.addEquation(EqKind.Simple, builder.addName(out1), builder.addRealLiteral(tMean));
        builder.addEquation(EqKind.Simple, builder.addName(out2), builder.addRealLiteral(iPeak));
        builder.addEquation(EqKind.Simple, builder.addName(out3), builder.addRealLiteral(50.0));
        builder.addEquation(EqKind.Simple, builder.addName(out4), builder.addRealLiteral(2.0));
        equationCount += 4;
        break;
      }

      case 56: {
        // Type 56: Multi-Zone Building thermal zone ODE
        // C * der(Tzone) = solarAperture * It + Qint + Qhvac - uaEnv * (Tzone - Tamb)
        const cap = Math.max(1.0, numParam(unit, 0, 5000.0));
        const uaEnv = Math.max(0.0, numParam(unit, 1, 250.0));
        const solarAp = Math.max(0.0, numParam(unit, 2, 6.0));
        const tInit = numParam(unit, 3, 20.0);

        const tAmb = getOrAddVar(`${prefix}_in1`, Variability.Continuous, numInit(unit, 0, 20.0));
        const it = getOrAddVar(`${prefix}_in2`, Variability.Continuous, numInit(unit, 1, 0.0));
        const qInt = getOrAddVar(`${prefix}_in3`, Variability.Continuous, numInit(unit, 2, 0.0));
        const qHvac = getOrAddVar(`${prefix}_in4`, Variability.Continuous, numInit(unit, 3, 0.0));

        const tZone = getOrAddVar(`${prefix}_Tzone`, Variability.Continuous, tInit);
        stateVarIndices.push(tZone);

        const qSolar = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(solarAp), builder.addName(it));
        const qGain = builder.addBinaryExpr(
          BinOp.Add,
          builder.addBinaryExpr(BinOp.Add, qSolar, builder.addName(qInt)),
          builder.addName(qHvac),
        );
        const qLoss = builder.addBinaryExpr(
          BinOp.Mul,
          builder.addRealLiteral(uaEnv),
          builder.addBinaryExpr(BinOp.Sub, builder.addName(tZone), builder.addName(tAmb)),
        );
        const rhs = builder.addBinaryExpr(BinOp.Sub, qGain, qLoss);
        const lhs = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(cap), builder.addDer(tZone));
        builder.addEquation(EqKind.Simple, lhs, rhs);
        equationCount++;

        const out1 = getOrAddVar(`${prefix}_out1`, Variability.Continuous, tInit);
        const out2 = getOrAddVar(`${prefix}_out2`, Variability.Continuous, 0.0);
        const out3 = getOrAddVar(`${prefix}_out3`, Variability.Continuous, 0.0);
        builder.addEquation(EqKind.Simple, builder.addName(out1), builder.addName(tZone));
        builder.addEquation(EqKind.Simple, builder.addName(out2), builder.addName(qHvac));
        builder.addEquation(EqKind.Simple, builder.addName(out3), qLoss);
        equationCount += 3;
        break;
      }

      default: {
        // Printer (Type 25) or generic unit: register declared inputs
        for (let k = 0; k < unit.inputs.length; k++) {
          getOrAddVar(`${prefix}_in${k + 1}`, Variability.Continuous, numInit(unit, k, 0.0));
        }
        break;
      }
    }
  }

  // 3. Lower inter-unit INPUTS wiring equations
  for (const unit of deck.units) {
    const dstPrefix = `u${unit.unitNumber}`;
    for (let k = 0; k < unit.inputs.length; k++) {
      const inp = unit.inputs[k]!;
      const dstVar = getOrAddVar(`${dstPrefix}_in${k + 1}`, Variability.Continuous, numInit(unit, k, 0.0));

      if (inp.kind === "connection") {
        const srcVar = getOrAddVar(`u${inp.unitNumber}_out${inp.outputIndex}`, Variability.Continuous, 0.0);
        builder.addEquation(EqKind.Simple, builder.addName(dstVar), builder.addName(srcVar));
        equationCount++;
      } else if (inp.kind === "constant") {
        // Use initial input value if connection was `0,0` (TRNSYS constant input idiom)
        const val = inp.raw === "0,0" ? numInit(unit, k, inp.value) : inp.value;
        builder.addEquation(EqKind.Simple, builder.addName(dstVar), builder.addRealLiteral(val));
        equationCount++;
      }
    }
  }

  return { stateVarIndices, equationCount, variableMap };
}

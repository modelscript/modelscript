// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BinOp,
  Causality,
  DAEBuilder,
  EqKind,
  ExprKind,
  StringInterner,
  Variability,
  VarType,
} from "@modelscript/runtime";
import { scheduleSmartCharging } from "../solver/charging-scheduler.js";
import type { OcppNetwork } from "../types.js";


/**
 * Lowers an OCPP charging network and active vehicle charging sessions
 * directly into ModelScript's zero-overhead DAEBuilder linear arena.
 */
export function lowerOcppToDae(network: OcppNetwork, arenaTitle?: string): DAEBuilder {
  const title = arenaTitle ?? "OCPP_EV_Charging_Network";
  const interner = new StringInterner();
  const arena = new DAEBuilder(interner, title);

  // Compute smart charging allocations first if sessions exist
  scheduleSmartCharging(network);

  for (const st of network.stations) {
    const cleanStId = st.id.replace(/[^a-zA-Z0-9_]/g, "_");

    // 1. Station Grid Connection Power Limit (Parameter)
    const limitName = `gridLimit_${cleanStId}`;
    const limitId = interner.intern(limitName);
    arena.addVariable(limitName, VarType.Real, Variability.Parameter, Causality.Input, st.gridLimitKW);
    const limitExpr = arena.addExpression(ExprKind.Name, limitId);
    const limitLit = arena.addRealLiteral(st.gridLimitKW);
    arena.addEquation(EqKind.Simple, limitExpr, limitLit);

    // 2. Station Aggregate Power Draw
    const pStName = `P_station_${cleanStId}`;
    const pStId = interner.intern(pStName);
    arena.addVariable(pStName, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const pStExpr = arena.addExpression(ExprKind.Name, pStId);

    const connectorPowerExprs: number[] = [];

    for (const e of st.evses) {
      for (const c of e.connectors) {
        const cleanConnId = `${cleanStId}_evse${e.id}_c${c.id}`;

        if (c.currentSession && c.status === "Charging") {
          const s = c.currentSession;
          const pAlloc = s.allocatedPowerKW ?? Math.min(c.maxPowerKW, st.gridLimitKW);

          // Connector Active Power (kW)
          const pName = `P_${cleanConnId}`;
          const pId = interner.intern(pName);
          arena.addVariable(pName, VarType.Real, Variability.Continuous, Causality.Local, pAlloc);
          const pExpr = arena.addExpression(ExprKind.Name, pId);
          connectorPowerExprs.push(pExpr);

          // Power binding: P = pAlloc
          const pLit = arena.addRealLiteral(pAlloc);
          arena.addEquation(EqKind.Simple, pExpr, pLit);

          // EV Battery State of Charge (SoC) - Continuous state
          const socName = `SoC_${cleanConnId}`;
          const socId = interner.intern(socName);
          arena.addVariable(socName, VarType.Real, Variability.Continuous, Causality.Local, s.currentSoC);
          const socExpr = arena.addExpression(ExprKind.Name, socId);

          // Initial SoC equation: SoC = currentSoC
          const initSocLit = arena.addRealLiteral(s.currentSoC);
          arena.addEquation(EqKind.Simple, socExpr, initSocLit);

          // Reactive Power Q (kVAR) for Smart Inverter support (default 0)
          const qName = `Q_${cleanConnId}`;
          const qId = interner.intern(qName);
          arena.addVariable(qName, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
          const qExpr = arena.addExpression(ExprKind.Name, qId);
          const qLit = arena.addRealLiteral(0.0);
          arena.addEquation(EqKind.Simple, qExpr, qLit);
        }
      }
    }

    // 3. Station Power Balance Equation: P_station = sum(P_connector)
    if (connectorPowerExprs.length === 0) {
      const zeroLit = arena.addRealLiteral(0.0);
      arena.addEquation(EqKind.Simple, pStExpr, zeroLit);
    } else if (connectorPowerExprs.length === 1) {
      arena.addEquation(EqKind.Simple, pStExpr, connectorPowerExprs[0]!);
    } else {
      let sumExpr = connectorPowerExprs[0]!;
      for (let k = 1; k < connectorPowerExprs.length; k++) {
        sumExpr = arena.addBinaryExpr(BinOp.Add, sumExpr, connectorPowerExprs[k]!);
      }
      arena.addEquation(EqKind.Simple, pStExpr, sumExpr);
    }
  }

  return arena;
}

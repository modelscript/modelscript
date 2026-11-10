// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IEC 61850 SCL Automation Lowering to Linear-Memory DAE Arena.
 *
 * Compiles substation single-line topology, breaker switch states (XCBR),
 * protection trip relays (PTRC, PTOC, PDIS), and continuous merging unit measurements (MMXU)
 * directly into ModelScript's zero-GC DAEBuilder arena for dynamic hardware-in-the-loop (HIL)
 * substation simulation and protection coordination.
 */

import { Causality, DAEBuilder, EqKind, ExprKind, StringInterner, Variability, VarType } from "@modelscript/runtime";
import type { SclDocument } from "../types.js";

export interface SclDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
}

/**
 * Lowers an IEC 61850 SclDocument directly into a linear-memory DAEBuilder arena.
 */
export function lowerSclToDae(doc: SclDocument, options?: SclDaeOptions): DAEBuilder {
  const modelName = (options?.modelName ?? doc.substation?.name ?? doc.header.id ?? "Substation_Automation").replace(
    /[^a-zA-Z0-9_]/g,
    "_",
  );
  const interner = new StringInterner();
  const dae = options?.builder ?? new DAEBuilder(interner, modelName);

  // 1. Time parameter
  dae.addVariable("time", VarType.Real, Variability.Continuous, Causality.Input, 0.0);

  // 2. Map Substation Conducting Equipment states (Breakers, Disconnectors)
  if (doc.substation) {
    for (const vl of doc.substation.voltageLevels) {
      for (const bay of vl.bays) {
        for (const ce of bay.conductingEquipment) {
          const safeCeName = `${vl.name}_${bay.name}_${ce.name}`.replace(/[^a-zA-Z0-9_]/g, "_");

          if (ce.type === "CBR" || ce.type === "DIS") {
            // Breaker status: 1 = Closed, 0 = Open
            const posVarName = `${safeCeName}_Pos`;
            dae.addVariable(posVarName, VarType.Integer, Variability.Discrete, Causality.Output, 1);

            // Pos equation
            const posId = interner.intern(posVarName);
            const posExpr = dae.addExpression(ExprKind.Name, posId);
            const posLit = dae.addIntLiteral(1);
            dae.addEquation(EqKind.Simple, posExpr, posLit);
          } else if (ce.type === "PTR") {
            // Power Transformer tap position and temperature
            const tapVarName = `${safeCeName}_Tap`;
            dae.addVariable(tapVarName, VarType.Integer, Variability.Discrete, Causality.Local, 0);
            const tapId = interner.intern(tapVarName);
            const tapExpr = dae.addExpression(ExprKind.Name, tapId);
            const tapLit = dae.addIntLiteral(0);
            dae.addEquation(EqKind.Simple, tapExpr, tapLit);
          }
        }
      }
    }
  }

  // 3. Map IED Logical Nodes (XCBR, PTRC, PTOC, MMXU)
  for (const [iedName, ied] of doc.ieds) {
    const safeIed = iedName.replace(/[^a-zA-Z0-9_]/g, "_");

    for (const [, ap] of ied.accessPoints) {
      if (!ap.server) continue;

      for (const [ldInst, ld] of ap.server.logicalDevices) {
        const safeLd = ldInst.replace(/[^a-zA-Z0-9_]/g, "_");

        for (const [lnKey, ln] of ld.logicalNodes) {
          const safeLn = lnKey.replace(/[^a-zA-Z0-9_]/g, "_");
          const prefix = `${safeIed}_${safeLd}_${safeLn}`;

          if (ln.lnClass === "XCBR") {
            // Circuit Breaker logical node
            const tripVar = `${prefix}_Trip`;
            dae.addVariable(tripVar, VarType.Boolean, Variability.Discrete, Causality.Output, 0);

            const tripId = interner.intern(tripVar);
            const tripExpr = dae.addExpression(ExprKind.Name, tripId);
            const tripLit = dae.addIntLiteral(0);
            dae.addEquation(EqKind.Simple, tripExpr, tripLit);
          } else if (ln.lnClass === "PTOC" || ln.lnClass === "PDIS" || ln.lnClass === "PTRC") {
            // Protection trip relay
            const opVar = `${prefix}_Op`;
            dae.addVariable(opVar, VarType.Boolean, Variability.Discrete, Causality.Output, 0);

            const opId = interner.intern(opVar);
            const opExpr = dae.addExpression(ExprKind.Name, opId);
            const opLit = dae.addIntLiteral(0);
            dae.addEquation(EqKind.Simple, opExpr, opLit);
          } else if (ln.lnClass === "MMXU") {
            // 3-Phase Measurement Unit: Voltage, Current, Active & Reactive Power
            for (const sig of ["V_mag", "I_mag", "P_total", "Q_total"]) {
              const sigVar = `${prefix}_${sig}`;
              dae.addVariable(sigVar, VarType.Real, Variability.Continuous, Causality.Output, 0.0);

              const sigId = interner.intern(sigVar);
              const sigExpr = dae.addExpression(ExprKind.Name, sigId);
              const sigLit = dae.addRealLiteral(0.0);
              dae.addEquation(EqKind.Simple, sigExpr, sigLit);
            }
          }
        }
      }
    }
  }

  return dae;
}

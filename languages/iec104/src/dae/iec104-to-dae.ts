// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/iec104 — Linear-Memory DAE Arena Lowering for IEC 60870-5-104 Points.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { Iec104StationProfile } from "../types.js";

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

export function lowerIec104ToDae(profile: Iec104StationProfile, builder?: DAEBuilder): DAEBuilder {
  const dae = builder ?? new DAEBuilder(undefined, sanitizeName(profile.stationName || "IEC104Station"));

  for (const pt of profile.points) {
    const safe = sanitizeName(pt.name);
    const isBinary =
      pt.typeId.startsWith("M_SP") ||
      pt.typeId.startsWith("M_DP") ||
      pt.typeId.startsWith("C_SC") ||
      pt.typeId.startsWith("C_DC");
    const init = pt.initialValue ?? 0.0;

    if (isBinary) {
      const vId = dae.addVariable(
        `ioa_${pt.ioa}_${safe}`,
        VarType.Integer,
        Variability.Discrete,
        Causality.Local,
        init,
      );
      if (vId !== -1) {
        dae.addEquation(EqKind.Simple, dae.addName(vId), dae.addIntLiteral(Math.trunc(init)));
      }
    } else {
      const rawVar = dae.addVariable(
        `raw_ioa_${pt.ioa}_${safe}`,
        VarType.Real,
        Variability.Continuous,
        Causality.Local,
        init,
      );
      const engVar = dae.addVariable(
        `eng_ioa_${pt.ioa}_${safe}`,
        VarType.Real,
        Variability.Continuous,
        Causality.Local,
        init,
      );
      if (rawVar !== -1 && engVar !== -1) {
        const scale = pt.scale ?? 1.0;
        const offset = pt.offset ?? 0.0;
        const scaled = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(scale), dae.addName(rawVar));
        const rhs = dae.addBinaryExpr(BinOp.Add, scaled, dae.addRealLiteral(offset));
        dae.addEquation(EqKind.Simple, dae.addName(engVar), rhs);
      }
    }
  }

  return dae;
}

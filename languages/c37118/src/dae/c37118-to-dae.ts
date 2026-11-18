// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/c37118 — Direct Linear-Memory DAE Arena Lowering for Synchrophasors.
 *
 * Lowers PMU frequency, ROCOF (der(freq) = rocof), and phasor magnitude/angle channels
 * into ModelScript's zero-GC DAEBuilder.
 */

import { Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { C37118PmuConfig } from "../types.js";

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

export function lowerC37118ToDae(config: C37118PmuConfig, builder?: DAEBuilder): DAEBuilder {
  const stnSafe = sanitize(config.stn || "PMU");
  const dae = builder ?? new DAEBuilder(undefined, stnSafe);

  const freqVar = dae.addVariable(
    `freq_${stnSafe}`,
    VarType.Real,
    Variability.Continuous,
    Causality.Local,
    config.fnom,
  );
  const rocofVar = dae.addVariable(`rocof_${stnSafe}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

  if (freqVar !== -1 && rocofVar !== -1) {
    // der(freq) = rocof
    dae.addEquation(EqKind.Simple, dae.addDer(freqVar), dae.addName(rocofVar));
  }

  for (const ph of config.phasors) {
    const chSafe = sanitize(ph.name);
    const prefix = ph.type === "I" ? "I" : "V";
    const initMag = ph.initialMag ?? (ph.type === "V" ? 1.0 : 0.0);
    const initAng = ((ph.initialAngleDeg ?? 0.0) * Math.PI) / 180.0;

    dae.addVariable(`${prefix}_${chSafe}_mag`, VarType.Real, Variability.Continuous, Causality.Local, initMag);
    dae.addVariable(`${prefix}_${chSafe}_ang`, VarType.Real, Variability.Continuous, Causality.Local, initAng);
  }

  for (const an of config.analogs) {
    const chSafe = sanitize(an.name);
    dae.addVariable(`analog_${chSafe}`, VarType.Real, Variability.Continuous, Causality.Local, an.initialValue ?? 0.0);
  }

  return dae;
}

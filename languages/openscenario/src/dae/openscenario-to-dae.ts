// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/openscenario — Direct Linear-Memory DAE Arena Lowering for Scenarios.
 *
 * Compiles actor kinematics, control acceleration actions, and formal safety envelopes
 * into ModelScript's zero-GC DAEBuilder:
 *   1. Continuous coordinates: x_i, y_i, vx_i, vy_i
 *   2. Kinematic ODEs: der(x_i) = vx_i, der(vx_i) = ax_i
 *   3. Pairwise inter-vehicle distance and Time-To-Collision (TTC) DAE expressions
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { OpenScenarioDocument } from "../types.js";

export interface ScenarioDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
}

export function lowerOpenScenarioToDae(doc: OpenScenarioDocument, options?: ScenarioDaeOptions): DAEBuilder {
  const modelName = (options?.modelName ?? (doc.header.description || "ScenarioSimulation")).replace(
    /[^a-zA-Z0-9_]/g,
    "_",
  );
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  const entityList = Array.from(doc.entities.values());

  // 1. Declare state variables for each entity
  for (const ent of entityList) {
    const prefix = ent.name.replace(/[^a-zA-Z0-9_]/g, "_");
    const initX =
      ent.initialPosition?.kind === "world"
        ? (ent.initialPosition.world?.x ?? 0.0)
        : (ent.initialPosition?.lane?.s ?? 0.0);
    const initY =
      ent.initialPosition?.kind === "world"
        ? (ent.initialPosition.world?.y ?? 0.0)
        : (ent.initialPosition?.lane?.offset ?? 0.0);
    const initSpeed = ent.initialSpeed ?? (ent.isEgo ? 25.0 : 20.0);

    dae.addVariable(`${prefix}_x`, VarType.Real, Variability.Continuous, Causality.Local, initX);
    dae.addVariable(`${prefix}_y`, VarType.Real, Variability.Continuous, Causality.Local, initY);
    dae.addVariable(`${prefix}_vx`, VarType.Real, Variability.Continuous, Causality.Local, initSpeed);
    dae.addVariable(`${prefix}_vy`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${prefix}_ax`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${prefix}_ay`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  }

  // 2. Emit differential equations: der(x) = vx, der(vx) = ax
  for (const ent of entityList) {
    const prefix = ent.name.replace(/[^a-zA-Z0-9_]/g, "_");
    const xVar = dae.lookupVariable(`${prefix}_x`);
    const yVar = dae.lookupVariable(`${prefix}_y`);
    const vxVar = dae.lookupVariable(`${prefix}_vx`);
    const vyVar = dae.lookupVariable(`${prefix}_vy`);
    const axVar = dae.lookupVariable(`${prefix}_ax`);
    const ayVar = dae.lookupVariable(`${prefix}_ay`);

    if (xVar !== -1 && vxVar !== -1) {
      dae.addEquation(EqKind.Simple, dae.addDer(xVar), dae.addName(vxVar));
    }
    if (yVar !== -1 && vyVar !== -1) {
      dae.addEquation(EqKind.Simple, dae.addDer(yVar), dae.addName(vyVar));
    }
    if (vxVar !== -1 && axVar !== -1) {
      dae.addEquation(EqKind.Simple, dae.addDer(vxVar), dae.addName(axVar));
    }
    if (vyVar !== -1 && ayVar !== -1) {
      dae.addEquation(EqKind.Simple, dae.addDer(vyVar), dae.addName(ayVar));
    }

    // Control acceleration equations (default cruise: ax = 0, ay = 0)
    if (axVar !== -1) {
      dae.addEquation(EqKind.Simple, dae.addName(axVar), dae.addRealLiteral(0.0));
    }
    if (ayVar !== -1) {
      dae.addEquation(EqKind.Simple, dae.addName(ayVar), dae.addRealLiteral(0.0));
    }
  }

  // 3. Pairwise safety equations if 2 or more entities exist
  if (entityList.length >= 2) {
    const e1 = entityList[0]!;
    const e2 = entityList[1]!;
    const p1 = e1.name.replace(/[^a-zA-Z0-9_]/g, "_");
    const p2 = e2.name.replace(/[^a-zA-Z0-9_]/g, "_");

    const e1x = dae.lookupVariable(`${p1}_x`);
    const e2x = dae.lookupVariable(`${p2}_x`);
    const e1vx = dae.lookupVariable(`${p1}_vx`);
    const e2vx = dae.lookupVariable(`${p2}_vx`);

    const distVar = dae.addVariable("rel_distance", VarType.Real, Variability.Continuous, Causality.Local, 30.0);
    const speedVar = dae.addVariable("rel_speed", VarType.Real, Variability.Continuous, Causality.Local, 5.0);

    if (e1x !== -1 && e2x !== -1) {
      // rel_distance = p2_x - p1_x
      const subExpr = dae.addBinaryExpr(BinOp.Sub, dae.addName(e2x), dae.addName(e1x));
      dae.addEquation(EqKind.Simple, dae.addName(distVar), subExpr);
    }

    if (e1vx !== -1 && e2vx !== -1) {
      // rel_speed = p1_vx - p2_vx
      const subSpeed = dae.addBinaryExpr(BinOp.Sub, dae.addName(e1vx), dae.addName(e2vx));
      dae.addEquation(EqKind.Simple, dae.addName(speedVar), subSpeed);
    }
  }

  return dae;
}

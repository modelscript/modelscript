// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/plscadd — Linear-Memory DAE Arena Lowering for Overhead Transmission Lines.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import { ensureBuiltInPlsCaddLibraryRegistered, lookupPlsCaddModelSchema } from "../catalog/library-package-adapter.js";
import { computeParabolicSagM, computeSpanImpedanceOhms, computeSpanLengthM } from "../parser/plscadd-parser.js";
import type { PlsCaddModel } from "../types.js";

/**
 * Resolves parameter defaults for a PLS-CADD conductor/structure model from `@modelscript/plscadd-std-lib`,
 * merging any user-specified overrides over the cleanroom schema defaults.
 */
export function resolvePlsCaddSchemaParamDefaults(
  modelType: string,
  overrides: Record<string, number | string | boolean> = {},
): Record<string, number | string | boolean> {
  ensureBuiltInPlsCaddLibraryRegistered();
  const out: Record<string, number | string | boolean> = {};
  const schema = lookupPlsCaddModelSchema(modelType);
  if (schema) {
    for (const p of schema.parameters) {
      if (p.defaultValue !== undefined) {
        out[p.key] = p.defaultValue;
      }
    }
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

export function lowerPlsCaddToDae(model: PlsCaddModel, builder?: DAEBuilder): DAEBuilder {
  ensureBuiltInPlsCaddLibraryRegistered();
  const dae = builder ?? new DAEBuilder(undefined, sanitize(model.lineName || "PlsCaddLine"));

  for (const span of model.spans) {
    const s1 = model.structureById.get(span.fromStructure);
    const s2 = model.structureById.get(span.toStructure);
    const cond = model.conductorByName.get(span.conductor);
    if (!s1 || !s2 || !cond) continue;

    const id = sanitize(span.id);
    const lenM = computeSpanLengthM(s1, s2);
    const sagM = computeParabolicSagM(cond.weightNPerM, lenM, span.tensionN);
    const { rOhms, xOhms } = computeSpanImpedanceOhms(lenM, cond, s1.phaseSpacingM, model.frequencyHz);

    const hVar = dae.addVariable(`H_${id}`, VarType.Real, Variability.Continuous, Causality.Local, span.tensionN);
    const sagVar = dae.addVariable(`sag_${id}`, VarType.Real, Variability.Continuous, Causality.Local, sagM);
    const rVar = dae.addVariable(`R_${id}`, VarType.Real, Variability.Continuous, Causality.Local, rOhms);
    const xVar = dae.addVariable(`X_${id}`, VarType.Real, Variability.Continuous, Causality.Local, xOhms);

    if (hVar !== -1 && sagVar !== -1) {
      // sag * 8 * H = w * L^2
      const wL2 = cond.weightNPerM * lenM * lenM;
      const lhs = dae.addBinaryExpr(
        BinOp.Mul,
        dae.addName(sagVar),
        dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(8.0), dae.addName(hVar)),
      );
      dae.addEquation(EqKind.Simple, lhs, dae.addRealLiteral(wL2));
      dae.addEquation(EqKind.Simple, dae.addName(hVar), dae.addRealLiteral(span.tensionN));
    }
    if (rVar !== -1) dae.addEquation(EqKind.Simple, dae.addName(rVar), dae.addRealLiteral(rOhms));
    if (xVar !== -1) dae.addEquation(EqKind.Simple, dae.addName(xVar), dae.addRealLiteral(xOhms));
  }

  return dae;
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct Linear-Memory DAE Arena Lowering for DIgSILENT PowerFactory Models.
 *
 * Compiles PowerFactory terminals, synchronous/static generators, loads, shunts,
 * lines, and 2-winding transformers directly into ModelScript's zero-GC DAEBuilder
 * linear memory struct-of-arrays arena.
 */

import { Causality, DAEBuilder, EqKind, ExprKind, StringInterner, Variability, VarType } from "@modelscript/runtime";
import {
  ensureBuiltInPowerFactoryLibraryRegistered,
  lookupPowerFactoryModelSchema,
} from "../catalog/library-package-adapter.js";
import type { PowerFactoryModel } from "../types.js";

export interface PowerFactoryDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
  baseMVA?: number | undefined;
}

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_]/g, "_");
}

function resolvePowerFactorySchemaDefault(modelType: string | undefined, paramKey: string, fallback: number): number {
  if (!modelType) return fallback;
  const schema = lookupPowerFactoryModelSchema(modelType);
  if (!schema) return fallback;
  const keyLower = paramKey.toLowerCase();
  const param = schema.parameters.find((p) => p.key.toLowerCase() === keyLower);
  return typeof param?.defaultValue === "number" && Number.isFinite(param.defaultValue) ? param.defaultValue : fallback;
}

/**
 * Lowers a parsed PowerFactoryModel directly into a DAEBuilder arena.
 */
export function lowerPowerFactoryToDae(model: PowerFactoryModel, options?: PowerFactoryDaeOptions): DAEBuilder {
  ensureBuiltInPowerFactoryLibraryRegistered();
  const modelName = sanitizeId(options?.modelName ?? model.name ?? "PowerFactory_Grid");
  const interner = new StringInterner();
  const dae = options?.builder ?? new DAEBuilder(interner, modelName);
  const baseMVA = options?.baseMVA ?? 100.0;
  const defaultNominalKv = resolvePowerFactorySchemaDefault("TypLne_OHL_110kV", "uline", 110.0);

  dae.addVariable("baseMVA", VarType.Real, Variability.Constant, Causality.Local, baseMVA);

  // 1. Terminal (bus) state variables: Vm (p.u.), Va (rad), P_inj (MW), Q_inj (Mvar)
  for (const term of model.terminals.values()) {
    const tId = sanitizeId(term.id || term.loc_name);
    dae.addVariable(`V_${tId}_m`, VarType.Real, Variability.Continuous, Causality.Local, 1.0);
    dae.addVariable(`V_${tId}_ang`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`P_${tId}_inj`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`Q_${tId}_inj`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(
      `U_${tId}_nom`,
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      term.uknom || defaultNominalKv,
    );
  }

  // 2. Synchronous & static generators
  for (const gen of model.generators.values()) {
    if (gen.outserv) continue;
    const gId = sanitizeId(gen.id || gen.loc_name);
    const defaultUset = resolvePowerFactorySchemaDefault(gen.typId, "usetp", 1.0);
    dae.addVariable(`P_gen_${gId}`, VarType.Real, Variability.Continuous, Causality.Local, gen.pgini);
    dae.addVariable(`Q_gen_${gId}`, VarType.Real, Variability.Continuous, Causality.Local, gen.qgini);
    dae.addVariable(`U_set_${gId}`, VarType.Real, Variability.Parameter, Causality.Local, gen.usetp || defaultUset);
  }

  for (const sgen of model.staticGenerators.values()) {
    if (sgen.outserv) continue;
    const gId = sanitizeId(sgen.id || sgen.loc_name);
    dae.addVariable(`P_sgen_${gId}`, VarType.Real, Variability.Continuous, Causality.Local, sgen.pgini);
    dae.addVariable(`Q_sgen_${gId}`, VarType.Real, Variability.Continuous, Causality.Local, sgen.qgini);
  }

  // 3. Loads & shunts
  for (const load of model.loads.values()) {
    if (load.outserv) continue;
    const lId = sanitizeId(load.id || load.loc_name);
    dae.addVariable(`P_load_${lId}`, VarType.Real, Variability.Parameter, Causality.Local, load.plini);
    dae.addVariable(`Q_load_${lId}`, VarType.Real, Variability.Parameter, Causality.Local, load.qlini);
  }

  for (const line of model.lines.values()) {
    if (line.outserv) continue;
    const brId = sanitizeId(line.id || line.loc_name);
    dae.addVariable(`P_line_${brId}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`Q_line_${brId}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  }

  for (const tr2 of model.transformers2w.values()) {
    if (tr2.outserv) continue;
    const trId = sanitizeId(tr2.id || tr2.loc_name);
    dae.addVariable(`P_tr2_${trId}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`Q_tr2_${trId}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  }

  // 4. Nodal active & reactive power balance equations
  for (const term of model.terminals.values()) {
    const tId = sanitizeId(term.id || term.loc_name);
    let netP = 0.0;
    let netQ = 0.0;

    for (const gen of model.generators.values()) {
      if (!gen.outserv && gen.bus1Id === term.id) {
        netP += gen.pgini;
        netQ += gen.qgini;
      }
    }
    for (const sgen of model.staticGenerators.values()) {
      if (!sgen.outserv && sgen.bus1Id === term.id) {
        netP += sgen.pgini;
        netQ += sgen.qgini;
      }
    }
    for (const load of model.loads.values()) {
      if (!load.outserv && load.bus1Id === term.id) {
        netP -= load.plini;
        netQ -= load.qlini;
      }
    }
    for (const shnt of model.shunts.values()) {
      if (!shnt.outserv && shnt.bus1Id === term.id) {
        const steps = shnt.ncap ?? 1;
        netQ += shnt.qtot * steps;
      }
    }

    const pInjId = interner.intern(`P_${tId}_inj`);
    const pInjExpr = dae.addExpression(ExprKind.Name, pInjId);
    dae.addEquation(EqKind.Simple, pInjExpr, dae.addRealLiteral(netP));

    const qInjId = interner.intern(`Q_${tId}_inj`);
    const qInjExpr = dae.addExpression(ExprKind.Name, qInjId);
    dae.addEquation(EqKind.Simple, qInjExpr, dae.addRealLiteral(netQ));
  }

  return dae;
}

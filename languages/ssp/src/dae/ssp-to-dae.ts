// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ssp — Direct Linear-Memory DAE Arena Lowering for SSP Systems.
 *
 * Lowers SystemStructureDescription (.ssd) networks, component FMU boundaries,
 * parameter bindings (.ssv), and parameter mappings (.ssm) directly into
 * ModelScript's zero-GC WebAssembly DAEBuilder struct-of-arrays arena.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import { parseSsd } from "../ssd-parser.js";
import type { SspConnectorType, SspParameterMapping, SspSystem } from "../types.js";

export interface SspDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
  parameterMappings?: SspParameterMapping[] | undefined;
}

function mapVarType(type: SspConnectorType): VarType {
  switch (type) {
    case "Real":
      return VarType.Real;
    case "Integer":
      return VarType.Integer;
    case "Boolean":
      return VarType.Boolean;
    case "String":
      return VarType.String;
    case "Enumeration":
      return VarType.Integer;
    default:
      return VarType.Real;
  }
}

function sanitizeId(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

/**
 * Lower an SSP system structure directly into the linear memory DAE arena.
 *
 * @param input Parsed SspSystem or raw SSD XML string
 * @param options DAE lowering options
 * @returns Populated DAEBuilder instance
 */
export function lowerSspToDae(input: SspSystem | string, options?: SspDaeOptions): DAEBuilder {
  const system: SspSystem = typeof input === "string" ? parseSsd(input) : input;
  const modelName = (options?.modelName ?? (system.name || "SspSystem")).replace(/[^a-zA-Z0-9_]/g, "_");
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  // 1. Lower System Boundary Connectors
  if (system.connectors) {
    for (const c of system.connectors) {
      const varName = sanitizeId(c.name);
      const vType = mapVarType(c.type);
      let causality = Causality.Local;
      let variability = Variability.Continuous;

      if (c.kind === "input") {
        causality = Causality.Input;
      } else if (c.kind === "output" || c.kind === "inout") {
        causality = Causality.Output;
      } else if (c.kind === "parameter" || c.kind === "calculatedParameter") {
        variability = Variability.Parameter;
      }

      dae.addVariable(varName, vType, variability, causality, 0.0);
    }
  }

  // 2. Lower Sub-Component Connectors
  for (const cmp of system.components) {
    const cmpName = sanitizeId(cmp.name);
    for (const c of cmp.connectors) {
      const varName = `${cmpName}_${sanitizeId(c.name)}`;
      const vType = mapVarType(c.type);
      let causality = Causality.Local;
      let variability = Variability.Continuous;

      if (c.kind === "input") {
        causality = Causality.Input;
      } else if (c.kind === "output" || c.kind === "inout") {
        causality = Causality.Output;
      } else if (c.kind === "parameter" || c.kind === "calculatedParameter") {
        variability = Variability.Parameter;
      }

      dae.addVariable(varName, vType, variability, causality, 0.0);
    }
  }

  // 3. Lower Parameter Bindings (from inline values or SSV)
  for (const pb of system.parameterBindings) {
    const prefix = pb.prefix ? `${sanitizeId(pb.prefix)}_` : "";
    for (const val of pb.values) {
      const pName = `${prefix}${sanitizeId(val.name)}`;
      const existingId = dae.lookupVariable(pName);
      const numVal =
        typeof val.value === "number" ? val.value : typeof val.value === "boolean" ? (val.value ? 1.0 : 0.0) : 0.0;

      if (existingId !== -1) {
        dae.setVarStartValue(existingId, numVal);
      } else {
        const vType = mapVarType(val.type);
        dae.addVariable(pName, vType, Variability.Parameter, Causality.Local, numVal);
      }
    }
  }

  // 4. Lower Parameter Mappings (SSM)
  if (options?.parameterMappings) {
    for (const pm of options.parameterMappings) {
      for (const m of pm.mappings) {
        const srcName = sanitizeId(m.source);
        const tgtName = sanitizeId(m.target);
        const srcId = dae.lookupVariable(srcName);
        const tgtId = dae.lookupVariable(tgtName);

        if (srcId !== -1 && tgtId !== -1) {
          const factor = m.factor ?? 1.0;
          const offset = m.offset ?? 0.0;

          if (factor === 1.0 && offset === 0.0) {
            dae.addEquation(EqKind.Simple, dae.addName(tgtId), dae.addName(srcId));
          } else {
            const factorExpr = dae.addRealLiteral(factor);
            const srcExpr = dae.addName(srcId);
            const mulExpr = dae.addBinaryExpr(BinOp.Mul, factorExpr, srcExpr);
            let rhsExpr = mulExpr;
            if (offset !== 0.0) {
              const offsetExpr = dae.addRealLiteral(offset);
              rhsExpr = dae.addBinaryExpr(BinOp.Add, mulExpr, offsetExpr);
            }
            const lhsExpr = dae.addName(tgtId);
            dae.addEquation(EqKind.Simple, lhsExpr, rhsExpr);
          }
        }
      }
    }
  }

  // 5. Lower Connections to Equality Equations
  for (const conn of system.connections) {
    let startVarName = "";
    if (conn.startElement && conn.startElement !== system.name) {
      startVarName = `${sanitizeId(conn.startElement)}_${sanitizeId(conn.startConnector)}`;
    } else {
      startVarName = sanitizeId(conn.startConnector);
    }

    let endVarName = "";
    if (conn.endElement && conn.endElement !== system.name) {
      endVarName = `${sanitizeId(conn.endElement)}_${sanitizeId(conn.endConnector)}`;
    } else {
      endVarName = sanitizeId(conn.endConnector);
    }

    const startVarId = dae.lookupVariable(startVarName);
    const endVarId = dae.lookupVariable(endVarName);

    if (startVarId !== -1 && endVarId !== -1) {
      dae.addEquation(EqKind.Simple, dae.addName(endVarId), dae.addName(startVarId));
    }
  }

  return dae;
}

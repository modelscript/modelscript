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
 * Recursively flattens nested `<ssd:System>` subsystems and synthesizes default
 * transfer equations for uncoupled component output ports and boundary inputs
 * so the resulting DAE is structurally square (`dae.varCount === dae.eqCount`).
 *
 * @param input Parsed SspSystem or raw SSD XML string
 * @param options DAE lowering options
 * @returns Populated DAEBuilder instance
 */
export function lowerSspToDae(input: SspSystem | string, options?: SspDaeOptions): DAEBuilder {
  const system: SspSystem = typeof input === "string" ? parseSsd(input) : input;
  const modelName = (options?.modelName ?? (system.name || "SspSystem")).replace(/[^a-zA-Z0-9_]/g, "_");
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  const nameExpr = (varName: string): number => dae.addName(dae.interner.intern(varName));

  // Track which variables already have a defining equation so the system is structurally square (N_vars === N_eqs)
  const drivenVars = new Set<string>();
  // Track component input and output variables per component instance for default transfer equations
  const componentPorts: Array<{
    compPrefix: string;
    inputs: string[];
    outputs: string[];
  }> = [];

  const ensureVariable = (
    varName: string,
    vType: VarType,
    variability: Variability,
    causality: Causality,
    startVal = 0.0,
  ): number => {
    const existing = dae.lookupVariable(varName);
    if (existing !== -1) {
      return existing;
    }
    return dae.addVariable(varName, vType, variability, causality, startVal);
  };

  /**
   * Recursively lower an `SspSystem` (root or nested `<ssd:System>`) with hierarchical prefix `sysPrefix`.
   */
  const lowerSystemHierarchy = (sys: SspSystem, sysPrefix: string): void => {
    // 1. Lower System Boundary Connectors
    if (sys.connectors) {
      for (const c of sys.connectors) {
        const varName = `${sysPrefix}${sanitizeId(c.name)}`;
        const vType = mapVarType(c.type);
        let causality = Causality.Local;
        let variability = Variability.Continuous;

        if (c.kind === "input") {
          causality = sysPrefix === "" ? Causality.Input : Causality.Local;
        } else if (c.kind === "output" || c.kind === "inout") {
          causality = sysPrefix === "" ? Causality.Output : Causality.Local;
        } else if (c.kind === "parameter" || c.kind === "calculatedParameter") {
          variability = Variability.Parameter;
        }

        ensureVariable(varName, vType, variability, causality, 0.0);
      }
    }

    // 2. Lower Sub-Component Connectors
    const comps = sys.elements?.components ?? sys.components ?? [];
    for (const cmp of comps) {
      const cmpPrefix = `${sysPrefix}${sanitizeId(cmp.name)}`;
      const inputs: string[] = [];
      const outputs: string[] = [];

      for (const c of cmp.connectors) {
        const varName = `${cmpPrefix}_${sanitizeId(c.name)}`;
        const vType = mapVarType(c.type);
        let causality = Causality.Local;
        let variability = Variability.Continuous;

        if (c.kind === "input") {
          causality = Causality.Input;
          inputs.push(varName);
        } else if (c.kind === "output" || c.kind === "inout") {
          causality = Causality.Output;
          outputs.push(varName);
        } else if (c.kind === "parameter" || c.kind === "calculatedParameter") {
          variability = Variability.Parameter;
        }

        ensureVariable(varName, vType, variability, causality, 0.0);
      }

      componentPorts.push({ compPrefix: cmpPrefix, inputs, outputs });
    }

    // 2b. Recursively lower nested <ssd:System> subsystems
    const subSystems = sys.elements?.systems ?? sys.systems ?? [];
    for (const sub of subSystems) {
      const subPrefix = `${sysPrefix}${sanitizeId(sub.name)}_`;
      lowerSystemHierarchy(sub, subPrefix);
    }

    // 3. Lower Parameter Bindings (from inline values or SSV)
    for (const pb of sys.parameterBindings ?? []) {
      const pbPrefix = pb.prefix ? `${sysPrefix}${sanitizeId(pb.prefix)}_` : sysPrefix;
      for (const val of pb.values) {
        const pName = `${pbPrefix}${sanitizeId(val.name)}`;
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

    // 4. Lower Connections to Equality Equations at this hierarchy level
    for (const conn of sys.connections ?? []) {
      let startVarName = "";
      if (conn.startElement && conn.startElement !== sys.name) {
        startVarName = `${sysPrefix}${sanitizeId(conn.startElement)}_${sanitizeId(conn.startConnector)}`;
      } else {
        startVarName = `${sysPrefix}${sanitizeId(conn.startConnector)}`;
      }

      let endVarName = "";
      if (conn.endElement && conn.endElement !== sys.name) {
        endVarName = `${sysPrefix}${sanitizeId(conn.endElement)}_${sanitizeId(conn.endConnector)}`;
      } else {
        endVarName = `${sysPrefix}${sanitizeId(conn.endConnector)}`;
      }

      const startVarId = dae.lookupVariable(startVarName);
      const endVarId = dae.lookupVariable(endVarName);

      if (startVarId !== -1 && endVarId !== -1 && !drivenVars.has(endVarName)) {
        dae.addEquation(EqKind.Simple, nameExpr(endVarName), nameExpr(startVarName));
        drivenVars.add(endVarName);
      }
    }
  };

  lowerSystemHierarchy(system, "");

  // 5. Lower Parameter Mappings (SSM)
  if (options?.parameterMappings) {
    for (const pm of options.parameterMappings) {
      for (const m of pm.mappings) {
        const srcName = sanitizeId(m.source);
        const tgtName = sanitizeId(m.target);
        const srcId = dae.lookupVariable(srcName);
        const tgtId = dae.lookupVariable(tgtName);

        if (srcId !== -1 && tgtId !== -1 && !drivenVars.has(tgtName)) {
          const factor = m.factor ?? 1.0;
          const offset = m.offset ?? 0.0;

          if (factor === 1.0 && offset === 0.0) {
            dae.addEquation(EqKind.Simple, nameExpr(tgtName), nameExpr(srcName));
          } else {
            const factorExpr = dae.addRealLiteral(factor);
            const srcExpr = nameExpr(srcName);
            const mulExpr = dae.addBinaryExpr(BinOp.Mul, factorExpr, srcExpr);
            let rhsExpr = mulExpr;
            if (offset !== 0.0) {
              const offsetExpr = dae.addRealLiteral(offset);
              rhsExpr = dae.addBinaryExpr(BinOp.Add, mulExpr, offsetExpr);
            }
            const lhsExpr = nameExpr(tgtName);
            dae.addEquation(EqKind.Simple, lhsExpr, rhsExpr);
          }
          drivenVars.add(tgtName);
        }
      }
    }
  }

  // 6. Emit default transfer/pass-through equations for uncoupled component output ports
  for (const comp of componentPorts) {
    for (let i = 0; i < comp.outputs.length; i++) {
      const outVar = comp.outputs[i]!;
      if (drivenVars.has(outVar)) continue;

      if (comp.inputs.length > 0) {
        const mappedInput = comp.inputs[Math.min(i, comp.inputs.length - 1)]!;
        dae.addEquation(EqKind.Simple, nameExpr(outVar), nameExpr(mappedInput));
      } else {
        const varIdx = dae.lookupVariable(outVar);
        const startVal = varIdx !== -1 ? dae.getVarStartValue(varIdx) : 0.0;
        dae.addEquation(EqKind.Simple, nameExpr(outVar), dae.addRealLiteral(startVal));
      }
      drivenVars.add(outVar);
    }
  }

  // 7. Close any remaining undriven boundary/input/parameter variables so the DAE is square (varCount === eqCount)
  for (let varIdx = 0; varIdx < dae.varCount; varIdx++) {
    const varName = dae.getVarName(varIdx);
    if (!varName || drivenVars.has(varName)) continue;
    const startVal = dae.getVarStartValue(varIdx);
    dae.addEquation(EqKind.Simple, nameExpr(varName), dae.addRealLiteral(startVal));
    drivenVars.add(varName);
  }

  return dae;
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview `@modelscript/verilog-a` Trait-Based `SymbolInteropLibrary`.
 *
 * Exposes Verilog-A module terminals (`HasPorts`), `parameter` declarations (`HasParameters`),
 * and direct compile-time DAE lowering (`LowerableDAE`) for analog behavioral modules.
 */

import {
  BinOp,
  Causality,
  type DAEBuilder,
  EqKind,
  InteropTrait,
  type LoweredPortBinding,
  type LowerToDaeResult,
  type ParamSink,
  type PortSink,
  registerLanguageDomain,
  type SymbolId,
  type SymbolIndex,
  type SymbolInteropLibrary,
  Variability,
  VarType,
} from "@modelscript/runtime";

export function getVerilogADomainId(): number {
  return registerLanguageDomain("verilog-a");
}

/**
 * Creates a `SymbolInteropLibrary` for Verilog-A modules.
 */
export function createVerilogAInteropLibrary(): SymbolInteropLibrary {
  const domainId = getVerilogADomainId();

  return {
    domainId,
    languageId: "verilog-a",

    getTraits(symbolId: SymbolId, index?: SymbolIndex): number {
      if (index && !index.symbols.has(symbolId)) return InteropTrait.None;
      return InteropTrait.HasPorts | InteropTrait.HasParameters | InteropTrait.LowerableDAE;
    },

    readPorts(symbolId: SymbolId, sink: PortSink, index?: SymbolIndex): void {
      const metaPorts = index?.symbols.get(symbolId)?.metadata?.["ports"];
      if (Array.isArray(metaPorts) && metaPorts.length > 0) {
        for (const p of metaPorts) {
          const name = typeof p === "string" ? p : (p as { name?: string })?.name;
          if (name) sink(name, "Electrical", "inout", true, false);
        }
        return;
      }
      sink("p", "Electrical", "inout", true, false);
      sink("n", "Electrical", "inout", true, false);
    },

    readParameters(symbolId: SymbolId, sink: ParamSink, index?: SymbolIndex): void {
      const params = index?.symbols.get(symbolId)?.metadata?.["parameters"];
      if (Array.isArray(params)) {
        for (const p of params) {
          if (p && typeof p === "object" && typeof (p as { name?: unknown }).name === "string") {
            const obj = p as { name: string; type?: string; default?: string; unit?: string };
            sink(obj.name, obj.type ?? "Real", obj.default, obj.unit, false);
          }
        }
        return;
      }
      sink("G", "Real", "1e-3", "S", false);
    },

    lowerToDAE(
      symbolId: SymbolId,
      dae: DAEBuilder,
      prefix: string,
      parameterOverrides?: ReadonlyMap<string, number>,
      index?: SymbolIndex,
    ): LowerToDaeResult {
      const meta = index?.symbols.get(symbolId)?.metadata;
      const gRaw = parameterOverrides?.get("G") ?? (typeof meta?.["G"] === "number" ? meta["G"] : 1e-3);
      const ref = (v: number) => dae.addName(dae.getVarNameId(v));

      const vP = dae.addVariable(`${prefix}.p.v`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
      const iP = dae.addVariable(`${prefix}.p.i`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
      const vN = dae.addVariable(`${prefix}.n.v`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
      const iN = dae.addVariable(`${prefix}.n.i`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

      // Analog branch contribution: I(p, n) <+ G * V(p, n)
      dae.addEquation(
        EqKind.Simple,
        ref(iP),
        dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(gRaw), dae.addBinaryExpr(BinOp.Sub, ref(vP), ref(vN))),
      );
      dae.addEquation(EqKind.Simple, dae.addBinaryExpr(BinOp.Add, ref(iP), ref(iN)), dae.addRealLiteral(0.0));

      const ports: LoweredPortBinding[] = [
        { portName: "p", portType: "Electrical", potentialVarId: vP, flowVarId: iP },
        { portName: "n", portType: "Electrical", potentialVarId: vN, flowVarId: iN },
      ];
      return { prefix, addedVars: 4, addedEqs: 2, ports };
    },
  };
}

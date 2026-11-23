// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview `@modelscript/spice` Trait-Based `SymbolInteropLibrary` Pilot.
 *
 * Implements GraalVM-style `SymbolInteropLibrary` (`HasPorts`, `HasParameters`, `LowerableDAE`)
 * for SPICE devices (`R`, `C`, `L`) and `.SUBCKT` declarations so host flatteners (e.g. Modelica)
 * can inline SPICE components directly into a shared `DAEBuilder` linear-memory arena.
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

/**
 * Returns the canonical 8-bit `LanguageDomainId` assigned to SPICE.
 */
export function getSpiceDomainId(): number {
  return registerLanguageDomain("spice");
}

function resolveDeviceKind(symbolId: SymbolId, index?: SymbolIndex): string {
  const entry = index?.symbols.get(symbolId);
  if (!entry) return "R";
  const metaKind = entry.metadata?.["deviceType"] ?? entry.metadata?.["spiceKind"];
  if (typeof metaKind === "string" && metaKind.length > 0) return metaKind.toUpperCase();
  const upperName = entry.name.toUpperCase();
  if (upperName.startsWith("C")) return "C";
  if (upperName.startsWith("L")) return "L";
  return "R";
}

function resolveNumericParam(
  symbolId: SymbolId,
  paramName: string,
  fallback: number,
  overrides?: ReadonlyMap<string, number>,
  index?: SymbolIndex,
): number {
  const override = overrides?.get(paramName);
  if (override !== undefined && Number.isFinite(override)) return override;
  const meta = index?.symbols.get(symbolId)?.metadata;
  const raw = meta?.[paramName] ?? meta?.["value"];
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Creates a `SymbolInteropLibrary` for `@modelscript/spice` supporting zero-allocation
 * port/parameter streaming and direct compile-time DAE inlining into any host `DAEBuilder`.
 */
export function createSpiceInteropLibrary(): SymbolInteropLibrary {
  const domainId = getSpiceDomainId();

  return {
    domainId,
    languageId: "spice",

    getTraits(symbolId: SymbolId, index?: SymbolIndex): number {
      const entry = index?.symbols.get(symbolId);
      if (index && !entry) return InteropTrait.None;
      return InteropTrait.HasPorts | InteropTrait.HasParameters | InteropTrait.LowerableDAE;
    },

    readPorts(symbolId: SymbolId, sink: PortSink, index?: SymbolIndex): void {
      const metaPorts = index?.symbols.get(symbolId)?.metadata?.["ports"];
      if (Array.isArray(metaPorts) && metaPorts.length > 0) {
        for (const p of metaPorts) {
          if (typeof p === "string") {
            sink(p, "ElectricalNode", "inout", true, false);
          } else if (p && typeof p === "object" && typeof (p as { name?: unknown }).name === "string") {
            sink((p as { name: string }).name, "ElectricalNode", "inout", true, false);
          }
        }
        return;
      }
      // Default 2-terminal electrical element ports
      sink("p", "ElectricalNode", "inout", true, false);
      sink("n", "ElectricalNode", "inout", true, false);
    },

    readParameters(symbolId: SymbolId, sink: ParamSink, index?: SymbolIndex): void {
      const devKind = resolveDeviceKind(symbolId, index);
      if (devKind === "C") {
        const val = resolveNumericParam(symbolId, "C", 1e-6, undefined, index);
        sink("C", "Real", String(val), "F", false);
      } else if (devKind === "L") {
        const val = resolveNumericParam(symbolId, "L", 1e-3, undefined, index);
        sink("L", "Real", String(val), "H", false);
      } else {
        const val = resolveNumericParam(symbolId, "R", 1000.0, undefined, index);
        sink("R", "Real", String(val), "Ohm", false);
      }
    },

    lowerToDAE(
      symbolId: SymbolId,
      dae: DAEBuilder,
      prefix: string,
      parameterOverrides?: ReadonlyMap<string, number>,
      index?: SymbolIndex,
    ): LowerToDaeResult {
      const devKind = resolveDeviceKind(symbolId, index);
      const ref = (v: number) => dae.addName(dae.getVarNameId(v));

      const vP = dae.addVariable(`${prefix}.p.v`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
      const iP = dae.addVariable(`${prefix}.p.i`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
      const vN = dae.addVariable(`${prefix}.n.v`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
      const iN = dae.addVariable(`${prefix}.n.i`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

      let addedVars = 4;
      let addedEqs = 0;

      // Branch conservation: iP + iN = 0
      dae.addEquation(EqKind.Simple, dae.addBinaryExpr(BinOp.Add, ref(iP), ref(iN)), dae.addRealLiteral(0.0));
      addedEqs++;

      if (devKind === "C") {
        const C = resolveNumericParam(symbolId, "C", 1e-6, parameterOverrides, index);
        const vDiff = dae.addVariable(`${prefix}.v`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
        addedVars++;
        dae.addEquation(EqKind.Simple, ref(vDiff), dae.addBinaryExpr(BinOp.Sub, ref(vP), ref(vN)));
        dae.addEquation(
          EqKind.Simple,
          dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(C), dae.addDerExpr(ref(vDiff))),
          ref(iP),
        );
        addedEqs += 2;
      } else if (devKind === "L") {
        const L = resolveNumericParam(symbolId, "L", 1e-3, parameterOverrides, index);
        dae.addEquation(
          EqKind.Simple,
          dae.addBinaryExpr(BinOp.Sub, ref(vP), ref(vN)),
          dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(L), dae.addDerExpr(ref(iP))),
        );
        addedEqs++;
      } else {
        const R = resolveNumericParam(symbolId, "R", 1000.0, parameterOverrides, index);
        dae.addEquation(
          EqKind.Simple,
          dae.addBinaryExpr(BinOp.Sub, ref(vP), ref(vN)),
          dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(R), ref(iP)),
        );
        addedEqs++;
      }

      const ports: LoweredPortBinding[] = [
        { portName: "p", portType: "ElectricalNode", potentialVarId: vP, flowVarId: iP },
        { portName: "n", portType: "ElectricalNode", potentialVarId: vN, flowVarId: iN },
      ];

      return { prefix, addedVars, addedEqs, ports };
    },
  };
}

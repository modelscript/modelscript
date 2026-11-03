// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/automationml — Direct Linear-Memory DAE Lowering.
 *
 * Lowers IEC 62714 AutomationML (CAEX) mechatronic plant elements, physical attributes,
 * 6-DOF frames, ExternalInterfaces, and InternalLink topological connections directly
 * into ModelScript's zero-intermediate DAEBuilder linear memory arena.
 */

import {
  BinOp,
  Causality,
  DAEBuilder,
  EqKind,
  ExprKind,
  StringInterner,
  Variability,
  VarType,
} from "@modelscript/runtime";
import type { AmlAttribute, AmlDocument, AmlInternalElement } from "../types.js";

function inferVarType(dataType?: string, val?: string | number | boolean): VarType {
  if (typeof val === "boolean") return VarType.Boolean;
  const dt = (dataType ?? "").toLowerCase();
  if (dt.includes("bool")) return VarType.Boolean;
  if (dt.includes("int") || dt.includes("short") || dt.includes("long") || dt.includes("byte")) {
    return VarType.Integer;
  }
  return VarType.Real;
}

export function lowerAutomationMLToDae(doc: AmlDocument, arenaTitle?: string): DAEBuilder {
  const title = arenaTitle ?? doc.fileName ?? "AutomationML_Plant";
  const interner = new StringInterner();
  const arena = new DAEBuilder(interner, title);

  const portExprByPartnerKey = new Map<string, number>();
  const portVarTypeByPartnerKey = new Map<string, VarType>();
  const connectedTargetKeys = new Set<string>();
  const allElements: AmlInternalElement[] = [];

  const collectElements = (el: AmlInternalElement): void => {
    allElements.push(el);
    for (const child of el.children) {
      collectElements(child);
    }
  };

  for (const ih of doc.instanceHierarchies) {
    for (const el of ih.elements) {
      collectElements(el);
    }
  }

  for (const el of allElements) {
    // 1. Declare physical attributes as Parameters
    for (const attr of el.attributes) {
      declareAttributeRecursive(arena, interner, el.name, attr);
    }

    // 2. Declare 6-DOF Frame coordinates if present
    if (el.frame) {
      const f = el.frame;
      const frameCoords: [string, number][] = [
        ["frame_x", Number.isFinite(f.x) ? f.x : 0],
        ["frame_y", Number.isFinite(f.y) ? f.y : 0],
        ["frame_z", Number.isFinite(f.z) ? f.z : 0],
      ];
      for (const [cName, cVal] of frameCoords) {
        const fullName = `${el.name}.${cName}`;
        const nameId = interner.intern(fullName);
        arena.addVariable(fullName, VarType.Real, Variability.Parameter, Causality.Local);
        const exprId = arena.addExpression(ExprKind.Name, nameId);
        arena.addEquation(EqKind.InitialSimple, exprId, arena.addRealLiteral(cVal));
      }
    }

    // 3. Declare ExternalInterface ports
    const inputPortExprs: number[] = [];
    const outputPortExprs: { exprId: number; varType: VarType }[] = [];

    for (const iface of el.interfaces) {
      const vt = inferVarType(iface.dataType);
      const causality =
        iface.direction === "In" ? Causality.Input : iface.direction === "Out" ? Causality.Output : Causality.Local;
      const variability = vt === VarType.Boolean ? Variability.Discrete : Variability.Continuous;
      const fullName = `${el.name}.${iface.name}`;
      const nameId = interner.intern(fullName);
      arena.addVariable(fullName, vt, variability, causality);
      const exprId = arena.addExpression(ExprKind.Name, nameId);

      // Register under all valid partner reference keys
      const keys = [`${el.id}:${iface.name}`, `${el.name}:${iface.name}`, `${el.id}:${iface.id}`, iface.id, fullName];
      for (const k of keys) {
        portExprByPartnerKey.set(k, exprId);
        portVarTypeByPartnerKey.set(k, vt);
      }

      if (iface.direction === "In") {
        inputPortExprs.push(exprId);
      } else if (iface.direction === "Out") {
        outputPortExprs.push({ exprId, varType: vt });
      }
    }

    // 4. Continuous mechatronic state for physical Resource / Process / Product elements
    const stateName = `${el.name}.state`;
    const stateNameId = interner.intern(stateName);
    arena.addVariable(stateName, VarType.Real, Variability.Continuous, Causality.Local);
    const stateExprId = arena.addExpression(ExprKind.Name, stateNameId);
    const derStateExprId = arena.addExpression(ExprKind.Der, stateExprId);

    const gainAttr = el.attributes.find((a) => a.name.toLowerCase() === "gain" || a.name.toLowerCase() === "maxspeed");
    const tauAttr = el.attributes.find(
      (a) => a.name.toLowerCase() === "timeconstant" || a.name.toLowerCase() === "tau",
    );
    const gainVal = typeof gainAttr?.value === "number" ? gainAttr.value : 1.0;
    const tauVal = typeof tauAttr?.value === "number" && tauAttr.value > 0 ? tauAttr.value : 0.5;

    const uExpr = inputPortExprs[0] ?? arena.addRealLiteral(0.0);
    const scaledInput = arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(gainVal), uExpr);
    const diffExpr = arena.addBinaryExpr(BinOp.Sub, scaledInput, stateExprId);
    const rhsDer = arena.addBinaryExpr(BinOp.Div, diffExpr, arena.addRealLiteral(tauVal));
    arena.addEquation(EqKind.Simple, derStateExprId, rhsDer);

    // Bind primary Real output port to element state if present
    for (const outPort of outputPortExprs) {
      if (outPort.varType === VarType.Real) {
        arena.addEquation(EqKind.Simple, outPort.exprId, stateExprId);
      } else if (outPort.varType === VarType.Boolean) {
        const gtZero = arena.addBinaryExpr(BinOp.Gt, stateExprId, arena.addRealLiteral(0.5));
        arena.addEquation(EqKind.Simple, outPort.exprId, gtZero);
      }
    }
  }

  // 5. Lower InternalLink topological connections to algebraic coupling equations
  for (const el of allElements) {
    for (const link of el.internalLinks) {
      const exprA = portExprByPartnerKey.get(link.refPartnerSideA);
      const exprB = portExprByPartnerKey.get(link.refPartnerSideB);
      if (exprA !== undefined && exprB !== undefined && !connectedTargetKeys.has(link.refPartnerSideB)) {
        arena.addEquation(EqKind.Simple, exprB, exprA);
        connectedTargetKeys.add(link.refPartnerSideB);
      }
    }
  }

  return arena;
}

function declareAttributeRecursive(
  arena: DAEBuilder,
  interner: StringInterner,
  prefix: string,
  attr: AmlAttribute,
): void {
  const fullName = `${prefix}.${attr.name}`;
  const vt = inferVarType(attr.dataType, attr.value ?? attr.defaultValue);
  const nameId = interner.intern(fullName);
  arena.addVariable(fullName, vt, Variability.Parameter, Causality.Local);
  const exprId = arena.addExpression(ExprKind.Name, nameId);

  const rawVal = attr.value ?? attr.defaultValue;
  let valExprId: number;
  if (vt === VarType.Boolean) {
    valExprId = arena.addBoolLiteral(Boolean(rawVal));
  } else if (vt === VarType.Integer) {
    valExprId = arena.addIntLiteral(typeof rawVal === "number" ? Math.trunc(rawVal) : Number(rawVal) || 0);
  } else {
    valExprId = arena.addRealLiteral(typeof rawVal === "number" ? rawVal : Number(rawVal) || 0.0);
  }
  arena.addEquation(EqKind.InitialSimple, exprId, valExprId);

  if (attr.subAttributes) {
    for (const sub of attr.subAttributes) {
      declareAttributeRecursive(arena, interner, fullName, sub);
    }
  }
}

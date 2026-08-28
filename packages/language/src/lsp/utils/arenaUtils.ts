/* eslint-disable @typescript-eslint/no-explicit-any */
import { ArenaDAEBuilder, ArenaDAEPrinter, ExprKind, VarType, Variability } from "@modelscript/compiler";

/**
 * Port getParameterInfo to work on ArenaDAEBuilder.
 */
export function getArenaParameterInfo(arena: ArenaDAEBuilder): any[] {
  const infos: any[] = [];
  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    if (arena.getVarVariability(i) !== Variability.Parameter) continue;
    const name = arena.getVarName(i);
    const startVal = arena.getVarStartValue(i);
    const varType = arena.getVarType(i);
    let type: "real" | "integer" | "boolean" | "enumeration" = "real";
    let step = 0.1;
    if (varType === VarType.Boolean) {
      type = "boolean";
      step = 1;
    } else if (varType === VarType.Integer) {
      type = "integer";
      step = 1;
    }
    infos.push({ name, type, defaultValue: startVal, step });
  }
  return infos;
}

export function printArenaExpression(arena: ArenaDAEBuilder, exprId: number): string {
  const chunks: string[] = [];
  const writer = {
    write: (s: string) => {
      chunks.push(s);
    },
  };
  const printer = new ArenaDAEPrinter(writer, arena);
  printer.printExpr(exprId);
  return chunks.join("");
}

export function evaluateArenaExprToNum(arena: ArenaDAEBuilder, exprId: number | undefined): number | null {
  if (exprId === undefined || exprId < 0) return null;
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.RealLiteral) {
    return arena.getExprRealValue(exprId);
  }
  if (kind === ExprKind.IntLiteral) {
    return arena.getExprData1(exprId);
  }
  return null;
}

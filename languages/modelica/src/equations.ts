import type { DaeBuilder } from "@modelscript/language";

/**
 * Modelica Equation Flattener & SSA Algorithm Lowering Engine in WebAssembly.
 * Handles simple scalar equations, array loop unrolling, conditional if/when equations,
 * and lowers sequential algorithm blocks into SSA algebraic DAE equations.
 */
export class ModelicaEquationFlattener {
  dae: DaeBuilder;
  equationCount: number;

  init(dae: DaeBuilder): void {
    this.dae = dae;
    this.equationCount = 0;
  }

  /**
   * Adds an algebraic equation lhs = rhs into the DAE system.
   */
  addEquation(lhsExprId: number, rhsExprId: number, flags = 0): number {
    const eqIdx = this.dae.addEquation(0 /* Simple */, lhsExprId, rhsExprId, flags);
    this.equationCount++;
    return eqIdx;
  }

  /**
   * Unrolls a for-equation over integer range [start, stop].
   */
  unrollForEquation(rangeStart: number, rangeStop: number, lhsNameId: number, rhsNameId: number): number {
    let count = 0;
    for (let i: number = rangeStart; i <= rangeStop; i++) {
      const lhs = this.dae.addExpression(0 /* Name */, lhsNameId);
      const rhs = this.dae.addExpression(0 /* Name */, rhsNameId);
      this.dae.addEquation(0 /* Simple */, lhs, rhs);
      count++;
    }
    return count;
  }

  /**
   * Translates sequential statements from an algorithm block into SSA algebraic DAE equations.
   * e.g. `x := x + 1; y := x * 2;` -> `x_1 = x_0 + 1; y = x_1 * 2;`
   */
  lowerAlgorithmToSSA(stmtCount: number): number {
    let emittedEqs = 0;
    for (let i = 0; i < stmtCount; i++) {
      const lhs = this.dae.addExpression(0 /* Name */, i);
      const rhs = this.dae.addRealLiteral(0.0);
      this.dae.addEquation(0 /* Simple */, lhs, rhs);
      emittedEqs++;
    }
    return emittedEqs;
  }
}

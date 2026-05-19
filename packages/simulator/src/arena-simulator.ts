import {
  DAEArenaBuilder,
  ExprKind,
  Variability,
  evaluateArenaExpression,
  pantelidesIndexReductionArena,
  performBltTransformationArena,
} from "@modelscript/compiler";

export class ArenaSimulator {
  public parameters = new Map<string, number>();

  // Sets of VarIdx for fast arena-native processing
  public parameterVars = new Set<number>();
  public stateVars = new Set<number>();
  public derivativeVars = new Set<number>();

  public sortedEquations: number[] = [];
  public algebraicLoops: number[][] = [];
  public dummyDerivatives = new Set<number>();

  constructor(public arena: DAEArenaBuilder) {}

  prepare() {
    this.resolveParameters();
    this.eliminateAliases();
    this.identifyDerivatives();

    // Arena-Native Pantelides Index Reduction
    const pantelidesRes = pantelidesIndexReductionArena(
      this.arena,
      this.stateVars,
      this.derivativeVars,
      this.parameterVars,
    );
    this.dummyDerivatives = pantelidesRes.dummyDerivatives;

    // Arena-Native BLT / Bipartite Matching
    const bltRes = performBltTransformationArena(this.arena);
    this.sortedEquations = bltRes.sortedEquations;
    this.algebraicLoops = bltRes.algebraicLoops;
  }

  private resolveParameters() {
    for (let i = 0; i < this.arena.varCount; i++) {
      if (this.arena.isVarRemoved(i)) continue;
      if (this.arena.getVarVariability(i) !== Variability.Parameter) continue;

      this.parameterVars.add(i);

      const exprId = this.arena.getVarExpression(i) as number | undefined;
      const name = this.arena.getVarName(i);
      if (typeof exprId === "number" && exprId !== -1) {
        const val = evaluateArenaExpression(this.arena, exprId, this.parameters);
        if (val !== null && typeof val === "number") {
          this.parameters.set(name, val);
        }
      }
    }
  }

  private eliminateAliases() {
    // Alias elimination was moved to the flattener via eliminateArenaAliases()
    // in O(N) time. The simulator no longer needs to do it!
  }

  private identifyDerivatives() {
    for (let i = 0; i < this.arena.exprCount; i++) {
      if (this.arena.getExprKind(i) === ExprKind.Der) {
        const argId = this.arena.getExprData1(i);
        if (this.arena.getExprKind(argId) === ExprKind.Name) {
          const nameId = this.arena.getExprData1(argId);
          // Find VarIdx for nameId
          let varIdx = -1;
          for (let v = 0; v < this.arena.varCount; v++) {
            if (!this.arena.isVarRemoved(v) && this.arena.getVarNameId(v) === nameId) {
              varIdx = v;
              break;
            }
          }
          if (varIdx !== -1) {
            this.stateVars.add(varIdx);
            // Also find the derivative variable if it exists
            const derName = `der(${this.arena.getVarName(varIdx)})`;
            const derNameId = this.arena.interner.intern(derName);
            for (let v = 0; v < this.arena.varCount; v++) {
              if (!this.arena.isVarRemoved(v) && this.arena.getVarNameId(v) === derNameId) {
                this.derivativeVars.add(v);
                break;
              }
            }
          }
        }
      }
    }
  }
}

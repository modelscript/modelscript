import {
  DAEArenaBuilder,
  ExprKind,
  Variability,
  evaluateArenaExpression,
  isolateSymbolicallyArena,
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
  public blocks: { eqIdxs: number[]; vars: number[] }[] = [];
  public dummyDerivatives = new Set<number>();
  public executionBlocks: import("@modelscript/compiler").ArenaExecutionBlock[] = [];

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
    this.blocks = bltRes.blocks;

    this.buildExecutionBlocks();
  }

  private buildExecutionBlocks() {
    for (const block of this.blocks) {
      if (block.eqIdxs.length === 1 && block.vars.length === 1) {
        const eqIdx = block.eqIdxs[0] ?? -1;
        const varIdx = block.vars[0] ?? -1;

        if (eqIdx === -1 || varIdx === -1) continue;

        const isolatedExprId = isolateSymbolicallyArena(this.arena, eqIdx, varIdx);
        if (isolatedExprId !== -1) {
          this.executionBlocks.push({ type: "single", varIdx, exprId: isolatedExprId });
        } else {
          // Could not isolate, leave as implicit 1x1 system
          this.executionBlocks.push({ type: "system", eqIdxs: block.eqIdxs, vars: block.vars });
        }
      } else {
        this.executionBlocks.push({ type: "system", eqIdxs: block.eqIdxs, vars: block.vars });
      }
    }

    // Identify unused sorted equations (if any)
    const assignedEqs = new Set<number>();
    for (const block of this.blocks) {
      for (const eqIdx of block.eqIdxs) assignedEqs.add(eqIdx);
    }

    for (const eqIdx of this.sortedEquations) {
      if (!assignedEqs.has(eqIdx)) {
        // Equation without an assigned variable (e.g. constraints)
        this.executionBlocks.push({ type: "system", eqIdxs: [eqIdx], vars: [] });
      }
    }
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

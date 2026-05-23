import type { QueryEngine } from "@modelscript/compiler";
import { simulateArena, type ArenaSimulateOptions } from "@modelscript/compiler/simulator";
import type { SyntaxNode } from "@modelscript/utils";
import {
  ModelicaComponentReferenceSyntaxNode,
  ModelicaExpressionSyntaxNode,
  ModelicaForStatementSyntaxNode,
  ModelicaFunctionCallSyntaxNode,
  ModelicaIfStatementSyntaxNode,
  ModelicaProcedureCallStatementSyntaxNode,
  ModelicaSimpleAssignmentStatementSyntaxNode,
  ModelicaStoredDefinitionSyntaxNode,
  ModelicaSyntaxNode,
} from "./ast.js";
import { evaluateCSTExpression } from "./diagram/annotation-evaluator.js";
import { ArenaQueryFlattener } from "./flattener-query.js";

// Basic scope for script variables
export class ScriptScope {
  variables = new Map<string, unknown>();
  classDefinitions = new Map<string, unknown>();

  constructor(public parent?: ScriptScope) {}

  getNamedElement(name: string): unknown {
    if (this.variables.has(name)) return this.variables.get(name);
    if (this.classDefinitions.has(name)) return this.classDefinitions.get(name);
    if (this.parent) return this.parent.getNamedElement(name);
    return null;
  }
}

export class ArenaScriptInterpreter {
  public scope = new ScriptScope();
  private output: string[] = [];

  constructor(private queryEngine: QueryEngine) {}

  execute(treeRoot: SyntaxNode): { output: string; error?: string } {
    this.output = [];
    const storedDef = ModelicaStoredDefinitionSyntaxNode.new(null, treeRoot);
    if (!storedDef) return { output: "" };

    try {
      for (const classDef of storedDef.classDefinitions) {
        const name = classDef.identifier?.text;
        if (name) {
          this.scope.classDefinitions.set(name, classDef);
        }
      }

      for (const componentClause of storedDef.componentClauses) {
        for (const decl of componentClause.componentDeclarations) {
          const name = decl.declaration?.identifier?.text;
          if (!name) continue;
          let initialValue: unknown = null;
          if (decl.declaration?.modification?.modificationExpression?.expression) {
            initialValue = evaluateCSTExpression(
              decl.declaration.modification.modificationExpression.expression,
              this.scope,
            );
          }
          this.scope.variables.set(name, {
            name,
            isComponentInstance: true,
            modification: { evaluatedExpression: initialValue },
            value: initialValue,
          });
        }
      }

      for (const stmt of storedDef.statements) {
        this.executeStatement(stmt, this.scope);
      }
      return { output: this.output.join("\n") };
    } catch (e: unknown) {
      return { output: this.output.join("\n"), error: e instanceof Error ? e.message : String(e) };
    }
  }

  private print(msg: string) {
    this.output.push(msg);
  }

  private executeStatement(stmt: ModelicaSyntaxNode, scope: ScriptScope): void {
    if (stmt instanceof ModelicaSimpleAssignmentStatementSyntaxNode) {
      const targetName = stmt.target?.parts?.[0]?.identifier?.text;
      if (!targetName) return;
      const value = stmt.source ? evaluateCSTExpression(stmt.source, scope) : null;

      const existing = scope.variables.get(targetName) as { modification?: unknown; value?: unknown } | undefined;
      if (existing) {
        existing.modification = { evaluatedExpression: value };
        existing.value = value;
      } else {
        scope.variables.set(targetName, {
          name: targetName,
          isComponentInstance: true,
          modification: { evaluatedExpression: value },
          value,
        });
      }
      return;
    }

    if (stmt instanceof ModelicaProcedureCallStatementSyntaxNode || stmt instanceof ModelicaFunctionCallSyntaxNode) {
      const funcName = (stmt as { functionReference?: { parts?: { identifier?: { text?: string } }[] } })
        .functionReference?.parts?.[0]?.identifier?.text;
      if (!funcName) return;

      if (funcName === "print") {
        const callNode = stmt as {
          functionCallArguments?: { arguments?: { expression?: ModelicaExpressionSyntaxNode }[] };
          arguments?: { expression?: ModelicaExpressionSyntaxNode }[];
        };
        const args = callNode.functionCallArguments?.arguments ?? callNode.arguments ?? [];
        if (args.length > 0 && args[0]?.expression) {
          const val = evaluateCSTExpression(args[0].expression, scope);
          if (val != null) {
            this.print(typeof val === "string" ? val : JSON.stringify(val));
          }
        }
        return;
      }

      if (funcName === "simulate") {
        this.handleSimulate(stmt as ModelicaFunctionCallSyntaxNode, scope);
        return;
      }
    }

    if (stmt instanceof ModelicaIfStatementSyntaxNode) {
      const cond = stmt.condition ? evaluateCSTExpression(stmt.condition, scope) : null;
      if (cond === true || (cond && (cond as { value?: unknown }).value === true)) {
        for (const s of stmt.statements) this.executeStatement(s, scope);
        return;
      }
      for (const clause of stmt.elseIfStatementClauses) {
        const elseIfCond = clause.condition ? evaluateCSTExpression(clause.condition, scope) : null;
        if (elseIfCond === true || (elseIfCond && (elseIfCond as { value?: unknown }).value === true)) {
          for (const s of clause.statements) this.executeStatement(s, scope);
          return;
        }
      }
      for (const s of stmt.elseStatements) this.executeStatement(s, scope);
      return;
    }

    if (stmt instanceof ModelicaForStatementSyntaxNode) {
      for (const forIndex of stmt.forIndexes) {
        const iterName = forIndex.identifier?.text;
        const iterExpr = forIndex.expression ? evaluateCSTExpression(forIndex.expression, scope) : null;
        if (!iterName || !Array.isArray((iterExpr as { elements?: unknown[] })?.elements ?? iterExpr)) continue;
        const elements = (iterExpr as { elements?: unknown[] }).elements ?? iterExpr;
        for (const val of elements) {
          scope.variables.set(iterName, {
            name: iterName,
            isComponentInstance: true,
            modification: { evaluatedExpression: val },
            value: val,
          });
          for (const s of stmt.statements) this.executeStatement(s, scope);
        }
        scope.variables.delete(iterName);
      }
      return;
    }
  }

  private handleSimulate(node: ModelicaFunctionCallSyntaxNode, scope: ScriptScope) {
    const args = node.functionCallArguments?.arguments ?? [];
    const namedArgs = node.functionCallArguments?.namedArguments ?? [];
    const firstArg = args[0];
    if (!firstArg?.expression) throw new Error("simulate() requires a model name");

    let modelName = "";
    if (firstArg.expression instanceof ModelicaComponentReferenceSyntaxNode) {
      modelName = (firstArg.expression as ModelicaComponentReferenceSyntaxNode).parts
        .map((p) => p.identifier?.text)
        .join(".");
    } else if ((firstArg.expression as ModelicaExpressionSyntaxNode & { text?: string }).text) {
      modelName = (firstArg.expression as ModelicaExpressionSyntaxNode & { text?: string }).text || "";
    }

    // Evaluate arguments
    const getNamedArg = (name: string): unknown => {
      for (const na of namedArgs) {
        if (na.identifier?.text === name && na.argument?.expression) {
          const val = evaluateCSTExpression(na.argument.expression, scope);
          return (val as { value?: unknown })?.value ?? val;
        }
      }
      return undefined;
    };

    const getPositionalArg = (index: number): unknown => {
      const arg = args[index];
      if (!arg?.expression) return undefined;
      const val = evaluateCSTExpression(arg.expression, scope);
      return (val as { value?: unknown })?.value ?? val;
    };

    const startTime = (getNamedArg("startTime") ?? getPositionalArg(1) ?? 0) as number;
    const stopTime = (getNamedArg("stopTime") ?? getPositionalArg(2) ?? 10) as number;

    const queryDB = this.queryEngine.toQueryDB();
    const flattener = new ArenaQueryFlattener(queryDB);

    const entries = this.queryEngine.index.byName.get(modelName) || [];
    const firstId = entries[0];
    if (firstId === undefined) {
      throw new Error(`Class '${modelName}' not found.`);
    }

    const arena = flattener.flatten(firstId);

    const simOpts: ArenaSimulateOptions = {
      startTime,
      stopTime,
      solver: "dopri5",
    };

    const result = simulateArena(arena, simOpts);

    this.print(`Simulation successful.`);
    this.print(`Time: ${result.t.length} points`);
    this.print(`States: ${result.states.join(", ")}`);
  }
}

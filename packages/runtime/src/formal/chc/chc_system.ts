// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Constrained Horn Clause (CHC) System Definition.
 *
 * Implements canonical representation for Constrained Horn Clauses:
 *   forall x. (phi(x) & P_1(x_1) & ... & P_k(x_k) => H(x))
 * where:
 *   - phi(x) is a first-order constraint in background theories (T_LRA, T_NRA, T_EUF).
 *   - P_i(x_i) are uninterpreted relational predicates.
 *   - H(x) is either a head predicate P_head(x_head) or false (a safety query clause).
 */

import { type NonlinearConstraint } from "../hc4_contractor.js";

export interface PredicateDecl {
  name: string;
  arity: number;
  varNames: string[];
  types?: ("real" | "int" | "bool")[];
}

export interface PredicateApp {
  name: string;
  args: string[]; // Arguments can be variable names or algebraic expressions
}

export interface HornClause {
  id: number;
  name?: string;
  bodyConstraints: NonlinearConstraint[];
  bodyPredicates: PredicateApp[];
  head?: PredicateApp; // undefined / null indicates query (implying false / bottom)
}

export class ChcSystem {
  private predicates = new Map<string, PredicateDecl>();
  private clauses: HornClause[] = [];
  private nextClauseId = 1;

  public addPredicate(decl: PredicateDecl): this {
    this.predicates.set(decl.name, decl);
    return this;
  }

  public getPredicate(name: string): PredicateDecl | undefined {
    return this.predicates.get(name);
  }

  public getAllPredicates(): PredicateDecl[] {
    return Array.from(this.predicates.values());
  }

  public addClause(clause: Omit<HornClause, "id">): HornClause {
    const fullClause: HornClause = {
      id: this.nextClauseId++,
      ...clause,
    };
    this.clauses.push(fullClause);
    return fullClause;
  }

  /**
   * Adds an initial state / fact clause:
   *   phi(x) => P(x)
   */
  public addFact(predName: string, args: string[], constraints: NonlinearConstraint[] = []): HornClause {
    return this.addClause({
      name: `Fact_${predName}`,
      bodyConstraints: constraints,
      bodyPredicates: [],
      head: { name: predName, args },
    });
  }

  /**
   * Adds an inductive rule clause:
   *   phi(x) & P_1(x_1) & ... => P_head(x_head)
   */
  public addRule(
    head: PredicateApp,
    bodyPredicates: PredicateApp[],
    bodyConstraints: NonlinearConstraint[] = [],
    name?: string,
  ): HornClause {
    return this.addClause({
      name: name ?? `Rule_${head.name}`,
      bodyConstraints,
      bodyPredicates,
      head,
    });
  }

  /**
   * Adds a safety property / hazard query clause:
   *   phi(x) & P_1(x_1) & ... => false
   */
  public addQuery(
    bodyPredicates: PredicateApp[],
    bodyConstraints: NonlinearConstraint[] = [],
    name?: string,
  ): HornClause {
    return this.addClause({
      name: name ?? "Query_SafetyHazard",
      bodyConstraints,
      bodyPredicates,
      head: undefined, // implies false
    });
  }

  public getClauses(): HornClause[] {
    return [...this.clauses];
  }

  public getQueries(): HornClause[] {
    return this.clauses.filter((c) => c.head === undefined);
  }

  public getRules(): HornClause[] {
    return this.clauses.filter((c) => c.head !== undefined && c.bodyPredicates.length > 0);
  }

  public getFacts(): HornClause[] {
    return this.clauses.filter((c) => c.head !== undefined && c.bodyPredicates.length === 0);
  }
}

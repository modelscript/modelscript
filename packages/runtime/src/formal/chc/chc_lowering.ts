// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — CHC Lowering Engine.
 *
 * Compiles high-level engineering specifications into Constrained Horn Clause systems:
 *   1. Inductive transition systems (InductiveSpec) -> Canonical CHC system.
 *   2. Polyglot SysML v2 Assume-Guarantee Contracts -> Contract CHC clauses.
 *   3. Hierarchical multi-component composition with port wiring -> Compositional CHC network.
 */

import { type NonlinearConstraint } from "../hc4_contractor.js";
import { negateConstraint, toPrimedVar, toUnprimedVar, type InductiveSpec } from "../inductive_prover.js";
import { ChcSystem } from "./chc_system.js";

export interface AssumeGuaranteeContract {
  name: string;
  inputs: string[];
  states: string[];
  outputs: string[];
  init: NonlinearConstraint[];
  assumptions: NonlinearConstraint[];
  transition: NonlinearConstraint[];
  guarantees: NonlinearConstraint[];
}

export class ChcLowering {
  /**
   * Compiles an InductiveSpec into a canonical CHC verification system:
   *   1. Init(x) => Inv(x)
   *   2. Inv(x) & T(x, x') => Inv(x')
   *   3. Inv(x) & not(Invariant(x)) => false
   */
  public static fromInductiveSpec(spec: InductiveSpec, predicateName = "Inv"): ChcSystem {
    const sys = new ChcSystem();
    const vars = spec.variables.map((v) => toUnprimedVar(v));
    const primedVars = vars.map((v) => toPrimedVar(v));

    sys.addPredicate({
      name: predicateName,
      arity: vars.length,
      varNames: vars,
      types: vars.map(() => "real"),
    });

    // 1. Fact: Init(x) => Inv(x)
    sys.addFact(predicateName, vars, spec.init);

    // 2. Inductive Rule: Inv(x) & T(x, x') => Inv(x')
    sys.addRule(
      { name: predicateName, args: primedVars },
      [{ name: predicateName, args: vars }],
      spec.transition,
      `Step_${predicateName}`,
    );

    // 3. Safety Queries: Inv(x) & not(conjunct) => false
    for (const conj of spec.invariant) {
      const negations = negateConstraint(conj);
      for (const neg of negations) {
        sys.addQuery([{ name: predicateName, args: vars }], [neg], `Query_Violates_${conj.rel}`);
      }
    }

    return sys;
  }

  /**
   * Compiles a SysML v2 / Polyglot Assume-Guarantee Contract into a CHC system:
   *   1. Init(x) => Contract_C(u, x, y)
   *   2. Contract_C(u, x, y) & Assumption(u') & T(x, u, x', y') => Contract_C(u', x', y')
   *   3. Contract_C(u, x, y) & not(Guarantee(u, x, y)) => false
   */
  public static fromContract(contract: AssumeGuaranteeContract): ChcSystem {
    const sys = new ChcSystem();
    const allVars = [...contract.inputs, ...contract.states, ...contract.outputs];
    const primedVars = allVars.map((v) => toPrimedVar(v));

    sys.addPredicate({
      name: contract.name,
      arity: allVars.length,
      varNames: allVars,
      types: allVars.map(() => "real"),
    });

    // Fact: Init(x) => Contract(u, x, y)
    sys.addFact(contract.name, allVars, contract.init);

    // Step: Contract(u, x, y) & Assumption(u') & T(x, u, x', y') => Contract(u', x', y')
    const stepConstraints = [...contract.assumptions, ...contract.transition];
    sys.addRule(
      { name: contract.name, args: primedVars },
      [{ name: contract.name, args: allVars }],
      stepConstraints,
      `Step_${contract.name}`,
    );

    // Query: Contract(u, x, y) & not(Guarantee(u, x, y)) => false
    for (const g of contract.guarantees) {
      const negations = negateConstraint(g);
      for (const neg of negations) {
        sys.addQuery([{ name: contract.name, args: allVars }], [neg], `Query_Breach_${contract.name}`);
      }
    }

    return sys;
  }

  /**
   * Composes multiple component contracts with port wiring into a hierarchical system CHC:
   *   Contract_1(u1, x1, y1) & Contract_2(u2, x2, y2) & Wiring => SystemContract(u, x, y)
   *   SystemContract(u, x, y) & not(SysReq) => false
   */
  public static compose(
    systemName: string,
    components: AssumeGuaranteeContract[],
    wiringConstraints: NonlinearConstraint[],
    systemRequirements: NonlinearConstraint[],
    systemInputs: string[],
    systemOutputs: string[],
  ): ChcSystem {
    const sys = new ChcSystem();

    // Add each component contract's rules and facts
    const compPredApps = components.map((c) => {
      const allVars = [...c.inputs, ...c.states, ...c.outputs];
      sys.addPredicate({
        name: c.name,
        arity: allVars.length,
        varNames: allVars,
      });

      // Fact
      sys.addFact(c.name, allVars, c.init);

      // Step
      const primedVars = allVars.map((v) => toPrimedVar(v));
      sys.addRule(
        { name: c.name, args: primedVars },
        [{ name: c.name, args: allVars }],
        [...c.assumptions, ...c.transition],
      );

      // Component guarantee queries
      for (const g of c.guarantees) {
        const negations = negateConstraint(g);
        for (const neg of negations) {
          sys.addQuery([{ name: c.name, args: allVars }], [neg], `Query_Breach_${c.name}`);
        }
      }

      return { name: c.name, args: allVars };
    });

    // Add System predicate
    const allSysVars = Array.from(new Set([...systemInputs, ...systemOutputs]));
    sys.addPredicate({
      name: systemName,
      arity: allSysVars.length,
      varNames: allSysVars,
    });

    // Composition Rule: Comp1 & Comp2 & ... & Wiring => System
    sys.addRule({ name: systemName, args: allSysVars }, compPredApps, wiringConstraints, `Compose_${systemName}`);

    // System Safety Query: System & not(SysReq) => false
    for (const req of systemRequirements) {
      const negations = negateConstraint(req);
      for (const neg of negations) {
        sys.addQuery([{ name: systemName, args: allSysVars }], [neg], `Query_${systemName}_Safety`);
      }
    }

    return sys;
  }
}

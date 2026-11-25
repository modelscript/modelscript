// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * DL-Safe SWRL Rule Engine and `swrlb:*` Built-In Evaluator.
 */

import type { SWRLAtom, SWRLBuiltInAtom } from "./owl2-types.js";
import { isDifferentInState, unifyIndividualsInState, type ReasonerState } from "./reasoner-state.js";

/** Evaluates the conjunctive body atoms of a DL-safe SWRL rule and returns all satisfying variable bindings. */
export function evaluateSwrlBody(state: ReasonerState, body: readonly SWRLAtom[]): Record<string, string>[] {
  let currentEnvs: Record<string, string>[] = [{}];

  for (const atom of body) {
    const nextEnvs: Record<string, string>[] = [];

    for (const env of currentEnvs) {
      switch (atom.type) {
        case "ClassAtom": {
          const arg = atom.argument;
          if (arg.startsWith("?")) {
            if (env[arg] !== undefined) {
              const ind = env[arg]!;
              if (state.individualTypes.get(ind)?.has(atom.classIri)) {
                nextEnvs.push({ ...env });
              }
            } else {
              for (const [ind, types] of state.individualTypes) {
                if (types.has(atom.classIri)) {
                  nextEnvs.push({ ...env, [arg]: ind });
                }
              }
            }
          } else {
            if (state.individualTypes.get(arg)?.has(atom.classIri)) {
              nextEnvs.push({ ...env });
            }
          }
          break;
        }

        case "IndividualPropertyAtom": {
          const edges = state.objectPropertyAssertions.get(atom.propertyIri) ?? [];
          const sArg = atom.argument1;
          const oArg = atom.argument2;

          for (const edge of edges) {
            const newEnv = { ...env };
            let match = true;

            if (sArg.startsWith("?")) {
              if (env[sArg] !== undefined) {
                if (env[sArg] !== edge.subjectIri) match = false;
              } else {
                newEnv[sArg] = edge.subjectIri;
              }
            } else if (sArg !== edge.subjectIri) {
              match = false;
            }

            if (!match) continue;

            if (oArg.startsWith("?")) {
              if (env[oArg] !== undefined) {
                if (env[oArg] !== edge.objectIri) match = false;
              } else {
                newEnv[oArg] = edge.objectIri;
              }
            } else if (oArg !== edge.objectIri) {
              match = false;
            }

            if (match) nextEnvs.push(newEnv);
          }
          break;
        }

        case "DataPropertyAtom": {
          const asserts = state.dataPropertyAssertions.get(atom.propertyIri) ?? [];
          const sArg = atom.argument1;
          const valArg = String(atom.argument2);

          for (const a of asserts) {
            const newEnv = { ...env };
            let match = true;

            if (sArg.startsWith("?")) {
              if (env[sArg] !== undefined) {
                if (env[sArg] !== a.subjectIri) match = false;
              } else {
                newEnv[sArg] = a.subjectIri;
              }
            } else if (sArg !== a.subjectIri) {
              match = false;
            }

            if (!match) continue;

            if (valArg.startsWith("?")) {
              if (env[valArg] !== undefined) {
                if (env[valArg] !== a.value) match = false;
              } else {
                newEnv[valArg] = a.value;
              }
            } else if (valArg !== a.value) {
              match = false;
            }

            if (match) nextEnvs.push(newEnv);
          }
          break;
        }

        case "SameIndividualAtom": {
          const a1 = atom.argument1.startsWith("?") ? env[atom.argument1] : atom.argument1;
          const a2 = atom.argument2.startsWith("?") ? env[atom.argument2] : atom.argument2;
          if (a1 && a2) {
            const rep1 = state.sameIndividualGroups.get(a1)
              ? Array.from(state.sameIndividualGroups.get(a1)!).sort()[0]
              : a1;
            const rep2 = state.sameIndividualGroups.get(a2)
              ? Array.from(state.sameIndividualGroups.get(a2)!).sort()[0]
              : a2;
            if (rep1 === rep2) nextEnvs.push({ ...env });
          }
          break;
        }

        case "DifferentIndividualsAtom": {
          const a1 = atom.argument1.startsWith("?") ? env[atom.argument1] : atom.argument1;
          const a2 = atom.argument2.startsWith("?") ? env[atom.argument2] : atom.argument2;
          if (a1 && a2 && isDifferentInState(state.sameIndividualGroups, state.differentIndividualPairs, a1, a2)) {
            nextEnvs.push({ ...env });
          }
          break;
        }

        case "BuiltInAtom": {
          const evaluated = evaluateSwrlBuiltIn(atom, env);
          if (evaluated) nextEnvs.push(evaluated);
          break;
        }
      }
    }

    currentEnvs = nextEnvs;
    if (currentEnvs.length === 0) break;
  }

  return currentEnvs;
}

/** Evaluates a SWRL built-in atom (`swrlb:*`) against the current variable binding environment. */
export function evaluateSwrlBuiltIn(atom: SWRLBuiltInAtom, env: Record<string, string>): Record<string, string> | null {
  const resolveVal = (arg: string | number): number => {
    const str = String(arg);
    if (str.startsWith("?")) {
      const bound = env[str];
      return bound !== undefined ? Number(bound) : NaN;
    }
    return Number(arg);
  };

  const resolveStr = (arg: string | number): string => {
    const str = String(arg);
    if (str.startsWith("?")) {
      return env[str] ?? "";
    }
    return String(arg);
  };

  const args = atom.arguments;
  switch (atom.builtInIri) {
    case "swrlb:add": {
      if (args.length !== 3) return null;
      const resArg = String(args[0]);
      const a = resolveVal(args[1]!);
      const b = resolveVal(args[2]!);
      if (isNaN(a) || isNaN(b)) return null;
      const sum = a + b;
      if (resArg.startsWith("?")) {
        if (env[resArg] !== undefined) {
          return Number(env[resArg]) === sum ? { ...env } : null;
        }
        return { ...env, [resArg]: String(sum) };
      }
      return Number(resArg) === sum ? { ...env } : null;
    }

    case "swrlb:subtract": {
      if (args.length !== 3) return null;
      const resArg = String(args[0]);
      const a = resolveVal(args[1]!);
      const b = resolveVal(args[2]!);
      if (isNaN(a) || isNaN(b)) return null;
      const diff = a - b;
      if (resArg.startsWith("?")) {
        if (env[resArg] !== undefined) {
          return Number(env[resArg]) === diff ? { ...env } : null;
        }
        return { ...env, [resArg]: String(diff) };
      }
      return Number(resArg) === diff ? { ...env } : null;
    }

    case "swrlb:multiply": {
      if (args.length !== 3) return null;
      const resArg = String(args[0]);
      const a = resolveVal(args[1]!);
      const b = resolveVal(args[2]!);
      if (isNaN(a) || isNaN(b)) return null;
      const prod = a * b;
      if (resArg.startsWith("?")) {
        if (env[resArg] !== undefined) {
          return Number(env[resArg]) === prod ? { ...env } : null;
        }
        return { ...env, [resArg]: String(prod) };
      }
      return Number(resArg) === prod ? { ...env } : null;
    }

    case "swrlb:divide": {
      if (args.length !== 3) return null;
      const resArg = String(args[0]);
      const a = resolveVal(args[1]!);
      const b = resolveVal(args[2]!);
      if (isNaN(a) || isNaN(b) || b === 0) return null;
      const div = a / b;
      if (resArg.startsWith("?")) {
        if (env[resArg] !== undefined) {
          return Number(env[resArg]) === div ? { ...env } : null;
        }
        return { ...env, [resArg]: String(div) };
      }
      return Number(resArg) === div ? { ...env } : null;
    }

    case "swrlb:equal": {
      if (args.length !== 2) return null;
      const v1 = resolveStr(args[0]!);
      const v2 = resolveStr(args[1]!);
      return v1 === v2 ? { ...env } : null;
    }

    case "swrlb:notEqual": {
      if (args.length !== 2) return null;
      const v1 = resolveStr(args[0]!);
      const v2 = resolveStr(args[1]!);
      return v1 !== v2 ? { ...env } : null;
    }

    case "swrlb:lessThan": {
      if (args.length !== 2) return null;
      const a = resolveVal(args[0]!);
      const b = resolveVal(args[1]!);
      return !isNaN(a) && !isNaN(b) && a < b ? { ...env } : null;
    }

    case "swrlb:lessThanOrEqual": {
      if (args.length !== 2) return null;
      const a = resolveVal(args[0]!);
      const b = resolveVal(args[1]!);
      return !isNaN(a) && !isNaN(b) && a <= b ? { ...env } : null;
    }

    case "swrlb:greaterThan": {
      if (args.length !== 2) return null;
      const a = resolveVal(args[0]!);
      const b = resolveVal(args[1]!);
      return !isNaN(a) && !isNaN(b) && a > b ? { ...env } : null;
    }

    case "swrlb:greaterThanOrEqual": {
      if (args.length !== 2) return null;
      const a = resolveVal(args[0]!);
      const b = resolveVal(args[1]!);
      return !isNaN(a) && !isNaN(b) && a >= b ? { ...env } : null;
    }

    case "swrlb:stringConcat": {
      if (args.length < 2) return null;
      const resArg = String(args[0]);
      const parts = args.slice(1).map(resolveStr);
      const concatenated = parts.join("");
      if (resArg.startsWith("?")) {
        if (env[resArg] !== undefined) {
          return env[resArg] === concatenated ? { ...env } : null;
        }
        return { ...env, [resArg]: concatenated };
      }
      return resArg === concatenated ? { ...env } : null;
    }

    default:
      return { ...env };
  }
}

/** Materializes a SWRL rule head atom using the bound variables in `env`, returning true if a new fact was added. */
export function applySwrlHeadAtom(state: ReasonerState, headAtom: SWRLAtom, env: Record<string, string>): boolean {
  const resolveInd = (arg: string): string => {
    if (arg.startsWith("?")) return env[arg] ?? arg;
    return arg;
  };

  switch (headAtom.type) {
    case "ClassAtom": {
      const ind = resolveInd(headAtom.argument);
      const types = state.individualTypes.get(ind) ?? new Set();
      if (!types.has(headAtom.classIri)) {
        types.add(headAtom.classIri);
        state.individualTypes.set(ind, types);
        state.axioms.push({
          type: "ClassAssertion",
          individualIri: ind,
          classIri: headAtom.classIri,
          sourceLang: "swrl",
        });
        return true;
      }
      return false;
    }

    case "IndividualPropertyAtom": {
      const s = resolveInd(headAtom.argument1);
      const o = resolveInd(headAtom.argument2);
      const edges = state.objectPropertyAssertions.get(headAtom.propertyIri) ?? [];
      if (!edges.some((e) => e.subjectIri === s && e.objectIri === o)) {
        edges.push({ subjectIri: s, objectIri: o });
        state.objectPropertyAssertions.set(headAtom.propertyIri, edges);
        state.axioms.push({
          type: "ObjectPropertyAssertion",
          propertyIri: headAtom.propertyIri,
          subjectIri: s,
          objectIri: o,
          sourceLang: "swrl",
        });
        return true;
      }
      return false;
    }

    case "DataPropertyAtom": {
      const s = resolveInd(headAtom.argument1);
      const rawVal = headAtom.argument2.toString();
      const val = rawVal.startsWith("?") ? (env[rawVal] ?? rawVal) : rawVal;
      const asserts = state.dataPropertyAssertions.get(headAtom.propertyIri) ?? [];
      if (!asserts.some((a) => a.subjectIri === s && a.value === val)) {
        asserts.push({ subjectIri: s, value: val });
        state.dataPropertyAssertions.set(headAtom.propertyIri, asserts);
        state.axioms.push({
          type: "DataPropertyAssertion",
          propertyIri: headAtom.propertyIri,
          subjectIri: s,
          value: val,
          sourceLang: "swrl",
        });
        return true;
      }
      return false;
    }

    case "SameIndividualAtom": {
      const a1 = resolveInd(headAtom.argument1);
      const a2 = resolveInd(headAtom.argument2);
      const g = state.sameIndividualGroups.get(a1);
      if (!g || !g.has(a2)) {
        unifyIndividualsInState(state.sameIndividualGroups, state.individualTypes, a1, a2);
        return true;
      }
      return false;
    }

    default:
      return false;
  }
}

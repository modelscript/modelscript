// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * SHACL Core, Logical, SPARQL Constraint Validator and SHACL-AF Constructive Rule Executor.
 */

import type {
  BgpQuery,
  BgpQueryResult,
  OWL2Axiom,
  SHACLNodeShape,
  SHACLPropertyShape,
  SHACLTripleRule,
  SHACLViolation,
} from "./owl2-types.js";
import type { ReasonerState } from "./reasoner-state.js";

/** Returns all object or data property values asserted/inferred for `focusNode` along `path`. */
export function getPropertyValuesOnState(state: ReasonerState, focusNode: string, path: string): string[] {
  const res: string[] = [];
  if (path === "rdf:type") {
    const types = state.individualTypes.get(focusNode);
    if (types) res.push(...types);
    return res;
  }
  const objEdges = state.objectPropertyAssertions.get(path);
  if (objEdges) {
    for (const e of objEdges) {
      if (e.subjectIri === focusNode) res.push(e.objectIri);
    }
  }
  const dataAsserts = state.dataPropertyAssertions.get(path);
  if (dataAsserts) {
    for (const a of dataAsserts) {
      if (a.subjectIri === focusNode) res.push(a.value);
    }
  }
  return res;
}

/** Validates all focus nodes in `state` against the given SHACL node shapes and returns any violations. */
export function validateShaclOnState(
  state: ReasonerState,
  shapes: readonly SHACLNodeShape[],
  queryBgp: (query: BgpQuery) => BgpQueryResult,
): readonly SHACLViolation[] {
  const violations: SHACLViolation[] = [];

  const evaluatePropertyShape = (
    focusNode: string,
    ps: SHACLPropertyShape,
    values: readonly string[],
    numericVals: readonly number[],
    nodeViolations: SHACLViolation[],
    recordViolations: boolean,
  ): boolean => {
    let valid = true;
    const count = values.length;

    // minCount
    if (ps.minCount !== undefined && count < ps.minCount) {
      valid = false;
      if (recordViolations) {
        nodeViolations.push({
          focusNode,
          resultPath: ps.path,
          message: `Node ${focusNode} has ${count} value(s) for property ${ps.path}, but minCount is ${ps.minCount}.`,
          constraintComponent: "sh:MinCountConstraintComponent",
          severity: "Violation",
        });
      }
    }

    // maxCount
    if (ps.maxCount !== undefined && count > ps.maxCount) {
      valid = false;
      if (recordViolations) {
        nodeViolations.push({
          focusNode,
          resultPath: ps.path,
          message: `Node ${focusNode} has ${count} value(s) for property ${ps.path}, but maxCount is ${ps.maxCount}.`,
          constraintComponent: "sh:MaxCountConstraintComponent",
          severity: "Violation",
        });
      }
    }

    // hasValue
    if (ps.hasValue !== undefined) {
      const found = values.some((v) => String(v) === ps.hasValue);
      if (!found) {
        valid = false;
        if (recordViolations) {
          nodeViolations.push({
            focusNode,
            resultPath: ps.path,
            message: `Node ${focusNode} does not have required value ${ps.hasValue} for property ${ps.path}.`,
            constraintComponent: "sh:HasValueConstraintComponent",
            severity: "Violation",
          });
        }
      }
    }

    // in
    if (ps.in && ps.in.length > 0) {
      const inSet = new Set(ps.in);
      for (const v of values) {
        if (!inSet.has(String(v))) {
          valid = false;
          if (recordViolations) {
            nodeViolations.push({
              focusNode,
              resultPath: ps.path,
              message: `Value ${String(v)} on ${focusNode} is not in allowed set: [${ps.in.join(", ")}].`,
              constraintComponent: "sh:InConstraintComponent",
              severity: "Violation",
            });
          }
        }
      }
    }

    // pattern
    if (ps.pattern) {
      const regex = new RegExp(ps.pattern);
      for (const v of values) {
        if (!regex.test(String(v))) {
          valid = false;
          if (recordViolations) {
            nodeViolations.push({
              focusNode,
              resultPath: ps.path,
              message: `Value ${String(v)} on ${focusNode} does not match regex pattern "${ps.pattern}".`,
              constraintComponent: "sh:PatternConstraintComponent",
              severity: "Violation",
            });
          }
        }
      }
    }

    // class
    if (ps.class) {
      for (const v of values) {
        const strVal = String(v);
        const types = state.individualTypes.get(strVal);
        const isInstance = types?.has(ps.class) || false;
        if (!isInstance) {
          valid = false;
          if (recordViolations) {
            nodeViolations.push({
              focusNode,
              resultPath: ps.path,
              message: `Object ${strVal} on ${focusNode} is not an instance of class ${ps.class}.`,
              constraintComponent: "sh:ClassConstraintComponent",
              severity: "Violation",
            });
          }
        }
      }
    }

    // Numeric boundary constraints
    for (const num of numericVals) {
      if (ps.minInclusive !== undefined && num < ps.minInclusive) {
        valid = false;
        if (recordViolations) {
          nodeViolations.push({
            focusNode,
            resultPath: ps.path,
            message: `Value ${num} on ${focusNode} violates minInclusive ${ps.minInclusive}.`,
            constraintComponent: "sh:MinInclusiveConstraintComponent",
            severity: "Violation",
          });
        }
      }
      if (ps.maxInclusive !== undefined && num > ps.maxInclusive) {
        valid = false;
        if (recordViolations) {
          nodeViolations.push({
            focusNode,
            resultPath: ps.path,
            message: `Value ${num} on ${focusNode} violates maxInclusive ${ps.maxInclusive}.`,
            constraintComponent: "sh:MaxInclusiveConstraintComponent",
            severity: "Violation",
          });
        }
      }
      if (ps.minExclusive !== undefined && num <= ps.minExclusive) {
        valid = false;
        if (recordViolations) {
          nodeViolations.push({
            focusNode,
            resultPath: ps.path,
            message: `Value ${num} on ${focusNode} violates minExclusive ${ps.minExclusive}.`,
            constraintComponent: "sh:MinExclusiveConstraintComponent",
            severity: "Violation",
          });
        }
      }
      if (ps.maxExclusive !== undefined && num >= ps.maxExclusive) {
        valid = false;
        if (recordViolations) {
          nodeViolations.push({
            focusNode,
            resultPath: ps.path,
            message: `Value ${num} on ${focusNode} violates maxExclusive ${ps.maxExclusive}.`,
            constraintComponent: "sh:MaxExclusiveConstraintComponent",
            severity: "Violation",
          });
        }
      }
    }

    // Property comparisons (lessThan, lessThanOrEquals)
    if (ps.lessThan) {
      const otherVals = getPropertyValuesOnState(state, focusNode, ps.lessThan);
      const otherNums = otherVals.map(Number).filter((n) => !isNaN(n));
      for (const num of numericVals) {
        for (const otherNum of otherNums) {
          if (num >= otherNum) {
            valid = false;
            if (recordViolations) {
              nodeViolations.push({
                focusNode,
                resultPath: ps.path,
                message: `Value ${num} for ${ps.path} is not strictly less than value ${otherNum} for ${ps.lessThan}.`,
                constraintComponent: "sh:LessThanConstraintComponent",
                severity: "Violation",
              });
            }
          }
        }
      }
    }

    if (ps.lessThanOrEquals) {
      const otherVals = getPropertyValuesOnState(state, focusNode, ps.lessThanOrEquals);
      const otherNums = otherVals.map(Number).filter((n) => !isNaN(n));
      for (const num of numericVals) {
        for (const otherNum of otherNums) {
          if (num > otherNum) {
            valid = false;
            if (recordViolations) {
              nodeViolations.push({
                focusNode,
                resultPath: ps.path,
                message: `Value ${num} for ${ps.path} exceeds value ${otherNum} for ${ps.lessThanOrEquals}.`,
                constraintComponent: "sh:LessThanOrEqualsConstraintComponent",
                severity: "Violation",
              });
            }
          }
        }
      }
    }

    // Logical: or
    if (ps.or && ps.or.length > 0) {
      const anyPass = ps.or.some((subPs) => {
        const subVals = subPs.path ? getPropertyValuesOnState(state, focusNode, subPs.path) : values;
        const subNums = subVals.map(Number).filter((n) => !isNaN(n));
        return evaluatePropertyShape(focusNode, subPs, subVals, subNums, [], false);
      });
      if (!anyPass) {
        valid = false;
        if (recordViolations) {
          nodeViolations.push({
            focusNode,
            resultPath: ps.path,
            message: `Node ${focusNode} does not satisfy any disjunct in sh:or constraint on ${ps.path}.`,
            constraintComponent: "sh:OrConstraintComponent",
            severity: "Violation",
          });
        }
      }
    }

    // Logical: and
    if (ps.and && ps.and.length > 0) {
      for (const subPs of ps.and) {
        const subVals = subPs.path ? getPropertyValuesOnState(state, focusNode, subPs.path) : values;
        const subNums = subVals.map(Number).filter((n) => !isNaN(n));
        const pass = evaluatePropertyShape(focusNode, subPs, subVals, subNums, nodeViolations, recordViolations);
        if (!pass) valid = false;
      }
    }

    // Logical: not
    if (ps.not) {
      const subVals = ps.not.path ? getPropertyValuesOnState(state, focusNode, ps.not.path) : values;
      const subNums = subVals.map(Number).filter((n) => !isNaN(n));
      const passedSub = evaluatePropertyShape(focusNode, ps.not, subVals, subNums, [], false);
      if (passedSub) {
        valid = false;
        if (recordViolations) {
          nodeViolations.push({
            focusNode,
            resultPath: ps.path,
            message: `Node ${focusNode} satisfied forbidden constraint in sh:not on ${ps.path}.`,
            constraintComponent: "sh:NotConstraintComponent",
            severity: "Violation",
          });
        }
      }
    }

    // Logical: xone
    if (ps.xone && ps.xone.length > 0) {
      let passCount = 0;
      for (const subPs of ps.xone) {
        const subVals = subPs.path ? getPropertyValuesOnState(state, focusNode, subPs.path) : values;
        const subNums = subVals.map(Number).filter((n) => !isNaN(n));
        if (evaluatePropertyShape(focusNode, subPs, subVals, subNums, [], false)) {
          passCount++;
        }
      }
      if (passCount !== 1) {
        valid = false;
        if (recordViolations) {
          nodeViolations.push({
            focusNode,
            resultPath: ps.path,
            message: `Node ${focusNode} matched ${passCount} shapes in sh:xone on ${ps.path} (expected exactly 1).`,
            constraintComponent: "sh:XoneConstraintComponent",
            severity: "Violation",
          });
        }
      }
    }

    // Query / SPARQL constraint
    if (ps.sparql) {
      const query = ps.sparql.select ?? ps.sparql.ask;
      if (query) {
        const boundPatterns = query.patterns.map((p) => ({
          subject: p.subject === "?this" ? focusNode : p.subject,
          predicate: p.predicate,
          object: p.object === "?this" ? focusNode : p.object,
        }));
        const queryRes = queryBgp({ patterns: boundPatterns });
        const hasMatches = queryRes.bindings.length > 0;
        const expectEmpty = ps.sparql.expectEmpty ?? false;

        if (expectEmpty && hasMatches) {
          valid = false;
          if (recordViolations) {
            nodeViolations.push({
              focusNode,
              resultPath: ps.path,
              message: ps.sparql.message ?? `SPARQL graph query matched forbidden pattern on ${focusNode}.`,
              constraintComponent: "sh:SPARQLConstraintComponent",
              severity: "Violation",
            });
          }
        } else if (!expectEmpty && !hasMatches) {
          valid = false;
          if (recordViolations) {
            nodeViolations.push({
              focusNode,
              resultPath: ps.path,
              message: ps.sparql.message ?? `SPARQL graph query failed to match required pattern on ${focusNode}.`,
              constraintComponent: "sh:SPARQLConstraintComponent",
              severity: "Violation",
            });
          }
        }
      }
    }

    return valid;
  };

  for (const shape of shapes) {
    const targetClassNode = state.classes.get(shape.targetClass);
    const targetClasses = new Set<string>([shape.targetClass]);
    if (targetClassNode?.allSubClasses) {
      for (const sub of targetClassNode.allSubClasses) targetClasses.add(sub);
    }

    const focusNodes: string[] = [];
    for (const [indIri, types] of state.individualTypes) {
      let match = false;
      for (const tc of targetClasses) {
        if (types.has(tc)) {
          match = true;
          break;
        }
      }
      if (match) focusNodes.push(indIri);
    }

    for (const focusNode of focusNodes) {
      if (shape.closed) {
        const allowedPaths = new Set(shape.propertyShapes.map((ps) => ps.path));
        allowedPaths.add("rdf:type");
        for (const [propIri, edges] of state.objectPropertyAssertions) {
          if (edges.some((e) => e.subjectIri === focusNode) && !allowedPaths.has(propIri)) {
            violations.push({
              focusNode,
              resultPath: propIri,
              message: `Node ${focusNode} has unallowed property ${propIri} on closed shape.`,
              constraintComponent: "sh:ClosedConstraintComponent",
              severity: "Violation",
            });
          }
        }
        for (const [propIri, assertions] of state.dataPropertyAssertions) {
          if (assertions.some((a) => a.subjectIri === focusNode) && !allowedPaths.has(propIri)) {
            violations.push({
              focusNode,
              resultPath: propIri,
              message: `Node ${focusNode} has unallowed data property ${propIri} on closed shape.`,
              constraintComponent: "sh:ClosedConstraintComponent",
              severity: "Violation",
            });
          }
        }
      }

      for (const ps of shape.propertyShapes) {
        const values = getPropertyValuesOnState(state, focusNode, ps.path);
        const numericVals = values.map(Number).filter((n) => !isNaN(n));
        evaluatePropertyShape(focusNode, ps, values, numericVals, violations, true);
      }
    }
  }

  return violations;
}

/** Executes SHACL-AF triple and SPARQL construct rules up to `maxPasses` fixpoint iterations. */
export function executeShaclRulesOnState(
  state: ReasonerState,
  shapes: readonly SHACLNodeShape[],
  queryBgp: (query: BgpQuery) => BgpQueryResult,
  invalidateBgpIndex: () => void,
  maxPasses = 10,
): { materializedAxioms: OWL2Axiom[]; passes: number } {
  const materializedAxioms: OWL2Axiom[] = [];
  let passes = 0;
  let changed = true;

  while (changed && passes < maxPasses) {
    changed = false;
    passes++;

    for (const shape of shapes) {
      if (!shape.rules || shape.rules.length === 0) continue;

      const targetClasses = new Set<string>([shape.targetClass]);
      const node = state.classes.get(shape.targetClass);
      if (node?.allSubClasses) {
        for (const sub of node.allSubClasses) targetClasses.add(sub);
      }

      const focusNodes: string[] = [];
      for (const [indIri, types] of state.individualTypes) {
        if ([...targetClasses].some((tc) => types.has(tc))) {
          focusNodes.push(indIri);
        }
      }

      for (const focusNode of focusNodes) {
        for (const rule of shape.rules) {
          if ("type" in rule && rule.type === "SparqlRule") {
            const boundWhere = rule.wherePatterns.map((p) => ({
              subject: p.subject === "?this" ? focusNode : p.subject,
              predicate: p.predicate,
              object: p.object === "?this" ? focusNode : p.object,
            }));
            const qRes = queryBgp({ patterns: boundWhere });
            for (const b of qRes.bindings) {
              for (const cp of rule.constructPatterns) {
                const s = cp.subject === "?this" ? focusNode : (b[cp.subject] ?? cp.subject);
                const p = b[cp.predicate] ?? cp.predicate;
                const o = cp.object === "?this" ? focusNode : (b[cp.object] ?? cp.object);

                if (p === "rdf:type") {
                  const types = state.individualTypes.get(s) ?? new Set();
                  if (!types.has(o)) {
                    types.add(o);
                    state.individualTypes.set(s, types);
                    const ax: OWL2Axiom = {
                      type: "ClassAssertion",
                      individualIri: s,
                      classIri: o,
                      sourceLang: "inferred",
                    };
                    materializedAxioms.push(ax);
                    state.axioms.push(ax);
                    changed = true;
                  }
                } else {
                  const edges = state.objectPropertyAssertions.get(p) ?? [];
                  if (!edges.some((e) => e.subjectIri === s && e.objectIri === o)) {
                    edges.push({ subjectIri: s, objectIri: o });
                    state.objectPropertyAssertions.set(p, edges);
                    const ax: OWL2Axiom = {
                      type: "ObjectPropertyAssertion",
                      propertyIri: p,
                      subjectIri: s,
                      objectIri: o,
                      sourceLang: "inferred",
                    };
                    materializedAxioms.push(ax);
                    state.axioms.push(ax);
                    changed = true;
                  }
                }
              }
              if (changed) {
                invalidateBgpIndex();
              }
            }
          } else {
            const tr = rule as SHACLTripleRule;
            let matchesCondition = true;
            if (tr.condition) {
              const values = getPropertyValuesOnState(state, focusNode, tr.condition.path);
              const numVals = values.map(Number).filter((n) => !isNaN(n));
              if (tr.condition.minCount !== undefined && values.length < tr.condition.minCount)
                matchesCondition = false;
              if (tr.condition.maxCount !== undefined && values.length > tr.condition.maxCount)
                matchesCondition = false;
              if (
                tr.condition.class !== undefined &&
                !values.some((v) => state.individualTypes.get(v)?.has(tr.condition!.class!))
              )
                matchesCondition = false;
              if (tr.condition.minInclusive !== undefined && !numVals.some((n) => n >= tr.condition!.minInclusive!))
                matchesCondition = false;
              if (tr.condition.maxInclusive !== undefined && !numVals.some((n) => n <= tr.condition!.maxInclusive!))
                matchesCondition = false;
            }

            if (matchesCondition) {
              const s = !tr.subject || tr.subject === "?this" || tr.subject === "sh:this" ? focusNode : tr.subject;
              const p = tr.predicate;
              const o = tr.object;

              if (p === "rdf:type") {
                const types = state.individualTypes.get(s) ?? new Set();
                if (!types.has(o)) {
                  types.add(o);
                  state.individualTypes.set(s, types);
                  const ax: OWL2Axiom = {
                    type: "ClassAssertion",
                    individualIri: s,
                    classIri: o,
                    sourceLang: "inferred",
                  };
                  materializedAxioms.push(ax);
                  state.axioms.push(ax);
                  changed = true;
                  invalidateBgpIndex();
                }
              } else if (
                state.objectProperties.has(p) ||
                (isNaN(Number(o)) && (state.classes.has(o) || state.individualTypes.has(o)))
              ) {
                const edges = state.objectPropertyAssertions.get(p) ?? [];
                if (!edges.some((e) => e.subjectIri === s && e.objectIri === o)) {
                  edges.push({ subjectIri: s, objectIri: o });
                  state.objectPropertyAssertions.set(p, edges);
                  const ax: OWL2Axiom = {
                    type: "ObjectPropertyAssertion",
                    propertyIri: p,
                    subjectIri: s,
                    objectIri: o,
                    sourceLang: "inferred",
                  };
                  materializedAxioms.push(ax);
                  state.axioms.push(ax);
                  changed = true;
                  invalidateBgpIndex();
                }
              } else {
                const list = state.dataPropertyAssertions.get(p) ?? [];
                if (!list.some((a) => a.subjectIri === s && a.value === String(o))) {
                  list.push({ subjectIri: s, value: String(o) });
                  state.dataPropertyAssertions.set(p, list);
                  const ax: OWL2Axiom = {
                    type: "DataPropertyAssertion",
                    propertyIri: p,
                    subjectIri: s,
                    value: String(o),
                    sourceLang: "inferred",
                  };
                  materializedAxioms.push(ax);
                  state.axioms.push(ax);
                  changed = true;
                  invalidateBgpIndex();
                }
              }
            }
          }
        }
      }
    }
  }

  return { materializedAxioms, passes };
}

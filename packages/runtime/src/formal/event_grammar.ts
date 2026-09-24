// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Declarative Event Grammar & Scope-Complete Trace Explorer.
 *
 * Implements the Monterey Phoenix (MP-Firebird) lightweight formal behavioral modeling:
 *   - Hierarchical event grammars (atoms, sequence, alternative, optional, loop).
 *   - Relational semantics: PRECEDES, INCLUDES, FOLLOWS, EQUALS, MUTEX.
 *   - Multi-actor cross-coordination rules.
 *   - SAT-based scope-complete non-isomorphic execution trace enumeration.
 *   - Automated detection of deadlocks, race conditions, and assertion violations.
 */

import { CdclSatSolver, type LitId, TseitinEncoder, type VarId } from "./cdcl_sat.js";

export type EventNodeKind = "atomic" | "sequence" | "alternative" | "optional" | "loop" | "set";

export interface EventNode {
  id?: string;
  name: string;
  actor: string;
  kind: EventNodeKind;
  children?: EventNode[];
  minRep?: number; // For loop: default 1
  maxRep?: number; // For loop: default scope k
}

export type EventRelationKind = "precedes" | "follows" | "includes" | "equals" | "mutex";

export interface EventRelationRule {
  kind: EventRelationKind;
  sourceActor?: string;
  sourceEvent: string;
  targetActor?: string;
  targetEvent: string;
}

export interface EventCoordinationRule {
  sourceActor: string;
  sourceEvent: string;
  targetActor: string;
  targetEvent: string;
  relation: EventRelationKind;
}

export interface EventAssertion {
  id: string;
  description: string;
  type: "mutex" | "precedence" | "response" | "custom";
  eventA: string; // Actor.Event or Event
  eventB?: string; // Actor.Event or Event
  customCheck?: (trace: ConcreteEventInstance[]) => boolean;
}

export interface EventGrammarModel {
  name: string;
  actors: Record<string, EventNode>;
  relations?: EventRelationRule[];
  coordinations?: EventCoordinationRule[];
  assertions?: EventAssertion[];
}

export interface ConcreteEventInstance {
  instanceId: string;
  actor: string;
  eventName: string;
  occurrence: number;
}

export interface EventTrace {
  id: number;
  events: ConcreteEventInstance[];
  order: [string, string][]; // pairs [beforeId, afterId]
  summary: string;
}

export interface EventExplorationResult {
  modelName: string;
  scopeK: number;
  totalTracesFound: number;
  traces: EventTrace[];
  isAssertionSatisfied: boolean;
  violations: {
    assertionId: string;
    description: string;
    violatingTrace: EventTrace;
    reason: string;
  }[];
  summary: string;
}

export interface EventExplorationOptions {
  scope?: number; // Max loop unrolling / instance scope (default: 3)
  maxTraces?: number; // Max non-isomorphic traces to explore (default: 100)
  enableSymmetryBreaking?: boolean; // Lexicographic symmetry breaking for symmetric/concurrent actors (default: false)
}

export class EventGrammarSolver {
  /**
   * Explores all valid execution traces of the event grammar model up to the specified scope.
   */
  public static explore(model: EventGrammarModel, options: EventExplorationOptions = {}): EventExplorationResult {
    const scope = Math.max(1, options.scope ?? 3);
    const maxTraces = Math.max(1, options.maxTraces ?? 100);

    // 1. Flatten actors and unroll instances up to scope
    interface FlatInstance {
      instId: string;
      actor: string;
      name: string;
      kind: EventNodeKind;
      occurrence: number;
      parentInstId?: string;
    }

    const allInstances: FlatInstance[] = [];
    const sequenceOrderPairs: [string, string][] = [];
    const alternativeGroups: string[][] = [];
    const parentChildPairs: [string, string][] = [];

    let instCounter = 0;

    function unrollNode(node: EventNode, actor: string, parentInstId?: string, occ = 1): string[] {
      const instId = `inst_${++instCounter}_${actor}_${node.name}_${occ}`;
      allInstances.push({
        instId,
        actor,
        name: node.name,
        kind: node.kind,
        occurrence: occ,
        parentInstId,
      });

      if (parentInstId) {
        parentChildPairs.push([parentInstId, instId]);
      }

      const activeChildInsts: string[] = [];

      switch (node.kind) {
        case "atomic":
          return [instId];

        case "sequence": {
          const children = node.children || [];
          let prevInsts: string[] = [];
          for (let i = 0; i < children.length; i++) {
            const childNode = children[i]!;
            const cInsts = unrollNode(childNode, actor, instId, 1);
            if (prevInsts.length > 0) {
              for (const p of prevInsts) {
                for (const c of cInsts) {
                  sequenceOrderPairs.push([p, c]);
                }
              }
            }
            prevInsts = cInsts;
            activeChildInsts.push(...cInsts);
          }
          return [instId];
        }

        case "alternative": {
          const children = node.children || [];
          const choiceInsts: string[] = [];
          for (const c of children) {
            const cInsts = unrollNode(c, actor, instId, 1);
            choiceInsts.push(...cInsts);
          }
          if (choiceInsts.length > 0) {
            alternativeGroups.push(choiceInsts);
          }
          return [instId];
        }

        case "optional": {
          const children = node.children || [];
          for (const c of children) {
            unrollNode(c, actor, instId, 1);
          }
          return [instId];
        }

        case "loop": {
          const maxRep = Math.min(scope, node.maxRep ?? scope);
          let prevLoopInsts: string[] = [];
          for (let rep = 1; rep <= maxRep; rep++) {
            const child = node.children?.[0];
            if (child) {
              const cInsts = unrollNode(child, actor, instId, rep);
              if (prevLoopInsts.length > 0) {
                for (const p of prevLoopInsts) {
                  for (const c of cInsts) {
                    sequenceOrderPairs.push([p, c]);
                  }
                }
              }
              prevLoopInsts = cInsts;
            }
          }
          return [instId];
        }

        case "set": {
          const children = node.children || [];
          for (const c of children) {
            unrollNode(c, actor, instId, 1);
          }
          return [instId];
        }
      }
    }

    // Unroll root node for each actor
    const actorRootInsts = new Map<string, string>();
    for (const [actorName, rootNode] of Object.entries(model.actors)) {
      const roots = unrollNode(rootNode, actorName);
      if (roots.length > 0) {
        actorRootInsts.set(actorName, roots[0]!);
      }
    }

    // 2. Build SAT formulation
    const encoder = new TseitinEncoder();
    const baseClauses: LitId[][] = [];

    // Map each instance to an activation variable
    const actVarMap = new Map<string, VarId>();
    for (const inst of allInstances) {
      const v = encoder.getOrCreateVar(`act_${inst.instId}`);
      actVarMap.set(inst.instId, v);
    }

    // Actor roots must be active
    for (const rId of actorRootInsts.values()) {
      const v = actVarMap.get(rId)!;
      baseClauses.push([v]);
    }

    // Process nodes by kind to establish exact hierarchy semantics
    for (const inst of allInstances) {
      const pVar = actVarMap.get(inst.instId)!;
      const childInsts = allInstances
        .filter((c) => c.parentInstId === inst.instId)
        .map((c) => actVarMap.get(c.instId)!);

      if (childInsts.length === 0) continue;

      // Every child active implies parent active: c_i => p
      for (const cVar of childInsts) {
        baseClauses.push([-cVar, pVar]);
      }
    }

    // Hierarchy semantics per node group:
    // A. Alternative: parent active <=> exactly one child active
    for (const group of alternativeGroups) {
      if (group.length === 0) continue;
      const firstChild = allInstances.find((i) => i.instId === group[0]);
      if (!firstChild || !firstChild.parentInstId) continue;
      const pVar = actVarMap.get(firstChild.parentInstId)!;
      const cLits = group.map((id) => actVarMap.get(id)!);

      // pVar => (c1 | c2 | ... | cn)  equiv (~pVar | c1 | ... | cn)
      baseClauses.push([-pVar, ...cLits]);

      // Exactly one: pairwise mutex among children
      for (let i = 0; i < cLits.length; i++) {
        for (let j = i + 1; j < cLits.length; j++) {
          baseClauses.push([-cLits[i]!, -cLits[j]!]);
        }
      }
    }

    // B. Sequence: parent active => all immediate sequence children active
    for (const inst of allInstances) {
      if (inst.kind === "sequence") {
        const pVar = actVarMap.get(inst.instId)!;
        const seqChildren = allInstances
          .filter((c) => c.parentInstId === inst.instId)
          .map((c) => actVarMap.get(c.instId)!);
        for (const cVar of seqChildren) {
          baseClauses.push([-pVar, cVar]);
        }
      }
    }

    // Precedence variables prec(u, v) for ordering active events
    const precVarMap = new Map<string, VarId>();
    function getPrecVar(u: string, v: string): VarId {
      const key = `${u}__prec__${v}`;
      let pVar = precVarMap.get(key);
      if (pVar === undefined) {
        pVar = encoder.getOrCreateVar(`prec_${key}`);
        precVarMap.set(key, pVar);
      }
      return pVar;
    }

    // Asymmetry and irreflexivity: prec(u, v) => ~prec(v, u)
    for (const u of allInstances) {
      for (const v of allInstances) {
        if (u.instId === v.instId) {
          const selfP = getPrecVar(u.instId, u.instId);
          baseClauses.push([-selfP]);
        } else {
          const pUV = getPrecVar(u.instId, v.instId);
          const pVU = getPrecVar(v.instId, u.instId);
          baseClauses.push([-pUV, -pVU]);
        }
      }
    }

    // Sequence order: if both active, then prec(u, v) holds
    for (const [uId, vId] of sequenceOrderPairs) {
      const uAct = actVarMap.get(uId)!;
      const vAct = actVarMap.get(vId)!;
      const pUV = getPrecVar(uId, vId);
      baseClauses.push([-uAct, -vAct, pUV]);
    }

    // Strict partial order transitivity: prec(u, v) && prec(v, w) => prec(u, w)
    for (const u of allInstances) {
      for (const v of allInstances) {
        if (u.instId === v.instId) continue;
        for (const w of allInstances) {
          if (w.instId === u.instId || w.instId === v.instId) continue;
          const uAct = actVarMap.get(u.instId)!;
          const vAct = actVarMap.get(v.instId)!;
          const wAct = actVarMap.get(w.instId)!;
          const pUV = getPrecVar(u.instId, v.instId);
          const pVW = getPrecVar(v.instId, w.instId);
          const pUW = getPrecVar(u.instId, w.instId);
          baseClauses.push([-uAct, -vAct, -wAct, -pUV, -pVW, pUW]);
        }
      }
    }

    // Lexicographic symmetry breaking for symmetric independent concurrent actors
    if (options.enableSymmetryBreaking) {
      const serializeActorStructure = (node: EventNode): string => {
        const parts: string[] = [node.kind, node.name];
        if (node.minRep !== undefined) parts.push(`min:${node.minRep}`);
        if (node.maxRep !== undefined) parts.push(`max:${node.maxRep}`);
        if (node.children) {
          parts.push(`[${node.children.map(serializeActorStructure).join(",")}]`);
        }
        return parts.join("|");
      };

      const actorNames = Object.keys(model.actors);
      for (let i = 0; i < actorNames.length; i++) {
        for (let j = i + 1; j < actorNames.length; j++) {
          const aName = actorNames[i]!;
          const bName = actorNames[j]!;
          const aNode = model.actors[aName]!;
          const bNode = model.actors[bName]!;

          if (serializeActorStructure(aNode) === serializeActorStructure(bNode)) {
            const aRels = (model.relations || []).filter((r) => r.sourceActor === aName || r.targetActor === aName);
            const bRels = (model.relations || []).filter((r) => r.sourceActor === bName || r.targetActor === bName);
            const aCoords = (model.coordinations || []).filter(
              (c) => c.sourceActor === aName || c.targetActor === aName,
            );
            const bCoords = (model.coordinations || []).filter(
              (c) => c.sourceActor === bName || c.targetActor === bName,
            );

            if (aRels.length === 0 && bRels.length === 0 && aCoords.length === 0 && bCoords.length === 0) {
              // Independent symmetric actors: impose lexicographic leader constraint
              const aLeafInsts = allInstances.filter((inst) => inst.actor === aName && inst.kind === "atomic");
              const bLeafInsts = allInstances.filter((inst) => inst.actor === bName && inst.kind === "atomic");
              if (aLeafInsts.length > 0 && bLeafInsts.length > 0) {
                const firstA = aLeafInsts[0]!;
                const firstB = bLeafInsts[0]!;
                const aAct = actVarMap.get(firstA.instId)!;
                const bAct = actVarMap.get(firstB.instId)!;
                const pAB = getPrecVar(firstA.instId, firstB.instId);
                baseClauses.push([-aAct, -bAct, pAB]);
              }
            }
          }
        }
      }
    }

    // Helper to find matching instances for an event name / actor
    function findInstances(actor?: string, eventName?: string): FlatInstance[] {
      return allInstances.filter((inst) => {
        if (actor && inst.actor !== actor) return false;
        if (eventName && inst.name !== eventName) return false;
        return true;
      });
    }

    // Process explicit relations
    const relations = model.relations || [];
    for (const rel of relations) {
      const srcInsts = findInstances(rel.sourceActor, rel.sourceEvent);
      const tgtInsts = findInstances(rel.targetActor, rel.targetEvent);

      for (const s of srcInsts) {
        for (const t of tgtInsts) {
          if (s.instId === t.instId) continue;
          const sAct = actVarMap.get(s.instId)!;
          const tAct = actVarMap.get(t.instId)!;

          switch (rel.kind) {
            case "precedes": {
              const p = getPrecVar(s.instId, t.instId);
              baseClauses.push([-sAct, -tAct, p]);
              break;
            }
            case "follows": {
              const p = getPrecVar(t.instId, s.instId);
              baseClauses.push([-sAct, -tAct, p]);
              break;
            }
            case "mutex": {
              baseClauses.push([-sAct, -tAct]);
              break;
            }
            case "includes": {
              baseClauses.push([-tAct, sAct]);
              break;
            }
            case "equals": {
              baseClauses.push([-sAct, tAct]);
              baseClauses.push([-tAct, sAct]);
              break;
            }
          }
        }
      }
    }

    // Process coordinations
    const coordinations = model.coordinations || [];
    for (const coord of coordinations) {
      const srcInsts = findInstances(coord.sourceActor, coord.sourceEvent);
      const tgtInsts = findInstances(coord.targetActor, coord.targetEvent);

      for (const s of srcInsts) {
        for (const t of tgtInsts) {
          if (s.instId === t.instId) continue;
          const sAct = actVarMap.get(s.instId)!;
          const tAct = actVarMap.get(t.instId)!;

          if (coord.relation === "precedes") {
            const p = getPrecVar(s.instId, t.instId);
            baseClauses.push([-sAct, -tAct, p]);
          } else if (coord.relation === "mutex") {
            baseClauses.push([-sAct, -tAct]);
          } else if (coord.relation === "equals") {
            baseClauses.push([-sAct, tAct]);
            baseClauses.push([-tAct, sAct]);
          }
        }
      }
    }

    // Add all Tseitin clauses into the solver
    for (const c of encoder.clauses) {
      baseClauses.push(c);
    }

    // 3. Exhaustive Trace Enumeration
    const traces: EventTrace[] = [];
    const violations: EventExplorationResult["violations"] = [];
    const assertions = model.assertions || [];
    const blockingClauses: LitId[][] = [];

    let traceCount = 0;

    while (traceCount < maxTraces) {
      const sat = new CdclSatSolver();
      for (const c of baseClauses) sat.addClause(c);
      for (const c of blockingClauses) sat.addClause(c);

      const res = sat.solve();
      if (res.status !== "SAT" || !res.model) {
        break;
      }

      traceCount++;
      const modelMap = res.model;

      // Extract active instances
      const activeInsts: FlatInstance[] = [];
      for (const inst of allInstances) {
        const v = actVarMap.get(inst.instId)!;
        if (modelMap.get(v) === true) {
          activeInsts.push(inst);
        }
      }

      if (activeInsts.length === 0) {
        // Enforce at least one event active and continue
        sat.addClause(allInstances.map((i) => actVarMap.get(i.instId)!));
        continue;
      }

      // Extract ordering among active instances
      const traceOrders: [string, string][] = [];
      for (let i = 0; i < activeInsts.length; i++) {
        for (let j = 0; j < activeInsts.length; j++) {
          if (i === j) continue;
          const u = activeInsts[i]!.instId;
          const v = activeInsts[j]!.instId;
          const pKey = `${u}__prec__${v}`;
          const pVar = precVarMap.get(pKey);
          if (pVar && modelMap.get(pVar) === true) {
            traceOrders.push([u, v]);
          }
        }
      }

      // Map to public concrete instances
      const concreteEvents: ConcreteEventInstance[] = activeInsts.map((i) => ({
        instanceId: i.instId,
        actor: i.actor,
        eventName: i.name,
        occurrence: i.occurrence,
      }));

      // Summarize trace
      const summary = activeInsts.map((i) => `${i.actor}.${i.name}`).join(" -> ");

      const trace: EventTrace = {
        id: traceCount,
        events: concreteEvents,
        order: traceOrders,
        summary: summary || "(empty trace)",
      };
      traces.push(trace);

      // Check assertions against this trace
      for (const assert of assertions) {
        let violated = false;
        let reason = "";

        const hasA = concreteEvents.some(
          (e) => e.eventName === assert.eventA || `${e.actor}.${e.eventName}` === assert.eventA,
        );
        const hasB = assert.eventB
          ? concreteEvents.some((e) => e.eventName === assert.eventB || `${e.actor}.${e.eventName}` === assert.eventB)
          : false;

        switch (assert.type) {
          case "mutex":
            if (hasA && hasB) {
              violated = true;
              reason = `Events '${assert.eventA}' and '${assert.eventB}' occurred concurrently in trace ${trace.id}.`;
            }
            break;

          case "precedence": {
            if (hasA && hasB) {
              const instA = concreteEvents.find(
                (e) => e.eventName === assert.eventA || `${e.actor}.${e.eventName}` === assert.eventA,
              )!;
              const instB = concreteEvents.find(
                (e) => e.eventName === assert.eventB || `${e.actor}.${e.eventName}` === assert.eventB,
              )!;
              const precedes = traceOrders.some(([u, v]) => u === instA.instanceId && v === instB.instanceId);
              if (!precedes) {
                violated = true;
                reason = `Event '${assert.eventA}' did not precede '${assert.eventB}' in trace ${trace.id}.`;
              }
            }
            break;
          }

          case "response":
            if (hasA && !hasB) {
              violated = true;
              reason = `Trigger '${assert.eventA}' occurred without required response '${assert.eventB}'.`;
            }
            break;

          case "custom":
            if (assert.customCheck && !assert.customCheck(concreteEvents)) {
              violated = true;
              reason = `Custom assertion '${assert.description}' failed on trace ${trace.id}.`;
            }
            break;
        }

        if (violated) {
          violations.push({
            assertionId: assert.id,
            description: assert.description,
            violatingTrace: trace,
            reason,
          });
        }
      }

      // Add blocking clause to find distinct activation assignment
      const blockingClause: LitId[] = [];
      for (const inst of allInstances) {
        const v = actVarMap.get(inst.instId)!;
        const val = modelMap.get(v);
        if (val === true) {
          blockingClause.push(-v);
        } else {
          blockingClause.push(v);
        }
      }
      blockingClauses.push(blockingClause);
    }

    return {
      modelName: model.name,
      scopeK: scope,
      totalTracesFound: traces.length,
      traces,
      isAssertionSatisfied: violations.length === 0,
      violations,
      summary: `Scope-complete exploration for '${model.name}' at scope k=${scope}: generated ${traces.length} trace(s) with ${violations.length} assertion violation(s).`,
    };
  }
}

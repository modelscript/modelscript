// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sysml2 — Scope-Complete Event Trace Explorer (Monterey Phoenix Bridge).
 *
 * Translates SysML v2 behavioral activities, interactions, and concurrent message flows
 * into declarative event grammars, synthesizing scope-complete execution traces using
 * @modelscript/runtime's EventGrammarSolver to uncover race conditions and deadlocks.
 */

import {
  type CanonicalTraceRecord,
  type EventAssertion,
  type EventCoordinationRule,
  type EventGrammarModel,
  EventGrammarSolver,
  type EventNode,
  TraceRecordNormalizer,
} from "@modelscript/runtime";
import { type ActivityGraph, extractActivityGraphsFromText } from "./activity-cfa.js";

export interface SysML2EventExplorationOptions {
  scope?: number; // Scope k for loop unrolling / instances (default: 2)
  maxTraces?: number; // Maximum number of non-isomorphic traces to explore
  targetActivities?: string[]; // Specific action defs to explore
}

export interface SysML2EventTraceViolation {
  assertionId: string;
  description: string;
  reason: string;
  violatingSequence: string[];
  traceRecord: CanonicalTraceRecord;
}

export interface SysML2EventExplorationResult {
  isCertified: boolean;
  modelName: string;
  totalTracesExplored: number;
  traces: {
    id: number;
    summary: string;
    events: string[];
  }[];
  violations: SysML2EventTraceViolation[];
  summary: string;
}

/**
 * Extracts declarative event assertions from SysML v2 comments and assert statements.
 */
function extractEventAssertions(sysmlSource: string): EventAssertion[] {
  const assertions: EventAssertion[] = [];

  // 1. assert not (A and B) or assert mutex(A, B)
  const mutexRegex =
    /\bassert\s+(?:not\s*\(\s*([A-Za-z0-9_.]+)\s+and\s+([A-Za-z0-9_.]+)\s*\)|mutex\s*\(\s*([A-Za-z0-9_.]+)\s*,\s*([A-Za-z0-9_.]+)\s*\))/gi;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = mutexRegex.exec(sysmlSource)) !== null) {
    const a = m[1] || m[3];
    const b = m[2] || m[4];
    if (a && b) {
      assertions.push({
        id: `ASSERT_MUTEX_${++idx}`,
        description: `Mutual exclusion: '${a}' and '${b}' cannot co-occur in the same trace`,
        type: "mutex",
        eventA: a.trim(),
        eventB: b.trim(),
      });
    }
  }

  // 2. assert precedes(A, B)
  const precRegex = /\bassert\s+precedes\s*\(\s*([A-Za-z0-9_.]+)\s*,\s*([A-Za-z0-9_.]+)\s*\)/gi;
  while ((m = precRegex.exec(sysmlSource)) !== null) {
    assertions.push({
      id: `ASSERT_PREC_${++idx}`,
      description: `Precedence requirement: '${m[1]}' must precede '${m[2]}'`,
      type: "precedence",
      eventA: m[1]!.trim(),
      eventB: m[2]!.trim(),
    });
  }

  // 3. assert response(A, B) - whenever A occurs, B must eventually occur
  const respRegex = /\bassert\s+response\s*\(\s*([A-Za-z0-9_.]+)\s*,\s*([A-Za-z0-9_.]+)\s*\)/gi;
  while ((m = respRegex.exec(sysmlSource)) !== null) {
    assertions.push({
      id: `ASSERT_RESP_${++idx}`,
      description: `Response requirement: occurrence of '${m[1]}' requires '${m[2]}'`,
      type: "response",
      eventA: m[1]!.trim(),
      eventB: m[2]!.trim(),
    });
  }

  return assertions;
}

export class SysML2EventTraceExplorer {
  /**
   * Compiles an ActivityGraph into an EventNode hierarchy.
   */
  public static activityToEventNode(activity: ActivityGraph): EventNode {
    const children: EventNode[] = [];

    // Filter out initial/final pseudostates
    const actionNodes = activity.nodes.filter((n) => n.kind === "action" || n.kind === "decide" || n.kind === "merge");

    // If there are decision/alternative paths:
    const decideNodes = activity.nodes.filter((n) => n.kind === "decide");
    if (decideNodes.length > 0) {
      // Build sequence of actions before decision
      for (const node of actionNodes) {
        if (node.kind === "decide") {
          // Find outgoing flows from decision node
          const outgoing = activity.flows.filter((f) => f.source === node.name);
          const altChildren: EventNode[] = outgoing.map((f) => ({
            name: f.target,
            actor: activity.name,
            kind: "atomic",
          }));

          children.push({
            name: `${node.name}_Choice`,
            actor: activity.name,
            kind: "alternative",
            children: altChildren,
          });
        } else if (node.kind === "action") {
          // Check if it's already an alternative target
          const isAltTarget = decideNodes.some((d) =>
            activity.flows.some((f) => f.source === d.name && f.target === node.name),
          );
          if (!isAltTarget) {
            children.push({
              name: node.name,
              actor: activity.name,
              kind: "atomic",
            });
          }
        }
      }
    } else {
      // Linear sequence of actions
      for (const node of actionNodes) {
        children.push({
          name: node.name,
          actor: activity.name,
          kind: "atomic",
        });
      }
    }

    return {
      name: `${activity.name}_Root`,
      actor: activity.name,
      kind: children.length >= 1 ? "sequence" : "atomic",
      children: children.length >= 1 ? children : undefined,
    };
  }

  /**
   * Explores all execution traces of a SysML v2 document up to a bounded scope.
   */
  public static exploreText(
    sysmlSource: string,
    options: SysML2EventExplorationOptions = {},
  ): SysML2EventExplorationResult {
    const activityMap = extractActivityGraphsFromText(sysmlSource);
    const actors: Record<string, EventNode> = {};
    const coordinations: EventCoordinationRule[] = [];

    for (const [name, act] of activityMap.entries()) {
      if (options.targetActivities && !options.targetActivities.includes(name)) {
        continue;
      }
      actors[name] = this.activityToEventNode(act);
    }

    // Extract item flows / message passing between activities as coordinations
    // e.g. flow from ActA.outPin to ActB.inPin
    const flowRegex = /\bflow\s+from\s+([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\s+to\s+([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/g;
    let fm: RegExpExecArray | null;
    while ((fm = flowRegex.exec(sysmlSource)) !== null) {
      coordinations.push({
        sourceActor: fm[1]!,
        sourceEvent: fm[2]!,
        targetActor: fm[3]!,
        targetEvent: fm[4]!,
        relation: "precedes",
      });
    }

    const assertions = extractEventAssertions(sysmlSource);

    const model: EventGrammarModel = {
      name: "SysML2BehavioralModel",
      actors,
      coordinations,
      assertions,
    };

    const explorationRes = EventGrammarSolver.explore(model, {
      scope: options.scope ?? 2,
      maxTraces: options.maxTraces ?? 100,
    });

    const violations: SysML2EventTraceViolation[] = [];
    for (const v of explorationRes.violations) {
      const stepStates: Record<string, boolean | string>[] = v.violatingTrace.events.map((e, idx) => ({
        step: String(idx),
        event: `${e.actor}.${e.eventName}`,
        actor: e.actor,
        active: true,
      }));

      const traceRecord = TraceRecordNormalizer.fromBmcCounterexample(stepStates, v.description);

      violations.push({
        assertionId: v.assertionId,
        description: v.description,
        reason: v.reason,
        violatingSequence: v.violatingTrace.events.map((e) => `${e.actor}.${e.eventName}`),
        traceRecord,
      });
    }

    const publicTraces = explorationRes.traces.map((t) => ({
      id: t.id,
      summary: t.summary,
      events: t.events.map((e) => `${e.actor}.${e.eventName}`),
    }));

    return {
      isCertified: violations.length === 0,
      modelName: model.name,
      totalTracesExplored: publicTraces.length,
      traces: publicTraces,
      violations,
      summary: explorationRes.summary,
    };
  }
}

export { SysML2EventTraceExplorer as EventTraceExplorer };

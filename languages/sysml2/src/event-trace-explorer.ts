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
import { collectCstLeaves, isSysmlIdentLeaf, parseSysmlSource, readDottedChainFromLeaves } from "./cst-utils.js";

export interface SysML2EventExplorationOptions {
  scope?: number | undefined; // Scope k for loop unrolling / instances (default: 2)
  maxTraces?: number | undefined; // Maximum number of non-isomorphic traces to explore
  targetActivities?: string[] | undefined; // Specific action defs to explore
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
  const leaves = collectCstLeaves(parseSysmlSource(sysmlSource));
  let idx = 0;

  for (let i = 0; i < leaves.length; i++) {
    if (leaves[i]!.text.toLowerCase() !== "assert") continue;
    const kw = leaves[i + 1]?.text.toLowerCase();

    if (kw === "not" && leaves[i + 2]?.text === "(") {
      const a = readDottedChainFromLeaves(leaves, i + 3);
      if (a && leaves[a.nextIdx]?.text.toLowerCase() === "and") {
        const b = readDottedChainFromLeaves(leaves, a.nextIdx + 1);
        if (b && leaves[b.nextIdx]?.text === ")") {
          assertions.push({
            id: `ASSERT_MUTEX_${++idx}`,
            description: `Mutual exclusion: '${a.text}' and '${b.text}' cannot co-occur in the same trace`,
            type: "mutex",
            eventA: a.text,
            eventB: b.text,
          });
        }
      }
      continue;
    }

    if ((kw === "mutex" || kw === "precedes" || kw === "response") && leaves[i + 2]?.text === "(") {
      const a = readDottedChainFromLeaves(leaves, i + 3);
      if (!a || leaves[a.nextIdx]?.text !== ",") continue;
      const b = readDottedChainFromLeaves(leaves, a.nextIdx + 1);
      if (!b || leaves[b.nextIdx]?.text !== ")") continue;

      if (kw === "mutex") {
        assertions.push({
          id: `ASSERT_MUTEX_${++idx}`,
          description: `Mutual exclusion: '${a.text}' and '${b.text}' cannot co-occur in the same trace`,
          type: "mutex",
          eventA: a.text,
          eventB: b.text,
        });
      } else if (kw === "precedes") {
        assertions.push({
          id: `ASSERT_PREC_${++idx}`,
          description: `Precedence requirement: '${a.text}' must precede '${b.text}'`,
          type: "precedence",
          eventA: a.text,
          eventB: b.text,
        });
      } else {
        assertions.push({
          id: `ASSERT_RESP_${++idx}`,
          description: `Response requirement: occurrence of '${a.text}' requires '${b.text}'`,
          type: "response",
          eventA: a.text,
          eventB: b.text,
        });
      }
    }
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
    const leaves = collectCstLeaves(parseSysmlSource(sysmlSource));
    for (let i = 0; i + 8 < leaves.length; i++) {
      if (
        leaves[i]!.text === "flow" &&
        leaves[i + 1]!.text === "from" &&
        isSysmlIdentLeaf(leaves[i + 2]!.text) &&
        leaves[i + 3]!.text === "." &&
        isSysmlIdentLeaf(leaves[i + 4]!.text) &&
        leaves[i + 5]!.text === "to" &&
        isSysmlIdentLeaf(leaves[i + 6]!.text) &&
        leaves[i + 7]!.text === "." &&
        isSysmlIdentLeaf(leaves[i + 8]!.text)
      ) {
        coordinations.push({
          sourceActor: leaves[i + 2]!.text,
          sourceEvent: leaves[i + 4]!.text,
          targetActor: leaves[i + 6]!.text,
          targetEvent: leaves[i + 8]!.text,
          relation: "precedes",
        });
      }
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

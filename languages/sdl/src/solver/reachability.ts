// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Reachability and Deadlock Analyzer for ITU-T Z.100 SDL-88 Processes.
 */

import type { SdlAction, SdlProcessDecl, SdlSystemModel, SdlTransition } from "../types.js";

export interface SdlProcessReachability {
  blockName: string;
  processName: string;
  initialStates: string[];
  declaredStates: string[];
  reachableStates: string[];
  unreachableStates: string[];
  deadlockStates: string[];
  stoppingStates: string[];
  hasCycles: boolean;
  transitions: Array<{ from: string; signal: string; to: string }>;
}

export interface SdlReachabilityReport {
  systemName: string;
  processes: SdlProcessReachability[];
  isDeadlockFree: boolean;
  allStatesReachable: boolean;
}

function extractTargets(
  transition: SdlTransition,
  currentState: string | null,
  out: Set<string>,
  hasStop: { value: boolean },
): void {
  const walk = (actions: SdlAction[]): void => {
    for (const act of actions) {
      if (act.kind === "decision") {
        for (const br of act.branches) {
          walk(br.actions);
          if (br.terminator) {
            if (br.terminator.kind === "stop") hasStop.value = true;
            else if (br.terminator.targetState === "-") {
              if (currentState) out.add(currentState);
            } else {
              out.add(br.terminator.targetState);
            }
          }
        }
      }
    }
  };
  walk(transition.actions);
  if (transition.terminator) {
    if (transition.terminator.kind === "stop") hasStop.value = true;
    else if (transition.terminator.targetState === "-") {
      if (currentState) out.add(currentState);
    } else {
      out.add(transition.terminator.targetState);
    }
  }
}

function analyzeProcess(blockName: string, proc: SdlProcessDecl): SdlProcessReachability {
  const canonicalByUpper = new Map<string, string>();
  const declaredStates: string[] = [];
  for (const st of proc.states) {
    for (const n of st.names) {
      if (n === "*") continue;
      const up = n.toUpperCase();
      if (!canonicalByUpper.has(up)) {
        canonicalByUpper.set(up, n);
        declaredStates.push(n);
      }
    }
  }

  const adj = new Map<string, Set<string>>();
  for (const s of declaredStates) adj.set(s.toUpperCase(), new Set<string>());

  const initialSet = new Set<string>();
  if (proc.start) {
    const raw = new Set<string>();
    extractTargets(proc.start, null, raw, { value: false });
    for (const r of raw) {
      const canon = canonicalByUpper.get(r.toUpperCase());
      if (canon) initialSet.add(canon);
    }
  }

  const stoppingStates = new Set<string>();
  const transitions: Array<{ from: string; signal: string; to: string }> = [];

  for (const st of proc.states) {
    const fromStates = st.names.includes("*")
      ? declaredStates
      : st.names.map((n) => canonicalByUpper.get(n.toUpperCase()) ?? n);

    for (const inp of st.inputs) {
      for (const fromName of fromStates) {
        const targets = new Set<string>();
        const stopFlag = { value: false };
        extractTargets(inp.transition, fromName, targets, stopFlag);
        if (stopFlag.value) {
          stoppingStates.add(fromName);
          transitions.push({ from: fromName, signal: inp.signal, to: "STOP" });
        }
        const edgeSet = adj.get(fromName.toUpperCase()) ?? new Set<string>();
        for (const t of targets) {
          const canon = canonicalByUpper.get(t.toUpperCase()) ?? t;
          edgeSet.add(canon.toUpperCase());
          transitions.push({ from: fromName, signal: inp.signal, to: canon });
        }
        adj.set(fromName.toUpperCase(), edgeSet);
      }
    }
  }

  // BFS from initial states
  const visited = new Set<string>();
  const queue: string[] = [];
  for (const init of initialSet) {
    const up = init.toUpperCase();
    if (!visited.has(up)) {
      visited.add(up);
      queue.push(up);
    }
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const nxt of adj.get(cur) ?? []) {
      if (canonicalByUpper.has(nxt) && !visited.has(nxt)) {
        visited.add(nxt);
        queue.push(nxt);
      }
    }
  }

  const reachableStates = declaredStates.filter((s) => visited.has(s.toUpperCase()));
  const unreachableStates = declaredStates.filter((s) => !visited.has(s.toUpperCase()));
  const deadlockStates = declaredStates.filter((s) => {
    const outEdges = adj.get(s.toUpperCase());
    return (!outEdges || outEdges.size === 0) && !stoppingStates.has(s);
  });

  // Cycle detection via 3-color DFS on reachable subgraph
  const color = new Map<string, number>(); // 0=unvisited, 1=visiting, 2=done
  let hasCycles = false;
  const dfs = (u: string): void => {
    color.set(u, 1);
    for (const v of adj.get(u) ?? []) {
      const c = color.get(v) ?? 0;
      if (c === 1) {
        hasCycles = true;
      } else if (c === 0 && canonicalByUpper.has(v)) {
        dfs(v);
      }
    }
    color.set(u, 2);
  };
  for (const r of reachableStates) {
    const up = r.toUpperCase();
    if ((color.get(up) ?? 0) === 0) dfs(up);
  }

  return {
    blockName,
    processName: proc.name,
    initialStates: Array.from(initialSet),
    declaredStates,
    reachableStates,
    unreachableStates,
    deadlockStates,
    stoppingStates: Array.from(stoppingStates),
    hasCycles,
    transitions,
  };
}

/**
 * Analyzes per-process reachability, deadlock/sink states, and cycles across an SDL-88 system.
 */
export function analyzeSdlReachability(model: SdlSystemModel): SdlReachabilityReport {
  const processes: SdlProcessReachability[] = [];
  for (const block of model.blocks) {
    for (const proc of block.processes) {
      processes.push(analyzeProcess(block.name, proc));
    }
  }
  return {
    systemName: model.name,
    processes,
    isDeadlockFree: processes.every((p) => p.deadlockStates.length === 0),
    allStatesReachable: processes.every((p) => p.unreachableStates.length === 0),
  };
}

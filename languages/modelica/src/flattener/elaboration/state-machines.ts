// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  type ArenaStateMachine,
  type ArenaStateMachineState,
  DAEBuilder,
  EqKind,
  ExprKind,
} from "@modelscript/runtime";

export function extractStateMachines(dae: DAEBuilder, options?: { omcCompatibility?: boolean }): void {
  // 1. Scan for initialState and transition calls
  interface InitialStateInfo {
    eqIdx: number;
    stateName: string;
  }
  interface TransitionInfo {
    eqIdx: number;
    from: string;
    to: string;
  }

  const initialStates: InitialStateInfo[] = [];
  const transitions: TransitionInfo[] = [];

  const getCallArgName = (callId: number, argIndex: number): string | null => {
    const argId = argIndex === 0 ? dae.getExprLeft(callId) : dae.getExprLeft(callId + argIndex);
    if (argId < 0) return null;
    const k = dae.getExprKind(argId);
    if (k === ExprKind.Name) {
      return dae.interner.resolve(dae.getExprData1(argId));
    }
    return null;
  };

  for (let eqIdx = 0; eqIdx < dae.eqCount; eqIdx++) {
    const ek = dae.getEqKind(eqIdx);
    if (ek === EqKind.FunctionCall || ek === EqKind.InitialFunctionCall) {
      const callId = dae.getEqLhs(eqIdx);
      if (callId >= 0 && dae.getExprKind(callId) === ExprKind.Call) {
        const fname = dae.interner.resolve(dae.getExprData1(callId));
        const argCount = dae.getExprRight(callId);
        if (fname === "initialState" && argCount >= 1) {
          const sName = getCallArgName(callId, 0);
          if (sName) initialStates.push({ eqIdx, stateName: sName });
        } else if (fname === "transition" && argCount >= 2) {
          const from = getCallArgName(callId, 0);
          const to = getCallArgName(callId, 1);
          if (from && to) transitions.push({ eqIdx, from, to });
        }
      }
    }
  }

  // If transitions exist but no initialState, in OMC compatibility mode, discard orphan transitions and state variables (TransitionTest.mo)
  if (transitions.length > 0 && initialStates.length === 0) {
    if (options?.omcCompatibility) {
      const orphanStates = new Set<string>();
      const ignored = new Set<number>();
      for (const t of transitions) {
        orphanStates.add(t.from);
        orphanStates.add(t.to);
        ignored.add(t.eqIdx);
      }
      (dae as any).ignoredEqIndices = ignored;
      for (let v = 0; v < dae.varCount; v++) {
        const vName = dae.getVarName(v);
        for (const st of orphanStates) {
          if (vName.startsWith(st + ".")) {
            dae.removeVariable(v);
            break;
          }
        }
      }
    }
    return;
  }

  if (initialStates.length === 0) return;

  // Build transition adjacency and reachability
  const adj = new Map<string, Set<string>>();
  const addEdge = (u: string, v: string) => {
    if (!adj.has(u)) adj.set(u, new Set());
    if (!adj.has(v)) adj.set(v, new Set());
    adj.get(u)!.add(v);
    adj.get(v)!.add(u);
  };
  for (const t of transitions) {
    addEdge(t.from, t.to);
  }

  // Group state machines
  // Each initialState defines one state machine
  const smList: ArenaStateMachine[] = [];
  const stateToSm = new Map<string, ArenaStateMachine>();
  const allKnownStates = new Set<string>();

  for (const init of initialStates) {
    // Find connected component from init.stateName
    const visited = new Set<string>();
    const queue = [init.stateName];
    visited.add(init.stateName);
    while (queue.length > 0) {
      const curr = queue.shift()!;
      const neighbors = adj.get(curr);
      if (neighbors) {
        for (const nbr of neighbors) {
          if (!visited.has(nbr)) {
            visited.add(nbr);
            queue.push(nbr);
          }
        }
      }
    }

    // Order states: initial state first, then others in order of discovery
    const orderedStates: string[] = [init.stateName];
    for (const st of visited) {
      if (st !== init.stateName) orderedStates.push(st);
    }

    // Collect transitions belonging to this state machine
    const smTransitions: number[] = [];
    for (const t of transitions) {
      if (visited.has(t.from) && visited.has(t.to)) {
        smTransitions.push(t.eqIdx);
      }
    }

    const smStates: ArenaStateMachineState[] = orderedStates.map((sName) => ({
      name: sName,
      equations: [],
      variables: [],
      stateMachines: [],
      varIndices: [],
      eqIndices: [],
      multiplexerEqIndices: [],
    }));

    const sm: ArenaStateMachine = {
      name: init.stateName,
      states: smStates,
      transitions: [],
      initialState: init.stateName,
      initialStateEqIdx: init.eqIdx,
      transitionEqIndices: smTransitions,
    };

    smList.push(sm);
    for (const st of smStates) {
      stateToSm.set(st.name, sm);
      allKnownStates.add(st.name);
    }
  }

  // Sort known states by length descending so prefix matching prefers the most specific state
  const sortedStateNames = Array.from(allKnownStates).sort((a, b) => b.length - a.length);

  const findOwnerState = (vName: string): ArenaStateMachineState | null => {
    for (const sName of sortedStateNames) {
      if (vName.startsWith(sName + ".")) {
        const sm = stateToSm.get(sName);
        if (sm) {
          const st = sm.states.find((s) => s.name === sName);
          if (st) return st;
        }
      }
    }
    return null;
  };

  // Partition variables into states
  for (let v = 0; v < dae.varCount; v++) {
    if (dae.isVarRemoved(v)) continue;
    const vName = dae.getVarName(v);
    const owner = findOwnerState(vName);
    if (owner) {
      owner.varIndices!.push(v);
    }
  }

  // Partition equations into states
  const getExprVarName = (exprId: number): string | null => {
    if (exprId < 0) return null;
    const k = dae.getExprKind(exprId);
    if (k === ExprKind.Name) return dae.interner.resolve(dae.getExprData1(exprId));
    if (k === ExprKind.Binary || k === ExprKind.Unary) {
      return getExprVarName(dae.getExprLeft(exprId));
    }
    return null;
  };

  const smEqSet = new Set<number>();
  for (const sm of smList) {
    if (sm.initialStateEqIdx !== undefined) smEqSet.add(sm.initialStateEqIdx);
    if (sm.transitionEqIndices) {
      for (const idx of sm.transitionEqIndices) smEqSet.add(idx);
    }
  }

  for (let eqIdx = 0; eqIdx < dae.eqCount; eqIdx++) {
    if (smEqSet.has(eqIdx)) continue;
    const ek = dae.getEqKind(eqIdx);
    if (ek === EqKind.Simple || ek === EqKind.InitialSimple || ek === EqKind.Array) {
      const lhs = dae.getEqLhs(eqIdx);
      const lhsName = getExprVarName(lhs);
      if (lhsName) {
        const owner = findOwnerState(lhsName);
        if (owner) {
          owner.eqIndices!.push(eqIdx);
        }
      }
    }
  }

  // Synthesize multiplexer equations for each state machine
  for (const sm of smList) {
    const dotIdx = sm.name.lastIndexOf(".");
    const enclosingStateName = dotIdx >= 0 ? sm.name.slice(0, dotIdx) : null;
    const parentState = enclosingStateName
      ? smList.flatMap((s) => s.states).find((s) => s.name === enclosingStateName)
      : null;

    const localOutputs = new Set<string>();
    for (const st of sm.states) {
      for (const vIdx of st.varIndices!) {
        if (dae.getVarCausality(vIdx) === 2 || Boolean((dae as any).stateOutputVars?.has(dae.getVarName(vIdx)))) {
          const fullName = dae.getVarName(vIdx);
          const shortName = fullName.slice(st.name.length + 1);
          localOutputs.add(shortName);
        }
      }
    }

    for (const shortName of localOutputs) {
      const targetVarName = enclosingStateName ? `${enclosingStateName}.${shortName}` : shortName;
      const targetVarIdx = dae.getVarIdxByName(targetVarName);
      if (targetVarIdx < 0) continue;

      const branches: { stateName: string; stateVarName: string }[] = [];
      for (const st of sm.states) {
        const stVarName = `${st.name}.${shortName}`;
        if (dae.getVarIdxByName(stVarName) >= 0) {
          branches.push({ stateName: st.name, stateVarName: stVarName });
        }
      }
      if (branches.length === 0) continue;

      let prevVarName = targetVarName;
      if ((dae as any).stateOutputVars?.has(targetVarName)) {
        const outerDot = targetVarName.lastIndexOf(".");
        prevVarName = outerDot >= 0 ? targetVarName.slice(outerDot + 1) : targetVarName;
      }

      const prevCall = dae.addCallExpr("previous", [
        dae.addExpression(ExprKind.Name, dae.interner.intern(prevVarName)),
      ]);

      let currElse = prevCall;
      for (let b = branches.length - 1; b >= 0; b--) {
        const br = branches[b]!;
        const cond = dae.addCallExpr("activeState", [
          dae.addExpression(ExprKind.Name, dae.interner.intern(br.stateName)),
        ]);
        const thenExpr = dae.addExpression(ExprKind.Name, dae.interner.intern(br.stateVarName));
        currElse = dae.addIfElse(cond, thenExpr, currElse);
      }

      const lhsExpr = dae.addExpression(ExprKind.Name, dae.interner.intern(targetVarName));
      const muxEqIdx = dae.addEquation(EqKind.Simple, lhsExpr, currElse);

      if (parentState) {
        parentState.multiplexerEqIndices!.push(muxEqIdx);
      }
    }
  }

  // Build hierarchy: attach child state machines to parent states
  const topLevelSms: ArenaStateMachine[] = [];
  for (const sm of smList) {
    const dotIdx = sm.name.lastIndexOf(".");
    if (dotIdx >= 0) {
      const parentStateName = sm.name.slice(0, dotIdx);
      const parentState = smList.flatMap((s) => s.states).find((st) => st.name === parentStateName);
      if (parentState) {
        parentState.stateMachines.push(sm);
        continue;
      }
    }
    topLevelSms.push(sm);
  }

  dae.stateMachines = topLevelSms;
}

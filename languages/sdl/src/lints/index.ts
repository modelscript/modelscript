// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Static Analysis and Linter Engine for ITU-T Z.100 SDL-88.
 *
 * Implements diagnostic rules SDL1001–SDL5006 covering syntax errors,
 * duplicate declarations, undefined signals/timers/states, unreachable states,
 * deadlock/sink states, unmatched NEXTSTATE, missing START, and disconnected
 * channels/signalroutes.
 */

import { SdlErrorCode, type SdlDiagnostic } from "../errors.js";
import type { SdlAction, SdlProcessDecl, SdlSpan, SdlSystemModel, SdlTransition } from "../types.js";

export { SdlErrorCode, type SdlDiagnostic };

function makeDiag(
  entry: { code: number; id: string; rule: string; severity: "error" | "warning" | "info" },
  message: string,
  span?: SdlSpan,
  symbolName?: string,
): SdlDiagnostic {
  return {
    code: entry.code,
    id: entry.id,
    rule: entry.rule,
    severity: entry.severity,
    message,
    startOffset: span?.startOffset,
    endOffset: span?.endOffset,
    line: span?.line,
    column: span?.column,
    symbolName,
  };
}

function collectTransitionTargets(
  transition: SdlTransition,
  currentState: string | null,
  targets: Set<string>,
  hasStop: { value: boolean },
): void {
  const walkActions = (actions: SdlAction[]): void => {
    for (const act of actions) {
      if (act.kind === "decision") {
        for (const br of act.branches) {
          walkActions(br.actions);
          if (br.terminator) {
            if (br.terminator.kind === "stop") {
              hasStop.value = true;
            } else if (br.terminator.targetState === "-") {
              if (currentState) targets.add(currentState.toUpperCase());
            } else {
              targets.add(br.terminator.targetState.toUpperCase());
            }
          }
        }
      }
    }
  };
  walkActions(transition.actions);
  if (transition.terminator) {
    if (transition.terminator.kind === "stop") {
      hasStop.value = true;
    } else if (transition.terminator.targetState === "-") {
      if (currentState) targets.add(currentState.toUpperCase());
    } else {
      targets.add(transition.terminator.targetState.toUpperCase());
    }
  }
}

function checkTransitionTerminated(
  transition: SdlTransition,
  context: string,
  processName: string,
  diags: SdlDiagnostic[],
): boolean {
  if (transition.terminator) return true;
  // Check if the last action is a DECISION whose every branch terminates
  const lastAction = transition.actions[transition.actions.length - 1];
  if (lastAction && lastAction.kind === "decision" && lastAction.branches.length > 0) {
    let allTerminated = true;
    for (const br of lastAction.branches) {
      const subTransition: SdlTransition = {
        actions: br.actions,
        ...(br.terminator !== undefined ? { terminator: br.terminator } : {}),
        ...br.span,
      };
      if (
        !checkTransitionTerminated(subTransition, `${context} DECISION branch '${br.condition}'`, processName, diags)
      ) {
        allTerminated = false;
      }
    }
    return allTerminated;
  }
  diags.push(
    makeDiag(
      SdlErrorCode.UNMATCHED_NEXTSTATE,
      SdlErrorCode.UNMATCHED_NEXTSTATE.message(context, processName),
      transition,
      processName,
    ),
  );
  return false;
}

function checkTransitionRefs(
  transition: SdlTransition,
  proc: SdlProcessDecl,
  declaredSignals: Set<string>,
  declaredTimers: Set<string>,
  declaredStates: Set<string>,
  setTimers: Set<string>,
  diags: SdlDiagnostic[],
): void {
  const walkActions = (actions: SdlAction[]): void => {
    for (const act of actions) {
      if (act.kind === "output") {
        if (!declaredSignals.has(act.signal.toUpperCase())) {
          diags.push(
            makeDiag(
              SdlErrorCode.UNDEFINED_SIGNAL,
              SdlErrorCode.UNDEFINED_SIGNAL.message(act.signal, `OUTPUT in process '${proc.name}'`),
              act.span,
              act.signal,
            ),
          );
        }
      } else if (act.kind === "set") {
        setTimers.add(act.timer.toUpperCase());
        if (!declaredTimers.has(act.timer.toUpperCase())) {
          diags.push(
            makeDiag(
              SdlErrorCode.UNDEFINED_TIMER,
              SdlErrorCode.UNDEFINED_TIMER.message(act.timer, proc.name),
              act.span,
              act.timer,
            ),
          );
        }
      } else if (act.kind === "reset") {
        if (!declaredTimers.has(act.timer.toUpperCase())) {
          diags.push(
            makeDiag(
              SdlErrorCode.UNDEFINED_TIMER,
              SdlErrorCode.UNDEFINED_TIMER.message(act.timer, proc.name),
              act.span,
              act.timer,
            ),
          );
        }
      } else if (act.kind === "decision") {
        for (const br of act.branches) {
          walkActions(br.actions);
          if (br.terminator && br.terminator.kind === "nextstate" && br.terminator.targetState !== "-") {
            if (!declaredStates.has(br.terminator.targetState.toUpperCase())) {
              diags.push(
                makeDiag(
                  SdlErrorCode.UNDEFINED_STATE,
                  SdlErrorCode.UNDEFINED_STATE.message(br.terminator.targetState, proc.name),
                  br.terminator.span,
                  br.terminator.targetState,
                ),
              );
            }
          }
        }
      }
    }
  };

  walkActions(transition.actions);
  if (
    transition.terminator &&
    transition.terminator.kind === "nextstate" &&
    transition.terminator.targetState !== "-"
  ) {
    if (!declaredStates.has(transition.terminator.targetState.toUpperCase())) {
      diags.push(
        makeDiag(
          SdlErrorCode.UNDEFINED_STATE,
          SdlErrorCode.UNDEFINED_STATE.message(transition.terminator.targetState, proc.name),
          transition.terminator.span,
          transition.terminator.targetState,
        ),
      );
    }
  }
}

/**
 * Runs all static SDL-88 verification rules (`SDL1001`–`SDL5006`) on a parsed `SdlSystemModel`.
 */
export function lintSdl(model: SdlSystemModel): SdlDiagnostic[] {
  const diags: SdlDiagnostic[] = [];

  // SDL1001: Syntax errors
  for (const err of model.syntaxErrors) {
    diags.push(makeDiag(SdlErrorCode.SYNTAX_ERROR, SdlErrorCode.SYNTAX_ERROR.message(err.message), err));
  }

  // SDL2001: Duplicate SYSTEM
  for (const extra of model.extraSystems) {
    diags.push(
      makeDiag(
        SdlErrorCode.DUPLICATE_SYSTEM,
        SdlErrorCode.DUPLICATE_SYSTEM.message(extra.name),
        extra.span,
        extra.name,
      ),
    );
  }

  // Collect global signals
  const globalSignals = new Set<string>();
  for (const sig of model.signals) {
    globalSignals.add(sig.name.toUpperCase());
  }

  // SDL2002: Duplicate BLOCK
  const seenBlocks = new Set<string>();
  for (const block of model.blocks) {
    const key = block.name.toUpperCase();
    if (seenBlocks.has(key)) {
      diags.push(
        makeDiag(SdlErrorCode.DUPLICATE_BLOCK, SdlErrorCode.DUPLICATE_BLOCK.message(block.name), block, block.name),
      );
    } else {
      seenBlocks.add(key);
    }
  }

  // Connected channels & signalroutes tracking
  const connectedChannels = new Set<string>();
  for (const block of model.blocks) {
    for (const conn of block.connects) {
      connectedChannels.add(conn.channel.toUpperCase());
    }
  }

  // Validate channels (SDL3001, SDL5003)
  for (const ch of model.channels) {
    if (ch.paths.length === 0) {
      diags.push(
        makeDiag(
          SdlErrorCode.DISCONNECTED_CHANNEL,
          SdlErrorCode.DISCONNECTED_CHANNEL.message(ch.name, "no FROM/TO paths defined"),
          ch,
          ch.name,
        ),
      );
    }
    let touchesBlock = false;
    for (const p of ch.paths) {
      for (const endpoint of [p.from, p.to]) {
        const up = endpoint.toUpperCase();
        if (up !== "ENV") {
          if (!seenBlocks.has(up)) {
            diags.push(
              makeDiag(
                SdlErrorCode.DISCONNECTED_CHANNEL,
                SdlErrorCode.DISCONNECTED_CHANNEL.message(
                  ch.name,
                  `endpoint '${endpoint}' is not a declared BLOCK or ENV`,
                ),
                ch,
                ch.name,
              ),
            );
          } else {
            touchesBlock = true;
          }
        }
      }
      for (const sig of p.signals) {
        if (!globalSignals.has(sig.toUpperCase())) {
          diags.push(
            makeDiag(
              SdlErrorCode.UNDEFINED_SIGNAL,
              SdlErrorCode.UNDEFINED_SIGNAL.message(sig, `CHANNEL '${ch.name}'`),
              ch,
              sig,
            ),
          );
        }
      }
    }
    if (touchesBlock && !connectedChannels.has(ch.name.toUpperCase())) {
      diags.push(
        makeDiag(
          SdlErrorCode.DISCONNECTED_CHANNEL,
          SdlErrorCode.DISCONNECTED_CHANNEL.message(ch.name, "not bound to any SIGNALROUTE via CONNECT"),
          ch,
          ch.name,
        ),
      );
    }
  }

  const consumedSignals = new Set<string>();

  // Per-block checks
  for (const block of model.blocks) {
    const blockSignals = new Set<string>(globalSignals);
    for (const sig of block.signals) {
      blockSignals.add(sig.name.toUpperCase());
    }

    // SDL2003: Duplicate PROCESS
    const seenProcesses = new Set<string>();
    for (const proc of block.processes) {
      const pKey = proc.name.toUpperCase();
      if (seenProcesses.has(pKey)) {
        diags.push(
          makeDiag(
            SdlErrorCode.DUPLICATE_PROCESS,
            SdlErrorCode.DUPLICATE_PROCESS.message(proc.name, block.name),
            proc,
            proc.name,
          ),
        );
      } else {
        seenProcesses.add(pKey);
      }
    }

    // Validate signalroutes (SDL3001, SDL5004)
    const connectedRoutes = new Set<string>();
    for (const conn of block.connects) {
      for (const r of conn.signalRoutes) connectedRoutes.add(r.toUpperCase());
    }

    for (const sr of block.signalRoutes) {
      if (sr.paths.length === 0) {
        diags.push(
          makeDiag(
            SdlErrorCode.DISCONNECTED_SIGNALROUTE,
            SdlErrorCode.DISCONNECTED_SIGNALROUTE.message(sr.name, block.name, "no FROM/TO paths defined"),
            sr,
            sr.name,
          ),
        );
      }
      let touchesEnv = false;
      for (const p of sr.paths) {
        for (const ep of [p.from, p.to]) {
          const up = ep.toUpperCase();
          if (up === "ENV") {
            touchesEnv = true;
          } else if (!seenProcesses.has(up)) {
            diags.push(
              makeDiag(
                SdlErrorCode.DISCONNECTED_SIGNALROUTE,
                SdlErrorCode.DISCONNECTED_SIGNALROUTE.message(
                  sr.name,
                  block.name,
                  `endpoint '${ep}' is not a declared PROCESS or ENV`,
                ),
                sr,
                sr.name,
              ),
            );
          }
        }
        for (const sig of p.signals) {
          if (!blockSignals.has(sig.toUpperCase())) {
            diags.push(
              makeDiag(
                SdlErrorCode.UNDEFINED_SIGNAL,
                SdlErrorCode.UNDEFINED_SIGNAL.message(sig, `SIGNALROUTE '${sr.name}'`),
                sr,
                sig,
              ),
            );
          }
        }
      }
      if (touchesEnv && !connectedRoutes.has(sr.name.toUpperCase())) {
        diags.push(
          makeDiag(
            SdlErrorCode.DISCONNECTED_SIGNALROUTE,
            SdlErrorCode.DISCONNECTED_SIGNALROUTE.message(
              sr.name,
              block.name,
              "route to ENV is not bound to a CHANNEL via CONNECT",
            ),
            sr,
            sr.name,
          ),
        );
      }
    }

    // Per-process checks
    for (const proc of block.processes) {
      const declaredTimers = new Set<string>();
      for (const t of proc.timers) declaredTimers.add(t.name.toUpperCase());

      // SDL2004: Duplicate STATE
      const declaredStates = new Set<string>();
      const stateSpans = new Map<string, { origName: string; span: SdlSpan }>();
      for (const st of proc.states) {
        for (const stName of st.names) {
          if (stName === "*") continue;
          const sKey = stName.toUpperCase();
          if (declaredStates.has(sKey)) {
            diags.push(
              makeDiag(
                SdlErrorCode.DUPLICATE_STATE,
                SdlErrorCode.DUPLICATE_STATE.message(stName, proc.name),
                st,
                stName,
              ),
            );
          } else {
            declaredStates.add(sKey);
            stateSpans.set(sKey, { origName: stName, span: st });
          }
        }
      }

      const setTimers = new Set<string>();
      const awaitedTimers = new Map<string, SdlSpan>();

      // SDL5002: Missing START
      const startTargets = new Set<string>();
      if (!proc.start) {
        diags.push(
          makeDiag(SdlErrorCode.MISSING_START, SdlErrorCode.MISSING_START.message(proc.name), proc, proc.name),
        );
      } else {
        checkTransitionTerminated(proc.start, "START", proc.name, diags);
        checkTransitionRefs(proc.start, proc, blockSignals, declaredTimers, declaredStates, setTimers, diags);
        collectTransitionTargets(proc.start, null, startTargets, { value: false });
      }

      // Build state adjacency for reachability & deadlock checks
      const adj = new Map<string, Set<string>>();
      const stateHasStop = new Set<string>();
      for (const sKey of declaredStates) adj.set(sKey, new Set<string>());

      for (const st of proc.states) {
        const appliesTo = st.names.includes("*") ? Array.from(declaredStates) : st.names.map((n) => n.toUpperCase());

        for (const inp of st.inputs) {
          const sigUp = inp.signal.toUpperCase();
          if (declaredTimers.has(sigUp)) {
            awaitedTimers.set(sigUp, inp);
          } else if (blockSignals.has(sigUp)) {
            consumedSignals.add(sigUp);
          } else {
            diags.push(
              makeDiag(
                SdlErrorCode.UNDEFINED_SIGNAL,
                SdlErrorCode.UNDEFINED_SIGNAL.message(inp.signal, `INPUT in process '${proc.name}'`),
                inp,
                inp.signal,
              ),
            );
          }

          checkTransitionTerminated(
            inp.transition,
            `STATE '${st.names.join(", ")}' INPUT '${inp.signal}'`,
            proc.name,
            diags,
          );
          checkTransitionRefs(inp.transition, proc, blockSignals, declaredTimers, declaredStates, setTimers, diags);

          for (const sKey of appliesTo) {
            const targets = adj.get(sKey) ?? new Set<string>();
            const stopFlag = { value: false };
            collectTransitionTargets(inp.transition, sKey, targets, stopFlag);
            adj.set(sKey, targets);
            if (stopFlag.value) stateHasStop.add(sKey);
          }
        }
      }

      // SDL5006: Timer awaited in INPUT but never SET
      for (const [timerUp, span] of awaitedTimers) {
        if (!setTimers.has(timerUp)) {
          const origTimer = proc.timers.find((t) => t.name.toUpperCase() === timerUp)?.name ?? timerUp;
          diags.push(
            makeDiag(
              SdlErrorCode.TIMER_NEVER_SET,
              SdlErrorCode.TIMER_NEVER_SET.message(origTimer, proc.name),
              span,
              origTimer,
            ),
          );
        }
      }

      // SDL4001: Unreachable states (BFS from START targets)
      if (proc.start) {
        const visited = new Set<string>();
        const queue: string[] = [];
        for (const t of startTargets) {
          if (declaredStates.has(t) && !visited.has(t)) {
            visited.add(t);
            queue.push(t);
          }
        }
        while (queue.length > 0) {
          const cur = queue.shift()!;
          for (const nxt of adj.get(cur) ?? []) {
            if (declaredStates.has(nxt) && !visited.has(nxt)) {
              visited.add(nxt);
              queue.push(nxt);
            }
          }
        }
        for (const [sKey, info] of stateSpans) {
          if (!visited.has(sKey)) {
            diags.push(
              makeDiag(
                SdlErrorCode.UNREACHABLE_STATE,
                SdlErrorCode.UNREACHABLE_STATE.message(info.origName, proc.name),
                info.span,
                info.origName,
              ),
            );
          }
        }
      }

      // SDL4002: Sink / deadlock states (no outgoing transitions and no STOP)
      for (const [sKey, info] of stateSpans) {
        const targets = adj.get(sKey);
        if ((!targets || targets.size === 0) && !stateHasStop.has(sKey)) {
          diags.push(
            makeDiag(
              SdlErrorCode.DEADLOCK_STATE,
              SdlErrorCode.DEADLOCK_STATE.message(info.origName, proc.name),
              info.span,
              info.origName,
            ),
          );
        }
      }
    }
  }

  // SDL5005: Unconsumed declared signals
  for (const sig of model.signals) {
    if (!consumedSignals.has(sig.name.toUpperCase())) {
      diags.push(
        makeDiag(SdlErrorCode.UNCONSUMED_SIGNAL, SdlErrorCode.UNCONSUMED_SIGNAL.message(sig.name), sig, sig.name),
      );
    }
  }

  return diags;
}

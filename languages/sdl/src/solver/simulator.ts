// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Communicating Extended Finite State Machine (EFSM) Discrete-Event Simulator
 * for ITU-T Z.100 SDL-88.
 *
 * Implements asynchronous per-process FIFO input queues, channel/signalroute
 * signal routing with propagation delays, timer SET/RESET/expiry scheduling,
 * TASK expression evaluation, DECISION branching, and optional packet-loss
 * injection for telecom protocol verification (e.g. Alternating-Bit Protocol).
 */

import type {
  SdlAction,
  SdlBlockDecl,
  SdlProcessDecl,
  SdlStateDecl,
  SdlSystemModel,
  SdlTerminator,
  SdlTransition,
} from "../types.js";

export type SdlValue = number | boolean | string;

export interface SdlInjectedSignal {
  time: number;
  targetProcess: string;
  signal: string;
  args?: SdlValue[];
}

export interface SdlSimulationOptions {
  maxTime?: number;
  maxSteps?: number;
  initialSignals?: SdlInjectedSignal[];
  /** Override per-channel propagation delay in seconds. */
  channelDelays?: Record<string, number>;
  /** Default propagation delay (s) for non-NODELAY channels if not specified. */
  defaultChannelDelay?: number;
  /** Optional packet drop predicate for unreliable channel simulation. */
  dropPredicate?: (info: {
    signal: string;
    transmissionIndex: number;
    fromProcess: string;
    toProcess: string;
    time: number;
    args: SdlValue[];
  }) => boolean;
}

export interface SdlTraceEvent {
  time: number;
  process: string;
  kind:
    | "start"
    | "input"
    | "output"
    | "task"
    | "decision"
    | "set"
    | "reset"
    | "timer_expiry"
    | "nextstate"
    | "stop"
    | "drop";
  detail: string;
  signal?: string;
  args?: SdlValue[];
  state?: string;
}

export interface SdlEnvOutput {
  time: number;
  fromProcess: string;
  signal: string;
  args: SdlValue[];
}

export interface SdlTimerExpiryRecord {
  time: number;
  process: string;
  timer: string;
  armedAt: number;
  requestedDuration: number;
}

export interface SdlProcessSnapshot {
  blockName: string;
  processName: string;
  state: string;
  stopped: boolean;
  variables: Record<string, SdlValue>;
  activeTimers: string[];
  queueLength: number;
}

export interface SdlSimulationResult {
  systemName: string;
  finalTime: number;
  stepsExecuted: number;
  trace: SdlTraceEvent[];
  envOutputs: SdlEnvOutput[];
  timerExpiries: SdlTimerExpiryRecord[];
  processStates: Record<string, SdlProcessSnapshot>;
  deliveredCount: number;
  droppedCount: number;
}

interface QueuedSignal {
  signal: string;
  args: SdlValue[];
  isTimer: boolean;
  timerId?: number;
}

interface ScheduledEvent {
  time: number;
  seq: number;
  kind: "signal" | "timer";
  targetProcess: string;
  signal: string;
  args: SdlValue[];
  timerId?: number;
  armedAt?: number;
  requestedDuration?: number;
}

interface ProcessRuntime {
  block: SdlBlockDecl;
  decl: SdlProcessDecl;
  state: string;
  stopped: boolean;
  vars: Map<string, SdlValue>;
  varNames: Map<string, string>; // upper -> original
  queue: QueuedSignal[];
  activeTimers: Map<string, { timerId: number; expiryTime: number; armedAt: number; duration: number }>;
  timersDeclared: Set<string>;
}

/**
 * Evaluates a simple SDL-88 expression against a process variable environment and current time `now`.
 */
export function evaluateSdlExpr(expr: string, vars: Map<string, SdlValue>, now: number): SdlValue {
  const trimmed = expr.trim();
  if (trimmed.length === 0) return 0;

  // Strip enclosing balanced parentheses
  if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    let depth = 0;
    let wrapsAll = true;
    for (let i = 0; i < trimmed.length - 1; i++) {
      if (trimmed[i] === "(") depth++;
      else if (trimmed[i] === ")") depth--;
      if (depth === 0) {
        wrapsAll = false;
        break;
      }
    }
    if (wrapsAll) return evaluateSdlExpr(trimmed.slice(1, -1), vars, now);
  }

  // String literal
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1);
  }

  // Boolean literals / NOW
  const upper = trimmed.toUpperCase();
  if (upper === "TRUE") return true;
  if (upper === "FALSE") return false;
  if (upper === "NOW") return now;

  // Numeric literal
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  // Logical OR / AND (lowest precedence, outside parens)
  const splitTopLevel = (s: string, ops: string[]): { left: string; op: string; right: string } | null => {
    let depth = 0;
    let inStr: string | null = null;
    for (let i = s.length - 1; i >= 0; i--) {
      const ch = s[i]!;
      if (inStr) {
        if (ch === inStr) inStr = null;
        continue;
      }
      if (ch === "'" || ch === '"') {
        inStr = ch;
        continue;
      }
      if (ch === ")") depth++;
      else if (ch === "(") depth--;
      if (depth !== 0) continue;

      for (const op of ops) {
        if (op.length > 1 && /^[A-Z]+$/.test(op)) {
          // Word operator: must be surrounded by whitespace/boundaries
          const start = i - op.length + 1;
          if (start > 0 && s.slice(start, i + 1).toUpperCase() === op) {
            const before = s[start - 1] ?? " ";
            const after = s[i + 1] ?? " ";
            if (/\s/.test(before) && /\s/.test(after)) {
              return { left: s.slice(0, start).trim(), op, right: s.slice(i + 1).trim() };
            }
          }
        } else {
          const start = i - op.length + 1;
          if (start > 0 && s.slice(start, i + 1) === op) {
            // Avoid splitting :=, /=, <=, >= on =
            if (
              op === "=" &&
              (s[start - 1] === ":" || s[start - 1] === "/" || s[start - 1] === "<" || s[start - 1] === ">")
            ) {
              continue;
            }
            // Avoid splitting unary +/- after operator
            if ((op === "+" || op === "-") && s.slice(0, start).trim().length === 0) {
              continue;
            }
            return { left: s.slice(0, start).trim(), op, right: s.slice(i + 1).trim() };
          }
        }
      }
    }
    return null;
  };

  const orSplit = splitTopLevel(trimmed, ["OR"]);
  if (orSplit) {
    return Boolean(evaluateSdlExpr(orSplit.left, vars, now)) || Boolean(evaluateSdlExpr(orSplit.right, vars, now));
  }

  const andSplit = splitTopLevel(trimmed, ["AND"]);
  if (andSplit) {
    return Boolean(evaluateSdlExpr(andSplit.left, vars, now)) && Boolean(evaluateSdlExpr(andSplit.right, vars, now));
  }

  const cmpSplit = splitTopLevel(trimmed, ["/=", "<=", ">=", "=", "<", ">"]);
  if (cmpSplit) {
    const l = evaluateSdlExpr(cmpSplit.left, vars, now);
    const r = evaluateSdlExpr(cmpSplit.right, vars, now);
    switch (cmpSplit.op) {
      case "=":
        return l === r;
      case "/=":
        return l !== r;
      case "<":
        return Number(l) < Number(r);
      case "<=":
        return Number(l) <= Number(r);
      case ">":
        return Number(l) > Number(r);
      case ">=":
        return Number(l) >= Number(r);
    }
  }

  const addSplit = splitTopLevel(trimmed, ["+", "-"]);
  if (addSplit) {
    const l = Number(evaluateSdlExpr(addSplit.left, vars, now));
    const r = Number(evaluateSdlExpr(addSplit.right, vars, now));
    return addSplit.op === "+" ? l + r : l - r;
  }

  const mulSplit = splitTopLevel(trimmed, ["*", "/", "MOD"]);
  if (mulSplit) {
    const l = Number(evaluateSdlExpr(mulSplit.left, vars, now));
    const r = Number(evaluateSdlExpr(mulSplit.right, vars, now));
    if (mulSplit.op === "*") return l * r;
    if (mulSplit.op === "/") return r === 0 ? 0 : l / r;
    if (mulSplit.op === "MOD") return r === 0 ? 0 : ((l % r) + r) % r;
  }

  // Unary NOT
  if (upper.startsWith("NOT ")) {
    return !evaluateSdlExpr(trimmed.slice(4), vars, now);
  }

  // Variable lookup
  const val = vars.get(upper);
  if (val !== undefined) return val;

  return trimmed;
}

function defaultForSort(sort: string): SdlValue {
  switch (sort.toUpperCase()) {
    case "BOOLEAN":
      return false;
    case "CHARSTRING":
      return "";
    case "INTEGER":
    case "REAL":
    case "DURATION":
    case "TIME":
    case "PID":
    default:
      return 0;
  }
}

function matchDecisionCondition(
  questionVal: SdlValue,
  cond: string,
  vars: Map<string, SdlValue>,
  now: number,
): boolean {
  const c = cond.trim();
  const cmpMatch = c.match(/^(\/=|<=|>=|=|<|>)\s*(.+)$/);
  if (cmpMatch) {
    const op = cmpMatch[1]!;
    const rhs = evaluateSdlExpr(cmpMatch[2]!, vars, now);
    switch (op) {
      case "=":
        return questionVal === rhs;
      case "/=":
        return questionVal !== rhs;
      case "<":
        return Number(questionVal) < Number(rhs);
      case "<=":
        return Number(questionVal) <= Number(rhs);
      case ">":
        return Number(questionVal) > Number(rhs);
      case ">=":
        return Number(questionVal) >= Number(rhs);
    }
  }
  const targetVal = evaluateSdlExpr(c, vars, now);
  return questionVal === targetVal;
}

/**
 * Simulates an SDL-88 system using asynchronous communicating EFSM semantics.
 */
export function simulateSdl(model: SdlSystemModel, options: SdlSimulationOptions = {}): SdlSimulationResult {
  const maxTime = options.maxTime ?? 100.0;
  const maxSteps = options.maxSteps ?? 10000;
  const defaultChannelDelay = options.defaultChannelDelay ?? 0.01;

  const trace: SdlTraceEvent[] = [];
  const envOutputs: SdlEnvOutput[] = [];
  const timerExpiries: SdlTimerExpiryRecord[] = [];
  const runtimes = new Map<string, ProcessRuntime>(); // upper(procName) -> runtime

  for (const block of model.blocks) {
    for (const proc of block.processes) {
      const vars = new Map<string, SdlValue>();
      const varNames = new Map<string, string>();
      for (const v of proc.variables) {
        const up = v.name.toUpperCase();
        varNames.set(up, v.name);
        const init = v.initialValue !== undefined ? evaluateSdlExpr(v.initialValue, vars, 0) : defaultForSort(v.sort);
        vars.set(up, init);
      }
      const timersDeclared = new Set<string>(proc.timers.map((t) => t.name.toUpperCase()));
      runtimes.set(proc.name.toUpperCase(), {
        block,
        decl: proc,
        state: "__START__",
        stopped: false,
        vars,
        varNames,
        queue: [],
        activeTimers: new Map(),
        timersDeclared,
      });
    }
  }

  let now = 0.0;
  let seqCounter = 0;
  let timerIdCounter = 0;
  let deliveredCount = 0;
  let droppedCount = 0;
  const signalTxCounter = new Map<string, number>();

  const eventQueue: ScheduledEvent[] = [];
  const pushEvent = (ev: Omit<ScheduledEvent, "seq">): void => {
    eventQueue.push({ ...ev, seq: seqCounter++ });
    eventQueue.sort((a, b) => (a.time !== b.time ? a.time - b.time : a.seq - b.seq));
  };

  // Resolve target process & propagation delay for an OUTPUT signal
  const resolveRoute = (
    sender: ProcessRuntime,
    signal: string,
    explicitTo?: string,
    explicitVia?: string,
  ): { target: string; delay: number } => {
    const sigUp = signal.toUpperCase();
    if (explicitTo) {
      const toUp = explicitTo.toUpperCase();
      if (toUp === "ENV") return { target: "ENV", delay: 0 };
      if (runtimes.has(toUp)) {
        const targetRt = runtimes.get(toUp)!;
        const delay = targetRt.block.name === sender.block.name ? 0 : defaultChannelDelay;
        return { target: targetRt.decl.name, delay };
      }
    }

    // 1. Check same-block signalroutes from sender
    for (const sr of sender.block.signalRoutes) {
      if (explicitVia && sr.name.toUpperCase() !== explicitVia.toUpperCase()) continue;
      for (const p of sr.paths) {
        if (
          p.from.toUpperCase() === sender.decl.name.toUpperCase() &&
          p.signals.some((s) => s.toUpperCase() === sigUp)
        ) {
          const destUp = p.to.toUpperCase();
          if (destUp !== "ENV" && runtimes.has(destUp)) {
            return { target: runtimes.get(destUp)!.decl.name, delay: 0 };
          }
          // Goes to block boundary -> follow CONNECT -> CHANNEL -> target block -> CONNECT -> SIGNALROUTE
          for (const conn of sender.block.connects) {
            if (!conn.signalRoutes.some((r) => r.toUpperCase() === sr.name.toUpperCase())) continue;
            const ch = model.channels.find((c) => c.name.toUpperCase() === conn.channel.toUpperCase());
            if (!ch) continue;
            const chDelay =
              options.channelDelays?.[ch.name] ?? (ch.noDelay ? 0 : (ch.delaySeconds ?? defaultChannelDelay));
            for (const cp of ch.paths) {
              if (
                cp.from.toUpperCase() === sender.block.name.toUpperCase() &&
                cp.signals.some((s) => s.toUpperCase() === sigUp)
              ) {
                const targetBlockUp = cp.to.toUpperCase();
                if (targetBlockUp === "ENV") return { target: "ENV", delay: chDelay };
                const targetBlock = model.blocks.find((b) => b.name.toUpperCase() === targetBlockUp);
                if (!targetBlock) continue;
                for (const tConn of targetBlock.connects) {
                  if (tConn.channel.toUpperCase() !== ch.name.toUpperCase()) continue;
                  for (const tRouteName of tConn.signalRoutes) {
                    const tSr = targetBlock.signalRoutes.find((r) => r.name.toUpperCase() === tRouteName.toUpperCase());
                    if (!tSr) continue;
                    for (const tp of tSr.paths) {
                      if (
                        tp.from.toUpperCase() === "ENV" &&
                        tp.signals.some((s) => s.toUpperCase() === sigUp) &&
                        runtimes.has(tp.to.toUpperCase())
                      ) {
                        return { target: runtimes.get(tp.to.toUpperCase())!.decl.name, delay: chDelay };
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    // 2. Fallback: find any other process that has an INPUT for this signal
    for (const rt of runtimes.values()) {
      if (rt.decl.name === sender.decl.name) continue;
      for (const st of rt.decl.states) {
        if (st.inputs.some((inp) => inp.signal.toUpperCase() === sigUp)) {
          const delay = rt.block.name === sender.block.name ? 0 : defaultChannelDelay;
          return { target: rt.decl.name, delay };
        }
      }
    }

    return { target: "ENV", delay: 0 };
  };

  const applyTerminator = (rt: ProcessRuntime, term: SdlTerminator): void => {
    if (term.kind === "stop") {
      rt.stopped = true;
      rt.state = "__STOPPED__";
      trace.push({ time: now, process: rt.decl.name, kind: "stop", detail: "STOP", state: rt.state });
    } else {
      const next = term.targetState === "-" ? rt.state : term.targetState;
      rt.state = next;
      trace.push({
        time: now,
        process: rt.decl.name,
        kind: "nextstate",
        detail: `NEXTSTATE ${next}`,
        state: next,
      });
    }
  };

  const executeActions = (rt: ProcessRuntime, actions: SdlAction[], fallbackTerm?: SdlTerminator): void => {
    let terminated = false;
    for (const act of actions) {
      if (act.kind === "task") {
        for (const assign of act.assignments) {
          const val = evaluateSdlExpr(assign.expression, rt.vars, now);
          const up = assign.target.toUpperCase();
          rt.vars.set(up, val);
          if (!rt.varNames.has(up)) rt.varNames.set(up, assign.target);
        }
        trace.push({ time: now, process: rt.decl.name, kind: "task", detail: act.rawText });
      } else if (act.kind === "output") {
        const evalArgs = act.args.map((a) => evaluateSdlExpr(a, rt.vars, now));
        const route = resolveRoute(rt, act.signal, act.to, act.via);
        trace.push({
          time: now,
          process: rt.decl.name,
          kind: "output",
          detail: `OUTPUT ${act.signal}(${evalArgs.join(", ")}) -> ${route.target}`,
          signal: act.signal,
          args: evalArgs,
        });

        const txKey = `${rt.decl.name}->${route.target}:${act.signal}`;
        const txIdx = (signalTxCounter.get(txKey) ?? 0) + 1;
        signalTxCounter.set(txKey, txIdx);

        const dropped =
          route.target !== "ENV" &&
          options.dropPredicate !== undefined &&
          options.dropPredicate({
            signal: act.signal,
            transmissionIndex: txIdx,
            fromProcess: rt.decl.name,
            toProcess: route.target,
            time: now,
            args: evalArgs,
          });

        if (dropped) {
          droppedCount++;
          trace.push({
            time: now,
            process: rt.decl.name,
            kind: "drop",
            detail: `DROPPED ${act.signal}(${evalArgs.join(", ")}) -> ${route.target} (tx #${txIdx})`,
            signal: act.signal,
            args: evalArgs,
          });
        } else if (route.target === "ENV") {
          envOutputs.push({
            time: now + route.delay,
            fromProcess: rt.decl.name,
            signal: act.signal,
            args: evalArgs,
          });
          deliveredCount++;
        } else {
          pushEvent({
            time: now + route.delay,
            kind: "signal",
            targetProcess: route.target,
            signal: act.signal,
            args: evalArgs,
          });
        }
      } else if (act.kind === "set") {
        const expiryTime = Number(evaluateSdlExpr(act.durationExpr, rt.vars, now));
        const safeExpiry = Number.isFinite(expiryTime) && expiryTime >= now ? expiryTime : now;
        const requestedDuration = Math.max(0, safeExpiry - now);
        const tUp = act.timer.toUpperCase();
        const tid = ++timerIdCounter;
        rt.activeTimers.set(tUp, { timerId: tid, expiryTime: safeExpiry, armedAt: now, duration: requestedDuration });
        pushEvent({
          time: safeExpiry,
          kind: "timer",
          targetProcess: rt.decl.name,
          signal: act.timer,
          args: act.args.map((a) => evaluateSdlExpr(a, rt.vars, now)),
          timerId: tid,
          armedAt: now,
          requestedDuration,
        });
        trace.push({
          time: now,
          process: rt.decl.name,
          kind: "set",
          detail: `SET(${safeExpiry.toFixed(4)}, ${act.timer})`,
          signal: act.timer,
        });
      } else if (act.kind === "reset") {
        const tUp = act.timer.toUpperCase();
        rt.activeTimers.delete(tUp);
        // Also purge any already-queued timer expiry for this timer
        rt.queue = rt.queue.filter((q) => !(q.isTimer && q.signal.toUpperCase() === tUp));
        trace.push({
          time: now,
          process: rt.decl.name,
          kind: "reset",
          detail: `RESET(${act.timer})`,
          signal: act.timer,
        });
      } else if (act.kind === "decision") {
        const qVal = evaluateSdlExpr(act.question, rt.vars, now);
        let chosen = act.branches.find((b) => !b.isElse && matchDecisionCondition(qVal, b.condition, rt.vars, now));
        if (!chosen) chosen = act.branches.find((b) => b.isElse);
        trace.push({
          time: now,
          process: rt.decl.name,
          kind: "decision",
          detail: `DECISION ${act.question} = ${String(qVal)} -> (${chosen?.condition ?? "none"})`,
        });
        if (chosen) {
          executeActions(rt, chosen.actions, chosen.terminator);
          if (chosen.terminator) terminated = true;
        }
      }
    }
    if (!terminated && fallbackTerm) {
      applyTerminator(rt, fallbackTerm);
    }
  };

  const executeTransition = (rt: ProcessRuntime, transition: SdlTransition): void => {
    executeActions(rt, transition.actions, transition.terminator);
  };

  // 1. Execute START transitions for all processes at t = 0
  for (const rt of runtimes.values()) {
    if (rt.decl.start) {
      trace.push({ time: 0, process: rt.decl.name, kind: "start", detail: "START" });
      executeTransition(rt, rt.decl.start);
    }
  }

  // 2. Schedule initial injected signals
  for (const inj of options.initialSignals ?? []) {
    pushEvent({
      time: inj.time,
      kind: "signal",
      targetProcess: inj.targetProcess,
      signal: inj.signal,
      args: inj.args ?? [],
    });
  }

  // Helper to find matching state & input clause
  const findInputClause = (rt: ProcessRuntime, signalName: string) => {
    const stUp = rt.state.toUpperCase();
    const sigUp = signalName.toUpperCase();
    const matchingStates: SdlStateDecl[] = rt.decl.states.filter(
      (s) => s.names.some((n) => n.toUpperCase() === stUp) || s.names.includes("*"),
    );
    for (const st of matchingStates) {
      const inp = st.inputs.find((i) => i.signal.toUpperCase() === sigUp);
      if (inp) return inp;
    }
    return undefined;
  };

  // 3. Main discrete-event loop
  let steps = 0;
  while (steps < maxSteps) {
    // First drain any ready queued signals in processes
    let progressed = false;
    for (const rt of runtimes.values()) {
      if (rt.stopped || rt.queue.length === 0) continue;
      const item = rt.queue.shift()!;
      const inp = findInputClause(rt, item.signal);
      if (!inp) {
        // SDL-88 implicit transition: unexpected signal is discarded
        continue;
      }
      steps++;
      progressed = true;
      for (let i = 0; i < inp.variables.length; i++) {
        const varName = inp.variables[i]!;
        const val = item.args[i];
        if (val !== undefined) {
          const up = varName.toUpperCase();
          rt.vars.set(up, val);
          if (!rt.varNames.has(up)) rt.varNames.set(up, varName);
        }
      }
      trace.push({
        time: now,
        process: rt.decl.name,
        kind: item.isTimer ? "timer_expiry" : "input",
        detail: `INPUT ${item.signal}(${item.args.join(", ")}) in ${rt.state}`,
        signal: item.signal,
        args: item.args,
        state: rt.state,
      });
      executeTransition(rt, inp.transition);
      if (steps >= maxSteps) break;
    }
    if (progressed) continue;

    // Otherwise pop the next scheduled event from the global event queue
    if (eventQueue.length === 0) break;
    const nextEv = eventQueue.shift()!;
    if (nextEv.time > maxTime) break;
    now = nextEv.time;

    const targetRt = runtimes.get(nextEv.targetProcess.toUpperCase());
    if (!targetRt || targetRt.stopped) continue;

    if (nextEv.kind === "timer") {
      const tUp = nextEv.signal.toUpperCase();
      const active = targetRt.activeTimers.get(tUp);
      // Ignore cancelled or superseded timers
      if (!active || active.timerId !== nextEv.timerId) continue;
      targetRt.activeTimers.delete(tUp);
      timerExpiries.push({
        time: now,
        process: targetRt.decl.name,
        timer: nextEv.signal,
        armedAt: nextEv.armedAt ?? 0,
        requestedDuration: nextEv.requestedDuration ?? 0,
      });
      targetRt.queue.push({
        signal: nextEv.signal,
        args: nextEv.args,
        isTimer: true,
        ...(nextEv.timerId !== undefined ? { timerId: nextEv.timerId } : {}),
      });
    } else {
      deliveredCount++;
      targetRt.queue.push({
        signal: nextEv.signal,
        args: nextEv.args,
        isTimer: false,
      });
    }
  }

  const processStates: Record<string, SdlProcessSnapshot> = {};
  for (const rt of runtimes.values()) {
    const varsObj: Record<string, SdlValue> = {};
    for (const [up, v] of rt.vars) {
      varsObj[rt.varNames.get(up) ?? up] = v;
    }
    processStates[rt.decl.name] = {
      blockName: rt.block.name,
      processName: rt.decl.name,
      state: rt.state,
      stopped: rt.stopped,
      variables: varsObj,
      activeTimers: Array.from(rt.activeTimers.keys()),
      queueLength: rt.queue.length,
    };
  }

  return {
    systemName: model.name,
    finalTime: now,
    stepsExecuted: steps,
    trace,
    envOutputs,
    timerExpiries,
    processStates,
    deliveredCount,
    droppedCount,
  };
}

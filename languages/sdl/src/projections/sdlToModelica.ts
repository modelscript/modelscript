// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projection from ITU-T Z.100 SDL-88 to Modelica 3.3+ Synchronous State Machines.
 *
 * Maps each SDL PROCESS to a Modelica `model` containing a `block` per SDL STATE,
 * `initialState(...)` for the START target, `transition(from, to, condition, ...)`
 * clauses for INPUT transitions, `DCL` variables, and `TIMER` countdown equations.
 */

import type { SdlAction, SdlProcessDecl, SdlSystemModel, SdlTransition } from "../types.js";

function sanitizeId(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[0-9]/.test(cleaned) ? `s_${cleaned}` : cleaned || "Unnamed";
}

function mapSortToModelica(sort: string): string {
  switch (sort.toUpperCase()) {
    case "BOOLEAN":
      return "Boolean";
    case "INTEGER":
    case "NATURAL":
    case "PID":
      return "Integer";
    case "CHARSTRING":
    case "CHARACTER":
      return "String";
    case "REAL":
    case "DURATION":
    case "TIME":
    default:
      return "Real";
  }
}

function collectTransitions(
  fromState: string,
  signal: string,
  tr: SdlTransition,
  out: Array<{ from: string; to: string; condition: string; actions: string[] }>,
): void {
  const actionComments: string[] = [];
  const walk = (actions: SdlAction[], guardPrefix: string): void => {
    for (const act of actions) {
      if (act.kind === "task") {
        actionComments.push(`TASK ${act.rawText}`);
      } else if (act.kind === "output") {
        actionComments.push(`OUTPUT ${act.signal}(${act.args.join(", ")})`);
      } else if (act.kind === "set") {
        actionComments.push(`SET(${act.durationExpr}, ${act.timer})`);
      } else if (act.kind === "reset") {
        actionComments.push(`RESET(${act.timer})`);
      } else if (act.kind === "decision") {
        for (const br of act.branches) {
          const cond = br.isElse ? `${guardPrefix}` : `${guardPrefix} and (${act.question} == ${br.condition})`;
          if (br.terminator?.kind === "nextstate") {
            const target = br.terminator.targetState === "-" ? fromState : br.terminator.targetState;
            out.push({ from: fromState, to: target, condition: cond, actions: [...actionComments] });
          } else {
            walk(br.actions, cond);
          }
        }
      }
    }
  };

  const baseCond = `sig_${sanitizeId(signal)}`;
  walk(tr.actions, baseCond);
  if (tr.terminator?.kind === "nextstate") {
    const target = tr.terminator.targetState === "-" ? fromState : tr.terminator.targetState;
    out.push({ from: fromState, to: target, condition: baseCond, actions: actionComments });
  }
}

function emitProcessModelica(proc: SdlProcessDecl, indent: string): string[] {
  const lines: string[] = [];
  const pName = sanitizeId(proc.name);
  lines.push(`${indent}model ${pName} "SDL-88 Process ${proc.name}"`);

  // Local DCL variables
  for (const v of proc.variables) {
    const moType = mapSortToModelica(v.sort);
    const initPart = v.initialValue !== undefined ? `(start=${v.initialValue})` : "";
    lines.push(`${indent}  ${moType} ${sanitizeId(v.name)}${initPart};`);
  }

  // Timers
  for (const t of proc.timers) {
    const tName = sanitizeId(t.name);
    lines.push(`${indent}  Real ${tName}_rem(start=0.0) "SDL Timer ${t.name} remaining time";`);
    lines.push(`${indent}  Boolean ${tName}_active(start=false) "SDL Timer ${t.name} armed flag";`);
    lines.push(`${indent}  Boolean sig_${tName}(start=false) "SDL Timer ${t.name} expiry trigger";`);
  }

  // Signal trigger inputs
  const seenSignals = new Set<string>();
  const timerSet = new Set(proc.timers.map((t) => t.name.toUpperCase()));
  for (const st of proc.states) {
    for (const inp of st.inputs) {
      const up = inp.signal.toUpperCase();
      if (!seenSignals.has(up) && !timerSet.has(up)) {
        seenSignals.add(up);
        lines.push(`${indent}  input Boolean sig_${sanitizeId(inp.signal)} "SDL Signal ${inp.signal}";`);
      }
    }
  }

  // State blocks
  const stateNames: string[] = [];
  for (const st of proc.states) {
    for (const s of st.names) {
      if (s === "*") continue;
      if (!stateNames.includes(s)) stateNames.push(s);
    }
  }

  for (const sName of stateNames) {
    const sid = sanitizeId(sName);
    lines.push(`${indent}  block State_${sid}`);
    lines.push(`${indent}    Boolean active;`);
    lines.push(`${indent}  equation`);
    lines.push(`${indent}    active = true;`);
    lines.push(`${indent}  end State_${sid};`);
    lines.push(`${indent}  State_${sid} ${sid};`);
  }

  lines.push(`${indent}equation`);

  // Timer countdown equations
  for (const t of proc.timers) {
    const tName = sanitizeId(t.name);
    lines.push(`${indent}  der(${tName}_rem) = if ${tName}_active then -1.0 else 0.0;`);
    lines.push(`${indent}  sig_${tName} = ${tName}_active and (${tName}_rem <= 0.0);`);
  }

  // Initial state from START
  if (proc.start?.terminator?.kind === "nextstate") {
    const initState = sanitizeId(proc.start.terminator.targetState);
    lines.push(`${indent}  initialState(${initState});`);
  } else if (stateNames.length > 0) {
    lines.push(`${indent}  initialState(${sanitizeId(stateNames[0]!)});`);
  }

  // Transitions
  const edges: Array<{ from: string; to: string; condition: string; actions: string[] }> = [];
  for (const st of proc.states) {
    const fromList = st.names.includes("*") ? stateNames : st.names;
    for (const from of fromList) {
      for (const inp of st.inputs) {
        collectTransitions(from, inp.signal, inp.transition, edges);
      }
    }
  }

  let priority = 1;
  for (const e of edges) {
    const comment = e.actions.length > 0 ? ` /* ${e.actions.join("; ")} */` : "";
    lines.push(
      `${indent}  transition(${sanitizeId(e.from)}, ${sanitizeId(e.to)}, ${e.condition}, immediate=false, reset=true, synchronize=false, priority=${priority++});${comment}`,
    );
  }

  lines.push(`${indent}end ${pName};`);
  return lines;
}

/**
 * Projects an SDL-88 `SdlSystemModel` into a Modelica 3.3+ package using synchronous state machines.
 */
export function sdlToModelica(model: SdlSystemModel): string {
  const sysName = sanitizeId(model.name);
  const lines: string[] = [];
  lines.push(`package ${sysName} "Projected from ITU-T Z.100 SDL-88 System ${model.name}"`);

  for (const block of model.blocks) {
    const bName = sanitizeId(block.name);
    lines.push(`  package ${bName} "SDL-88 Block ${block.name}"`);
    for (const proc of block.processes) {
      lines.push(...emitProcessModelica(proc, "    "));
    }
    lines.push(`  end ${bName};`);
  }

  lines.push(`  model SystemAssembly "Top-level SDL-88 System ${model.name}"`);
  for (const block of model.blocks) {
    const bName = sanitizeId(block.name);
    for (const proc of block.processes) {
      const pName = sanitizeId(proc.name);
      lines.push(`    ${bName}.${pName} ${bName}_${pName};`);
    }
  }
  lines.push(`  end SystemAssembly;`);
  lines.push(`end ${sysName};`);
  return lines.join("\n") + "\n";
}

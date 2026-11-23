// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — GR(1) Synthesized Mealy Supervisor Codegen Emitters.
 *
 * Emits verified GR(1) reactive strategies (`Gr1SynthesisResult`) into:
 *   1. Modelica discrete state machine block (`emitGr1ToModelica`)
 *   2. IEC 61131-3 PLCopen Structured Text (`emitGr1ToPlcOpenSt`)
 *   3. AUTOSAR-compliant C runnable (`emitGr1ToAutosarC`)
 */

import type { Gr1SynthesisResult } from "./gr1_synthesizer.js";

export function emitGr1ToModelica(blockName: string, result: Gr1SynthesisResult): string {
  if (!result.realizable) {
    throw new Error(`Cannot emit Modelica supervisor for unrealizable GR(1) spec '${blockName}'.`);
  }
  const numGoals = result.strategy.length;
  const lines: string[] = [
    `block ${blockName}`,
    `  input Integer envMove(start = 0);`,
    `  output Integer state(start = ${result.winningRegion[0] ?? 0});`,
    `  protected Integer goalIdx(start = 0);`,
    `algorithm`,
    `  when sample(0, 0.01) then`,
  ];
  for (let g = 0; g < numGoals; g++) {
    lines.push(`    ${g === 0 ? "if" : "elseif"} goalIdx == ${g} then`);
    const states = result.strategy[g]!;
    let firstState = true;
    for (let q = 0; q < states.length; q++) {
      const moves = states[q]!;
      if (moves.length === 0) continue;
      lines.push(`      ${firstState ? "if" : "elseif"} pre(state) == ${q} then`);
      firstState = false;
      for (let e = 0; e < moves.length; e++) {
        lines.push(`        ${e === 0 ? "if" : "elseif"} envMove == ${e} then state := ${moves[e]!};`);
      }
      lines.push(`        end if;`);
    }
    if (!firstState) lines.push(`      end if;`);
    lines.push(`      goalIdx := mod(goalIdx + 1, ${numGoals});`);
  }
  lines.push(`    end if;`);
  lines.push(`  end when;`);
  lines.push(`end ${blockName};`);
  return lines.join("\n");
}

export function emitGr1ToPlcOpenSt(fbName: string, result: Gr1SynthesisResult): string {
  if (!result.realizable) {
    throw new Error(`Cannot emit PLCopen ST for unrealizable GR(1) spec '${fbName}'.`);
  }
  const numGoals = result.strategy.length;
  const lines: string[] = [
    `FUNCTION_BLOCK ${fbName}`,
    `VAR_INPUT`,
    `  envMove : INT;`,
    `END_VAR`,
    `VAR_OUTPUT`,
    `  state : INT := ${result.winningRegion[0] ?? 0};`,
    `END_VAR`,
    `VAR`,
    `  goalIdx : INT := 0;`,
    `END_VAR`,
    `CASE goalIdx OF`,
  ];
  for (let g = 0; g < numGoals; g++) {
    lines.push(`  ${g}:`);
    lines.push(`    CASE state OF`);
    const states = result.strategy[g]!;
    for (let q = 0; q < states.length; q++) {
      const moves = states[q]!;
      if (moves.length === 0) continue;
      lines.push(`      ${q}:`);
      lines.push(`        CASE envMove OF`);
      for (let e = 0; e < moves.length; e++) {
        lines.push(`          ${e}: state := ${moves[e]!};`);
      }
      lines.push(`        END_CASE;`);
    }
    lines.push(`    END_CASE;`);
  }
  lines.push(`END_CASE;`);
  lines.push(`goalIdx := (goalIdx + 1) MOD ${numGoals};`);
  lines.push(`END_FUNCTION_BLOCK`);
  return lines.join("\n");
}

export function emitGr1ToAutosarC(runnableName: string, result: Gr1SynthesisResult): string {
  if (!result.realizable) {
    throw new Error(`Cannot emit AUTOSAR C for unrealizable GR(1) spec '${runnableName}'.`);
  }
  const numGoals = result.strategy.length;
  const lines: string[] = [
    `/* Auto-generated verified GR(1) AUTOSAR Runnable */`,
    `#include <stdint.h>`,
    `static int32_t g_state = ${result.winningRegion[0] ?? 0};`,
    `static int32_t g_goal_idx = 0;`,
    `int32_t ${runnableName}(int32_t env_move) {`,
    `  switch (g_goal_idx) {`,
  ];
  for (let g = 0; g < numGoals; g++) {
    lines.push(`    case ${g}:`);
    lines.push(`      switch (g_state) {`);
    const states = result.strategy[g]!;
    for (let q = 0; q < states.length; q++) {
      const moves = states[q]!;
      if (moves.length === 0) continue;
      lines.push(`        case ${q}:`);
      for (let e = 0; e < moves.length; e++) {
        lines.push(`          if (env_move == ${e}) { g_state = ${moves[e]!}; }`);
      }
      lines.push(`          break;`);
    }
    lines.push(`      }`);
    lines.push(`      break;`);
  }
  lines.push(`  }`);
  lines.push(`  g_goal_idx = (g_goal_idx + 1) % ${numGoals};`);
  lines.push(`  return g_state;`);
  lines.push(`}`);
  return lines.join("\n");
}

// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { simulateEsterelTrace } from "../src/solver/index.js";

describe("Esterel Constructive Reactive Semantics Benchmarks", () => {
  it("reproduces Gérard Berry's exact ABRO reaction trace", () => {
    const abro = `
      module ABRO:
      input A, B, R;
      output O;
      loop
        [ await A || await B ];
        emit O
      each R
      end module
    `;

    const trace = simulateEsterelTrace(abro, [
      [], // tick 0: entry, awaits A and B -> {}
      ["A"], // tick 1: A arrives, still waiting for B -> {}
      ["B"], // tick 2: B arrives -> O emitted instantaneously!
      ["A", "B"], // tick 3: already emitted in this cycle -> {}
      ["R"], // tick 4: strong reset R restarts awaits -> {}
      ["A", "B"], // tick 5: simultaneous A & B -> O emitted!
      ["R", "A", "B"], // tick 6: strong reset R preempts & restarts (non-immediate awaits) -> {}
      ["B"], // tick 7: B arrives -> {}
      ["A"], // tick 8: A arrives -> O emitted!
    ]);

    assert.strictEqual(trace.allConstructive, true);
    assert.deepStrictEqual(
      trace.reactions.map((r) => r.outputs),
      [[], [], ["O"], [], [], ["O"], [], [], ["O"]],
    );
  });

  it("enforces strong abort vs weak abort preemption semantics", () => {
    const strongAbort = `
      module StrongAbort:
      input K;
      output S, H;
      abort
        sustain S
      when K do
        emit H
      end
      end module
    `;
    const weakAbort = `
      module WeakAbort:
      input K;
      output S, H;
      weak abort
        sustain S
      when K do
        emit H
      end
      end module
    `;

    const strongTrace = simulateEsterelTrace(strongAbort, [[], ["K"], []]);
    const weakTrace = simulateEsterelTrace(weakAbort, [[], ["K"], []]);

    // Tick 0: both sustain S
    assert.deepStrictEqual(strongTrace.reactions[0]!.outputs, ["S"]);
    assert.deepStrictEqual(weakTrace.reactions[0]!.outputs, ["S"]);

    // Tick 1 (K present): strong abort suppresses S and emits H; weak abort lets S emit AND emits H!
    assert.deepStrictEqual(strongTrace.reactions[1]!.outputs, ["H"]);
    assert.deepStrictEqual(weakTrace.reactions[1]!.outputs, ["H", "S"]);

    // Tick 2: both terminated
    assert.deepStrictEqual(strongTrace.reactions[2]!.outputs, []);
    assert.deepStrictEqual(weakTrace.reactions[2]!.outputs, []);
  });

  it("enforces parallel || instantaneous broadcast regardless of branch order", () => {
    const broadcast = `
      module Broadcast:
      input GO;
      output S, T;
      await immediate GO;
      [
        present S then emit T end
      ||
        emit S
      ]
      end module
    `;

    const trace = simulateEsterelTrace(broadcast, [["GO"]]);
    assert.strictEqual(trace.allConstructive, true);
    assert.deepStrictEqual(trace.reactions[0]!.outputs, ["S", "T"]);
  });

  it("enforces nested trap/exit priority in parallel composition (outermost trap wins)", () => {
    const trapPriority = `
      module TrapPriority:
      output OUTER_H, INNER_H;
      trap OUTER in
        trap INNER in
          [ exit INNER || exit OUTER ]
        handle INNER do
          emit INNER_H
        end
      handle OUTER do
        emit OUTER_H
      end
      end module
    `;

    const trace = simulateEsterelTrace(trapPriority, [[]]);
    assert.strictEqual(trace.allConstructive, true);
    assert.deepStrictEqual(trace.reactions[0]!.outputs, ["OUTER_H"]);
  });

  it("enforces suspend freezing state on suspension instants", () => {
    const susp = `
      module SuspendCounter:
      input TICK, HOLD;
      output DONE;
      suspend
        await 2 TICK;
        emit DONE
      when HOLD end
      end module
    `;

    const trace = simulateEsterelTrace(susp, [
      [], // tick 0: entry (non-immediate await)
      ["TICK"], // tick 1: 1st tick counted (remaining = 1)
      ["TICK", "HOLD"], // tick 2: suspended -> TICK ignored! (remaining = 1)
      ["TICK"], // tick 3: 2nd un-suspended tick -> DONE emitted!
    ]);

    assert.strictEqual(trace.allConstructive, true);
    assert.deepStrictEqual(
      trace.reactions.map((r) => r.outputs),
      [[], [], [], ["DONE"]],
    );
  });

  it("verifies Watchdog timeout parity (kick prevents alarm; 3 ticks without kick emits ALARM)", () => {
    const watchdog = `
      module Watchdog:
      input TICK, KICK, RESET;
      output ALARM;
      loop
        abort
          await 3 TICK;
          emit ALARM;
          halt
        when KICK end
      each RESET
      end module
    `;

    const trace = simulateEsterelTrace(watchdog, [
      [], // tick 0: entry
      ["TICK"], // tick 1: 1st tick
      ["TICK"], // tick 2: 2nd tick
      ["KICK"], // tick 3: kicked! aborts & stays halted until RESET
      ["TICK"], // tick 4: already kicked
      ["RESET"], // tick 5: reset starts fresh watchdog
      ["TICK"], // tick 6: 1st tick
      ["TICK"], // tick 7: 2nd tick
      ["TICK"], // tick 8: 3rd tick -> ALARM!
      ["TICK"], // tick 9: halted after alarm
    ]);

    assert.strictEqual(trace.allConstructive, true);
    assert.deepStrictEqual(
      trace.reactions.map((r) => r.outputs),
      [[], [], [], [], [], [], [], [], ["ALARM"], []],
    );
  });

  it("detects non-constructive causality paradox at runtime (present S else emit S)", () => {
    const paradox = `
      module Paradox:
      output S;
      present S else emit S end
      end module
    `;

    const trace = simulateEsterelTrace(paradox, [[]]);
    assert.strictEqual(trace.allConstructive, false);
    assert.strictEqual(trace.reactions[0]!.constructive, false);
    assert.ok(trace.reactions[0]!.error);
  });
});

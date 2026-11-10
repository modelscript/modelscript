// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CurtailmentSchedulePoint, OpenAdrDeck } from "../types.js";

/**
 * Evaluates active OpenADR demand response events into a time-series curtailment schedule.
 */
export function evaluateCurtailment(
  deck: OpenAdrDeck,
  targetVenId?: string | undefined,
): CurtailmentSchedulePoint[] {
  const schedule: CurtailmentSchedulePoint[] = [];

  const activeEvents = deck.events.filter(
    (e) =>
      e.status === "active" &&
      (!targetVenId || !e.targetVenId || e.targetVenId === targetVenId),
  );

  let currentTime = 0;
  for (const e of activeEvents) {
    for (const it of e.intervals) {
      schedule.push({
        timeSeconds: currentTime,
        activeLimitKW: it.payload,
        signalType: e.signalType,
      });
      currentTime += it.durationSeconds;
    }
  }

  return schedule;
}

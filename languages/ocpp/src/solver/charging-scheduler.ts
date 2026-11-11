// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AllocationResult, OcppNetwork } from "../types.js";

export interface SchedulingOptions {
  fairShare?: boolean | undefined;
  minSessionPowerKW?: number | undefined;
}

/**
 * Smart Charging Load Allocator:
 * Distributes available station grid capacity among active EV charging sessions.
 * Respects connector hardware ratings, transformer capacity limits, and departure deadlines.
 */
export function scheduleSmartCharging(
  network: OcppNetwork,
  options?: SchedulingOptions | undefined,
): AllocationResult[] {
  const results: AllocationResult[] = [];
  const minPower = options?.minSessionPowerKW ?? 6.0; // minimum Level 2 / DC charging power

  for (const st of network.stations) {
    const activeSessions: {
      evseId: number;
      connectorId: number;
      connMaxKW: number;
      session: NonNullable<(typeof st.evses)[0]["connectors"][0]["currentSession"]>;
      neededKWh: number;
      urgency: number; // required average kW to meet departure deadline
    }[] = [];

    for (const e of st.evses) {
      for (const c of e.connectors) {
        if (c.currentSession && c.status === "Charging") {
          const s = c.currentSession;
          const needed = Math.max(0, (s.targetSoC - s.currentSoC) * s.evBatteryCapacityKWh);
          const hours = Math.max(s.departureMinutes / 60, 0.1);
          const urgency = needed / hours;
          activeSessions.push({
            evseId: e.id,
            connectorId: c.id,
            connMaxKW: c.maxPowerKW,
            session: s,
            neededKWh: needed,
            urgency,
          });
        }
      }
    }

    if (activeSessions.length === 0) continue;

    const totalUnconstrainedKW = activeSessions.reduce((sum, item) => sum + item.connMaxKW, 0);

    // Case 1: Grid limit can satisfy all connectors at max hardware capacity
    if (totalUnconstrainedKW <= st.gridLimitKW) {
      for (const item of activeSessions) {
        const pAlloc = item.connMaxKW;
        item.session.allocatedPowerKW = pAlloc;
        const estMinutes = pAlloc > 0 ? (item.neededKWh / pAlloc) * 60 : Infinity;
        results.push({
          stationId: st.id,
          evseId: item.evseId,
          connectorId: item.connectorId,
          transactionId: item.session.transactionId,
          allocatedPowerKW: pAlloc,
          energyRequiredKWh: item.neededKWh,
          estimatedTimeToTargetMinutes: estMinutes,
        });
      }
      continue;
    }

    // Case 2: Congested grid transformer -> Distribute power weighted by urgency/deficit
    const totalUrgency = activeSessions.reduce((sum, item) => sum + Math.max(item.urgency, 1.0), 0);
    // First pass: Assign proportional shares
    const allocations: number[] = [];
    for (let i = 0; i < activeSessions.length; i++) {
      const item = activeSessions[i]!;
      const share = (Math.max(item.urgency, 1.0) / totalUrgency) * st.gridLimitKW;
      const clamped = Math.min(item.connMaxKW, Math.max(minPower, share));
      allocations.push(clamped);
    }

    // Second pass: Adjust to strictly adhere to st.gridLimitKW
    const currentSum = allocations.reduce((a, b) => a + b, 0);
    if (currentSum > st.gridLimitKW) {
      const scale = st.gridLimitKW / currentSum;
      for (let i = 0; i < allocations.length; i++) {
        allocations[i] = Math.round(allocations[i]! * scale * 10) / 10;
      }
    }

    for (let i = 0; i < activeSessions.length; i++) {
      const item = activeSessions[i]!;
      const pAlloc = allocations[i]!;
      item.session.allocatedPowerKW = pAlloc;
      const estMinutes = pAlloc > 0 ? (item.neededKWh / pAlloc) * 60 : Infinity;

      results.push({
        stationId: st.id,
        evseId: item.evseId,
        connectorId: item.connectorId,
        transactionId: item.session.transactionId,
        allocatedPowerKW: pAlloc,
        energyRequiredKWh: item.neededKWh,
        estimatedTimeToTargetMinutes: estMinutes,
      });
    }
  }

  return results;
}

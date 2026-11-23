// SPDX-License-Identifier: AGPL-3.0-or-later

import { IeeeCdfErrorCode, type IeeeCdfDiagnostic } from "../errors.js";
import type { IeeeCdfNetwork } from "../types.js";

export { IeeeCdfErrorCode, type IeeeCdfDiagnostic, type IeeeCdfErrorCodeKey } from "../errors.js";

/**
 * Runs all structural, topological, and electrical lint checks (`CDF1001`–`CDF5006`)
 * on a parsed IEEE CDF or BPA IPF network.
 */
export function lintIeeeCdf(network: IeeeCdfNetwork): IeeeCdfDiagnostic[] {
  const diags: IeeeCdfDiagnostic[] = [];

  // CDF1001: Parser syntax issues
  for (const issue of network.parseIssues) {
    diags.push({
      code: IeeeCdfErrorCode.SYNTAX_ERROR.code,
      rule: IeeeCdfErrorCode.SYNTAX_ERROR.rule,
      severity: IeeeCdfErrorCode.SYNTAX_ERROR.severity,
      message: IeeeCdfErrorCode.SYNTAX_ERROR.message(issue.message),
      line: issue.line,
      column: issue.column,
    });
  }

  // CDF1002 & CDF5006: Missing title / invalid MVA base
  if (!network.hasTitleCard) {
    diags.push({
      code: IeeeCdfErrorCode.MISSING_TITLE_OR_MVA_BASE.code,
      rule: IeeeCdfErrorCode.MISSING_TITLE_OR_MVA_BASE.rule,
      severity: IeeeCdfErrorCode.MISSING_TITLE_OR_MVA_BASE.severity,
      message: IeeeCdfErrorCode.MISSING_TITLE_OR_MVA_BASE.message(),
      line: network.title.line || 1,
    });
  }
  if (!(network.title.mvaBase > 0)) {
    diags.push({
      code: IeeeCdfErrorCode.ZERO_MVA_BASE.code,
      rule: IeeeCdfErrorCode.ZERO_MVA_BASE.rule,
      severity: IeeeCdfErrorCode.ZERO_MVA_BASE.severity,
      message: IeeeCdfErrorCode.ZERO_MVA_BASE.message(network.title.mvaBase),
      line: network.title.line || 1,
    });
  }

  // CDF1003: Missing END OF DATA in IEEE CDF format
  if (network.format === "ieee-cdf" && !network.hasEndOfData) {
    diags.push({
      code: IeeeCdfErrorCode.MISSING_END_OF_DATA.code,
      rule: IeeeCdfErrorCode.MISSING_END_OF_DATA.rule,
      severity: IeeeCdfErrorCode.MISSING_END_OF_DATA.severity,
      message: IeeeCdfErrorCode.MISSING_END_OF_DATA.message(),
      line: Math.max(1, network.buses.length + network.branches.length + 1),
    });
  }

  // CDF2001: Duplicate bus numbers & bus map
  const busMap = new Map<number, (typeof network.buses)[number]>();
  const slackBuses: number[] = [];

  for (const bus of network.buses) {
    if (busMap.has(bus.busNumber)) {
      diags.push({
        code: IeeeCdfErrorCode.DUPLICATE_BUS_NUMBER.code,
        rule: IeeeCdfErrorCode.DUPLICATE_BUS_NUMBER.rule,
        severity: IeeeCdfErrorCode.DUPLICATE_BUS_NUMBER.severity,
        message: IeeeCdfErrorCode.DUPLICATE_BUS_NUMBER.message(bus.busNumber),
        line: bus.line,
        busNumber: bus.busNumber,
      });
    } else {
      busMap.set(bus.busNumber, bus);
    }

    if (bus.type === 3) {
      slackBuses.push(bus.busNumber);
    }

    // CDF5001: Voltage magnitude outside [0.8, 1.2] pu
    const vm = bus.desiredVoltsPu > 0 && (bus.type === 2 || bus.type === 3) ? bus.desiredVoltsPu : bus.finalVoltagePu;
    if (vm < 0.8 || vm > 1.2) {
      diags.push({
        code: IeeeCdfErrorCode.VOLTAGE_OUT_OF_BOUNDS.code,
        rule: IeeeCdfErrorCode.VOLTAGE_OUT_OF_BOUNDS.rule,
        severity: IeeeCdfErrorCode.VOLTAGE_OUT_OF_BOUNDS.severity,
        message: IeeeCdfErrorCode.VOLTAGE_OUT_OF_BOUNDS.message(bus.busNumber, vm),
        line: bus.line,
        busNumber: bus.busNumber,
      });
    }

    // CDF5002: PV bus with Qmin > Qmax
    if (bus.type === 2 && bus.minMvarOrVolt > bus.maxMvarOrVolt) {
      diags.push({
        code: IeeeCdfErrorCode.PV_QLIM_INVERTED.code,
        rule: IeeeCdfErrorCode.PV_QLIM_INVERTED.rule,
        severity: IeeeCdfErrorCode.PV_QLIM_INVERTED.severity,
        message: IeeeCdfErrorCode.PV_QLIM_INVERTED.message(bus.busNumber, bus.minMvarOrVolt, bus.maxMvarOrVolt),
        line: bus.line,
        busNumber: bus.busNumber,
      });
    }
  }

  // CDF4001 / CDF4002: Missing or multiple slack buses
  if (network.buses.length > 0) {
    if (slackBuses.length === 0) {
      diags.push({
        code: IeeeCdfErrorCode.MISSING_SLACK_BUS.code,
        rule: IeeeCdfErrorCode.MISSING_SLACK_BUS.rule,
        severity: IeeeCdfErrorCode.MISSING_SLACK_BUS.severity,
        message: IeeeCdfErrorCode.MISSING_SLACK_BUS.message(),
        line: network.buses[0]?.line ?? 1,
      });
    } else if (slackBuses.length > 1) {
      diags.push({
        code: IeeeCdfErrorCode.MULTIPLE_SLACK_BUSES.code,
        rule: IeeeCdfErrorCode.MULTIPLE_SLACK_BUSES.rule,
        severity: IeeeCdfErrorCode.MULTIPLE_SLACK_BUSES.severity,
        message: IeeeCdfErrorCode.MULTIPLE_SLACK_BUSES.message(slackBuses.length),
        line: busMap.get(slackBuses[1]!)?.line ?? 1,
        busNumber: slackBuses[1],
      });
    }
  }

  // Adjacency for island detection
  const adj = new Map<number, number[]>();
  for (const busNum of busMap.keys()) {
    adj.set(busNum, []);
  }

  for (const br of network.branches) {
    const hasFrom = busMap.has(br.fromBus);
    const hasTo = busMap.has(br.toBus);

    // CDF2002: Undefined from/to bus
    if (!hasFrom) {
      diags.push({
        code: IeeeCdfErrorCode.UNDEFINED_BRANCH_BUS.code,
        rule: IeeeCdfErrorCode.UNDEFINED_BRANCH_BUS.rule,
        severity: IeeeCdfErrorCode.UNDEFINED_BRANCH_BUS.severity,
        message: IeeeCdfErrorCode.UNDEFINED_BRANCH_BUS.message("from", br.fromBus, br.toBus),
        line: br.line,
        busNumber: br.fromBus,
      });
    }
    if (!hasTo) {
      diags.push({
        code: IeeeCdfErrorCode.UNDEFINED_BRANCH_BUS.code,
        rule: IeeeCdfErrorCode.UNDEFINED_BRANCH_BUS.rule,
        severity: IeeeCdfErrorCode.UNDEFINED_BRANCH_BUS.severity,
        message: IeeeCdfErrorCode.UNDEFINED_BRANCH_BUS.message("to", br.toBus, br.fromBus),
        line: br.line,
        busNumber: br.toBus,
      });
    }

    // CDF3001: Self-loop branch
    if (br.fromBus === br.toBus) {
      diags.push({
        code: IeeeCdfErrorCode.SELF_LOOP_BRANCH.code,
        rule: IeeeCdfErrorCode.SELF_LOOP_BRANCH.rule,
        severity: IeeeCdfErrorCode.SELF_LOOP_BRANCH.severity,
        message: IeeeCdfErrorCode.SELF_LOOP_BRANCH.message(br.fromBus, br.circuit),
        line: br.line,
        busNumber: br.fromBus,
      });
    }

    // CDF3002: Zero impedance branch (R = 0 and X = 0)
    if (Math.abs(br.r) < 1e-15 && Math.abs(br.x) < 1e-15) {
      diags.push({
        code: IeeeCdfErrorCode.ZERO_IMPEDANCE_BRANCH.code,
        rule: IeeeCdfErrorCode.ZERO_IMPEDANCE_BRANCH.rule,
        severity: IeeeCdfErrorCode.ZERO_IMPEDANCE_BRANCH.severity,
        message: IeeeCdfErrorCode.ZERO_IMPEDANCE_BRANCH.message(br.fromBus, br.toBus, br.circuit),
        line: br.line,
        busNumber: br.fromBus,
      });
    }

    // CDF5004: Negative branch resistance
    if (br.r < 0) {
      diags.push({
        code: IeeeCdfErrorCode.NEGATIVE_BRANCH_RESISTANCE.code,
        rule: IeeeCdfErrorCode.NEGATIVE_BRANCH_RESISTANCE.rule,
        severity: IeeeCdfErrorCode.NEGATIVE_BRANCH_RESISTANCE.severity,
        message: IeeeCdfErrorCode.NEGATIVE_BRANCH_RESISTANCE.message(br.fromBus, br.toBus, br.r),
        line: br.line,
        busNumber: br.fromBus,
      });
    }

    // CDF5005: Invalid transformer tap ratio
    if (br.tapRatio !== 0 && (br.tapRatio < 0.5 || br.tapRatio > 1.5)) {
      diags.push({
        code: IeeeCdfErrorCode.INVALID_TAP_RATIO.code,
        rule: IeeeCdfErrorCode.INVALID_TAP_RATIO.rule,
        severity: IeeeCdfErrorCode.INVALID_TAP_RATIO.severity,
        message: IeeeCdfErrorCode.INVALID_TAP_RATIO.message(br.fromBus, br.toBus, br.tapRatio),
        line: br.line,
        busNumber: br.fromBus,
      });
    }

    if (hasFrom && hasTo && br.fromBus !== br.toBus) {
      adj.get(br.fromBus)?.push(br.toBus);
      adj.get(br.toBus)?.push(br.fromBus);
    }
  }

  // CDF5003: Disconnected island bus (BFS from all slack buses)
  if (slackBuses.length > 0 && busMap.size > 1) {
    const visited = new Set<number>();
    const queue: number[] = [...slackBuses];
    for (const s of slackBuses) visited.add(s);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const next of adj.get(curr) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }

    for (const [busNum, bus] of busMap) {
      if (!visited.has(busNum)) {
        diags.push({
          code: IeeeCdfErrorCode.DISCONNECTED_ISLAND_BUS.code,
          rule: IeeeCdfErrorCode.DISCONNECTED_ISLAND_BUS.rule,
          severity: IeeeCdfErrorCode.DISCONNECTED_ISLAND_BUS.severity,
          message: IeeeCdfErrorCode.DISCONNECTED_ISLAND_BUS.message(busNum, bus.name),
          line: bus.line,
          busNumber: busNum,
        });
      }
    }
  }

  return diags;
}

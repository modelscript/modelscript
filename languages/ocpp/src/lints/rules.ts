// SPDX-License-Identifier: AGPL-3.0-or-later

import { OcppErrorCode } from "../errors.js";
import type { OcppNetwork } from "../types.js";

export interface OcppDiagnostic {
  code: number;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
}

export function lintOcpp(network: OcppNetwork): OcppDiagnostic[] {
  const diags: OcppDiagnostic[] = [];

  for (const st of network.stations) {
    let totalConnMaxKW = 0;

    for (const e of st.evses) {
      if (e.id <= 0) {
        diags.push({
          code: OcppErrorCode.CONNECTOR_NOT_FOUND.code,
          rule: OcppErrorCode.CONNECTOR_NOT_FOUND.rule,
          severity: OcppErrorCode.CONNECTOR_NOT_FOUND.severity,
          message: OcppErrorCode.CONNECTOR_NOT_FOUND.message(st.id, e.id, 0),
          line: e.line,
        });
      }

      for (const c of e.connectors) {
        if (c.id <= 0) {
          diags.push({
            code: OcppErrorCode.CONNECTOR_NOT_FOUND.code,
            rule: OcppErrorCode.CONNECTOR_NOT_FOUND.rule,
            severity: OcppErrorCode.CONNECTOR_NOT_FOUND.severity,
            message: OcppErrorCode.CONNECTOR_NOT_FOUND.message(st.id, e.id, c.id),
            line: c.line,
          });
        }

        totalConnMaxKW += c.maxPowerKW;

        if (c.currentSession) {
          const s = c.currentSession;

          // Rule 2: SoC range validity
          if (s.currentSoC < 0.0 || s.currentSoC > 1.0 || s.targetSoC < 0.0 || s.targetSoC > 1.0 || s.targetSoC <= s.currentSoC) {
            diags.push({
              code: OcppErrorCode.INVALID_SOC_RANGE.code,
              rule: OcppErrorCode.INVALID_SOC_RANGE.rule,
              severity: OcppErrorCode.INVALID_SOC_RANGE.severity,
              message: OcppErrorCode.INVALID_SOC_RANGE.message(s.transactionId, s.currentSoC, s.targetSoC),
              line: c.line,
            });
          }

          // Rule 3: Deadline feasibility
          const neededKWh = Math.max(0, (s.targetSoC - s.currentSoC) * s.evBatteryCapacityKWh);
          const maxDeliverableKWh = c.maxPowerKW * (s.departureMinutes / 60);
          if (neededKWh > maxDeliverableKWh + 0.1) {
            diags.push({
              code: OcppErrorCode.DEADLINE_INFEASIBLE.code,
              rule: OcppErrorCode.DEADLINE_INFEASIBLE.rule,
              severity: OcppErrorCode.DEADLINE_INFEASIBLE.severity,
              message: OcppErrorCode.DEADLINE_INFEASIBLE.message(s.transactionId, neededKWh, maxDeliverableKWh, s.departureMinutes),
              line: c.line,
            });
          }
        }
      }
    }

    // Rule 1: Power limit warning
    if (totalConnMaxKW > st.gridLimitKW) {
      diags.push({
        code: OcppErrorCode.POWER_LIMIT_EXCEEDED.code,
        rule: OcppErrorCode.POWER_LIMIT_EXCEEDED.rule,
        severity: OcppErrorCode.POWER_LIMIT_EXCEEDED.severity,
        message: OcppErrorCode.POWER_LIMIT_EXCEEDED.message(st.id, totalConnMaxKW, st.gridLimitKW),
        line: st.line,
      });
    }
  }

  return diags;
}

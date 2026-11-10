// SPDX-License-Identifier: AGPL-3.0-or-later

import { OpenAdrErrorCode } from "../errors.js";
import type { OpenAdrDeck } from "../types.js";

export interface OpenAdrDiagnostic {
  code: number;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
}

export function lintOpenAdr(deck: OpenAdrDeck): OpenAdrDiagnostic[] {
  const diags: OpenAdrDiagnostic[] = [];

  for (const e of deck.events) {
    if (e.status === "active" && e.intervals.length === 0) {
      diags.push({
        code: OpenAdrErrorCode.EMPTY_INTERVALS.code,
        rule: OpenAdrErrorCode.EMPTY_INTERVALS.rule,
        severity: OpenAdrErrorCode.EMPTY_INTERVALS.severity,
        message: OpenAdrErrorCode.EMPTY_INTERVALS.message(e.id),
        line: e.line,
      });
    }

    for (const it of e.intervals) {
      if (it.durationSeconds <= 0) {
        diags.push({
          code: OpenAdrErrorCode.NEGATIVE_DURATION.code,
          rule: OpenAdrErrorCode.NEGATIVE_DURATION.rule,
          severity: OpenAdrErrorCode.NEGATIVE_DURATION.severity,
          message: OpenAdrErrorCode.NEGATIVE_DURATION.message(e.id, it.durationSeconds),
          line: it.line,
        });
      }

      if ((e.signalType === "price" || e.signalType === "setpoint") && it.payload < 0) {
        diags.push({
          code: OpenAdrErrorCode.INVALID_SIGNAL_PAYLOAD.code,
          rule: OpenAdrErrorCode.INVALID_SIGNAL_PAYLOAD.rule,
          severity: OpenAdrErrorCode.INVALID_SIGNAL_PAYLOAD.severity,
          message: OpenAdrErrorCode.INVALID_SIGNAL_PAYLOAD.message(e.id, it.payload, e.signalType),
          line: it.line,
        });
      }
    }
  }

  return diags;
}

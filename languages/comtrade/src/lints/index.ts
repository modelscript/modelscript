// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic Linter for IEEE C37.111 / IEC 60255-24 COMTRADE Records.
 */

import type { ComtradeConfig, ComtradeRecord } from "../types.js";

export interface ComtradeDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  channelName?: string | undefined;
  line?: number | undefined;
}

export const ComtradeErrorCode = {
  EMPTY_RECORD: "CT4001",
  NON_MONOTONIC_TIME: "CT2001",
  CHANNEL_COUNT_MISMATCH: "CT3001",
  ZERO_MULTIPLIER: "CT3001",
  INVALID_LINE_FREQUENCY: "CT3002",
  INDEX_MISMATCH: "CT1001",
  INVALID_SAMPLE_RATE: "CT4001",
} as const;

export const COMTRADE_ERROR_CODES = ComtradeErrorCode;

/**
 * Validates a ComtradeConfig schema for standard compliance.
 */
export function lintComtradeCfg(cfg: ComtradeConfig): ComtradeDiagnostic[] {
  const diagnostics: ComtradeDiagnostic[] = [];

  const analogs = cfg.analogChannels ?? cfg.analogs ?? [];
  const digitals = cfg.digitalChannels ?? cfg.digitals ?? [];
  const nAnalog = cfg.analogCount ?? analogs.length;
  const nDigital = cfg.digitalCount ?? digitals.length;
  const nTotal = cfg.totalChannels ?? nAnalog + nDigital;

  // CT1001: Header total channels mismatch
  if (nTotal !== nAnalog + nDigital) {
    diagnostics.push({
      code: ComtradeErrorCode.INDEX_MISMATCH,
      severity: "error",
      message: `Declared total channels (${nTotal}) does not match sum of analog (${nAnalog}) + digital (${nDigital}) channels.`,
      line: 2,
    });
  }

  // CT3002: Line frequency validation
  const lineFreq = cfg.lineFrequencyHz ?? cfg.nominalFrequency ?? 60;
  if (lineFreq <= 0) {
    diagnostics.push({
      code: ComtradeErrorCode.INVALID_LINE_FREQUENCY,
      severity: "error",
      message: `Invalid non-positive line frequency (${lineFreq} Hz). Expected 50 or 60 Hz.`,
      line: 3 + nAnalog + nDigital,
    });
  }

  // CT4001: Sampling rates validation
  const rates = cfg.samplingRates ?? cfg.sampleRates ?? [];
  if (rates.length === 0) {
    diagnostics.push({
      code: ComtradeErrorCode.INVALID_SAMPLE_RATE,
      severity: "error",
      message: "No sampling rates defined in COMTRADE configuration.",
      line: 4 + nAnalog + nDigital,
    });
  } else {
    for (let r = 0; r < rates.length; r++) {
      const rateHz = (rates[r] as any).rateHz ?? (rates[r] as any).rate ?? 0;
      if (rateHz <= 0) {
        diagnostics.push({
          code: ComtradeErrorCode.INVALID_SAMPLE_RATE,
          severity: "error",
          message: `Sampling rate at index ${r} must be strictly positive (got ${rateHz} Hz).`,
          line: 5 + nAnalog + nDigital + r,
        });
      }
    }
  }

  // Check analog multiplier
  for (const ch of analogs) {
    const multA = ch.multiplierA ?? ch.a ?? 1.0;
    if (multA === 0) {
      diagnostics.push({
        code: ComtradeErrorCode.ZERO_MULTIPLIER,
        severity: "warning",
        message: `Analog channel '${ch.name ?? ch.chId}' has zero multiplier A=0.0. Measurements will be flat offset.`,
        channelName: ch.name ?? ch.chId,
      });
    }
  }

  return diagnostics;
}

/**
 * Validates a ComtradeRecord for standard compliance, sampling monotonicity, and scaling sanity.
 */
export function lintComtradeRecord(record: ComtradeRecord): ComtradeDiagnostic[] {
  const cfg = record.config ?? record.cfg;
  const diagnostics: ComtradeDiagnostic[] = cfg ? lintComtradeCfg(cfg) : [];

  const times = record.timeSec ?? record.timestamps ?? [];
  const nSamples = times.length;

  if (nSamples === 0) {
    diagnostics.push({
      code: ComtradeErrorCode.EMPTY_RECORD,
      severity: "error",
      message: "COMTRADE record contains zero time samples.",
    });
    return diagnostics;
  }

  // CT2001: Timestamp monotonicity
  for (let i = 1; i < nSamples; i++) {
    if (times[i]! < times[i - 1]!) {
      diagnostics.push({
        code: ComtradeErrorCode.NON_MONOTONIC_TIME,
        severity: "error",
        message: `Retrograde/non-monotonic timestamp at sample ${i}: t[${i}]=${times[i]} < t[${i - 1}]=${times[i - 1]}.`,
      });
      break;
    }
  }

  // CT3001: Channel count mismatch in data
  if (cfg) {
    const expectedAnalogs = cfg.analogCount ?? (cfg.analogChannels ?? cfg.analogs ?? []).length;
    if (Array.isArray(record.analogData) && record.analogData.length !== expectedAnalogs) {
      diagnostics.push({
        code: ComtradeErrorCode.CHANNEL_COUNT_MISMATCH,
        severity: "error",
        message: `Analog data channel series count (${record.analogData.length}) does not match CFG analog count (${expectedAnalogs}).`,
      });
    }

    const expectedDigitals = cfg.digitalCount ?? (cfg.digitalChannels ?? cfg.digitals ?? []).length;
    if (Array.isArray(record.digitalData) && record.digitalData.length !== expectedDigitals) {
      diagnostics.push({
        code: ComtradeErrorCode.CHANNEL_COUNT_MISMATCH,
        severity: "error",
        message: `Digital data channel series count (${record.digitalData.length}) does not match CFG digital count (${expectedDigitals}).`,
      });
    }
  }

  return diagnostics;
}

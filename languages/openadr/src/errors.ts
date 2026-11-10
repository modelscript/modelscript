// SPDX-License-Identifier: AGPL-3.0-or-later

export const OpenAdrErrorCode = {
  PARSE_ERROR: {
    code: 1001,
    rule: "openadr-parse-error",
    severity: "error" as const,
    message: (err: string) => `Syntax or XML/JSON format error in OpenADR payload: ${err}.`,
  },
  NEGATIVE_DURATION: {
    code: 3001,
    rule: "openadr-negative-duration",
    severity: "error" as const,
    message: (eventId: string, duration: number) =>
      `Event '${eventId}' interval has invalid non-positive duration: ${duration}s. Duration must be strictly positive.`,
  },
  INVALID_SIGNAL_PAYLOAD: {
    code: 3002,
    rule: "openadr-invalid-signal-payload",
    severity: "warning" as const,
    message: (eventId: string, payload: number, signalType: string) =>
      `Event '${eventId}' has negative payload (${payload}) for signalType '${signalType}'.`,
  },
  EMPTY_INTERVALS: {
    code: 4001,
    rule: "openadr-empty-intervals",
    severity: "error" as const,
    message: (eventId: string) =>
      `Event '${eventId}' declared with status 'active' has zero intervals specified.`,
  },
};

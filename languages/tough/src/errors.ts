// SPDX-License-Identifier: AGPL-3.0-or-later

export const ToughErrorCode = {
  PARSE_ERROR: {
    code: 1001,
    rule: "tough-parse-error",
    severity: "error" as const,
    message: (err: string) => `Syntax or block structure error in TOUGH deck: ${err}.`,
  },
  ROCK_NOT_FOUND: {
    code: 2001,
    rule: "tough-rock-not-found",
    severity: "error" as const,
    message: (elem: string, rock: string) =>
      `Element '${elem}' references rock material '${rock}', which is not defined in ROCKS block.`,
  },
  INVALID_POROSITY: {
    code: 3001,
    rule: "tough-invalid-porosity",
    severity: "error" as const,
    message: (rock: string, phi: number) =>
      `Rock '${rock}' has invalid porosity ${phi}. Porosity must satisfy 0.0 < phi < 1.0.`,
  },
  DANGLING_CONNECTION: {
    code: 4001,
    rule: "tough-dangling-connection",
    severity: "error" as const,
    message: (elem: string, connIndex: number) =>
      `Connection #${connIndex} references undefined grid block '${elem}'.`,
  },
  NEGATIVE_TEMPERATURE: {
    code: 5001,
    rule: "tough-negative-temperature",
    severity: "warning" as const,
    message: (elem: string, tempC: number) =>
      `Element '${elem}' initial temperature is sub-zero (${tempC} °C). Sub-zero temperatures risk freezing phase changes not handled by standard EOS1.`,
  },
};

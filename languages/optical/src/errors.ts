// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes and messages for optical transport networks and OTDR traces.
 */
export const OpticalErrorCode = {
  OSNR_MARGIN_EXHAUSTED: {
    code: 1001,
    rule: "osnr-margin-exhausted",
    severity: "error" as const,
    message: (channelId: string, gsnrDb: string, requiredDb: string) =>
      `Channel '${channelId}' GSNR (${gsnrDb} dB) is below required FEC threshold (${requiredDb} dB).`,
  },
  EDFA_INPUT_POWER_UNDERFLOW: {
    code: 1002,
    rule: "edfa-input-power-underflow",
    severity: "warning" as const,
    message: (ampId: string, inputDbm: string, sensitivityDbm: string) =>
      `Amplifier '${ampId}' input power (${inputDbm} dBm) is below operational sensitivity threshold (${sensitivityDbm} dBm).`,
  },
  NONLINEAR_POWER_THRESHOLD_EXCEEDED: {
    code: 1003,
    rule: "nonlinear-power-threshold-exceeded",
    severity: "warning" as const,
    message: (spanId: string, powerDbm: string, thresholdDbm: string) =>
      `Span '${spanId}' total launch power (${powerDbm} dBm) exceeds non-linear Kerr threshold (${thresholdDbm} dBm).`,
  },
  ROADM_COLORLESS_CONTENTION: {
    code: 1004,
    rule: "roadm-colorless-contention",
    severity: "error" as const,
    message: (nodeId: string, srgNum: number, freqThz: string, ch1: string, ch2: string) =>
      `ROADM '${nodeId}' SRG bank ${srgNum} has frequency contention at ${freqThz} THz between '${ch1}' and '${ch2}'.`,
  },
  UNCOMPENSATED_CHROMATIC_DISPERSION: {
    code: 1005,
    rule: "uncompensated-chromatic-dispersion",
    severity: "error" as const,
    message: (channelId: string, accumPsPerNm: string, limitPsPerNm: string) =>
      `Channel '${channelId}' accumulated chromatic dispersion (${accumPsPerNm} ps/nm) exceeds DSP buffer limit (${limitPsPerNm} ps/nm).`,
  },
  OTDR_HIGH_LOSS_EVENT: {
    code: 1006,
    rule: "otdr-high-loss-event",
    severity: "error" as const,
    message: (evNum: number, distM: number, lossDb: string, maxDb: string) =>
      `OTDR Event #${evNum} at ${Math.round(distM)}m specifies high loss (${lossDb} dB), exceeding max allowable (${maxDb} dB).`,
  },
  SRLG_DIVERSITY_VIOLATION: {
    code: 1007,
    rule: "srlg-diversity-violation",
    severity: "error" as const,
    message: (ch1: string, ch2: string, srlgId: string) =>
      `Protection pair '${ch1}' and '${ch2}' share common-risk conduit/trench '${srlgId}'.`,
  },
};

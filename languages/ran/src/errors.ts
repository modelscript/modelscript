// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes and messages for RAN, antenna patterns, and microwave backhaul links.
 */
export const RanErrorCode = {
  FRESNEL_ZONE_OBSTRUCTION: {
    code: 2001,
    rule: "fresnel-zone-obstruction",
    severity: "error" as const,
    message: (linkId: string, distKm: string, ratio: string) =>
      `Microwave link '${linkId}' has terrain obstacle at ${distKm} km penetrating 1st Fresnel zone (clearance ratio ${ratio} < 0.60).`,
  },
  LINK_AVAILABILITY_SUB_FIVE_NINES: {
    code: 2002,
    rule: "link-availability-sub-five-nines",
    severity: "warning" as const,
    message: (linkId: string, avail: string, unavailMin: string) =>
      `Microwave link '${linkId}' annual availability (${avail}%) is below 99.999% SLA (${unavailMin} minutes/year outage).`,
  },
  FCC_EIRP_LIMIT_EXCEEDED: {
    code: 2003,
    rule: "fcc-eirp-limit-exceeded",
    severity: "error" as const,
    message: (linkId: string, eirpDbm: string, maxDbm: string) =>
      `Microwave link '${linkId}' EIRP (${eirpDbm} dBm) exceeds regulatory FCC Part 101 ceiling (${maxDbm} dBm).`,
  },
  POLARIZATION_MISMATCH: {
    code: 2004,
    rule: "polarization-mismatch",
    severity: "error" as const,
    message: (linkId: string, txPol: string, antPol: string) =>
      `Link '${linkId}' declares polarization '${txPol}' but antenna specifies incompatible '${antPol}'.`,
  },
  ANTENNA_DOWNTILT_OUT_OF_BOUNDS: {
    code: 2005,
    rule: "antenna-downtilt-out-of-bounds",
    severity: "warning" as const,
    message: (antenna: string, tilt: string) =>
      `Antenna '${antenna}' declares electrical downtilt (${tilt} deg) outside typical operational range [0.0, 16.0 deg].`,
  },
};

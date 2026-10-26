// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/swmm — Standard Diagnostic Error Codes (M8201–M8215).
 * Follows OpenModelica diagnostic conventions: quoted identifiers ('${id}'), period-terminated.
 */

export const SwmmErrorCode = {
  DANGLING_NODE_REFERENCE: {
    code: "M8201",
    rule: "dangling-node-reference",
    severity: "error" as const,
    message: (linkId: string, nodeId: string, role: "inlet" | "outlet") =>
      `Link '${linkId}' references undefined ${role} node '${nodeId}'.`,
  },
  ADVERSE_CONDUIT_SLOPE: {
    code: "M8202",
    rule: "adverse-conduit-slope",
    severity: "warning" as const,
    message: (conduitId: string, inElev: number, outElev: number) =>
      `Conduit '${conduitId}' has adverse slope: inlet elevation (${inElev.toFixed(2)}) is lower than outlet elevation (${outElev.toFixed(2)}).`,
  },
  MISSING_CROSS_SECTION: {
    code: "M8203",
    rule: "missing-cross-section",
    severity: "error" as const,
    message: (conduitId: string) =>
      `Conduit '${conduitId}' has no hydraulic cross-section definition in '[XSECTIONS]'.`,
  },
  UNSUPPORTED_OUTFALL_TYPE: {
    code: "M8204",
    rule: "unsupported-outfall-type",
    severity: "error" as const,
    message: (outfallId: string, type: string) =>
      `Outfall '${outfallId}' specifies unsupported boundary condition type '${type}'.`,
  },
  SURCHARGE_OVERFLOW_RISK: {
    code: "M8205",
    rule: "surcharge-overflow-risk",
    severity: "warning" as const,
    message: (junctionId: string, rimElev: number, crownElev: number) =>
      `Junction '${junctionId}' rim elevation (${rimElev.toFixed(2)}) is lower than connected conduit crown (${crownElev.toFixed(2)}), creating surcharge overflow risk.`,
  },
  DUPLICATE_NODE_ID: {
    code: "M8206",
    rule: "duplicate-node-id",
    severity: "error" as const,
    message: (nodeId: string) => `Duplicate node identifier '${nodeId}' declared in network.`,
  },
  DUPLICATE_LINK_ID: {
    code: "M8207",
    rule: "duplicate-link-id",
    severity: "error" as const,
    message: (linkId: string) => `Duplicate link identifier '${linkId}' declared in network.`,
  },
  NEGATIVE_ROUGHNESS: {
    code: "M8208",
    rule: "negative-roughness",
    severity: "error" as const,
    message: (conduitId: string, n: number) =>
      `Conduit '${conduitId}' specifies non-positive Manning's roughness coefficient (n = ${n}).`,
  },
  ZERO_LENGTH_CONDUIT: {
    code: "M8209",
    rule: "zero-length-conduit",
    severity: "error" as const,
    message: (conduitId: string, len: number) => `Conduit '${conduitId}' specifies non-positive length (${len}).`,
  },
  ISOLATED_NETWORK_NODE: {
    code: "M8210",
    rule: "isolated-network-node",
    severity: "warning" as const,
    message: (nodeId: string) => `Junction '${nodeId}' has no connected conduits or hydraulic links (isolated node).`,
  },
  SUBCATCHMENT_OUTLET_NOT_FOUND: {
    code: "M8211",
    rule: "subcatchment-outlet-not-found",
    severity: "error" as const,
    message: (subId: string, outletId: string) =>
      `Subcatchment '${subId}' references non-existent discharge outlet '${outletId}'.`,
  },
  WEIR_OFFSET_NEGATIVE: {
    code: "M8212",
    rule: "weir-offset-negative",
    severity: "error" as const,
    message: (weirId: string, offset: number) => `Weir '${weirId}' specifies negative crest height offset (${offset}).`,
  },
  INVALID_DISCHARGE_COEFFICIENT: {
    code: "M8213",
    rule: "invalid-discharge-coefficient",
    severity: "error" as const,
    message: (linkId: string, cd: number) =>
      `Link '${linkId}' specifies non-positive discharge coefficient (Cd = ${cd}).`,
  },
} as const;

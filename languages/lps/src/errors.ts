// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lps — Standard Diagnostic Error Codes (M8001–M8020).
 */

export const LpsErrorCode = {
  MAOP_EXCEEDED: {
    code: "M8001",
    rule: "maop-exceeded",
    severity: "error" as const,
    message: (pipeName: string, maxP: number, maop: number) =>
      `Pipe '${pipeName}' operating pressure (${maxP.toFixed(1)} bar) exceeds Maximum Allowable Operating Pressure (${maop.toFixed(1)} bar).`,
  },
  COMPRESSOR_SURGE_HAZARD: {
    code: "M8002",
    rule: "compressor-surge-hazard",
    severity: "error" as const,
    message: (compName: string, flow: number, surgeFlow: number) =>
      `Compressor '${compName}' operating flow (${flow.toFixed(1)} m³/h) is below the aerodynamic surge limit (${surgeFlow.toFixed(1)} m³/h).`,
  },
  COMPRESSOR_STONEWALL_LIMIT: {
    code: "M8003",
    rule: "compressor-stonewall-limit",
    severity: "warning" as const,
    message: (compName: string, flow: number, chokeFlow: number) =>
      `Compressor '${compName}' throughput (${flow.toFixed(1)} m³/h) approaches sonic choke/stonewall limit (${chokeFlow.toFixed(1)} m³/h).`,
  },
  UNCONNECTED_PIPELINE_NODE: {
    code: "M8004",
    rule: "unconnected-pipeline-node",
    severity: "error" as const,
    message: (nodeName: string) => `Node '${nodeName}' is isolated and has no connecting pipes or equipment links.`,
  },
  DELIVERY_PRESSURE_DEFICIT: {
    code: "M8005",
    rule: "delivery-pressure-deficit",
    severity: "error" as const,
    message: (nodeName: string) =>
      `Delivery node '${nodeName}' is hydraulically unreachable from any supply or storage cavern.`,
  },
  EROSIONAL_VELOCITY_HAZARD: {
    code: "M8006",
    rule: "erosional-velocity-hazard",
    severity: "warning" as const,
    message: (pipeName: string, vel: number, limit: number) =>
      `Gas velocity in pipe '${pipeName}' (${vel.toFixed(1)} m/s) exceeds API RP 14E erosional limit (${limit.toFixed(1)} m/s).`,
  },
  LIQUID_COLUMN_SEPARATION: {
    code: "M8007",
    rule: "liquid-column-separation",
    severity: "error" as const,
    message: (pipeName: string, pMin: number, vPres: number) =>
      `Transient pressure in pipe '${pipeName}' (${pMin.toFixed(2)} bar) drops below liquid vapor pressure (${vPres.toFixed(2)} bar), risking cavitation.`,
  },
  HYDROGEN_EMBRITTLEMENT_RISK: {
    code: "M8008",
    rule: "hydrogen-embrittlement-risk",
    severity: "warning" as const,
    message: (pipeName: string, fraction: number) =>
      `Hydrogen blend fraction in pipe '${pipeName}' (${(fraction * 100).toFixed(1)}%) exceeds 10% on steel without fracture toughness certification.`,
  },
  BATCH_TRANSMIX_EXCESS: {
    code: "M8009",
    rule: "batch-transmix-excess",
    severity: "warning" as const,
    message: (pipeName: string, detail: string) =>
      `Batch transmix interface on pipe '${pipeName}' exceeds allowable contamination threshold: ${detail}.`,
  },
  JOULE_THOMSON_FREEZING: {
    code: "M8010",
    rule: "joule-thomson-freezing",
    severity: "warning" as const,
    message: (regName: string, tOut: number) =>
      `Joule-Thomson throttling across regulator '${regName}' reduces outlet temperature to ${tOut.toFixed(1)}°C, risking ice/hydrate blockage.`,
  },
  PUMP_NPSH_DEFICIT: {
    code: "M8011",
    rule: "pump-npsh-deficit",
    severity: "error" as const,
    message: (pumpName: string, npsha: number, npshr: number) =>
      `Pump '${pumpName}' net positive suction head available (${npsha.toFixed(1)} m) is below required NPSHr (${npshr.toFixed(1)} m).`,
  },
  LINE_PACK_DEPLETION_RISK: {
    code: "M8012",
    rule: "line-pack-depletion-risk",
    severity: "warning" as const,
    message: (detail: string) => `Network total line pack is depleting rapidly: ${detail}.`,
  },
} as const;

export type LpsErrorCodeKey = keyof typeof LpsErrorCode;

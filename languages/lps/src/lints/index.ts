// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lps — Pre-Flight Diagnostic Linter for PipelineStudio Models.
 *
 * Rules:
 * - M8001: maop-exceeded (Operating or transient pressure exceeds Maximum Allowable Operating Pressure)
 * - M8002: compressor-surge-hazard (Flow point below compressor surge limit or excessive pressure ratio)
 * - M8003: compressor-stonewall-limit (Throughput exceeds maximum compressor choke/stonewall limit)
 * - M8004: unconnected-pipeline-node (Topological node has 0 connections or unreachable delivery)
 * - M8005: delivery-pressure-deficit (Delivery node cannot achieve minimum contractual pressure)
 * - M8006: erosional-velocity-hazard (Gas velocity exceeds API RP 14E erosional limits)
 * - M8007: liquid-column-separation (Transient pressure drops below liquid vapor pressure, risking cavitation)
 * - M8008: hydrogen-embrittlement-risk (Hydrogen blend fraction > 10% on steel without fracture certification)
 * - M8009: batch-transmix-excess (Small liquid batch size or excessive interface mixing)
 * - M8010: joule-thomson-freezing (Large pressure throttling drop across regulator without active preheater)
 * - M8011: pump-npsh-deficit (Available NPSH is below required NPSH)
 * - M8012: line-pack-depletion-risk (Network total delivery demand exceeds supply with no storage buffer)
 */

import { PipelineGraph } from "../graph/pipeline-graph.js";
import type { LpsDiagnostic, LpsModel } from "../types.js";

export function lintLpsModel(model: LpsModel): LpsDiagnostic[] {
  const diagnostics: LpsDiagnostic[] = [];
  const graph = new PipelineGraph(model);

  // M8004: Unconnected Pipeline Node
  for (const node of model.nodes) {
    const inLinks = graph.inbound.get(node.name) ?? [];
    const outLinks = graph.outbound.get(node.name) ?? [];
    if (inLinks.length === 0 && outLinks.length === 0) {
      diagnostics.push({
        code: "M8004",
        rule: "unconnected-pipeline-node",
        severity: "error",
        message: `Node '${node.name}' is isolated and has no connecting pipes or equipment links.`,
        target: node.name,
      });
    }
  }

  // M8005: Delivery Reachability Check
  const { deliverable, unreachableDeliveries } = graph.verifyDeliverability();
  if (!deliverable) {
    for (const d of unreachableDeliveries) {
      diagnostics.push({
        code: "M8005",
        rule: "delivery-pressure-deficit",
        severity: "error",
        message: `Delivery node '${d}' is hydraulically unreachable from any supply or storage cavern.`,
        target: d,
      });
    }
  }

  // M8001: MAOP Exceeded
  for (const pipe of model.pipes) {
    const fromNode = graph.nodes.get(pipe.fromNode);
    const toNode = graph.nodes.get(pipe.toNode);

    if (pipe.diameter <= 0 || pipe.length <= 0) {
      diagnostics.push({
        code: "M8001",
        rule: "maop-exceeded",
        severity: "error",
        message: `Pipe '${pipe.name}' has invalid dimensions (diameter: ${pipe.diameter}m, length: ${pipe.length}m).`,
        target: pipe.name,
      });
    }

    if (fromNode?.pressure != null && fromNode.pressure > pipe.maop * 1.001) {
      diagnostics.push({
        code: "M8001",
        rule: "maop-exceeded",
        severity: "error",
        message: `Inlet node '${fromNode.name}' pressure (${(fromNode.pressure / 1e5).toFixed(1)} bar) exceeds pipe '${pipe.name}' MAOP (${(pipe.maop / 1e5).toFixed(1)} bar).`,
        target: pipe.name,
      });
    }

    if (toNode?.pressure != null && toNode.pressure > pipe.maop * 1.001) {
      diagnostics.push({
        code: "M8001",
        rule: "maop-exceeded",
        severity: "error",
        message: `Outlet node '${toNode.name}' pressure (${(toNode.pressure / 1e5).toFixed(1)} bar) exceeds pipe '${pipe.name}' MAOP (${(pipe.maop / 1e5).toFixed(1)} bar).`,
        target: pipe.name,
      });
    }
  }

  // M8002 & M8003: Compressor Surge and Stonewall Limits
  for (const comp of model.compressors) {
    const suction = graph.nodes.get(comp.fromNode);
    const discharge = graph.nodes.get(comp.toNode);

    if (comp.status === "RUNNING") {
      if (suction?.pressure != null && discharge?.pressure != null) {
        const ratio = discharge.pressure / suction.pressure;
        if (ratio > comp.maxPressureRatio) {
          diagnostics.push({
            code: "M8002",
            rule: "compressor-surge-hazard",
            severity: "warning",
            message: `Compressor '${comp.name}' operating pressure ratio (${ratio.toFixed(2)}) exceeds maximum allowable ratio (${comp.maxPressureRatio.toFixed(2)}).`,
            target: comp.name,
          });
        }
      }

      if (comp.surgeFlow != null && comp.setpoint < comp.surgeFlow && comp.controlMode === "MASS_FLOW") {
        diagnostics.push({
          code: "M8002",
          rule: "compressor-surge-hazard",
          severity: "warning",
          message: `Compressor '${comp.name}' mass flow setpoint (${comp.setpoint} kg/s) is below surge limit (${comp.surgeFlow} kg/s).`,
          target: comp.name,
        });
      }

      if (comp.stonewallFlow != null && comp.setpoint > comp.stonewallFlow && comp.controlMode === "MASS_FLOW") {
        diagnostics.push({
          code: "M8003",
          rule: "compressor-stonewall-limit",
          severity: "warning",
          message: `Compressor '${comp.name}' throughput setpoint (${comp.setpoint} kg/s) exceeds maximum stonewall choke limit (${comp.stonewallFlow} kg/s).`,
          target: comp.name,
        });
      }
    }
  }

  // M8011: Pump NPSH Deficit (TLNET)
  for (const pump of model.pumps) {
    if (pump.status === "RUNNING") {
      const suction = graph.nodes.get(pump.fromNode);
      if (suction?.pressure != null) {
        // Compute NPSH available (approx P / (rho * g))
        const rho = 850.0; // typical liquid density
        const g = 9.80665;
        const npsha = suction.pressure / (rho * g);
        if (npsha < pump.npshRequired) {
          diagnostics.push({
            code: "M8011",
            rule: "pump-npsh-deficit",
            severity: "error",
            message: `Pump '${pump.name}' available NPSH (${npsha.toFixed(1)}m) is below required NPSH (${pump.npshRequired.toFixed(1)}m), risking cavitation damage.`,
            target: pump.name,
          });
        }
      }
    }
  }

  // M8010: Joule-Thomson Freezing Across Pressure Regulators
  for (const reg of model.regulators) {
    const upstream = graph.nodes.get(reg.fromNode);
    if (upstream?.pressure != null) {
      const deltaP = upstream.pressure - reg.setpointPressure;
      // If deltaP > 25 bar without preheater, high risk of hydrate/freezing
      if (deltaP > 25e5 && !reg.preheaterInstalled) {
        const estTempDrop = (deltaP / 1e5) * 0.45; // ~0.45 K/bar Joule-Thomson cooling for natural gas
        diagnostics.push({
          code: "M8010",
          rule: "joule-thomson-freezing",
          severity: "warning",
          message: `Regulator '${reg.name}' has severe throttling pressure drop (${(deltaP / 1e5).toFixed(1)} bar, ~${estTempDrop.toFixed(1)} K drop) without a preheater, creating severe ice/hydrate blockage risk.`,
          target: reg.name,
        });
      }
    }
  }

  // M8008: Hydrogen Embrittlement and Blending Limit
  if (model.gasComposition?.hydrogen != null && model.gasComposition.hydrogen > 0.1) {
    const h2Percent = (model.gasComposition.hydrogen * 100).toFixed(1);
    diagnostics.push({
      code: "M8008",
      rule: "hydrogen-embrittlement-risk",
      severity: "warning",
      message: `Gas mixture contains ${h2Percent}% hydrogen, exceeding standard 10% threshold. Verify fracture mechanics, weld toughness, and compressor power re-rating.`,
      target: "gasComposition",
    });
  }

  // M8009: Batch Transmix Risk (TLNET)
  if (model.batches) {
    for (const b of model.batches.injections) {
      if (b.volume < 1000) {
        diagnostics.push({
          code: "M8009",
          rule: "batch-transmix-excess",
          severity: "warning",
          message: `Liquid batch '${b.batchId}' volume (${b.volume} m³) is below 1000 m³; interface transmix contamination will degrade product recovery.`,
          target: b.batchId,
        });
      }
    }
  }

  // M8007: Liquid Column Separation / Vapor Cavitation (TLNET)
  if (model.type === "TLNET" || model.batches) {
    for (const node of model.nodes) {
      if (node.pressure != null && node.pressure < 80e3) {
        diagnostics.push({
          code: "M8007",
          rule: "liquid-column-separation",
          severity: "error",
          message: `Node '${node.name}' pressure (${(node.pressure / 1e3).toFixed(1)} kPa) is dangerously close to vapor pressure, risking vapor pocket formation and water hammer column separation.`,
          target: node.name,
        });
      }
    }
  }

  // M8012: Line Pack Depletion Risk
  let totalSupply = 0;
  let totalDelivery = 0;
  for (const n of model.nodes) {
    if (n.type === "SUPPLY" && n.flowRate != null && n.flowRate > 0) {
      totalSupply += n.flowRate;
    } else if (n.type === "DELIVERY" && n.flowRate != null && n.flowRate > 0) {
      totalDelivery += n.flowRate;
    }
  }
  if (totalDelivery > totalSupply * 1.05 && totalSupply > 0) {
    diagnostics.push({
      code: "M8012",
      rule: "line-pack-depletion-risk",
      severity: "warning",
      message: `Total delivery demand (${totalDelivery.toFixed(1)} kg/s) exceeds continuous supply (${totalSupply.toFixed(1)} kg/s); line pack storage will deplete over extended operation.`,
    });
  }

  // M8006: High Erosional Velocity Screening
  for (const p of model.pipes) {
    const fromNode = graph.nodes.get(p.fromNode);
    if (fromNode?.flowRate != null && fromNode.flowRate > 0) {
      const area = Math.PI * (p.diameter / 2) ** 2;
      const rho = 45.0; // typical high-pressure gas density ~45 kg/m3 at 60 bar
      const velocity = fromNode.flowRate / (rho * area);
      if (velocity > 20.0) {
        diagnostics.push({
          code: "M8006",
          rule: "erosional-velocity-hazard",
          severity: "warning",
          message: `Pipe '${p.name}' estimated gas velocity (${velocity.toFixed(1)} m/s) exceeds API RP 14E erosional noise guideline (20.0 m/s).`,
          target: p.name,
        });
      }
    }
  }

  return diagnostics;
}

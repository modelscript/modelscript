// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lps — SysML v2 Polyglot Projection for Pipeline Networks.
 *
 * Generates formal SysML v2 architecture, requirements, port interfaces,
 * and operational state machines from PipelineStudio (.lps) models.
 */

import type { LpsModel } from "../types.js";

export function lpsToSysml2(model: LpsModel): string {
  const isGas = model.type === "TGNET";
  const lines: string[] = [
    `// Auto-generated SysML v2 model from PipelineStudio study: '${model.title}'`,
    `package '${model.id.replace(/[^a-zA-Z0-9_]/g, "_")}' {`,
    `  private import ScalarValues::*;`,
    `  private import ISQ::*;`,
    ``,
    `  // 1. Port Definitions`,
    `  port def PipelineFluidPort {`,
    `    out attribute pressure : Pressure;`,
    `    out attribute massFlowRate : MassFlowRate;`,
    `    out attribute temperature : Temperature;`,
    ...(isGas ? [`    out attribute grossHeatingValue : Real;`] : []),
    `  }`,
    ``,
    `  // 2. Component Definitions`,
    `  part def PipeSegment {`,
    `    attribute length : Length;`,
    `    attribute diameter : Length;`,
    `    attribute maop : Pressure;`,
    `    port inlet : ~PipelineFluidPort;`,
    `    port outlet : PipelineFluidPort;`,
    `  }`,
    ``,
    ...(isGas
      ? [
          `  part def CompressorStationBlock {`,
          `    attribute maxPower : Power;`,
          `    attribute pressureRatio : Real;`,
          `    port suction : ~PipelineFluidPort;`,
          `    port discharge : PipelineFluidPort;`,
          `  }`,
        ]
      : [
          `  part def PumpStationBlock {`,
          `    attribute maxPower : Power;`,
          `    attribute ratedHead : Length;`,
          `    port suction : ~PipelineFluidPort;`,
          `    port discharge : PipelineFluidPort;`,
          `  }`,
        ]),
    ``,
    `  // 3. System Architecture`,
    `  part def PipelineTransmissionNetwork {`,
  ];

  // Emit pipes as parts
  for (const pipe of model.pipes) {
    lines.push(`    part ${pipe.name.replace(/[^a-zA-Z0-9_]/g, "_")} : PipeSegment {`);
    lines.push(`      attribute :>> length = ${(pipe.length / 1000).toFixed(2)} [km];`);
    lines.push(`      attribute :>> diameter = ${(pipe.diameter * 1000).toFixed(1)} [mm];`);
    lines.push(`      attribute :>> maop = ${(pipe.maop / 1e5).toFixed(1)} [bar];`);
    lines.push(`    }`);
  }

  // Emit compressors
  for (const comp of model.compressors) {
    lines.push(`    part ${comp.name.replace(/[^a-zA-Z0-9_]/g, "_")} : CompressorStationBlock {`);
    lines.push(`      attribute :>> maxPower = ${(comp.maxPower / 1e6).toFixed(1)} [MW];`);
    lines.push(`      attribute :>> pressureRatio = ${comp.maxPressureRatio.toFixed(2)};`);
    lines.push(`    }`);
  }

  lines.push(`  }`);
  lines.push(``);

  // 4. Formal Requirements
  lines.push(`  // 4. Formal Safety & Deliverability Requirements`);
  lines.push(`  requirement def PipelineMaopIntegrityRequirement {`);
  lines.push(`    doc /* ASME B31.8 / B31.4 Pipeline Integrity: Operating pressure must never exceed MAOP */`);
  lines.push(`    attribute maxOperatingPressure : Pressure;`);
  lines.push(`    attribute maopRating : Pressure;`);
  lines.push(`    require constraint { maxOperatingPressure <= maopRating }`);
  lines.push(`  }`);
  lines.push(``);

  lines.push(`  requirement def MinimumCityGateDeliveryRequirement {`);
  lines.push(`    doc /* Security of Supply: Delivery pressure at city gates must satisfy contractual minimum */`);
  lines.push(`    attribute actualDeliveryPressure : Pressure;`);
  lines.push(`    attribute minContractPressure : Pressure;`);
  lines.push(`    require constraint { actualDeliveryPressure >= minContractPressure }`);
  lines.push(`  }`);
  lines.push(``);

  if (isGas) {
    lines.push(`  requirement def HydrogenBlendingLimitRequirement {`);
    lines.push(`    doc /* Decarbonization: Hydrogen injection must not exceed certified steel fracture limits */`);
    lines.push(`    attribute hydrogenMolarFraction : Real;`);
    lines.push(`    require constraint { hydrogenMolarFraction <= 0.10 }`);
    lines.push(`  }`);
    lines.push(``);
  }

  // 5. Operational State Machine
  lines.push(`  // 5. Operational State Machine`);
  lines.push(`  state def PipelineOperationalProcedure {`);
  lines.push(`    entry; then SteadyTransmission;`);
  lines.push(``);
  lines.push(`    state SteadyTransmission;`);
  lines.push(`    accept PackPipelineCommand then LinePacking;`);
  lines.push(`    accept PeakDemandEvent then PeakDemandDrafting;`);
  lines.push(`    accept EmergencyTripEvent then EmergencySectionalizing;`);
  lines.push(``);
  lines.push(`    state LinePacking;`);
  lines.push(`    accept PackCompleteEvent then SteadyTransmission;`);
  lines.push(``);
  lines.push(`    state PeakDemandDrafting;`);
  lines.push(`    accept DemandNormalizedEvent then SteadyTransmission;`);
  lines.push(`    accept LinePackDepletedAlert then ControlledCurtailment;`);
  lines.push(``);
  lines.push(`    state ControlledCurtailment;`);
  lines.push(`    accept SupplyRestoredEvent then LinePacking;`);
  lines.push(``);
  lines.push(`    state EmergencySectionalizing;`);
  lines.push(`    accept SafeIsolationConfirmed then ControlledVenting;`);
  lines.push(``);
  lines.push(`    state ControlledVenting;`);
  lines.push(`  }`);
  lines.push(`}`);

  return lines.join("\n");
}

export const projectLpsToSysml2 = lpsToSysml2;

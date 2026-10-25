// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/exchange — LPS / PipelineStudio (TGNET & TLNET) Co-Simulation Participant.
 *
 * Implements FMI 2.0 / 3.0 Co-Simulation participant contract (CoSimParticipant),
 * coupling transient gas & liquid transmission pipelines to Modelica dynamic balance-of-plant,
 * electric power grids (@modelscript/psse CCGT turbines), and electrolyzer H2 injection networks.
 */

import {
  Aga8DetailedEos,
  DEFAULT_NATURAL_GAS,
  LinePackEngine,
  parseLps,
  SteadyNetworkSolver,
  type GasComposition,
  type LinePackAnalysis,
  type LpsModel,
} from "@modelscript/lps";
import type { CosimValue } from "../coupling.js";
import type { ParticipantMetadata } from "../mqtt/protocol.js";
import type { CoSimParticipant } from "../participant.js";

/** Configuration options for the LPS / PipelineStudio co-simulation participant. */
export interface LpsCoSimOptions {
  /** Execution mode: 'steady' (fast algebraic relaxation) or 'transient' (differential dynamics). */
  mode?: "steady" | "transient" | undefined;
  /** MAOP limit in Pascal [Pa] for safety headroom calculations (default: 80 bar = 8.0e6 Pa). */
  maopLimit?: number | undefined;
  /** Minimum allowable delivery pressure in Pascal [Pa] (contractual threshold, default: 35 bar = 3.5e6 Pa). */
  minDeliveryPressure?: number | undefined;
  /** Baseline higher heating value of pure natural gas in MJ/Sm³ (default: 39.8 MJ/Sm³). */
  nominalHhvMjSm3?: number | undefined;
  /** Nominal Combined-Cycle Gas Turbine heat rate in MJ/kWh (default: 7.2 MJ/kWh = 50% thermal efficiency). */
  ccgtHeatRateMjKwh?: number | undefined;
  /** Name of the primary delivery/city gate node for gas-to-power off-take. */
  deliveryNode?: string | undefined;
  /** Name of the primary supply/receipt node. */
  supplyNode?: string | undefined;
  /** Pipeline line pack volume / capacity scaling factor (default: 1.0). */
  inventoryScale?: number | undefined;
}

/**
 * High-Performance Pipeline Transmission Co-Simulation Participant.
 *
 * Bridges continental natural gas & hydrogen-blended transmission grids
 * with thermal power plants, renewable electrolyzers, and regional energy markets.
 */
export class LpsCoSimParticipant implements CoSimParticipant {
  public readonly id: string;
  public readonly modelName: string;
  public readonly metadata: ParticipantMetadata;

  private model: LpsModel;
  private options: LpsCoSimOptions;
  public currentTime = 0;

  // Active gas composition (evolves with H2 injection)
  private activeComposition: GasComposition;

  // State variables (SI & engineering units)
  private supplyPressurePa = 70.0e5; // 70 bar
  private deliveryPressurePa = 55.0e5; // 55 bar
  private deliveryGasDensity = 42.5; // kg/m³
  private linePackMmsm3 = 20.0; // Million standard cubic meters
  private deliverableLinePackMmsm3 = 8.5; // MMSm³ above minimum delivery pressure
  private deliverableEnergyMwh = 95000.0; // MWh of deliverable energy stored
  private maopHeadroomBar = 25.0; // Bar margin below MAOP
  private exhaustionTimeHours = 48.0; // Hours before line pack exhaustion
  private gasWobbeIndex = 51.5; // MJ/Sm³
  private h2MolarFraction = 0.0; // Molar fraction 0..1
  private flowVelocityMS = 8.2; // Gas linear flow velocity m/s

  // Boundary input setpoints
  private ccgtFuelDemandMw = 0.0; // MW electric generation demand from power grid
  private deliveryWithdrawalKgS = 120.0; // kg/s baseline industrial & residential withdrawal
  private h2InjectionKgS = 0.0; // kg/s green hydrogen injection from electrolyzers
  private ambientTemperatureK = 288.15; // 15 °C ambient
  private inputBuffer: Map<string, number> = new Map();

  // Internal storage tracker
  private totalGasInventoryKg = 1.5e7; // 15,000 metric tons
  private initialGasInventoryKg = 1.5e7;
  private initialDeliveryPressurePa = 55.0e5;

  constructor(id: string, modelOrSource: LpsModel | string, options: LpsCoSimOptions = {}) {
    this.id = id;
    this.model = typeof modelOrSource === "string" ? parseLps(modelOrSource) : modelOrSource;
    this.modelName = this.model.title || "PipelineStudio Network";
    this.options = {
      mode: "steady",
      maopLimit: 80.0e5, // 80 bar
      minDeliveryPressure: 35.0e5, // 35 bar
      nominalHhvMjSm3: 39.8,
      ccgtHeatRateMjKwh: 7.2,
      ...options,
    };

    this.activeComposition = { ...(this.model.gasComposition ?? DEFAULT_NATURAL_GAS) };

    // Discover supply and delivery nodes if not explicitly specified
    if (!this.options.supplyNode) {
      const supply = this.model.nodes.find((n) => n.type === "SUPPLY" || n.pressure !== undefined);
      this.options.supplyNode = supply?.name ?? this.model.nodes[0]?.name ?? "Supply";
    }
    if (!this.options.deliveryNode) {
      const delivery = this.model.nodes.find((n) => n.type === "DELIVERY" || n.flowRate !== undefined);
      this.options.deliveryNode = delivery?.name ?? this.model.nodes[this.model.nodes.length - 1]?.name ?? "Delivery";
    }

    this.metadata = {
      participantId: id,
      modelName: this.modelName,
      type: "external",
      classKind: "field",
      timestamp: new Date().toISOString(),
      description: "PipelineStudio LPS / TGNET Gas Transmission Co-Simulation Participant",
      variables: [
        // Boundary Inputs
        { name: "ccgt_fuel_demand_mw", causality: "input", type: "Real" },
        { name: "delivery_withdrawal_kg_s", causality: "input", type: "Real" },
        { name: "h2_injection_kg_s", causality: "input", type: "Real" },
        { name: "supply_pressure_bar", causality: "input", type: "Real" },
        { name: "ambient_temperature_k", causality: "input", type: "Real" },

        // Dynamic State Outputs
        { name: "fuel_gas_pressure_bar", causality: "output", type: "Real" },
        { name: "fuel_gas_pressure_pa", causality: "output", type: "Real" },
        { name: "fuel_gas_wobbe_index", causality: "output", type: "Real" },
        { name: "fuel_gas_density", causality: "output", type: "Real" },
        { name: "line_pack_mmsm3", causality: "output", type: "Real" },
        { name: "deliverable_line_pack_mmsm3", causality: "output", type: "Real" },
        { name: "deliverable_energy_mwh", causality: "output", type: "Real" },
        { name: "maop_headroom_bar", causality: "output", type: "Real" },
        { name: "exhaustion_time_hours", causality: "output", type: "Real" },
        { name: "h2_molar_fraction", causality: "output", type: "Real" },
        { name: "gas_velocity_m_s", causality: "output", type: "Real" },
      ],
    };
  }

  public async initialize(startTime: number, _stopTime: number, _stepSize: number): Promise<void> {
    this.currentTime = startTime;
    this.applyBoundaryConditions();

    // Initial steady hydraulic calculation
    const steady = SteadyNetworkSolver.solve(this.model);
    const summary: LinePackAnalysis = LinePackEngine.analyze(this.model, steady);

    const stdDensity = this.activeComposition.standardDensity ?? 0.78;
    this.totalGasInventoryKg = summary.totalLinePackKg;
    this.initialGasInventoryKg = this.totalGasInventoryKg;
    this.linePackMmsm3 = this.totalGasInventoryKg / (stdDensity * 1.0e6);
    this.deliverableLinePackMmsm3 = summary.deliverableLinePackSm3 / 1.0e6;
    this.deliverableEnergyMwh = summary.totalEnergyStoredGWh * 1000.0;

    // Delivery node pressure
    const delP = steady.nodeStates[this.options.deliveryNode ?? ""]?.pressure ?? 55.0e5;
    this.deliveryPressurePa = delP;
    this.initialDeliveryPressurePa = delP;

    const supP = steady.nodeStates[this.options.supplyNode ?? ""]?.pressure ?? 70.0e5;
    this.supplyPressurePa = supP;

    this.updateThermodynamicOutputs();
  }

  public async setInputs(values: Map<string, CosimValue>): Promise<void> {
    for (const [k, v] of values.entries()) {
      if (typeof v === "number") {
        this.inputBuffer.set(k.toLowerCase(), v);
      }
    }
    this.applyBoundaryConditions();
  }

  private applyBoundaryConditions(): void {
    for (const [k, v] of this.inputBuffer.entries()) {
      if (k.includes("ccgt") || k.includes("power_demand") || k.includes("fuel_demand")) {
        this.ccgtFuelDemandMw = Math.max(0.0, v);
      } else if (k.includes("withdrawal") || k.includes("delivery_rate") || k.includes("offtake")) {
        this.deliveryWithdrawalKgS = Math.max(0.0, v);
      } else if (k.includes("h2") || k.includes("hydrogen")) {
        this.h2InjectionKgS = Math.max(0.0, v);
      } else if (k.includes("supply_p") || k.includes("inlet_p")) {
        this.supplyPressurePa = Math.max(1.0e5, v > 1000 ? v : v * 1.0e5);
      } else if (k.includes("ambient") || k.includes("temperature")) {
        this.ambientTemperatureK = Math.max(200.0, v);
      }
    }
  }

  public async doStep(currentTime: number, stepSize: number): Promise<void> {
    this.currentTime = currentTime + stepSize;

    // 1. Calculate CCGT turbine gas consumption:
    // Fuel heat input required = Electric Power [MW] * HeatRate [MJ/kWh] / 3.6 MJ/kWh
    const heatRate = this.options.ccgtHeatRateMjKwh ?? 7.2;
    // Lower Heating Value of Natural Gas ~ 47.0 MJ/kg
    const gasLhvMjKg = 47.0;
    const ccgtFuelRateKgS = (this.ccgtFuelDemandMw * (heatRate / 3.6)) / gasLhvMjKg;

    // 2. Net mass balance across the transmission system:
    const totalWithdrawalRateKgS = this.deliveryWithdrawalKgS + ccgtFuelRateKgS;
    // Inflow from upstream supplies (balanced to match baseline scheduled delivery rate)
    const nominalSupplyRateKgS = this.deliveryWithdrawalKgS;
    const netDraftRateKgS = totalWithdrawalRateKgS - (nominalSupplyRateKgS + this.h2InjectionKgS);

    // 3. Dynamic gas line pack inventory update:
    this.totalGasInventoryKg = Math.max(1.0e5, this.totalGasInventoryKg - netDraftRateKgS * stepSize);

    // 4. Update H2 blending molar fraction:
    const baselineMolarMassKgMol = 0.018; // ~18 g/mol for natural gas
    const h2MolarMassKgMol = 0.002016; // 2 g/mol
    const totalMassInflow = nominalSupplyRateKgS + this.h2InjectionKgS;
    if (totalMassInflow > 1e-4) {
      const h2MassFrac = this.h2InjectionKgS / totalMassInflow;
      const molesH2 = h2MassFrac / h2MolarMassKgMol;
      const molesNg = (1.0 - h2MassFrac) / baselineMolarMassKgMol;
      this.h2MolarFraction = Math.max(0.0, Math.min(1.0, molesH2 / (molesH2 + molesNg)));
      this.activeComposition.hydrogen = this.h2MolarFraction;
      this.activeComposition.methane = Math.max(
        0.0,
        1.0 -
          this.h2MolarFraction -
          (this.activeComposition.carbonDioxide ?? 0.015) -
          (this.activeComposition.nitrogen ?? 0.015),
      );
    }

    // 5. Line pack inventory in MMSm³:
    const stdDensity = this.activeComposition.standardDensity ?? 0.78;
    this.linePackMmsm3 = this.totalGasInventoryKg / (stdDensity * 1.0e6);

    // Dynamic delivery pressure response: drops as inventory drops and withdrawal increases
    const inventoryRatio = this.totalGasInventoryKg / Math.max(1.0, this.initialGasInventoryKg);
    const flowRatio = totalWithdrawalRateKgS / Math.max(1.0, this.deliveryWithdrawalKgS);
    const frictionDropPa = 2.5e5 * (flowRatio * flowRatio - 1.0);
    this.deliveryPressurePa = Math.max(1.0e5, this.initialDeliveryPressurePa * inventoryRatio - frictionDropPa);

    // Effective flow velocity:
    let totalPipeVolumeM3 = 0;
    for (const pipe of this.model.pipes) {
      const area = (Math.PI / 4.0) * pipe.diameter * pipe.diameter;
      totalPipeVolumeM3 += area * pipe.length;
    }
    if (totalPipeVolumeM3 <= 0) totalPipeVolumeM3 = 50000.0;
    const avgDensity = this.totalGasInventoryKg / totalPipeVolumeM3;
    const pipeDiam = this.model.pipes[0]?.diameter ?? 0.762;
    const pipeArea = (Math.PI / 4.0) * pipeDiam * pipeDiam;
    this.flowVelocityMS = totalWithdrawalRateKgS / Math.max(1.0, avgDensity * pipeArea);

    const eosProps = Aga8DetailedEos.evaluate(
      this.deliveryPressurePa,
      this.ambientTemperatureK,
      this.activeComposition,
    );

    // Deliverable inventory above min contractual delivery pressure:
    const minP = this.options.minDeliveryPressure ?? 35.0e5;
    const pFrac = Math.max(0.0, (this.deliveryPressurePa - minP) / Math.max(1.0e5, this.deliveryPressurePa));
    this.deliverableLinePackMmsm3 = this.linePackMmsm3 * pFrac;

    // Deliverable energy in MWh:
    // HHV is modulated by H2 blend (H2 volumetric HHV ~ 12.7 MJ/Sm³, Methane ~ 39.8 MJ/Sm³)
    const hhvH2 = 12.7;
    const hhvNg = this.options.nominalHhvMjSm3 ?? 39.8;
    const effectiveHhv = (1.0 - this.h2MolarFraction) * hhvNg + this.h2MolarFraction * hhvH2;
    // Energy [MWh] = Volume [Sm³] * HHV [MJ/Sm³] / 3600 [MJ/MWh]
    this.deliverableEnergyMwh = (this.deliverableLinePackMmsm3 * 1.0e6 * effectiveHhv) / 3600.0;

    // Wobbe Index = HHV / sqrt(Specific Gravity)
    const specificGravity = eosProps.molarMass / 0.028966; // relative to dry air
    this.gasWobbeIndex = effectiveHhv / Math.max(0.1, Math.sqrt(specificGravity));

    // Safety headroom to MAOP
    const maop = this.options.maopLimit ?? 80.0e5;
    this.maopHeadroomBar = Math.max(0.0, (maop - Math.max(this.supplyPressurePa, this.deliveryPressurePa)) / 1.0e5);

    // Time to line pack exhaustion at current draft rate:
    if (netDraftRateKgS > 0.01) {
      const deliverableKg = this.totalGasInventoryKg * pFrac;
      this.exhaustionTimeHours = deliverableKg / (netDraftRateKgS * 3600.0);
    } else {
      this.exhaustionTimeHours = 999.0; // Infinite/replenishing
    }

    this.updateThermodynamicOutputs();
  }

  private updateThermodynamicOutputs(): void {
    const props = Aga8DetailedEos.evaluate(this.deliveryPressurePa, this.ambientTemperatureK, this.activeComposition);
    this.deliveryGasDensity = props.massDensity;
  }

  public async getOutputs(): Promise<Map<string, CosimValue>> {
    const outputs = new Map<string, CosimValue>();

    const pDeliveryBar = this.deliveryPressurePa / 1.0e5;

    // Standard underscored variables
    outputs.set("fuel_gas_pressure_bar", pDeliveryBar);
    outputs.set("fuel_gas_pressure_pa", this.deliveryPressurePa);
    outputs.set("fuel_gas_wobbe_index", this.gasWobbeIndex);
    outputs.set("fuel_gas_density", this.deliveryGasDensity);
    outputs.set("line_pack_mmsm3", this.linePackMmsm3);
    outputs.set("deliverable_line_pack_mmsm3", this.deliverableLinePackMmsm3);
    outputs.set("deliverable_energy_mwh", this.deliverableEnergyMwh);
    outputs.set("maop_headroom_bar", this.maopHeadroomBar);
    outputs.set("exhaustion_time_hours", this.exhaustionTimeHours);
    outputs.set("h2_molar_fraction", this.h2MolarFraction);
    outputs.set("gas_velocity_m_s", this.flowVelocityMS);

    // Dot-notation aliases for FMI / SSP compatibility
    outputs.set("fuel_gas.pressure_bar", pDeliveryBar);
    outputs.set("fuel_gas.pressure_pa", this.deliveryPressurePa);
    outputs.set("fuel_gas.wobbe_index", this.gasWobbeIndex);
    outputs.set("fuel_gas.density", this.deliveryGasDensity);
    outputs.set("line_pack.inventory_mmsm3", this.linePackMmsm3);
    outputs.set("line_pack.deliverable_mmsm3", this.deliverableLinePackMmsm3);
    outputs.set("line_pack.energy_mwh", this.deliverableEnergyMwh);
    outputs.set("safety.maop_headroom_bar", this.maopHeadroomBar);
    outputs.set("safety.exhaustion_time_hours", this.exhaustionTimeHours);
    outputs.set("blend.h2_molar_fraction", this.h2MolarFraction);

    return outputs;
  }

  public async terminate(): Promise<void> {
    // Release any allocated handles
  }
}

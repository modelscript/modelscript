// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/exchange — Tier 2: OLGA Multiphase Flow Co-Simulation Participant.
 *
 * Implements FMI 2.0 / 3.0 Co-Simulation participant contract (CoSimParticipant),
 * coupling transient multiphase pipelines to Modelica dynamic systems, topside
 * facilities (separators, compressors, chokes), and SSP master orchestrators.
 */

import {
  computeHydrateEquilibriumTemp,
  evaluateEmulsionViscosity,
  parseOlga,
  PigTracker,
  SlugTracker,
  type OlgaEngineOptions,
  type OlgaModel,
} from "@modelscript/olga";
import type { CosimValue } from "../coupling.js";
import type { ParticipantMetadata } from "../mqtt/protocol.js";
import type { CoSimParticipant } from "../participant.js";

/** Configuration options for the OLGA co-simulation participant. */
export interface OlgaCoSimOptions {
  /** Execution tier mode: 'wasm' (Tier 1 in-WASM), 'engine' (Tier 3 Schlumberger OLGA batch/OPC), or 'fmu' (Tier 2 FMI). */
  mode?: "wasm" | "engine" | "fmu" | undefined;
  /** MAOP limit in Pascal [Pa] for headroom calculations (default: 250 bar = 2.5e7 Pa). */
  maopLimit?: number | undefined;
  /** Slug catcher design capacity in m^3 (default: 150 m^3). */
  slugCatcherCapacity?: number | undefined;
  /** Options passed to the external OLGA engine orchestrator when mode is 'engine'. */
  engineOptions?: OlgaEngineOptions | undefined;
}

/**
 * High-Fidelity Multiphase Dynamic Flowline Co-Simulation Participant.
 *
 * Bridges OLGA flowline-riser systems with 1D Modelica dynamic components,
 * supervisory controllers (OPC / SysML v2), and topside facilities.
 */
export class OlgaCoSimParticipant implements CoSimParticipant {
  public readonly id: string;
  public readonly modelName: string;
  public readonly metadata: ParticipantMetadata;

  private model: OlgaModel;
  private options: OlgaCoSimOptions;
  private currentTime = 0;

  // Active state variables
  private inletPressure = 150.0e5; // 150 bar bottomhole / inlet
  private arrivalPressure = 20.0e5; // 20 bar topside separator
  private arrivalTemperature = 310.15; // ~37 C topside
  private arrivalLiquidHoldup = 0.25; // 25% holdup
  private arrivalLiquidRate = 22.5; // kg/s
  private accumulatedLiquidVolume = 0.0; // m^3
  private slugSurgeVolume = 0.0; // m^3
  private hydrateSubcooling = 12.5; // K margin above hydrate curve
  private maopMargin = 100.0e5; // 100 bar headroom to MAOP

  // Advanced multiphase states
  private slugTracker = new SlugTracker();
  private pigTracker: PigTracker;
  private meanSlugLength = 0.0;
  private slugFrequency = 0.0;
  private activeSlugsCount = 0;
  private pigPosition = 0.0;
  private pigVelocity = 0.0;
  private emulsionViscosity = 0.005;

  // Boundary inputs
  private chokeOpening = 1.0; // 0.0 to 1.0
  private wellheadMassRate = 35.0; // kg/s
  private ambientTemperature = 277.15; // 4 C seawater
  private inputBuffer: Map<string, number> = new Map();

  constructor(id: string, modelOrSource: OlgaModel | string, options: OlgaCoSimOptions = {}) {
    this.id = id;
    this.model = typeof modelOrSource === "string" ? parseOlga(modelOrSource) : modelOrSource;
    this.modelName = this.model.title || "OLGA Flowline";
    this.options = {
      mode: "wasm",
      maopLimit: 250.0e5, // 250 bar
      slugCatcherCapacity: 150.0,
      ...options,
    };

    this.pigTracker = new PigTracker(this.model.flowpaths[0]?.pigs || []);

    // Initialize from model geometry/boundaries if specified
    const source = this.model.flowpaths[0]?.sources[0];
    if (source) {
      this.wellheadMassRate = source.totalMassRate;
      if (source.pressure) this.inletPressure = source.pressure;
    }
    const valve = this.model.flowpaths[0]?.valves[0];
    if (valve) {
      this.chokeOpening = valve.opening;
    }

    this.metadata = {
      participantId: id,
      modelName: this.modelName,
      type: "external",
      classKind: "field",
      timestamp: new Date().toISOString(),
      description: "OLGA High-Fidelity Multiphase Flowline Participant",
      variables: [
        // Inputs
        { name: "choke.opening", causality: "input", type: "Real" },
        { name: "wellhead.mass_rate", causality: "input", type: "Real" },
        { name: "separator.pressure", causality: "input", type: "Real" },
        { name: "ambient.temperature", causality: "input", type: "Real" },

        // Outputs
        { name: "inlet.pressure", causality: "output", type: "Real" },
        { name: "arrival.temperature", causality: "output", type: "Real" },
        { name: "arrival.liquid_holdup", causality: "output", type: "Real" },
        { name: "arrival.liquid_rate", causality: "output", type: "Real" },
        { name: "slug.surge_volume", causality: "output", type: "Real" },
        { name: "hydrate.subcooling", causality: "output", type: "Real" },
        { name: "maop.margin", causality: "output", type: "Real" },
        { name: "slug.mean_length", causality: "output", type: "Real" },
        { name: "slug.frequency", causality: "output", type: "Real" },
        { name: "slug.active_count", causality: "output", type: "Integer" },
        { name: "pig.position", causality: "output", type: "Real" },
        { name: "pig.velocity", causality: "output", type: "Real" },
        { name: "emulsion.viscosity", causality: "output", type: "Real" },
      ],
    };
  }

  public async initialize(startTime: number, _stopTime: number, _stepSize: number): Promise<void> {
    this.currentTime = startTime;
    this.accumulatedLiquidVolume = 0;
    this.slugSurgeVolume = 0;
    this.applyBoundaryConditions();

    // Compute nominal initial equilibrium inlet pressure
    const cdArea = 0.84 * (Math.PI * 0.05 * 0.05);
    const rhoMix = 150.0;
    const chokeDeltaP =
      Math.pow(this.wellheadMassRate / Math.max(1e-4, cdArea * this.chokeOpening), 2) / (2.0 * rhoMix);
    const pipeFriction = 0.02 * (5000.0 / 0.3) * (rhoMix * Math.pow(this.wellheadMassRate / (rhoMix * 0.07), 2)) * 0.5;
    const riserHydrostatic = 800.0 * 9.81 * 350.0 * this.arrivalLiquidHoldup;
    this.inletPressure = this.arrivalPressure + chokeDeltaP + pipeFriction + riserHydrostatic;
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
      if (k.includes("choke") || k.includes("opening") || k.includes("valve")) {
        this.chokeOpening = Math.max(0.001, Math.min(1.0, v));
      } else if (k.includes("well") || k.includes("rate") || k.includes("massrate") || k.includes("inflow")) {
        this.wellheadMassRate = Math.max(0.0, v);
      } else if (k.includes("separator") || k.includes("outlet_p") || k.includes("backpressure")) {
        this.arrivalPressure = Math.max(1.0e5, v);
      } else if (k.includes("ambient") || k.includes("tamb") || k.includes("seawater")) {
        this.ambientTemperature = Math.max(250.0, v);
      }
    }
  }

  public async doStep(currentTime: number, stepSize: number): Promise<void> {
    this.currentTime = currentTime + stepSize;

    // Effective flow calculation across choke and pipeline
    const z = this.chokeOpening;
    // Choke pressure drop: DeltaP_choke ~ (W / (Cd * A * z))^2
    const cdArea = 0.84 * (Math.PI * 0.05 * 0.05); // ~0.1m choke diameter
    const rhoMix = 150.0; // bulk mixture density ~150 kg/m^3
    const chokeDeltaP = Math.min(
      150.0e5,
      Math.pow(this.wellheadMassRate / Math.max(1e-4, cdArea * z), 2) / (2.0 * rhoMix),
    );

    // Pipeline friction & hydrostatic elevation (e.g. 500m riser)
    const pipeFriction = 0.02 * (5000.0 / 0.3) * (rhoMix * Math.pow(this.wellheadMassRate / (rhoMix * 0.07), 2)) * 0.5;
    const riserHydrostatic = 800.0 * 9.81 * 350.0 * this.arrivalLiquidHoldup; // ~350m sea depth

    // Steady-state relaxation / dynamic update for inlet pressure
    const targetInletP = this.arrivalPressure + chokeDeltaP + pipeFriction + riserHydrostatic;
    // Smooth first-order filter representing pipeline acoustic capacitance
    const tauP = 15.0; // 15s fluid storage time constant
    const alphaP = Math.min(1.0, stepSize / tauP);
    this.inletPressure += alphaP * (targetInletP - this.inletPressure);

    // Heat transfer relaxation towards seawater ambient
    const heatU = 15.0; // overall heat transfer coeff W/m2-K
    const pipeSurfaceArea = Math.PI * 0.3 * 5000.0;
    const thermalCapacitance = 5000.0 * 0.07 * 800.0 * 2000.0; // mass * Cp
    const tauT = thermalCapacitance / Math.max(1.0, heatU * pipeSurfaceArea);
    const alphaT = Math.min(1.0, stepSize / Math.max(1.0, tauT));
    const targetArrivalT = this.ambientTemperature + (340.15 - this.ambientTemperature) * Math.exp(-stepSize / 500.0);
    this.arrivalTemperature += alphaT * (targetArrivalT - this.arrivalTemperature);

    // Arrival liquid rate and holdup
    const gasFraction = 0.25;
    const liquidFraction = 1.0 - gasFraction;
    this.arrivalLiquidRate = this.wellheadMassRate * liquidFraction * z;
    this.arrivalLiquidHoldup = Math.max(
      0.05,
      Math.min(0.9, 0.2 + 0.3 * (1.0 - z) + 0.1 * Math.sin(this.currentTime / 60.0)),
    );

    // Slug surge volume (integral of liquid production exceeding nominal slug-catcher drainage)
    const nominalDrainRate = 15.0; // kg/s
    const netLiquidRate = Math.max(0.0, this.arrivalLiquidRate - nominalDrainRate);
    const deltaVol = (netLiquidRate / 800.0) * stepSize;
    this.accumulatedLiquidVolume += deltaVol;
    this.slugSurgeVolume = Math.min(this.options.slugCatcherCapacity ?? 150.0, this.slugSurgeVolume * 0.98 + deltaVol);

    // Flow assurance margins: Hydrate Equilibrium Curve T_hyd(P)
    const hydTemp = computeHydrateEquilibriumTemp(this.inletPressure);
    // Subcooling margin = T_fluid - T_hyd(P). Positive means outside hydrate region (safe).
    this.hydrateSubcooling = this.arrivalTemperature - hydTemp;

    // Advance slug tracker & scraper pigging dynamics
    const pipeL = 5000.0;
    const pipeD = 0.3;
    const holdups = [0.15, 0.2, 0.25, 0.3, this.arrivalLiquidHoldup];
    const positions = [0, 1000, 2500, 4000, pipeL];
    const pressures = [
      this.inletPressure,
      this.inletPressure * 0.8,
      this.inletPressure * 0.6,
      this.arrivalPressure * 1.5,
      this.arrivalPressure,
    ];
    const jBulk = this.wellheadMassRate / (150.0 * 0.07);

    const slugs = this.slugTracker.step(this.currentTime, stepSize, pipeL, pipeD, holdups, positions, jBulk);
    const slugStats = this.slugTracker.getStatistics();
    this.meanSlugLength = slugStats.meanSlugLength;
    this.slugFrequency = slugStats.slugFrequencyHz;
    this.activeSlugsCount = slugs.length;

    const pigs = this.pigTracker.step(this.currentTime, stepSize, pipeL, pipeD, holdups, positions, pressures);
    if (pigs.length > 0) {
      this.pigPosition = pigs[0]!.position;
      this.pigVelocity = pigs[0]!.velocity;
      if (pigs[0]!.isReceived && pigs[0]!.arrivalTime === this.currentTime) {
        this.accumulatedLiquidVolume += pigs[0]!.sweptLiquidVolume;
      }
    }

    // Emulsion viscosity
    const wc = this.model.flowpaths[0]?.sources[0]?.waterCut ?? 0.05;
    const emulsion = evaluateEmulsionViscosity(wc, 0.003, 0.001);
    this.emulsionViscosity = emulsion.effectiveViscosity;

    // MAOP headroom = MAOP - P_inlet
    const maop = this.options.maopLimit ?? 250.0e5;
    this.maopMargin = Math.max(0.0, maop - this.inletPressure);
  }

  public async getOutputs(): Promise<Map<string, CosimValue>> {
    const outputs = new Map<string, CosimValue>();

    // Standard port names
    outputs.set("inlet.pressure", this.inletPressure);
    outputs.set("arrival.temperature", this.arrivalTemperature);
    outputs.set("arrival.liquid_holdup", this.arrivalLiquidHoldup);
    outputs.set("arrival.liquid_rate", this.arrivalLiquidRate);
    outputs.set("slug.surge_volume", this.slugSurgeVolume);
    outputs.set("hydrate.subcooling", this.hydrateSubcooling);
    outputs.set("maop.margin", this.maopMargin);
    outputs.set("slug.mean_length", this.meanSlugLength);
    outputs.set("slug.frequency", this.slugFrequency);
    outputs.set("slug.active_count", this.activeSlugsCount);
    outputs.set("pig.position", this.pigPosition);
    outputs.set("pig.velocity", this.pigVelocity);
    outputs.set("emulsion.viscosity", this.emulsionViscosity);

    // Underscore aliases for compatibility with diverse FMI / SSP tools
    outputs.set("inlet_pressure", this.inletPressure);
    outputs.set("arrival_temperature", this.arrivalTemperature);
    outputs.set("arrival_liquid_holdup", this.arrivalLiquidHoldup);
    outputs.set("arrival_liquid_rate", this.arrivalLiquidRate);
    outputs.set("slug_surge_volume", this.slugSurgeVolume);
    outputs.set("hydrate_subcooling", this.hydrateSubcooling);
    outputs.set("maop_margin", this.maopMargin);
    outputs.set("slug_mean_length", this.meanSlugLength);
    outputs.set("slug_frequency", this.slugFrequency);
    outputs.set("slug_active_count", this.activeSlugsCount);
    outputs.set("pig_position", this.pigPosition);
    outputs.set("pig_velocity", this.pigVelocity);
    outputs.set("emulsion_viscosity", this.emulsionViscosity);

    return outputs;
  }

  public async terminate(): Promise<void> {
    // Release resources
  }
}

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

  // Discretized multi-segment drift-flux grid
  private segments: {
    length: number;
    diameter: number;
    elevation: number;
    roughness: number;
    uHeat: number;
    position: number;
    pressure: number;
    holdup: number;
    temperature: number;
  }[] = [];
  private totalLength = 5000.0;
  private nominalDiameter = 0.3;
  private inletTemperature = 340.15;
  private gasFraction = 0.25;

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
      if (source.temperature) this.inletTemperature = source.temperature;
      if (source.gasMassFraction !== undefined) this.gasFraction = source.gasMassFraction;
    }
    const valve = this.model.flowpaths[0]?.valves[0];
    if (valve) {
      this.chokeOpening = valve.opening;
    }
    const sepNode = this.model.nodes?.find(
      (n) => n.type === "PRESSURE" || n.type === "SEPARATOR" || n.name.toUpperCase().includes("SEP"),
    );
    if (sepNode?.pressure) {
      this.arrivalPressure = sepNode.pressure;
    }

    this.buildSegmentsFromFlowpaths();

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

  private buildSegmentsFromFlowpaths(): void {
    const allPipes = this.model.flowpaths.flatMap((fp) =>
      fp.pipes.map((pipe) => ({
        pipe,
        uHeat: fp.heatTransfer?.ambientHeatTransferCoeff ?? 15.0,
      })),
    );
    this.segments = [];
    let pos = 0.0;

    if (allPipes.length > 0) {
      for (const { pipe, uHeat } of allPipes) {
        const nSeg = Math.max(1, Math.min(24, pipe.discretization || 4));
        const segLen = Math.max(1.0, pipe.length / nSeg);
        const segElev = (pipe.elevation ?? 0.0) / nSeg;
        const segDiam = Math.max(0.05, pipe.diameter || 0.3);
        const segRough = Math.max(1e-6, pipe.roughness ?? 4.5e-5);
        const segU = Math.max(1.0, uHeat);
        for (let i = 0; i < nSeg; i++) {
          pos += segLen;
          this.segments.push({
            length: segLen,
            diameter: segDiam,
            elevation: segElev,
            roughness: segRough,
            uHeat: segU,
            position: pos,
            pressure: this.arrivalPressure,
            holdup: this.arrivalLiquidHoldup,
            temperature: this.inletTemperature,
          });
        }
      }
    } else {
      const nDefault = 5;
      const segLen = 5000.0 / nDefault;
      for (let i = 0; i < nDefault; i++) {
        pos += segLen;
        this.segments.push({
          length: segLen,
          diameter: 0.3,
          elevation: i === nDefault - 1 ? 350.0 : -25.0,
          roughness: 4.5e-5,
          uHeat: 15.0,
          position: pos,
          pressure: this.arrivalPressure,
          holdup: this.arrivalLiquidHoldup,
          temperature: this.inletTemperature,
        });
      }
    }

    this.totalLength = Math.max(1.0, pos);
    this.nominalDiameter = this.segments[0]?.diameter ?? 0.3;
  }

  private computeSteadyProfile(): { totalFriction: number; totalHydrostatic: number; chokeDeltaP: number } {
    const valve = this.model.flowpaths[0]?.valves[0];
    const chokeDiam = valve?.diameter ? Math.min(0.12, valve.diameter * 0.5) : 0.1;
    const chokeCd = valve?.cd ?? 0.84;
    const cdArea = chokeCd * (Math.PI * 0.25 * chokeDiam * chokeDiam);
    const rhoL = 800.0;
    const rhoG = 65.0;
    const rhoMix = 150.0;
    const chokeDeltaP = Math.min(
      150.0e5,
      Math.pow(this.wellheadMassRate / Math.max(1e-4, cdArea * this.chokeOpening), 2) / (2.0 * rhoMix),
    );

    let totalFriction = 0.0;
    let totalHydrostatic = 0.0;

    for (const seg of this.segments) {
      const area = Math.PI * 0.25 * seg.diameter * seg.diameter;
      const rhoSeg = seg.holdup * rhoL + (1.0 - seg.holdup) * rhoG;
      const vMix = this.wellheadMassRate / Math.max(1e-3, rhoSeg * area);
      const re = Math.max(4000.0, (rhoSeg * Math.abs(vMix) * seg.diameter) / 0.0025);
      const fDarcy = 0.25 / Math.pow(Math.log10(seg.roughness / (3.7 * seg.diameter) + 5.74 / Math.pow(re, 0.9)), 2.0);
      const dpFric = fDarcy * (seg.length / seg.diameter) * 0.5 * rhoSeg * vMix * vMix;
      const dpGrav = rhoL * 9.81 * Math.max(0.0, seg.elevation) * seg.holdup;
      totalFriction += dpFric;
      totalHydrostatic += dpGrav;
    }

    return { totalFriction, totalHydrostatic, chokeDeltaP };
  }

  public async initialize(startTime: number, _stopTime: number, _stepSize: number): Promise<void> {
    this.currentTime = startTime;
    this.accumulatedLiquidVolume = 0;
    this.slugSurgeVolume = 0;
    this.applyBoundaryConditions();

    // Initialize segment holdups, temperatures, and pressures from flowpath geometry
    let prevT = this.inletTemperature;
    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i]!;
      const sinTheta = seg.elevation / Math.max(1.0, seg.length);
      seg.holdup = Math.max(0.12, Math.min(0.65, 0.22 + 0.15 * sinTheta));
      const area = Math.PI * 0.25 * seg.diameter * seg.diameter;
      const decay = Math.exp(
        (-seg.uHeat * Math.PI * seg.diameter * seg.length) / Math.max(100.0, this.wellheadMassRate * 2100.0 + area),
      );
      seg.temperature = this.ambientTemperature + (prevT - this.ambientTemperature) * decay;
      prevT = seg.temperature;
    }

    const { totalFriction, totalHydrostatic, chokeDeltaP } = this.computeSteadyProfile();
    this.inletPressure = this.arrivalPressure + chokeDeltaP + totalFriction + totalHydrostatic;
    this.arrivalTemperature = this.segments[this.segments.length - 1]?.temperature ?? 310.15;
    this.arrivalLiquidHoldup = this.segments[this.segments.length - 1]?.holdup ?? 0.25;
    this.arrivalLiquidRate = this.wellheadMassRate * (1.0 - this.gasFraction) * this.chokeOpening;

    for (let i = 0; i < this.segments.length; i++) {
      const frac = (i + 1) / this.segments.length;
      this.segments[i]!.pressure = this.inletPressure - frac * (this.inletPressure - this.arrivalPressure);
    }
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

    const z = this.chokeOpening;
    const rhoL = 800.0;
    const rhoG = 65.0;
    const cpMix = 2000.0;
    const liquidFraction = 1.0 - this.gasFraction;

    // Integrate multi-segment drift-flux continuity, momentum, and thermal PDEs
    const wEff = this.wellheadMassRate * (0.25 + 0.75 * z);
    let qLiqIn = (wEff * liquidFraction) / rhoL;
    const qGasIn = (wEff * this.gasFraction) / rhoG;
    let prevTemp = this.inletTemperature;

    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i]!;
      const area = Math.PI * 0.25 * seg.diameter * seg.diameter;
      const vol = area * seg.length;
      const sinTheta = seg.elevation / Math.max(1.0, seg.length);

      const jL = qLiqIn / area;
      const jG = qGasIn / area;
      const jM = jL + jG;

      // Zuber-Findlay drift velocity in inclined/riser pipe section
      const vDrift =
        0.35 * Math.sqrt((9.81 * seg.diameter * (rhoL - rhoG)) / rhoL) +
        0.54 * Math.sqrt(9.81 * seg.diameter) * sinTheta;
      const vG = Math.max(0.05, 1.18 * jM + vDrift);
      const alphaGEq = Math.max(0.05, Math.min(0.92, jG / vG));
      const alphaLEq = Math.max(0.05, Math.min(0.9, 1.0 - alphaGEq + 0.22 * (1.0 - z)));

      const vL = Math.max(0.02, (jM * (1.0 - 0.15 * sinTheta)) / Math.max(0.1, seg.holdup));
      const qLiqOut = seg.holdup * Math.min(3.5, vL) * area;

      const tauHoldup = Math.max(4.0, seg.length / Math.max(0.25, jM));
      const dAlpha = (qLiqIn - qLiqOut) / Math.max(1.0, vol) + (alphaLEq - seg.holdup) / tauHoldup;
      seg.holdup = Math.max(0.05, Math.min(0.9, seg.holdup + Math.min(0.5, stepSize) * dAlpha));

      // Segment thermal energy balance
      const rhoSeg = seg.holdup * rhoL + (1.0 - seg.holdup) * rhoG;
      const surfaceArea = Math.PI * seg.diameter * seg.length;
      const thermalCap = Math.max(100.0, vol * rhoSeg * cpMix);
      const tauT = thermalCap / Math.max(1.0, seg.uHeat * surfaceArea);
      const advDecay = Math.exp((-seg.uHeat * surfaceArea) / Math.max(100.0, this.wellheadMassRate * cpMix));
      const targetSegT = this.ambientTemperature + (prevTemp - this.ambientTemperature) * advDecay;
      const alphaT = Math.min(1.0, stepSize / Math.max(1.0, tauT));
      seg.temperature += alphaT * (targetSegT - seg.temperature);

      qLiqIn = qLiqOut;
      prevTemp = seg.temperature;
    }

    // Compute total friction, hydrostatic head, and choke deltaP across all segments
    const { totalFriction, totalHydrostatic, chokeDeltaP } = this.computeSteadyProfile();
    const targetInletP = this.arrivalPressure + chokeDeltaP + totalFriction + totalHydrostatic;
    const tauP = Math.max(5.0, this.totalLength / 400.0);
    const alphaP = Math.min(1.0, stepSize / tauP);
    this.inletPressure += alphaP * (targetInletP - this.inletPressure);

    // Update segment pressure distribution from inlet to arrival
    let cumDrop = 0.0;
    const totalDrop = Math.max(0.0, this.inletPressure - this.arrivalPressure);
    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i]!;
      cumDrop += seg.length / this.totalLength;
      seg.pressure = this.inletPressure - cumDrop * totalDrop;
    }

    const lastSeg = this.segments[this.segments.length - 1];
    this.arrivalTemperature = lastSeg ? lastSeg.temperature : this.arrivalTemperature;
    this.arrivalLiquidHoldup = lastSeg ? lastSeg.holdup : this.arrivalLiquidHoldup;
    this.arrivalLiquidRate = this.wellheadMassRate * liquidFraction * z;

    // Slug surge volume (integral of liquid production exceeding nominal slug-catcher drainage)
    const nominalDrainRate = 15.0; // kg/s
    const netLiquidRate = Math.max(0.0, this.arrivalLiquidRate - nominalDrainRate);
    const deltaVol = (netLiquidRate / rhoL) * stepSize;
    this.accumulatedLiquidVolume += deltaVol;
    this.slugSurgeVolume = Math.min(this.options.slugCatcherCapacity ?? 150.0, this.slugSurgeVolume * 0.98 + deltaVol);

    // Flow assurance margins: Hydrate Equilibrium Curve T_hyd(P)
    const hydTemp = computeHydrateEquilibriumTemp(this.inletPressure);
    this.hydrateSubcooling = this.arrivalTemperature - hydTemp;

    // Advance slug tracker & scraper pigging dynamics using actual flowpath segments
    const holdups = this.segments.map((s) => s.holdup);
    const positions = this.segments.map((s) => s.position);
    const pressures = this.segments.map((s) => s.pressure);
    const nomArea = Math.PI * 0.25 * this.nominalDiameter * this.nominalDiameter;
    const jBulk = this.wellheadMassRate / Math.max(1e-3, 150.0 * nomArea);

    const slugs = this.slugTracker.step(
      this.currentTime,
      stepSize,
      this.totalLength,
      this.nominalDiameter,
      holdups,
      positions,
      jBulk,
    );
    const slugStats = this.slugTracker.getStatistics();
    this.meanSlugLength = slugStats.meanSlugLength;
    this.slugFrequency = slugStats.slugFrequencyHz;
    this.activeSlugsCount = slugs.length;

    const pigs = this.pigTracker.step(
      this.currentTime,
      stepSize,
      this.totalLength,
      this.nominalDiameter,
      holdups,
      positions,
      pressures,
    );
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

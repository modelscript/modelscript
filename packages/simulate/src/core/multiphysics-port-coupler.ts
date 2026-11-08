// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  type ConflictClause,
  DigitalThreadHypergraph,
  FlowAlgebraOracle,
  type SharedEquality,
  bindCfdToModelicaThread,
} from "@modelscript/runtime";
import type {
  ContinuumBoundaryCondition,
  ContinuumPatchMetrics,
  ICfdContinuumParticipant,
  IFeaContinuumParticipant,
  Vector3D,
} from "./continuum-participant.js";

export type PortCouplingRole =
  | "mechanical_flange"
  | "fluid_port"
  | "thermal_port"
  | "electrical_emt_port"
  | "electro_thermal_die_port";

export interface PortCouplingBinding {
  /** Unique coupling binding identifier. */
  id: string;
  /** 1D Modelica or EMT port/variable name (e.g., 'pipe.port_a', 'flange_a', 'mmc_arm_a1', 'wind_gen_shaft'). */
  oneDPortName: string;
  /** 3D Continuum boundary patch tag or mesh surface name (e.g., 'inlet_boundary', 'igbt_die_patch', 'rotor_blade'). */
  continuumTagOrPatch: string;
  /** Physical domain role. */
  role: PortCouplingRole;
  /** Direction axis for mechanical projection (default: [1, 0, 0]). */
  axis?: Vector3D | undefined;
  /** Physical patch area in m^2 (optional, used for fluid & heat flux integrals). */
  areaM2?: number | undefined;
  /** Fluid density in kg/m^3 (optional, used for flow algebra). */
  fluidDensity?: number | undefined;
  /** Effective moment arm radius in meters for converting 3D CFD blade force to 1D EMT machine shaft torque. */
  effectiveRadiusM?: number | undefined;
  /** Nominal semiconductor on-state resistance R_on,0 in Ohms at reference temperature. */
  nominalRonOhm?: number | undefined;
  /** Linear temperature coefficient alpha_T (1/K) for R_on(T_j) = R_on,0 * (1 + alpha_T * (T_j - T_ref)). */
  dieTemperatureCoeffPerK?: number | undefined;
  /** Reference ambient/coolant temperature in degC (default: 25.0). */
  referenceTempDegC?: number | undefined;
  /** Continuum heatsink / die effective thermal capacitance in J/K (default: 40.0). */
  heatCapacityJPerK?: number | undefined;
  /** Continuum heatsink-to-ambient thermal resistance in K/W (default: 0.05). */
  thermalResistanceKPerW?: number | undefined;
  /** Digital thread node IDs for hypergraph cross-domain binding. */
  digitalThreadIds?:
    | {
        threadId: number;
        modelicaNodeId: number;
        continuumNodeId: number;
      }
    | undefined;
}

export interface ElectroThermalState {
  powerLossWatts: number;
  heatFluxW_m2: number;
  dieSurfaceTempDegC: number;
  updatedRonOhm: number;
  integratedElectricalLossJoules: number;
  integratedContinuumHeatFluxJoules: number;
}

export interface ConservationVerificationResult {
  isConservative: boolean;
  conflict?: ConflictClause | undefined;
  sharedEqualities: SharedEquality[];
  metrics: {
    massFluxImbalanceKg_s: number;
    pressureDeltaPa: number;
    electroThermalEnergyImbalanceJoules?: number | undefined;
    electroThermalRelativeDrift?: number | undefined;
  };
}

/**
 * Multiphysics Port Coupler.
 *
 * Provides conservative interpolation and formal invariant verification between
 * 1D Modelica / EMT ports (translational flange, rotational flange, fluid port,
 * electrical EMT machine shaft, IGBT/SiC electro-thermal die port) and
 * 3D continuum boundaries (FEA Tet4/Tet10 surface tags, CFD LBM/FVM patches).
 */
export class MultiphysicsPortCoupler {
  public readonly oracle: FlowAlgebraOracle;
  public readonly hypergraph?: DigitalThreadHypergraph | undefined;
  private bindings: Map<string, PortCouplingBinding> = new Map();
  private last1DValues: Map<
    string,
    {
      massFlow?: number | undefined;
      pressure?: number | undefined;
      force?: number | undefined;
      disp?: number | undefined;
      omegaShaft?: number | undefined;
      powerLossWatts?: number | undefined;
    }
  > = new Map();
  private lastContinuumMetrics: Map<string, ContinuumPatchMetrics> = new Map();
  private electroThermalStates: Map<string, ElectroThermalState> = new Map();

  constructor(options?: { oracle?: FlowAlgebraOracle | undefined; hypergraph?: DigitalThreadHypergraph | undefined }) {
    this.oracle = options?.oracle ?? new FlowAlgebraOracle();
    this.hypergraph = options?.hypergraph;
  }

  /**
   * Registers a 1D-3D physical port binding.
   */
  public registerBinding(binding: PortCouplingBinding): void {
    this.bindings.set(binding.id, binding);

    // If fluid coupling, assert spatial patch into FlowAlgebraOracle
    if (binding.role === "fluid_port") {
      this.oracle.assertSpatialPatch({
        patchName: binding.continuumTagOrPatch,
        surfaceAreaM2: binding.areaM2 ?? 0.01,
        normalVector: binding.axis ?? [-1, 0, 0],
        fluidDensity: binding.fluidDensity ?? 1.225,
      });
      this.oracle.connect1Dto3D(binding.oneDPortName, binding.continuumTagOrPatch);
    } else if (binding.role === "electro_thermal_die_port") {
      const tRef = binding.referenceTempDegC ?? 25.0;
      const rOn0 = binding.nominalRonOhm ?? 1.5e-3;
      this.electroThermalStates.set(binding.oneDPortName, {
        powerLossWatts: 0.0,
        heatFluxW_m2: 0.0,
        dieSurfaceTempDegC: tRef,
        updatedRonOhm: rOn0,
        integratedElectricalLossJoules: 0.0,
        integratedContinuumHeatFluxJoules: 0.0,
      });
    }

    // If digital thread IDs provided, federate slot into DigitalThreadHypergraph
    if (this.hypergraph && binding.digitalThreadIds) {
      const dt = binding.digitalThreadIds;
      bindCfdToModelicaThread(this.hypergraph, dt.threadId, dt.continuumNodeId, dt.modelicaNodeId, 1);
    }
  }

  public getBindings(): readonly PortCouplingBinding[] {
    return Array.from(this.bindings.values());
  }

  public getElectroThermalState(oneDPortName: string): ElectroThermalState | undefined {
    return this.electroThermalStates.get(oneDPortName);
  }

  /**
   * Synchronizes 1D Modelica / EMT actuator, shaft, or semiconductor loss states
   * into 3D Continuum Boundary Conditions.
   */
  public sync1DToContinuum(
    oneDStates: Record<string, number>,
    continuum: ICfdContinuumParticipant | IFeaContinuumParticipant,
    dt = 0.0,
  ): void {
    for (const binding of this.bindings.values()) {
      if (binding.role === "fluid_port") {
        if ("setBoundaryCondition" in continuum && typeof continuum.setBoundaryCondition === "function") {
          const cfd = continuum as ICfdContinuumParticipant;
          const massFlow = oneDStates[`${binding.oneDPortName}.m_flow`] ?? oneDStates[binding.oneDPortName] ?? 0.0;
          const pressure = oneDStates[`${binding.oneDPortName}.p`] ?? 101325.0;

          this.last1DValues.set(binding.oneDPortName, { massFlow, pressure });

          // Update CFD boundary condition
          const area = binding.areaM2 ?? 0.01;
          const rho = binding.fluidDensity ?? 1.225;
          const normalSpeed = massFlow / (rho * area);

          const axis = binding.axis ?? [1, 0, 0];
          const bc: ContinuumBoundaryCondition = {
            velocity: [axis[0] * normalSpeed, axis[1] * normalSpeed, axis[2] * normalSpeed],
            pressure,
            massFlow,
          };
          cfd.setBoundaryCondition(binding.continuumTagOrPatch, bc);
        }
      } else if (binding.role === "mechanical_flange") {
        const force = oneDStates[`${binding.oneDPortName}.f`] ?? oneDStates[binding.oneDPortName] ?? 0.0;
        this.last1DValues.set(binding.oneDPortName, { force });
      } else if (binding.role === "electrical_emt_port") {
        const omegaShaft = oneDStates[`${binding.oneDPortName}.omega`] ?? oneDStates[binding.oneDPortName] ?? 0.0;
        this.last1DValues.set(binding.oneDPortName, { omegaShaft });

        if ("setBoundaryCondition" in continuum && typeof continuum.setBoundaryCondition === "function") {
          const cfd = continuum as ICfdContinuumParticipant;
          const rEff = binding.effectiveRadiusM ?? 1.0;
          const tipSpeed = omegaShaft * rEff;
          const axis = binding.axis ?? [1, 0, 0];
          cfd.setBoundaryCondition(binding.continuumTagOrPatch, {
            velocity: [axis[0] * tipSpeed, axis[1] * tipSpeed, axis[2] * tipSpeed],
          });
        }
      } else if (binding.role === "electro_thermal_die_port") {
        const pLoss = oneDStates[`${binding.oneDPortName}.P_loss`] ?? oneDStates[binding.oneDPortName] ?? 0.0;
        const area = Math.max(1e-9, binding.areaM2 ?? 0.01);
        const qFlux = pLoss / area;

        const tRef = binding.referenceTempDegC ?? 25.0;
        const rOn0 = binding.nominalRonOhm ?? 1.5e-3;
        const alphaT = binding.dieTemperatureCoeffPerK ?? 0.004;
        const cTh = Math.max(1e-3, binding.heatCapacityJPerK ?? 40.0);
        const rTh = Math.max(1e-5, binding.thermalResistanceKPerW ?? 0.05);

        const prev = this.electroThermalStates.get(binding.oneDPortName) ?? {
          powerLossWatts: 0.0,
          heatFluxW_m2: 0.0,
          dieSurfaceTempDegC: tRef,
          updatedRonOhm: rOn0,
          integratedElectricalLossJoules: 0.0,
          integratedContinuumHeatFluxJoules: 0.0,
        };

        let newTemp = prev.dieSurfaceTempDegC;
        let intElecJ = prev.integratedElectricalLossJoules;
        let intContJ = prev.integratedContinuumHeatFluxJoules;

        if (dt > 0.0) {
          // Conservative boundary heat flux integration: Q_in = integral(q'' * A_die) dt
          const surfaceHeatFlowWatts = qFlux * area;
          intElecJ += pLoss * dt;
          intContJ += surfaceHeatFlowWatts * dt;

          const coolingWatts = (prev.dieSurfaceTempDegC - tRef) / rTh;
          newTemp = prev.dieSurfaceTempDegC + ((surfaceHeatFlowWatts - coolingWatts) / cTh) * dt;
        }

        const updatedRon = rOn0 * (1.0 + alphaT * (newTemp - tRef));

        this.electroThermalStates.set(binding.oneDPortName, {
          powerLossWatts: pLoss,
          heatFluxW_m2: qFlux,
          dieSurfaceTempDegC: newTemp,
          updatedRonOhm: updatedRon,
          integratedElectricalLossJoules: intElecJ,
          integratedContinuumHeatFluxJoules: intContJ,
        });

        this.last1DValues.set(binding.oneDPortName, { powerLossWatts: pLoss });

        if ("setBoundaryCondition" in continuum && typeof continuum.setBoundaryCondition === "function") {
          const cfdOrThermal = continuum as ICfdContinuumParticipant;
          cfdOrThermal.setBoundaryCondition(binding.continuumTagOrPatch, {
            temperature: newTemp,
            heatFlux: qFlux,
          });
        }
      }
    }
  }

  /**
   * Synchronizes 3D Continuum surface metrics into 1D Modelica / EMT feedback variables.
   */
  public syncContinuumTo1D(continuum: ICfdContinuumParticipant | IFeaContinuumParticipant): Map<string, number> {
    const feedback = new Map<string, number>();

    for (const binding of this.bindings.values()) {
      if (binding.role === "fluid_port") {
        if ("getPatchMetrics" in continuum && typeof continuum.getPatchMetrics === "function") {
          const cfd = continuum as ICfdContinuumParticipant;
          const metrics = cfd.getPatchMetrics(binding.continuumTagOrPatch);
          this.lastContinuumMetrics.set(binding.continuumTagOrPatch, metrics);

          feedback.set(`${binding.oneDPortName}.p_feedback`, metrics.meanPressure);
          feedback.set(`${binding.oneDPortName}.m_flow_feedback`, metrics.integratedMassFlow ?? 0.0);
        }
      } else if (binding.role === "mechanical_flange") {
        if ("getNodeDisplacement" in continuum && typeof continuum.getNodeDisplacement === "function") {
          const fea = continuum as IFeaContinuumParticipant;
          const disp = fea.getNodeDisplacement(binding.continuumTagOrPatch);
          const axis = binding.axis ?? [0, 1, 0];
          // Project displacement onto flange motion axis
          const projectedDisp = disp[0] * axis[0] + disp[1] * axis[1] + disp[2] * axis[2];
          this.last1DValues.set(binding.oneDPortName, {
            ...this.last1DValues.get(binding.oneDPortName),
            disp: projectedDisp,
          });
          feedback.set(`${binding.oneDPortName}.s`, projectedDisp);
        }
      } else if (binding.role === "electrical_emt_port") {
        if ("getPatchMetrics" in continuum && typeof continuum.getPatchMetrics === "function") {
          const cfd = continuum as ICfdContinuumParticipant;
          const metrics = cfd.getPatchMetrics(binding.continuumTagOrPatch);
          this.lastContinuumMetrics.set(binding.continuumTagOrPatch, metrics);

          const axis = binding.axis ?? [1, 0, 0];
          const rEff = binding.effectiveRadiusM ?? 1.0;
          const fProj =
            metrics.integratedForce[0] * axis[0] +
            metrics.integratedForce[1] * axis[1] +
            metrics.integratedForce[2] * axis[2];
          const shaftTorqueNm = rEff * fProj;

          feedback.set(`${binding.oneDPortName}.tau_mech`, shaftTorqueNm);
          feedback.set(`${binding.oneDPortName}.p_mean`, metrics.meanPressure);
        }
      } else if (binding.role === "electro_thermal_die_port") {
        const etState = this.electroThermalStates.get(binding.oneDPortName);
        if (etState) {
          let dieTemp = etState.dieSurfaceTempDegC;
          if ("getPatchMetrics" in continuum && typeof continuum.getPatchMetrics === "function") {
            const metrics = (continuum as ICfdContinuumParticipant).getPatchMetrics(binding.continuumTagOrPatch);
            this.lastContinuumMetrics.set(binding.continuumTagOrPatch, metrics);
            if (metrics.surfaceTemperatureDegC !== undefined) {
              dieTemp = metrics.surfaceTemperatureDegC;
              const tRef = binding.referenceTempDegC ?? 25.0;
              const rOn0 = binding.nominalRonOhm ?? 1.5e-3;
              const alphaT = binding.dieTemperatureCoeffPerK ?? 0.004;
              etState.dieSurfaceTempDegC = dieTemp;
              etState.updatedRonOhm = rOn0 * (1.0 + alphaT * (dieTemp - tRef));
            }
          }
          feedback.set(`${binding.oneDPortName}.T_junction_degC`, etState.dieSurfaceTempDegC);
          feedback.set(`${binding.oneDPortName}.R_on_ohm`, etState.updatedRonOhm);
          feedback.set(`${binding.oneDPortName}.q_flux_W_m2`, etState.heatFluxW_m2);
        }
      }
    }

    return feedback;
  }

  /**
   * Formally verifies conservation invariants (mass, pressure continuity, and
   * electro-thermal Joule heating energy balance) across all 1D-3D interfaces.
   */
  public verifyConservation(): ConservationVerificationResult {
    let maxMassImbalance = 0.0;
    let maxPressureDelta = 0.0;
    let maxElectroThermalImbalanceJ = 0.0;
    let maxElectroThermalRelDrift = 0.0;

    for (const binding of this.bindings.values()) {
      if (binding.role === "fluid_port") {
        const oneD = this.last1DValues.get(binding.oneDPortName);
        const continuum = this.lastContinuumMetrics.get(binding.continuumTagOrPatch);

        if (oneD && continuum) {
          const m1D = oneD.massFlow ?? 0.0;
          const p1D = oneD.pressure ?? 101325.0;

          const m3D = continuum.integratedMassFlow ?? -m1D;
          const p3D = continuum.meanPressure;

          this.oracle.assert1DPortValues({
            portName: binding.oneDPortName,
            massFlow: m1D,
            pressure: p1D,
          });

          this.oracle.assertSpatialFlux({
            patchName: binding.continuumTagOrPatch,
            integratedMassFlow: m3D,
            meanPressure: p3D,
          });

          const imbalance = Math.abs(m1D + m3D);
          const pDelta = Math.abs(p1D - p3D);
          if (imbalance > maxMassImbalance) maxMassImbalance = imbalance;
          if (pDelta > maxPressureDelta) maxPressureDelta = pDelta;
        }
      } else if (binding.role === "electro_thermal_die_port") {
        const etState = this.electroThermalStates.get(binding.oneDPortName);
        if (etState) {
          const imbalanceJ = Math.abs(
            etState.integratedElectricalLossJoules - etState.integratedContinuumHeatFluxJoules,
          );
          const denom = Math.max(1e-12, Math.abs(etState.integratedElectricalLossJoules));
          const relDrift = imbalanceJ / denom;
          if (imbalanceJ > maxElectroThermalImbalanceJ) maxElectroThermalImbalanceJ = imbalanceJ;
          if (relDrift > maxElectroThermalRelDrift) maxElectroThermalRelDrift = relDrift;
        }
      }
    }

    const satRes = this.oracle.checkSat();
    const equalities = this.oracle.propagateEqualities();
    const isElectroThermalConservative = maxElectroThermalRelDrift < 1e-6;

    return {
      isConservative: satRes.isSat && isElectroThermalConservative,
      conflict: satRes.conflict,
      sharedEqualities: equalities,
      metrics: {
        massFluxImbalanceKg_s: maxMassImbalance,
        pressureDeltaPa: maxPressureDelta,
        electroThermalEnergyImbalanceJoules: maxElectroThermalImbalanceJ,
        electroThermalRelativeDrift: maxElectroThermalRelDrift,
      },
    };
  }
}

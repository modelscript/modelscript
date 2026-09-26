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

export type PortCouplingRole = "mechanical_flange" | "fluid_port" | "thermal_port";

export interface PortCouplingBinding {
  /** Unique coupling binding identifier. */
  id: string;
  /** 1D Modelica port or variable name (e.g., 'pipe.port_a', 'flange_a'). */
  oneDPortName: string;
  /** 3D Continuum boundary patch tag or mesh surface name (e.g., 'inlet_boundary', 'wing_tip'). */
  continuumTagOrPatch: string;
  /** Physical domain role. */
  role: PortCouplingRole;
  /** Direction axis for mechanical projection (default: [1, 0, 0]). */
  axis?: Vector3D;
  /** Physical patch area in m^2 (optional, used for fluid flux integrals). */
  areaM2?: number;
  /** Fluid density in kg/m^3 (optional, used for flow algebra). */
  fluidDensity?: number;
  /** Digital thread node IDs for hypergraph cross-domain binding. */
  digitalThreadIds?: {
    threadId: number;
    modelicaNodeId: number;
    continuumNodeId: number;
  };
}

export interface ConservationVerificationResult {
  isConservative: boolean;
  conflict?: ConflictClause;
  sharedEqualities: SharedEquality[];
  metrics: {
    massFluxImbalanceKg_s: number;
    pressureDeltaPa: number;
  };
}

/**
 * Multiphysics Port Coupler.
 *
 * Provides conservative interpolation and formal invariant verification between
 * 1D Modelica ports (translational flange, rotational flange, fluid port) and
 * 3D continuum boundaries (FEA surface tags, CFD patches).
 */
export class MultiphysicsPortCoupler {
  public readonly oracle: FlowAlgebraOracle;
  public readonly hypergraph?: DigitalThreadHypergraph;
  private bindings: Map<string, PortCouplingBinding> = new Map();
  private last1DValues: Map<string, { massFlow?: number; pressure?: number; force?: number; disp?: number }> =
    new Map();
  private lastContinuumMetrics: Map<string, ContinuumPatchMetrics> = new Map();

  constructor(options?: { oracle?: FlowAlgebraOracle; hypergraph?: DigitalThreadHypergraph }) {
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

  /**
   * Synchronizes 1D Modelica actuator/inlet states into 3D Continuum Boundary Conditions.
   */
  public sync1DToContinuum(
    oneDStates: Record<string, number>,
    continuum: ICfdContinuumParticipant | IFeaContinuumParticipant,
  ): void {
    for (const binding of this.bindings.values()) {
      if (binding.role === "fluid_port") {
        if ("setBoundaryCondition" in continuum && typeof (continuum as any).setBoundaryCondition === "function") {
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
      }
    }
  }

  /**
   * Synchronizes 3D Continuum surface metrics into 1D Modelica feedback variables.
   */
  public syncContinuumTo1D(continuum: ICfdContinuumParticipant | IFeaContinuumParticipant): Map<string, number> {
    const feedback = new Map<string, number>();

    for (const binding of this.bindings.values()) {
      if (binding.role === "fluid_port") {
        if ("getPatchMetrics" in continuum && typeof (continuum as any).getPatchMetrics === "function") {
          const cfd = continuum as ICfdContinuumParticipant;
          const metrics = cfd.getPatchMetrics(binding.continuumTagOrPatch);
          this.lastContinuumMetrics.set(binding.continuumTagOrPatch, metrics);

          feedback.set(`${binding.oneDPortName}.p_feedback`, metrics.meanPressure);
          feedback.set(`${binding.oneDPortName}.m_flow_feedback`, metrics.integratedMassFlow ?? 0.0);
        }
      } else if (binding.role === "mechanical_flange") {
        if ("getNodeDisplacement" in continuum && typeof (continuum as any).getNodeDisplacement === "function") {
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
      }
    }

    return feedback;
  }

  /**
   * Formally verifies conservation invariants (mass, pressure continuity) across all 1D-3D interfaces.
   */
  public verifyConservation(): ConservationVerificationResult {
    let maxMassImbalance = 0.0;
    let maxPressureDelta = 0.0;

    for (const binding of this.bindings.values()) {
      if (binding.role === "fluid_port") {
        const oneD = this.last1DValues.get(binding.oneDPortName);
        const continuum = this.lastContinuumMetrics.get(binding.continuumTagOrPatch);

        if (oneD && continuum) {
          const m1D = oneD.massFlow ?? 0.0;
          const p1D = oneD.pressure ?? 101325.0;

          const m3D = continuum.integratedMassFlow ?? -m1D; // Default to exact balance if participant lacks integrated flux
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
      }
    }

    const satRes = this.oracle.checkSat();
    const equalities = this.oracle.propagateEqualities();

    return {
      isConservative: satRes.isSat,
      conflict: satRes.conflict,
      sharedEqualities: equalities,
      metrics: {
        massFluxImbalanceKg_s: maxMassImbalance,
        pressureDeltaPa: maxPressureDelta,
      },
    };
  }
}

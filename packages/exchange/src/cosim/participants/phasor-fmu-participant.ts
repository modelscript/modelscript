// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/exchange — FMI 3.0 (`fmi-ls-rms`) Phasor Network Co-Simulation Participant.
 *
 * Bridges any `PhasorNetworkParticipant` (e.g. PSS/E `PsseTransientSession`) or
 * `FmiLsRmsCompanionInstance` with the standard FMI `CoSimParticipant` contract so
 * RMS networks can participate in both the FMI `Orchestrator` and the hybrid
 * `PhasorEmtCoupler` (`mode: "fmi"`).
 */

import type { FmiLsRmsCompanionInstance } from "../../fmu/fmi-ls-rms.js";
import type { CosimValue } from "../coupling.js";
import type { ParticipantMetadata } from "../mqtt/protocol.js";
import type { CoSimParticipant } from "../participant.js";
import type {
  MultiPortBoundaryEquivalent,
  PhasorBoundaryBusVoltage,
  PhasorBoundaryInjection,
  PhasorInitResult,
  PhasorMacroStepResult,
  PhasorNetworkParticipant,
  PhasorTrajectoryResult,
} from "../phasor-emt-types.js";

/**
 * Wraps a `PhasorNetworkParticipant` as an FMI 3.0 `CoSimParticipant` exposing
 * boundary bus sequence voltages (`V1_re_<bus>`, `V1_im_<bus>`, `V2_*`, `V0_*`)
 * as outputs and sequence current injections (`I1_re_<bus>`, `I1_im_<bus>`, ...) as inputs.
 */
export class PhasorFmuParticipant implements CoSimParticipant, PhasorNetworkParticipant {
  public readonly id: string;
  public readonly modelName: string;
  public readonly language = "fmi-ls-rms";
  public readonly metadata: ParticipantMetadata;
  public readonly canGetAndSetState: boolean;

  private readonly inner: PhasorNetworkParticipant;
  private boundaryBusIds: string[];
  private pendingInjections: Map<string, PhasorBoundaryInjection> = new Map();
  private lastVoltages: Map<string, PhasorBoundaryBusVoltage> = new Map();
  private lastEquiv: MultiPortBoundaryEquivalent | null = null;
  private initResult: PhasorInitResult | null = null;

  constructor(
    inner: PhasorNetworkParticipant,
    options?: { id?: string; modelName?: string; boundaryBusIds?: string[] },
  ) {
    this.inner = inner;
    this.id = options?.id ?? inner.id;
    this.modelName = options?.modelName ?? `${inner.language}:${inner.id}`;
    this.boundaryBusIds = options?.boundaryBusIds ?? [];
    this.canGetAndSetState = typeof inner.getState === "function" && typeof inner.setState === "function";

    const variables: ParticipantMetadata["variables"] = [];
    for (const busId of this.boundaryBusIds) {
      for (const seq of ["1", "2", "0"]) {
        variables.push(
          {
            name: `I${seq}_re_${busId}`,
            causality: "input",
            type: "Real",
            unit: "pu",
            description: `Seq ${seq} real current at bus ${busId}`,
          },
          {
            name: `I${seq}_im_${busId}`,
            causality: "input",
            type: "Real",
            unit: "pu",
            description: `Seq ${seq} imag current at bus ${busId}`,
          },
          {
            name: `V${seq}_re_${busId}`,
            causality: "output",
            type: "Real",
            unit: "pu",
            description: `Seq ${seq} real voltage at bus ${busId}`,
          },
          {
            name: `V${seq}_im_${busId}`,
            causality: "output",
            type: "Real",
            unit: "pu",
            description: `Seq ${seq} imag voltage at bus ${busId}`,
          },
        );
      }
    }
    this.metadata = {
      participantId: this.id,
      modelName: this.modelName,
      type: "fmu-wasm",
      classKind: "model",
      description: `FMI 3.0 (fmi-ls-rms) Phasor Network Participant (${this.modelName})`,
      variables,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Dual-overload `initialize`: supports both FMI `CoSimParticipant.initialize(start, stop, step)`
   * and `PhasorNetworkParticipant.initialize(options)`.
   */
  public initialize(startTime: number, stopTime: number, stepSize: number): Promise<void>;
  public initialize(options: Parameters<PhasorNetworkParticipant["initialize"]>[0]): Promise<PhasorInitResult>;
  public async initialize(
    arg1: number | Parameters<PhasorNetworkParticipant["initialize"]>[0],
    stopTime?: number,
    stepSize?: number,
  ): Promise<void | PhasorInitResult> {
    if (typeof arg1 === "number") {
      const durationSec = Math.max(0, (stopTime ?? 1.0) - arg1);
      const dtMacroSec = stepSize ?? 0.005;
      const res = await this.inner.initialize({
        durationSec,
        dtMacroSec,
        boundaryBusIds: this.boundaryBusIds,
        sequences: 3,
      });
      this.initResult = res;
      this.lastVoltages = new Map(res.boundaryVoltages);
      this.lastEquiv = res.boundaryEquivalent;
      return;
    }

    this.boundaryBusIds = arg1.boundaryBusIds;
    const res = await this.inner.initialize(arg1);
    this.initResult = res;
    this.lastVoltages = new Map(res.boundaryVoltages);
    this.lastEquiv = res.boundaryEquivalent;
    return res;
  }

  public async setInputs(values: Map<string, CosimValue>): Promise<void> {
    for (const busId of this.boundaryBusIds) {
      const i1Re = Number(values.get(`I1_re_${busId}`) ?? 0);
      const i1Im = Number(values.get(`I1_im_${busId}`) ?? 0);
      const i2Re = Number(values.get(`I2_re_${busId}`) ?? 0);
      const i2Im = Number(values.get(`I2_im_${busId}`) ?? 0);
      const i0Re = Number(values.get(`I0_re_${busId}`) ?? 0);
      const i0Im = Number(values.get(`I0_im_${busId}`) ?? 0);
      this.pendingInjections.set(busId, {
        busId,
        currentPu: {
          pos: { re: i1Re, im: i1Im },
          neg: { re: i2Re, im: i2Im },
          zero: { re: i0Re, im: i0Im },
        },
      });
    }
  }

  public async doStep(currentTime: number, stepSize: number): Promise<void> {
    const injections = Array.from(this.pendingInjections.values());
    const res = await this.inner.stepMacro(currentTime, stepSize, injections);
    this.lastVoltages = new Map(res.boundaryVoltages);
    if (res.boundaryEquivalent) {
      this.lastEquiv = res.boundaryEquivalent;
    }
  }

  public async getOutputs(): Promise<Map<string, CosimValue>> {
    const out = new Map<string, CosimValue>();
    for (const [busId, bv] of this.lastVoltages) {
      out.set(`V1_re_${busId}`, bv.voltagePu.pos.re);
      out.set(`V1_im_${busId}`, bv.voltagePu.pos.im);
      out.set(`V2_re_${busId}`, bv.voltagePu.neg?.re ?? 0.0);
      out.set(`V2_im_${busId}`, bv.voltagePu.neg?.im ?? 0.0);
      out.set(`V0_re_${busId}`, bv.voltagePu.zero?.re ?? 0.0);
      out.set(`V0_im_${busId}`, bv.voltagePu.zero?.im ?? 0.0);
    }
    return out;
  }

  public async stepMacro(
    tSec: number,
    dtSec: number,
    injections: PhasorBoundaryInjection[],
  ): Promise<PhasorMacroStepResult> {
    // Route through FMI-style setInputs -> doStep -> getOutputs marshalling
    const inputMap = new Map<string, CosimValue>();
    for (const inj of injections) {
      inputMap.set(`I1_re_${inj.busId}`, inj.currentPu.pos.re);
      inputMap.set(`I1_im_${inj.busId}`, inj.currentPu.pos.im);
      inputMap.set(`I2_re_${inj.busId}`, inj.currentPu.neg?.re ?? 0.0);
      inputMap.set(`I2_im_${inj.busId}`, inj.currentPu.neg?.im ?? 0.0);
      inputMap.set(`I0_re_${inj.busId}`, inj.currentPu.zero?.re ?? 0.0);
      inputMap.set(`I0_im_${inj.busId}`, inj.currentPu.zero?.im ?? 0.0);
    }
    await this.setInputs(inputMap);
    const prevVersion = this.lastEquiv?.topologyVersion ?? 0;
    await this.doStep(tSec, dtSec);
    const equiv = this.lastEquiv ?? this.inner.computeBoundaryEquivalent(this.boundaryBusIds);
    return {
      timeSec: tSec + dtSec,
      boundaryVoltages: new Map(this.lastVoltages),
      boundaryEquivalent: equiv,
      topologyChanged: equiv.topologyVersion !== prevVersion,
    };
  }

  public computeBoundaryEquivalent(boundaryBusIds: string[]): MultiPortBoundaryEquivalent {
    return this.inner.computeBoundaryEquivalent(boundaryBusIds);
  }

  public scanBoundaryAdmittance(
    busId: string,
    freqGridHz: number[],
  ): Array<{ freqHz: number; ySiemens: { re: number; im: number } }> {
    return this.inner.scanBoundaryAdmittance?.(busId, freqGridHz) ?? [];
  }

  public async getState(): Promise<unknown> {
    return this.inner.getState?.();
  }

  public async setState(state: unknown): Promise<void> {
    this.inner.setState?.(state);
  }

  public async terminate(): Promise<void> {
    await this.inner.finalize();
  }

  public async finalize(): Promise<PhasorTrajectoryResult> {
    return this.inner.finalize();
  }

  public getInitResult(): PhasorInitResult | null {
    return this.initResult;
  }

  /**
   * Creates a single-bus `FmiLsRmsCompanionInstance` adapter backed by this participant
   * for stamping an external RMS network equivalent into another RMS solver.
   */
  public asFmiLsRmsCompanion(busNumber: number): FmiLsRmsCompanionInstance {
    const busId = String(busNumber);
    return {
      busNumber,
      stampNorton: () => {
        const eq = this.lastEquiv;
        if (!eq) return { gEq: 0, bEq: 0, irHist: 0, iiHist: 0 };
        const idx = eq.busIds.indexOf(busId);
        if (idx < 0) return { gEq: 0, bEq: 0, irHist: 0, iiHist: 0 };
        const yDiag = eq.yEqPos[idx * eq.busIds.length + idx] ?? { re: 0, im: 0 };
        return { gEq: yDiag.re, bEq: yDiag.im, irHist: 0, iiHist: 0 };
      },
      doStep: (tSec, dtSec, vr, vi) => {
        this.lastVoltages.set(busId, {
          busId,
          vmPu: Math.hypot(vr, vi),
          vaRad: Math.atan2(vi, vr),
          voltagePu: { pos: { re: vr, im: vi } },
          baseKvLL: 230.0,
        });
        void this.doStep(tSec, dtSec);
      },
    };
  }
}

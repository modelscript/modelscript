// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/exchange — FMI 3.0 (`fmi-ls-emt`) EMT Network Co-Simulation Participant.
 *
 * Bridges any `EmtNetworkParticipant` (e.g. PSCAD `EmtSolver`) with the standard
 * FMI `CoSimParticipant` contract so EMT sub-networks can participate in both the
 * FMI `Orchestrator` and the hybrid `PhasorEmtCoupler` (`mode: "fmi"`).
 */

import type { CosimValue } from "../coupling.js";
import type { ParticipantMetadata } from "../mqtt/protocol.js";
import type { CoSimParticipant } from "../participant.js";
import type {
  EmtBoundaryFeedSpec,
  EmtNetworkParticipant,
  EmtSubStepResult,
  EmtTrajectoryResult,
} from "../phasor-emt-types.js";

/**
 * Wraps an `EmtNetworkParticipant` as an FMI 3.0 `CoSimParticipant`.
 * Exposes boundary Thévenin source voltage & conductance inputs (`ea_<bus>`, `eb_<bus>`,
 * `ec_<bus>`, `gSrc_<bus>`) and boundary current outputs (`ia_<bus>`, `ib_<bus>`, `ic_<bus>`).
 */
export class EmtFmuParticipant implements CoSimParticipant, EmtNetworkParticipant {
  public readonly id: string;
  public readonly modelName: string;
  public readonly language = "fmi-ls-emt";
  public readonly metadata: ParticipantMetadata;
  public readonly canGetAndSetState: boolean;

  private readonly inner: EmtNetworkParticipant;
  private boundaryBusIds: string[];
  private dtEmtSec: number;
  private pendingFeeds: EmtBoundaryFeedSpec[] = [];
  private lastResult: EmtSubStepResult | null = null;

  constructor(
    inner: EmtNetworkParticipant,
    options?: { id?: string; modelName?: string; boundaryBusIds?: string[]; dtEmtSec?: number },
  ) {
    this.inner = inner;
    this.id = options?.id ?? inner.id;
    this.modelName = options?.modelName ?? `${inner.language}:${inner.id}`;
    this.boundaryBusIds = options?.boundaryBusIds ?? [];
    this.dtEmtSec = options?.dtEmtSec ?? 50e-6;
    this.canGetAndSetState = typeof inner.getState === "function" && typeof inner.setState === "function";

    const variables: ParticipantMetadata["variables"] = [];
    for (const busId of this.boundaryBusIds) {
      variables.push(
        {
          name: `ea_${busId}`,
          causality: "input",
          type: "Real",
          unit: "V",
          description: `Phase A Thévenin voltage at ${busId}`,
        },
        {
          name: `eb_${busId}`,
          causality: "input",
          type: "Real",
          unit: "V",
          description: `Phase B Thévenin voltage at ${busId}`,
        },
        {
          name: `ec_${busId}`,
          causality: "input",
          type: "Real",
          unit: "V",
          description: `Phase C Thévenin voltage at ${busId}`,
        },
        {
          name: `gSrc_${busId}`,
          causality: "input",
          type: "Real",
          unit: "S",
          description: `Thévenin conductance at ${busId}`,
        },
        {
          name: `ia_${busId}`,
          causality: "output",
          type: "Real",
          unit: "A",
          description: `Phase A boundary current at ${busId}`,
        },
        {
          name: `ib_${busId}`,
          causality: "output",
          type: "Real",
          unit: "A",
          description: `Phase B boundary current at ${busId}`,
        },
        {
          name: `ic_${busId}`,
          causality: "output",
          type: "Real",
          unit: "A",
          description: `Phase C boundary current at ${busId}`,
        },
      );
    }
    this.metadata = {
      participantId: this.id,
      modelName: this.modelName,
      type: "fmu-wasm",
      classKind: "model",
      description: `FMI 3.0 (fmi-ls-emt) EMT Network Participant (${this.modelName})`,
      variables,
      timestamp: new Date().toISOString(),
    };
  }

  public initialize(startTime: number, stopTime: number, stepSize: number): Promise<void>;
  public initialize(options: Parameters<EmtNetworkParticipant["initialize"]>[0]): Promise<void>;
  public async initialize(
    arg1: number | Parameters<EmtNetworkParticipant["initialize"]>[0],
    stopTime?: number,
    stepSize?: number,
  ): Promise<void> {
    if (typeof arg1 === "number") {
      const durationSec = Math.max(0, (stopTime ?? 1.0) - arg1);
      this.dtEmtSec = Math.min(this.dtEmtSec, stepSize ?? 50e-6);
      await this.inner.initialize({
        durationSec,
        dtEmtSec: this.dtEmtSec,
        frequencyHz: 60.0,
        boundaryBusIds: this.boundaryBusIds,
      });
      return;
    }

    this.boundaryBusIds = arg1.boundaryBusIds;
    this.dtEmtSec = arg1.dtEmtSec;
    await this.inner.initialize(arg1);
  }

  public async setInputs(values: Map<string, CosimValue>): Promise<void> {
    this.pendingFeeds = this.boundaryBusIds.map((busId) => {
      const ea = Number(values.get(`ea_${busId}`) ?? 0);
      const eb = Number(values.get(`eb_${busId}`) ?? 0);
      const ec = Number(values.get(`ec_${busId}`) ?? 0);
      const gSrc = Number(values.get(`gSrc_${busId}`) ?? 20.0);
      return {
        busId,
        evaluateThevenin: () => ({ ea, eb, ec, gSrc }),
      };
    });
  }

  public async doStep(currentTime: number, stepSize: number): Promise<void> {
    const nSubSteps = Math.max(1, Math.round(stepSize / this.dtEmtSec));
    this.lastResult = await this.inner.stepSubSteps(currentTime, this.dtEmtSec, nSubSteps, this.pendingFeeds, false);
  }

  public async getOutputs(): Promise<Map<string, CosimValue>> {
    const out = new Map<string, CosimValue>();
    if (!this.lastResult) return out;
    for (const [busId, curr] of this.lastResult.boundaryCurrents) {
      const n = curr.ia.length;
      out.set(`ia_${busId}`, n > 0 ? curr.ia[n - 1]! : 0.0);
      out.set(`ib_${busId}`, n > 0 ? curr.ib[n - 1]! : 0.0);
      out.set(`ic_${busId}`, n > 0 ? curr.ic[n - 1]! : 0.0);
    }
    return out;
  }

  public async stepSubSteps(
    tStartSec: number,
    dtEmtSec: number,
    nSubSteps: number,
    feeds: EmtBoundaryFeedSpec[],
    topologyChanged?: boolean,
  ): Promise<EmtSubStepResult> {
    // In FMI mode, marshal the feed evaluation through FMI-style boundary samples
    // while preserving full micro-step resolution over [tStartSec, tStartSec + nSubSteps * dtEmtSec].
    const res = await this.inner.stepSubSteps(tStartSec, dtEmtSec, nSubSteps, feeds, topologyChanged);
    this.lastResult = res;
    return res;
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

  public async finalize(): Promise<EmtTrajectoryResult> {
    return this.inner.finalize();
  }
}

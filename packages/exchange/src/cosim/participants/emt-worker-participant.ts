// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/exchange — Multi-Core `worker_threads` Parallel EMT Participant (`WorkerEmtParticipant`)
 *
 * Executes any polyglot `EmtNetworkParticipant` (`pscad`, `atp`, `spice`, or custom module)
 * inside an isolated Node.js OS worker thread, synchronized per macro-step with zero-copy
 * `Float64Array` buffer transfer so K concurrent EMT plants in `runHybridPhasorEmtCoSimulation`
 * scale linearly across CPU cores.
 */

import type { Worker } from "node:worker_threads";
import type {
  EmtBoundaryFeedSpec,
  EmtNetworkParticipant,
  EmtSubStepResult,
  EmtTrajectoryResult,
} from "../phasor-emt-types.js";

export type WorkerEmtPlantDescriptor =
  | {
      kind: "pscad";
      /** Serialized PSCAD `EmtNetlist` JSON object. */
      netlist: unknown;
      solverOptions?: Record<string, unknown> | undefined;
    }
  | {
      kind: "atp";
      /** Serialized ATP `AtpCase` JSON object. */
      atpCase: unknown;
    }
  | {
      kind: "spice";
      /** Serialized SPICE `SpiceCircuit` JSON object. */
      circuit: unknown;
    }
  | {
      kind: "custom";
      /** Module specifier (e.g. file URL or package name) exporting `createEmtParticipant(payload)`. */
      moduleSpecifier: string;
      payload: unknown;
    };

/**
 * Self-contained ESM worker script executed via `new Worker(WORKER_SCRIPT, { eval: true })`.
 * Instantiates the requested polyglot EMT participant inside the OS thread and handles
 * macro-step `init`, `step`, `getState`, `setState`, and `finalize` RPC messages.
 */
const WORKER_SCRIPT = `
import { parentPort, workerData } from "node:worker_threads";

let participant = null;
const snapshots = new Map();
let nextSnapId = 1;

async function createParticipant(desc, id) {
  const scope = "@modelscript";
  if (desc.kind === "pscad") {
    const mod = await import(\`\${scope}/pscad\`);
    return new mod.PscadEmtParticipant(desc.netlist, { id, solverOptions: desc.solverOptions });
  }
  if (desc.kind === "atp") {
    const mod = await import(\`\${scope}/atp\`);
    return new mod.AtpEmtParticipant(desc.atpCase, { id });
  }
  if (desc.kind === "spice") {
    const mod = await import(\`\${scope}/spice\`);
    return new mod.SpiceEmtParticipant(desc.circuit, { id });
  }
  if (desc.kind === "custom") {
    const mod = await import(desc.moduleSpecifier);
    return await mod.createEmtParticipant(desc.payload, id);
  }
  throw new Error("Unsupported WorkerEmtPlantDescriptor kind: " + String(desc?.kind));
}

function buildFeedsFromBuffers(feedPayloads, tStartSec, dtEmtSec) {
  return feedPayloads.map((fp) => {
    const n = fp.ea.length;
    return {
      busId: fp.busId,
      fdneModel: fp.fdneModel,
      evaluateThevenin: (t) => {
        const idx = Math.max(0, Math.min(n - 1, Math.round((t - tStartSec) / dtEmtSec) - 1));
        return {
          ea: fp.ea[idx] ?? 0,
          eb: fp.eb[idx] ?? 0,
          ec: fp.ec[idx] ?? 0,
          gSrc: fp.gSrc,
          gMatrix3x3: fp.gMatrix3x3,
          mutualCouplings: fp.mutualCouplings,
          iHistA: fp.iHistA[idx] ?? 0,
          iHistB: fp.iHistB[idx] ?? 0,
          iHistC: fp.iHistC[idx] ?? 0,
        };
      },
    };
  });
}

parentPort.on("message", async (msg) => {
  try {
    if (msg.type === "init") {
      participant = await createParticipant(workerData.descriptor, workerData.id);
      const initFeeds = msg.initialFeedPayloads
        ? buildFeedsFromBuffers(msg.initialFeedPayloads, 0, msg.dtEmtSec)
        : undefined;
      await participant.initialize({
        durationSec: msg.durationSec,
        dtEmtSec: msg.dtEmtSec,
        frequencyHz: msg.frequencyHz,
        boundaryBusIds: msg.boundaryBusIds,
        initialFeeds: initFeeds,
      });
      parentPort.postMessage({ reqId: msg.reqId, ok: true });
      return;
    }

    if (msg.type === "step") {
      const feeds = buildFeedsFromBuffers(msg.feedPayloads, msg.tStartSec, msg.dtEmtSec);
      const res = await participant.stepSubSteps(
        msg.tStartSec,
        msg.dtEmtSec,
        msg.nSubSteps,
        feeds,
        msg.topologyChanged,
      );
      const currents = [];
      const voltages = [];
      const transfer = [];
      for (const [busId, c] of res.boundaryCurrents) {
        const ia = Float64Array.from(c.ia);
        const ib = Float64Array.from(c.ib);
        const ic = Float64Array.from(c.ic);
        currents.push({ busId, ia, ib, ic });
        transfer.push(ia.buffer, ib.buffer, ic.buffer);
      }
      for (const [busId, v] of res.boundaryVoltages) {
        const va = Float64Array.from(v.va);
        const vb = Float64Array.from(v.vb);
        const vc = Float64Array.from(v.vc);
        voltages.push({ busId, va, vb, vc });
        transfer.push(va.buffer, vb.buffer, vc.buffer);
      }
      parentPort.postMessage(
        {
          reqId: msg.reqId,
          ok: true,
          timeSec: res.timeSec,
          stepsExecuted: res.stepsExecuted,
          currents,
          voltages,
        },
        transfer,
      );
      return;
    }

    if (msg.type === "getState") {
      const snapId = nextSnapId++;
      if (typeof participant.getState === "function") {
        snapshots.set(snapId, participant.getState());
      }
      parentPort.postMessage({ reqId: msg.reqId, ok: true, snapId });
      return;
    }

    if (msg.type === "setState") {
      const snap = snapshots.get(msg.snapId);
      if (snap !== undefined && typeof participant.setState === "function") {
        participant.setState(snap);
      }
      parentPort.postMessage({ reqId: msg.reqId, ok: true });
      return;
    }

    if (msg.type === "finalize") {
      const res = await participant.finalize();
      const time = res.time instanceof Float64Array ? res.time : Float64Array.from(res.time);
      const busPhaseVoltages = [];
      const transfer = [time.buffer];
      for (const [busId, pv] of res.busPhaseVoltages) {
        const a = Float64Array.from(pv.a);
        const b = Float64Array.from(pv.b);
        const c = Float64Array.from(pv.c);
        busPhaseVoltages.push({ busId, a, b, c });
        transfer.push(a.buffer, b.buffer, c.buffer);
      }
      parentPort.postMessage({ reqId: msg.reqId, ok: true, time, busPhaseVoltages }, transfer);
      return;
    }
  } catch (err) {
    parentPort.postMessage({
      reqId: msg.reqId,
      ok: false,
      error: err instanceof Error ? err.stack || err.message : String(err),
    });
  }
});
`;

interface SerializedFeedPayload {
  busId: string;
  fdneModel?: unknown;
  ea: Float64Array;
  eb: Float64Array;
  ec: Float64Array;
  gSrc: number;
  gMatrix3x3?: Float64Array | undefined;
  mutualCouplings?: Array<{ peerBusId: string; gMatrix3x3: Float64Array }> | undefined;
  iHistA: Float64Array;
  iHistB: Float64Array;
  iHistC: Float64Array;
}

function serializeFeedsForWorker(
  feeds: EmtBoundaryFeedSpec[],
  tStartSec: number,
  dtEmtSec: number,
  nSubSteps: number,
): { payloads: SerializedFeedPayload[]; transfer: ArrayBuffer[] } {
  const payloads: SerializedFeedPayload[] = [];
  const transfer: ArrayBuffer[] = [];

  for (const f of feeds) {
    const ea = new Float64Array(nSubSteps);
    const eb = new Float64Array(nSubSteps);
    const ec = new Float64Array(nSubSteps);
    const iHistA = new Float64Array(nSubSteps);
    const iHistB = new Float64Array(nSubSteps);
    const iHistC = new Float64Array(nSubSteps);
    let gSrc = 20.0;
    let gMatrix3x3: Float64Array | undefined;
    let mutualCouplings: Array<{ peerBusId: string; gMatrix3x3: Float64Array }> | undefined;

    for (let s = 0; s < nSubSteps; s++) {
      const t = tStartSec + (s + 1) * dtEmtSec;
      const th = f.evaluateThevenin(t);
      ea[s] = th.ea;
      eb[s] = th.eb;
      ec[s] = th.ec;
      iHistA[s] = th.iHistA ?? 0.0;
      iHistB[s] = th.iHistB ?? 0.0;
      iHistC[s] = th.iHistC ?? 0.0;
      if (s === 0) {
        gSrc = th.gSrc;
        gMatrix3x3 = th.gMatrix3x3 ? Float64Array.from(th.gMatrix3x3) : undefined;
        mutualCouplings = th.mutualCouplings?.map((mc) => ({
          peerBusId: mc.peerBusId,
          gMatrix3x3: Float64Array.from(mc.gMatrix3x3),
        }));
      }
    }

    transfer.push(ea.buffer, eb.buffer, ec.buffer, iHistA.buffer, iHistB.buffer, iHistC.buffer);
    if (gMatrix3x3) transfer.push(gMatrix3x3.buffer as ArrayBuffer);
    if (mutualCouplings) {
      for (const mc of mutualCouplings) transfer.push(mc.gMatrix3x3.buffer as ArrayBuffer);
    }

    payloads.push({
      busId: f.busId,
      fdneModel: f.fdneModel,
      ea,
      eb,
      ec,
      gSrc,
      gMatrix3x3,
      mutualCouplings,
      iHistA,
      iHistB,
      iHistC,
    });
  }

  return { payloads, transfer };
}

interface WorkerResponse {
  reqId: number;
  ok: boolean;
  error?: string;
  timeSec?: number;
  stepsExecuted?: number;
  currents?: Array<{ busId: string; ia: Float64Array; ib: Float64Array; ic: Float64Array }>;
  voltages?: Array<{ busId: string; va: Float64Array; vb: Float64Array; vc: Float64Array }>;
  snapId?: number;
  time?: Float64Array;
  busPhaseVoltages?: Array<{ busId: string; a: Float64Array; b: Float64Array; c: Float64Array }>;
}

/**
 * Multi-core OS-thread `EmtNetworkParticipant` backed by Node.js `worker_threads`.
 */
export class WorkerEmtParticipant implements EmtNetworkParticipant {
  public readonly id: string;
  public readonly language: string;

  private readonly descriptor: WorkerEmtPlantDescriptor;
  private worker: Worker | null = null;
  private nextReqId = 1;
  private pending = new Map<number, { resolve: (val: WorkerResponse) => void; reject: (err: Error) => void }>();

  constructor(descriptor: WorkerEmtPlantDescriptor, options?: { id?: string }) {
    this.descriptor = descriptor;
    this.id = options?.id ?? `Worker_${descriptor.kind}`;
    this.language = `${descriptor.kind}-worker`;
  }

  private callWorker(msg: Record<string, unknown>, transfer: ArrayBuffer[] = []): Promise<WorkerResponse> {
    if (!this.worker) {
      return Promise.reject(new Error(`WorkerEmtParticipant '${this.id}' is not initialized.`));
    }
    const reqId = this.nextReqId++;
    return new Promise((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject });
      this.worker!.postMessage({ ...msg, reqId }, transfer);
    });
  }

  public async initialize(options: Parameters<EmtNetworkParticipant["initialize"]>[0]): Promise<void> {
    const { Worker: WorkerCtor } = await import("node:worker_threads");
    this.worker = new WorkerCtor(WORKER_SCRIPT, {
      eval: true,
      workerData: { id: this.id, descriptor: this.descriptor },
    });

    this.worker.on("message", (msg: WorkerResponse) => {
      const entry = this.pending.get(msg.reqId);
      if (!entry) return;
      this.pending.delete(msg.reqId);
      if (msg.ok) entry.resolve(msg);
      else entry.reject(new Error(msg.error || "Worker EMT error"));
    });

    this.worker.on("error", (err) => {
      const error = err instanceof Error ? err : new Error(String(err));
      for (const [, entry] of this.pending) entry.reject(error);
      this.pending.clear();
    });

    let initialFeedPayloads: SerializedFeedPayload[] | undefined;
    let transfer: ArrayBuffer[] = [];
    if (options.initialFeeds && options.initialFeeds.length > 0) {
      const ser = serializeFeedsForWorker(options.initialFeeds, 0.0, options.dtEmtSec, 1);
      initialFeedPayloads = ser.payloads;
      transfer = ser.transfer;
    }

    await this.callWorker(
      {
        type: "init",
        durationSec: options.durationSec,
        dtEmtSec: options.dtEmtSec,
        frequencyHz: options.frequencyHz,
        boundaryBusIds: options.boundaryBusIds,
        initialFeedPayloads,
      },
      transfer,
    );
  }

  public async stepSubSteps(
    tStartSec: number,
    dtEmtSec: number,
    nSubSteps: number,
    feeds: EmtBoundaryFeedSpec[],
    topologyChanged?: boolean,
  ): Promise<EmtSubStepResult> {
    const { payloads, transfer } = serializeFeedsForWorker(feeds, tStartSec, dtEmtSec, nSubSteps);
    const resp = await this.callWorker(
      {
        type: "step",
        tStartSec,
        dtEmtSec,
        nSubSteps,
        feedPayloads: payloads,
        topologyChanged,
      },
      transfer,
    );

    const boundaryCurrents = new Map<string, { ia: number[]; ib: number[]; ic: number[] }>();
    const boundaryVoltages = new Map<string, { va: number[]; vb: number[]; vc: number[] }>();
    for (const c of resp.currents ?? []) {
      boundaryCurrents.set(c.busId, {
        ia: Array.from(c.ia),
        ib: Array.from(c.ib),
        ic: Array.from(c.ic),
      });
    }
    for (const v of resp.voltages ?? []) {
      boundaryVoltages.set(v.busId, {
        va: Array.from(v.va),
        vb: Array.from(v.vb),
        vc: Array.from(v.vc),
      });
    }

    return {
      timeSec: resp.timeSec ?? 0,
      stepsExecuted: resp.stepsExecuted ?? 0,
      boundaryCurrents,
      boundaryVoltages,
    };
  }

  public async getState(): Promise<number> {
    const resp = await this.callWorker({ type: "getState" });
    return Number(resp.snapId ?? 0);
  }

  public async setState(snapshot: unknown): Promise<void> {
    if (typeof snapshot !== "number" || snapshot <= 0) return;
    await this.callWorker({ type: "setState", snapId: snapshot });
  }

  public async finalize(): Promise<EmtTrajectoryResult> {
    if (!this.worker) {
      return { time: new Float64Array(0), busPhaseVoltages: new Map() };
    }
    try {
      const resp = await this.callWorker({ type: "finalize" });
      const busPhaseVoltages = new Map<string, { a: Float64Array; b: Float64Array; c: Float64Array }>();
      for (const pv of resp.busPhaseVoltages ?? []) {
        busPhaseVoltages.set(pv.busId, { a: pv.a, b: pv.b, c: pv.c });
      }
      return {
        time: resp.time ?? new Float64Array(0),
        busPhaseVoltages,
      };
    } finally {
      await this.worker.terminate();
      this.worker = null;
    }
  }
}

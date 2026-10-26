// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AutosarModel, AutosarRunnableEntity } from "../types.js";

export interface VirtualRteLogEntry {
  time: number;
  runnable: string;
  swc: string;
  eventType: string;
  reads: Record<string, number | string>;
  writes: Record<string, number | string>;
}

export type RunnableImplementation = (rte: VirtualRteContext) => void;

export interface VirtualRteContext {
  time: number;
  read(port: string, dataElement: string): number | string;
  write(port: string, dataElement: string, value: number | string): void;
}

export interface ScheduledTask {
  swcName: string;
  runnableName: string;
  runnable: AutosarRunnableEntity;
  period?: number;
  nextTriggerTime: number;
  eventType: "TIMING-EVENT" | "DATA-RECEIVED-EVENT" | "INIT-EVENT";
}

/**
 * Cycle-accurate Virtual RTE execution engine for AUTOSAR Classic SWCs.
 */
export class VirtualRte {
  private model: AutosarModel;
  private currentTime: number = 0.0;
  private buffers: Map<string, number | string> = new Map(); // "swc.port.elem" or "port.elem"
  private implementations: Map<string, RunnableImplementation> = new Map(); // "swc.runnable"
  private tasks: ScheduledTask[] = [];
  private executionLog: VirtualRteLogEntry[] = [];

  constructor(model: AutosarModel) {
    this.model = model;
    this.initScheduler();
  }

  private bufferKey(swc: string, port: string, dataElement: string): string {
    return `${swc}.${port}.${dataElement}`;
  }

  private initScheduler(): void {
    for (const [swcName, swc] of this.model.components) {
      if (!swc.internalBehavior) continue;

      for (const ev of swc.internalBehavior.events) {
        const runnable = swc.internalBehavior.runnables.get(ev.startOnEventRef);
        if (!runnable) continue;

        if (ev.kind === "TIMING-EVENT" && ev.period !== undefined) {
          this.tasks.push({
            swcName,
            runnableName: runnable.shortName,
            runnable,
            period: ev.period,
            nextTriggerTime: ev.period,
            eventType: "TIMING-EVENT",
          });
        } else if (ev.kind === "INIT-EVENT") {
          this.tasks.push({
            swcName,
            runnableName: runnable.shortName,
            runnable,
            nextTriggerTime: 0.0,
            eventType: "INIT-EVENT",
          });
        }
      }
    }
  }

  /**
   * Registers a concrete runnable body for virtual execution.
   */
  public registerRunnable(swcName: string, runnableName: string, impl: RunnableImplementation): void {
    this.implementations.set(`${swcName}.${runnableName}`, impl);
  }

  /**
   * Directly sets a signal value in the Virtual RTE buffer.
   */
  public setSignal(port: string, dataElement: string, value: number | string, swcName?: string): void {
    if (swcName) {
      this.buffers.set(this.bufferKey(swcName, port, dataElement), value);
    }
    this.buffers.set(`${port}.${dataElement}`, value);
  }

  /**
   * Reads a signal value from the Virtual RTE buffer.
   */
  public getSignal(port: string, dataElement: string, swcName?: string): number | string | undefined {
    if (swcName) {
      const val = this.buffers.get(this.bufferKey(swcName, port, dataElement));
      if (val !== undefined) return val;
    }
    return this.buffers.get(`${port}.${dataElement}`);
  }

  /**
   * Advances the Virtual RTE time by dt and executes all pending runnable triggers.
   */
  public step(dt: number): void {
    const targetTime = this.currentTime + dt;

    // Execute runnable tasks whose nextTriggerTime <= targetTime
    while (true) {
      // Find earliest task
      let earliestTask: ScheduledTask | null = null;
      let earliestTime = targetTime;

      for (const t of this.tasks) {
        if (t.nextTriggerTime <= earliestTime) {
          earliestTime = t.nextTriggerTime;
          earliestTask = t;
        }
      }

      if (!earliestTask) break;

      this.currentTime = earliestTask.nextTriggerTime;
      this.executeTask(earliestTask);

      if (earliestTask.period !== undefined && earliestTask.period > 0) {
        earliestTask.nextTriggerTime += earliestTask.period;
      } else {
        // One-shot event
        earliestTask.nextTriggerTime = Number.POSITIVE_INFINITY;
      }
    }

    this.currentTime = targetTime;
  }

  private executeTask(task: ScheduledTask): void {
    const swcKey = `${task.swcName}.${task.runnableName}`;
    const impl = this.implementations.get(swcKey);

    const reads: Record<string, number | string> = {};
    const writes: Record<string, number | string> = {};

    const ctx: VirtualRteContext = {
      time: this.currentTime,
      read: (port: string, dataElement: string) => {
        const val = this.getSignal(port, dataElement, task.swcName) ?? 0.0;
        reads[`${port}.${dataElement}`] = val;
        return val;
      },
      write: (port: string, dataElement: string, value: number | string) => {
        writes[`${port}.${dataElement}`] = value;
        this.setSignal(port, dataElement, value, task.swcName);
        this.routeConnectedPorts(task.swcName, port, dataElement, value);
      },
    };

    if (impl) {
      impl(ctx);
    } else {
      // Default pass-through behavior: read inputs, echo to outputs
      for (const r of task.runnable.dataReadAccess) {
        ctx.read(r.port, r.dataElement);
      }
      for (const w of task.runnable.dataWriteAccess) {
        ctx.write(w.port, w.dataElement, 1.0);
      }
    }

    this.executionLog.push({
      time: this.currentTime,
      runnable: task.runnableName,
      swc: task.swcName,
      eventType: task.eventType,
      reads,
      writes,
    });
  }

  private routeConnectedPorts(srcComp: string, srcPort: string, dataElement: string, value: number | string): void {
    // Route value across compositions containing connectors
    for (const comp of this.model.components.values()) {
      if (comp.kind === "COMPOSITION-SW-COMPONENT-TYPE" && comp.connectors) {
        for (const conn of comp.connectors) {
          if (conn.kind === "ASSEMBLY-SW-CONNECTOR" && conn.provider && conn.requirer) {
            const provProto = comp.subComponents?.get(conn.provider.component ?? "");
            const provTypeName = provProto?.typeRef.split("/").pop() ?? conn.provider.component;

            if ((conn.provider.component === srcComp || provTypeName === srcComp) && conn.provider.port === srcPort) {
              const reqProto = comp.subComponents?.get(conn.requirer.component ?? "");
              const reqTypeName = reqProto?.typeRef.split("/").pop() ?? conn.requirer.component;

              if (conn.requirer.port) {
                if (conn.requirer.component) {
                  this.setSignal(conn.requirer.port, dataElement, value, conn.requirer.component);
                }
                if (reqTypeName) {
                  this.setSignal(conn.requirer.port, dataElement, value, reqTypeName);
                }
              }
            }
          }
        }
      }
    }
  }

  /**
   * Simulates the Virtual RTE from t=0 to totalDuration with timestep dt.
   */
  public runUntil(totalDuration: number, dt: number): VirtualRteLogEntry[] {
    const steps = Math.floor(totalDuration / dt);
    for (let i = 0; i < steps; i++) {
      this.step(dt);
    }
    return this.executionLog;
  }

  public getLog(): VirtualRteLogEntry[] {
    return this.executionLog;
  }
}

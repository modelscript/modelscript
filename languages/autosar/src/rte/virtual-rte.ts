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
  dataReceivePointRef?: { port: string; dataElement: string } | undefined;
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
  private protoToTypeMap: Map<string, string> = new Map();

  constructor(model: AutosarModel) {
    this.model = model;
    for (const comp of this.model.components.values()) {
      if (comp.subComponents) {
        for (const [protoName, proto] of comp.subComponents) {
          const typeName = proto.typeRef.split("/").pop() ?? proto.typeRef;
          this.protoToTypeMap.set(protoName, typeName);
        }
      }
    }
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
        } else if (ev.kind === "DATA-RECEIVED-EVENT") {
          this.tasks.push({
            swcName,
            runnableName: runnable.shortName,
            runnable,
            nextTriggerTime: Number.POSITIVE_INFINITY,
            eventType: "DATA-RECEIVED-EVENT",
            dataReceivePointRef: ev.dataReceivePointRef,
          });
        }
      }
    }
  }

  private notifyDataReceived(swcOrProto: string | undefined, port: string, dataElement: string): void {
    const resolvedSwc = swcOrProto ? (this.protoToTypeMap.get(swcOrProto) ?? swcOrProto) : undefined;
    for (const t of this.tasks) {
      if (t.eventType !== "DATA-RECEIVED-EVENT") continue;
      if (resolvedSwc && t.swcName !== resolvedSwc && t.swcName !== swcOrProto) continue;
      if (t.dataReceivePointRef) {
        if (t.dataReceivePointRef.port && t.dataReceivePointRef.port !== port) continue;
        if (t.dataReceivePointRef.dataElement && t.dataReceivePointRef.dataElement !== dataElement) continue;
      } else {
        // Fallback: check runnable's dataReadAccess
        const matchesRead = t.runnable.dataReadAccess.some(
          (r) => r.port === port && (!r.dataElement || r.dataElement === dataElement),
        );
        if (!matchesRead) continue;
      }
      t.nextTriggerTime = this.currentTime;
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
      const resolvedSwc = this.protoToTypeMap.get(swcName);
      if (resolvedSwc) {
        this.buffers.set(this.bufferKey(resolvedSwc, port, dataElement), value);
      }
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
      const resolvedSwc = this.protoToTypeMap.get(swcName);
      if (resolvedSwc) {
        const resVal = this.buffers.get(this.bufferKey(resolvedSwc, port, dataElement));
        if (resVal !== undefined) return resVal;
      }
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
      if (earliestTask.period !== undefined && earliestTask.period > 0) {
        earliestTask.nextTriggerTime += earliestTask.period;
      } else {
        // One-shot or event-driven trigger
        earliestTask.nextTriggerTime = Number.POSITIVE_INFINITY;
      }

      this.executeTask(earliestTask);
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
        this.routeConnectedPorts(task.swcName, port, dataElement, value, new Set());
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

  private routeConnectedPorts(
    srcComp: string,
    srcPort: string,
    dataElement: string,
    value: number | string,
    visited: Set<string>,
  ): void {
    const visitKey = `${srcComp}.${srcPort}.${dataElement}`;
    if (visited.has(visitKey)) return;
    visited.add(visitKey);

    // Route value across compositions containing assembly and delegation connectors
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
                  this.notifyDataReceived(conn.requirer.component, conn.requirer.port, dataElement);
                  this.routeConnectedPorts(conn.requirer.component, conn.requirer.port, dataElement, value, visited);
                }
                if (reqTypeName && reqTypeName !== conn.requirer.component) {
                  this.setSignal(conn.requirer.port, dataElement, value, reqTypeName);
                  this.notifyDataReceived(reqTypeName, conn.requirer.port, dataElement);
                  this.routeConnectedPorts(reqTypeName, conn.requirer.port, dataElement, value, visited);
                }
              }
            }
          } else if (conn.kind === "DELEGATION-SW-CONNECTOR" && conn.outerPort && conn.innerPort?.port) {
            const innerProto = comp.subComponents?.get(conn.innerPort.component ?? "");
            const innerTypeName = innerProto?.typeRef.split("/").pop() ?? conn.innerPort.component;

            // Outward delegation: inner component P-port -> composition outer P-port
            if (
              (conn.innerPort.component === srcComp || innerTypeName === srcComp) &&
              conn.innerPort.port === srcPort
            ) {
              this.setSignal(conn.outerPort, dataElement, value, comp.shortName);
              this.notifyDataReceived(comp.shortName, conn.outerPort, dataElement);
              this.routeConnectedPorts(comp.shortName, conn.outerPort, dataElement, value, visited);
            }

            // Inward delegation: composition outer R-port -> inner component R-port
            if (comp.shortName === srcComp && conn.outerPort === srcPort) {
              if (conn.innerPort.component) {
                this.setSignal(conn.innerPort.port, dataElement, value, conn.innerPort.component);
                this.notifyDataReceived(conn.innerPort.component, conn.innerPort.port, dataElement);
                this.routeConnectedPorts(conn.innerPort.component, conn.innerPort.port, dataElement, value, visited);
              }
              if (innerTypeName && innerTypeName !== conn.innerPort.component) {
                this.setSignal(conn.innerPort.port, dataElement, value, innerTypeName);
                this.notifyDataReceived(innerTypeName, conn.innerPort.port, dataElement);
                this.routeConnectedPorts(innerTypeName, conn.innerPort.port, dataElement, value, visited);
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

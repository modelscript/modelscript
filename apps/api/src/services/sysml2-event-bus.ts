// SPDX-License-Identifier: AGPL-3.0-or-later

import { EventEmitter } from "node:events";

export interface SysML2EventEnvelope {
  type: "commit.created" | "branch.created" | "branch.updated" | "merge.completed" | "element.modified";
  projectId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export class SysML2EventBus extends EventEmitter {
  public emitEvent(event: SysML2EventEnvelope): void {
    this.emit("event", event);
    this.emit(`project:${event.projectId}`, event);
  }

  public onProjectEvent(projectId: string, listener: (event: SysML2EventEnvelope) => void): () => void {
    const channel = `project:${projectId}`;
    this.on(channel, listener);
    return () => {
      this.off(channel, listener);
    };
  }
}

export const sysml2EventBus = new SysML2EventBus();

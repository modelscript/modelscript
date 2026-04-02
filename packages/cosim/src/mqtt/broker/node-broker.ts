// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Aedes } from "aedes";
import * as aedes from "aedes";
import { createServer } from "aedes-server-factory";
import type { EmbeddedBroker } from "./interface.js";

/**
 * Node.js specific MQTT broker implementation.
 * Bootstraps Aedes and a physical WebSocket/HTTP listener on a port.
 * Allows external HMI web applications (like Vite apps running separately)
 * to connect via standard WebSockets.
 */
export class NodeBroker implements EmbeddedBroker {
  public readonly aedes: Aedes;
  private readonly server: import("net").Server | import("http").Server;
  private readonly port: number;

  constructor(port = 9001) {
    // Check if running in Node.js environment
    if (typeof process === "undefined" || !process.versions?.node) {
      throw new Error("NodeBroker can only be instantiated in a Node.js environment.");
    }

    // Using simple aedes instantiator handling either new or default function
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AedesConstructor = (aedes as any).default || aedes;
    this.aedes = new (AedesConstructor as new () => Aedes)();

    this.server = createServer(this.aedes, { ws: true });
    this.port = port;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.port, (err?: Error) => {
        if (err) {
          reject(err);
        } else {
          console.log(`[Cosim] Local Node MQTT Broker running on ws://localhost:${this.port}`);
          resolve();
        }
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.aedes.close(() => {
        if (this.server && this.server.close) {
          this.server.close(() => resolve());
        } else {
          resolve();
        }
      });
    });
  }
}

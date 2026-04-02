// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Aedes } from "aedes";
import * as aedes from "aedes";
import { Duplex } from "stream";
import type { EmbeddedBroker } from "./interface.js";

/** Simple paired memory stream to simulate identical ends of a TCP socket. */
class MemoryStream extends Duplex {
  peer?: MemoryStream;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override _read(_size: number): void {
    // Flow control not strictly implemented for memory streams,
    // pushing occurs via peer's _write.
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override _write(chunk: any, _encoding: string, callback: (error?: Error | null) => void): void {
    if (this.peer) {
      this.peer.push(chunk);
    }
    callback();
  }

  override _final(callback: (error?: Error | null) => void): void {
    if (this.peer) {
      this.peer.push(null); // End the peer stream
    }
    callback();
  }
}

/**
 * Browser-compatible MQTT broker implementation.
 * Wraps Aedes using an in-memory execution strategy without assuming native networking
 * or physically listening on an HTTP/WebSocket port.
 * Internally connects local Webviews via stream.Duplex pairings.
 */
export class BrowserBroker implements EmbeddedBroker {
  public readonly aedes: Aedes;

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AedesConstructor = (aedes as any).default || aedes;
    this.aedes = new (AedesConstructor as new () => Aedes)();
  }

  async start(): Promise<void> {
    // No physical listeners to bind. Start immediately.
    console.log("[Cosim] Local In-Memory Browser MQTT Broker started.");
    return Promise.resolve();
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.aedes.close(() => resolve());
    });
  }

  /**
   * Generates a virtual network connection to the broker.
   * Enables local mqtt.js instances in the browser to interact via an in-memory pipe.
   */
  createClientStream(): Duplex {
    const clientStream = new MemoryStream();
    const serverStream = new MemoryStream();

    clientStream.peer = serverStream;
    serverStream.peer = clientStream;

    // Attach the server end to Aedes connection handler
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.aedes.handle(serverStream as any);

    return clientStream;
  }
}

// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Aedes } from "aedes";

/**
 * Universal interface for an embedded MQTT broker.
 * Provides a uniform API for both Node.js (desktop) and pure Web (browser) environments.
 */
export interface EmbeddedBroker {
  /** The underlying Aedes broker instance. */
  readonly aedes: Aedes;

  /** Initialize and start the broker. */
  start(): Promise<void>;

  /** Shutdown the broker and disconnect all clients. */
  stop(): Promise<void>;

  /**
   * Factory for creating a direct in-memory duplex stream to the broker.
   * Useful in browser environments where local MQTT connections are required
   * without a physical WebSocket URL.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createClientStream?(): any;
}

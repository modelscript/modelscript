// SPDX-License-Identifier: AGPL-3.0-or-later

import type { EmbeddedBroker } from "./interface.js";

// Export concrete classes explicitly if needed
export { BrowserBroker } from "./browser-broker.js";
export { NodeBroker } from "./node-broker.js";
export type { EmbeddedBroker };

/**
 * Factory for creating the appropriate EmbeddedBroker given the runtime environment.
 * If running in a Node.js context, it will provision a NodeBroker (which opens a physical port).
 * If running in the Browser, it provisions an in-memory BrowserBroker.
 *
 * @param port The port to bind to in a Node.js context (defaults to 9001).
 * @returns An instance of EmbeddedBroker.
 */
export async function createEmbeddedBroker(port = 9001): Promise<EmbeddedBroker> {
  // Simple check for node environment
  const isNode = typeof process !== "undefined" && Boolean(process.versions?.node);

  if (isNode) {
    // Dynamically import to ensure no browser polyfill issues with physical modules
    const { NodeBroker } = await import("./node-broker.js");
    return new NodeBroker(port);
  } else {
    // Fall back to Browser purely in-memory broker
    const { BrowserBroker } = await import("./browser-broker.js");
    return new BrowserBroker();
  }
}

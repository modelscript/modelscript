// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Browser-local in-memory MQTT-like pub/sub broker.
//
// Provides topic-based publish/subscribe with MQTT wildcard matching
// (+ for single level, # for multi-level). Runs entirely in the
// extension host — no external broker needed.

/** Subscription callback. */
export type BrokerCallback = (topic: string, payload: string) => void;

interface Subscription {
  filter: string;
  callback: BrokerCallback;
}

/**
 * Lightweight in-memory pub/sub broker with MQTT-style topic matching.
 *
 * Topics use `/` as the level separator (e.g. `cosim/session1/participant1/data/x`).
 * Filters support `+` (single-level wildcard) and `#` (multi-level wildcard at end).
 */
export class BrowserBroker {
  private subscriptions: Subscription[] = [];
  private retained = new Map<string, string>();

  /** Publish a message to a topic. */
  publish(topic: string, payload: string, retain = false): void {
    if (retain) {
      this.retained.set(topic, payload);
    }

    for (const sub of this.subscriptions) {
      if (matchTopic(sub.filter, topic)) {
        try {
          sub.callback(topic, payload);
        } catch {
          // Don't let one subscriber crash others
        }
      }
    }
  }

  /** Subscribe to a topic filter. Returns an unsubscribe function. */
  subscribe(filter: string, callback: BrokerCallback): () => void {
    const sub: Subscription = { filter, callback };
    this.subscriptions.push(sub);

    // Deliver retained messages that match
    for (const [topic, payload] of this.retained) {
      if (matchTopic(filter, topic)) {
        try {
          callback(topic, payload);
        } catch {
          // Ignore
        }
      }
    }

    return () => {
      const idx = this.subscriptions.indexOf(sub);
      if (idx >= 0) this.subscriptions.splice(idx, 1);
    };
  }

  /** Remove all subscriptions matching a filter string. */
  unsubscribe(filter: string): void {
    this.subscriptions = this.subscriptions.filter((s) => s.filter !== filter);
  }

  /** Clear all state. */
  dispose(): void {
    this.subscriptions = [];
    this.retained.clear();
  }

  /** Number of active subscriptions. */
  get subscriberCount(): number {
    return this.subscriptions.length;
  }
}

/**
 * Match an MQTT topic against a subscription filter.
 *
 * Rules:
 * - `+` matches exactly one level
 * - `#` matches zero or more levels (must be last)
 * - Literal segments must match exactly
 */
function matchTopic(filter: string, topic: string): boolean {
  const filterParts = filter.split("/");
  const topicParts = topic.split("/");

  for (let i = 0; i < filterParts.length; i++) {
    const fp = filterParts[i];

    if (fp === "#") {
      // # matches everything from here on
      return true;
    }

    if (i >= topicParts.length) {
      // Topic is shorter than filter
      return false;
    }

    if (fp !== "+" && fp !== topicParts[i]) {
      // Literal mismatch
      return false;
    }
  }

  // Filter consumed — topic must also be fully consumed
  return filterParts.length === topicParts.length;
}

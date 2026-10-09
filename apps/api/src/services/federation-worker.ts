// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LibraryDatabase } from "../database.js";
import { sendSignedRequest } from "../util/activitypub-crypto.js";
import { isOfacSanctioned } from "../util/compliance.js";
import { locationService } from "./location.js";

export class FederationWorker {
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(private readonly db: LibraryDatabase) {}

  public start(intervalMs = 5000): void {
    if (this.timer || process.env["NODE_ENV"] === "test") return;
    this.timer = setInterval(() => {
      this.processQueue().catch((err) => {
        console.error("[FederationWorker] Error in processQueue tick:", err);
      });
    }, intervalMs);
    // Don't prevent Node process from exiting
    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async processQueue(batchSize = 25): Promise<number> {
    if (this.isProcessing) return 0;
    if (!this.db || !this.db.db || !this.db.db.open) {
      this.stop();
      return 0;
    }
    this.isProcessing = true;

    let processedCount = 0;
    try {
      if (!this.db.db.open) return 0;
      if (process.env["FEDERATION_MODE"] === "disabled") return 0;

      const items = this.db.fetchPendingFederationDeliveries(batchSize);
      if (items.length === 0) return 0;

      const instanceKeys = this.db.getInstanceKeys();
      const transportKey = instanceKeys.privateKey;
      const publicUrl = process.env.PUBLIC_URL || "https://hub.modelscript.org";
      const transportKeyId = `${publicUrl}/actor#main-key`;

      for (const item of items) {
        processedCount++;
        this.db.updateFederationDeliveryStatus(item.id, "processing");

        // Check if destination domain is suspended
        if (this.db.isDomainSuspended(item.target_domain)) {
          this.db.updateFederationDeliveryStatus(
            item.id,
            "failed",
            `Delivery blocked: Domain '${item.target_domain}' is suspended by instance administration.`,
          );
          continue;
        }

        // Pre-delivery export-control geofencing guard
        const targetIpMatch = item.target_domain.match(/^\d+\.\d+\.\d+\.\d+$/);
        const geoResult = targetIpMatch
          ? locationService.lookupIp(targetIpMatch[0])
          : locationService.lookupIp(item.target_domain);

        if (geoResult && isOfacSanctioned(geoResult.countryCode, geoResult.regionCode)) {
          this.db.updateFederationDeliveryStatus(
            item.id,
            "failed",
            `Delivery blocked under export control regulations: Destination '${item.target_domain}' is in sanctioned jurisdiction (${geoResult.countryCode}).`,
          );
          this.db.logAudit({
            actorId: null,
            action: "export_control_federation_blocked",
            resourceType: "federation",
            resourceId: item.target_domain,
            details: {
              targetDomain: item.target_domain,
              country: geoResult.countryCode,
              inbox: item.target_inbox_url,
              reason: "Pre-delivery export compliance geofencing blocked transfer",
            },
          });
          continue;
        }

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(item.payload);
        } catch (parseErr: any) {
          this.db.updateFederationDeliveryStatus(item.id, "failed", `Invalid JSON payload: ${parseErr.message}`);
          continue;
        }

        try {
          await sendSignedRequest(item.target_inbox_url, payload, transportKeyId, transportKey, this.db);
          this.db.updateFederationDeliveryStatus(item.id, "completed");
        } catch (err: any) {
          const errMsg = err?.message || String(err);
          const nextAttempt = item.attempts + 1;
          if (nextAttempt >= item.max_attempts) {
            this.db.updateFederationDeliveryStatus(
              item.id,
              "failed",
              `Max retries exceeded (${item.max_attempts}). Last error: ${errMsg}`,
            );
          } else {
            // Exponential backoff: attempt 1 -> 60s, attempt 2 -> 120s, attempt 3 -> 240s...
            const backoffMs = Math.min(60 * 1000 * Math.pow(2, nextAttempt - 1), 6 * 60 * 60 * 1000);
            this.db.updateFederationDeliveryStatus(item.id, "pending", errMsg, backoffMs);
          }
        }
      }
    } finally {
      this.isProcessing = false;
    }

    return processedCount;
  }

  /**
   * Broadcasts an ActivityPub activity to all remote followers of an author.
   * Optimizes delivery by deduplicating across remote domains using sharedInbox where available.
   */
  public enqueueActivityBroadcast(
    activity: Record<string, unknown>,
    authorId: number,
    additionalInboxes: { inbox_url: string; shared_inbox_url?: string; remote_domain: string }[] = [],
  ): number {
    const remoteFollowers = this.db.db
      .prepare(
        `SELECT u.inbox_url, u.shared_inbox_url, u.remote_domain 
         FROM follows f
         JOIN users u ON f.follower_id = u.id
         WHERE f.following_id = ? AND u.remote_domain IS NOT NULL AND (f.state = 'accepted' OR f.state IS NULL)`,
      )
      .all(authorId) as { inbox_url: string; shared_inbox_url?: string; remote_domain: string }[];

    const allRecipients = [...remoteFollowers, ...additionalInboxes];
    if (allRecipients.length === 0) return 0;

    // Group recipients by remote domain for sharedInbox deduplication
    const domainGroups = new Map<string, { sharedInbox?: string; personalInboxes: Set<string> }>();

    for (const f of allRecipients) {
      const domain = f.remote_domain.toLowerCase();
      let group = domainGroups.get(domain);
      if (!group) {
        group = { personalInboxes: new Set() };
        domainGroups.set(domain, group);
      }
      if (f.shared_inbox_url) {
        group.sharedInbox = f.shared_inbox_url;
      }
      if (f.inbox_url) {
        group.personalInboxes.add(f.inbox_url);
      }
    }

    let enqueued = 0;
    const actType = (activity.type as string) || "Activity";
    const actId = (activity.id as string) || `${Date.now()}`;

    for (const [domain, group] of domainGroups.entries()) {
      if (group.sharedInbox) {
        // One shared delivery for the entire domain
        this.db.enqueueFederationDelivery(actType, actId, activity, group.sharedInbox, domain);
        enqueued++;
      } else {
        // Individual deliveries
        for (const inbox of group.personalInboxes) {
          this.db.enqueueFederationDelivery(actType, actId, activity, inbox, domain);
          enqueued++;
        }
      }
    }

    // Trigger queue processing asynchronously outside of tests
    if (process.env["NODE_ENV"] !== "test") {
      void this.processQueue();
    }
    return enqueued;
  }
}

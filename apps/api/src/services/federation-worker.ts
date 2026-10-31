// SPDX-License-Identifier: AGPL-3.0-or-later

import dns from "node:dns/promises";
import type { LibraryDatabase } from "../database.js";
import { computeFollowersSyncDigest, sendSignedRequest } from "../util/activitypub-crypto.js";
import { isOfacSanctioned } from "../util/compliance.js";
import { isFederationDisabled } from "../util/tier-presets.js";
import { locationService } from "./location.js";

const SANCTIONED_TLDS: Record<string, string> = {
  ".ru": "RU",
  ".by": "BY",
  ".ir": "IR",
  ".kp": "KP",
  ".sy": "SY",
  ".cu": "CU",
};

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
      if (isFederationDisabled()) return 0;
      try {
        const settings = this.db.getInstanceSettings();
        if (settings.maintenanceMode || isFederationDisabled(settings)) return 0;
      } catch {
        // Proceed if instance_settings table is not yet initialized
      }

      const items = this.db.fetchPendingFederationDeliveries(batchSize);
      if (items.length === 0) return 0;

      const instanceKeys = this.db.getInstanceKeys();
      const transportKey = instanceKeys.privateKey;
      const publicUrl = process.env["PUBLIC_URL"] || "https://hub.modelscript.org";
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
        const lowerDomain = item.target_domain.toLowerCase();
        const targetIpMatch = lowerDomain.match(/^\d+\.\d+\.\d+\.\d+$/);
        let geoResult = targetIpMatch
          ? locationService.lookupIp(targetIpMatch[0])
          : locationService.lookupIp(lowerDomain);

        if (!geoResult) {
          for (const [tld, countryCode] of Object.entries(SANCTIONED_TLDS)) {
            if (lowerDomain.endsWith(tld)) {
              geoResult = { countryCode };
              break;
            }
          }
        }

        if (!geoResult && !targetIpMatch && process.env["NODE_ENV"] !== "test") {
          try {
            const resolved = await dns.lookup(lowerDomain);
            if (resolved?.address) {
              geoResult = locationService.lookupIp(resolved.address);
            }
          } catch {
            // Ignore DNS resolution error here; sendSignedRequest handles SSRF/DNS validation
          }
        }

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
        } catch (parseErr: unknown) {
          const parseMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
          this.db.updateFederationDeliveryStatus(item.id, "failed", `Invalid JSON payload: ${parseMsg}`);
          continue;
        }

        let signingKeyId = transportKeyId;
        let signingKey = transportKey;
        const extraHeaders: Record<string, string> = {};
        if (typeof payload["actor"] === "string") {
          const userMatch = payload["actor"].match(/\/users\/([^/#?]+)$/);
          if (userMatch?.[1]) {
            const localUser = this.db.getUserByUsername(decodeURIComponent(userMatch[1]));
            if (localUser) {
              const userKeys = this.db.ensureUserRSAKeys(localUser.id);
              if (userKeys?.privateKey) {
                signingKeyId = `${payload["actor"]}#main-key`;
                signingKey = userKeys.privateKey;
              }
              try {
                const domainFollowerActors = this.db.db
                  .prepare(
                    `SELECT u.actor_url
                     FROM follows f
                     JOIN users u ON f.follower_id = u.id
                     WHERE f.following_id = ? AND LOWER(u.remote_domain) = ? AND (f.state = 'accepted' OR f.state IS NULL)`,
                  )
                  .all(localUser.id, lowerDomain) as { actor_url: string | null }[];
                const actorUrls = domainFollowerActors.map((r) => r.actor_url).filter((u): u is string => Boolean(u));
                if (actorUrls.length > 0) {
                  const digestHex = computeFollowersSyncDigest(actorUrls);
                  const actorUri = String(payload["actor"]);
                  extraHeaders["Collection-Synchronization"] =
                    `collectionId="${actorUri}/followers", url="${actorUri}/followers/synchronization", digest="${digestHex}"`;
                }
              } catch {}
            }
          }
        }

        try {
          await sendSignedRequest(item.target_inbox_url, payload, signingKeyId, signingKey, this.db, extraHeaders);
          this.db.updateFederationDeliveryStatus(item.id, "completed");
          this.db.recordDomainDeliverySuccess(item.target_domain);
          try {
            this.db.incrementRelayStats(item.target_inbox_url, "forwarded");
          } catch {}
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          this.db.recordDomainDeliveryFailure(item.target_domain, errMsg);
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
    additionalInboxes: { inbox_url: string; shared_inbox_url?: string | undefined; remote_domain: string }[] = [],
  ): number {
    try {
      if (isFederationDisabled(this.db.getInstanceSettings())) return 0;
    } catch {
      if (isFederationDisabled()) return 0;
    }

    const toArr = Array.isArray(activity["to"])
      ? activity["to"].map(String)
      : typeof activity["to"] === "string"
        ? [activity["to"]]
        : [];
    const ccArr = Array.isArray(activity["cc"])
      ? activity["cc"].map(String)
      : typeof activity["cc"] === "string"
        ? [activity["cc"]]
        : [];
    const allAddressing = [...toArr, ...ccArr];
    const isDirectOnly =
      allAddressing.length > 0 &&
      !allAddressing.some(
        (u) =>
          u === "https://www.w3.org/ns/activitystreams#Public" ||
          u === "as:Public" ||
          u === "Public" ||
          u.endsWith("/followers"),
      );
    const isPublic = toArr.some(
      (u) => u === "https://www.w3.org/ns/activitystreams#Public" || u === "as:Public" || u === "Public",
    );

    const remoteFollowers = isDirectOnly
      ? []
      : (this.db.db
          .prepare(
            `SELECT u.inbox_url, u.shared_inbox_url, u.remote_domain 
             FROM follows f
             JOIN users u ON f.follower_id = u.id
             WHERE f.following_id = ? AND u.remote_domain IS NOT NULL AND (f.state = 'accepted' OR f.state IS NULL)`,
          )
          .all(authorId) as { inbox_url: string; shared_inbox_url?: string | undefined; remote_domain: string }[]);

    const relayRecipients: { inbox_url: string; shared_inbox_url?: string | undefined; remote_domain: string }[] = [];
    const actType = (activity["type"] as string) || "Activity";
    if (isPublic && (actType === "Create" || actType === "Announce" || actType === "Update" || actType === "Delete")) {
      try {
        const relays = this.db.listFederationRelays().filter((r) => r.state === "accepted");
        for (const relay of relays) {
          relayRecipients.push({
            inbox_url: relay.inbox_url,
            shared_inbox_url: relay.inbox_url,
            remote_domain: relay.domain || new URL(relay.inbox_url).hostname,
          });
        }
      } catch {}
    }

    const allRecipients = [...remoteFollowers, ...additionalInboxes, ...relayRecipients];
    if (allRecipients.length === 0) return 0;

    // Group recipients by remote domain for sharedInbox deduplication
    const domainGroups = new Map<string, { sharedInbox?: string | undefined; personalInboxes: Set<string> }>();

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
    const actId = (activity["id"] as string) || `${Date.now()}`;

    for (const [domain, group] of domainGroups.entries()) {
      if (group.sharedInbox) {
        // One shared delivery for the entire domain
        const res = this.db.enqueueFederationDelivery(actType, actId, activity, group.sharedInbox, domain);
        if (!res.skipped) enqueued++;
      } else {
        // Individual deliveries
        for (const inbox of group.personalInboxes) {
          const res = this.db.enqueueFederationDelivery(actType, actId, activity, inbox, domain);
          if (!res.skipped) enqueued++;
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

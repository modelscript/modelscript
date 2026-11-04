// SPDX-License-Identifier: AGPL-3.0-or-later

import webPush from "web-push";
import type { LibraryDatabase } from "../database.js";
import type { PushSubscriptionRow } from "../database/types.js";

export interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string | undefined;
  badge?: string | undefined;
  data?:
    | {
        url?: string | undefined;
        [key: string]: unknown;
      }
    | undefined;
}

export class WebPushService {
  #db: LibraryDatabase;

  constructor(db: LibraryDatabase) {
    this.#db = db;
  }

  getVapidPublicKey(): string {
    const keys = this.#db.getInstanceVapidKeys();
    return keys.publicKey;
  }

  async sendToSubscription(subscription: PushSubscriptionRow, payload: PushNotificationPayload): Promise<boolean> {
    const keys = this.#db.getInstanceVapidKeys();
    const settings = this.#db.getInstanceSettings();
    const contact = process.env["VAPID_SUBJECT"] || settings.contactEmail || "mailto:admin@modelscript.org";

    webPush.setVapidDetails(
      contact.startsWith("mailto:") || contact.startsWith("https://") ? contact : `mailto:${contact}`,
      keys.publicKey,
      keys.privateKey,
    );

    const pushSub = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.p256dh,
        auth: subscription.auth,
      },
    };

    try {
      await webPush.sendNotification(pushSub, JSON.stringify(payload));
      return true;
    } catch (err: unknown) {
      const errorObj = err as { statusCode?: number };
      // HTTP 404 Not Found or 410 Gone indicates expired or revoked subscription
      if (errorObj?.statusCode === 404 || errorObj?.statusCode === 410) {
        try {
          this.#db.deletePushSubscription(subscription.user_id, subscription.endpoint);
        } catch {
          // Ignore deletion error
        }
      }
      return false;
    }
  }

  async dispatchUserPush(userId: number, payload: PushNotificationPayload): Promise<number> {
    const subscriptions = this.#db.listPushSubscriptions(userId);
    if (!subscriptions || subscriptions.length === 0) {
      return 0;
    }

    let successCount = 0;
    await Promise.all(
      subscriptions.map(async (sub) => {
        const ok = await this.sendToSubscription(sub, payload);
        if (ok) successCount++;
      }),
    );

    return successCount;
  }
}

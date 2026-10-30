// SPDX-License-Identifier: AGPL-3.0-or-later

import type { UserRow } from "../database/types.js";

/**
 * Standard W3C ActivityPub / ActivityStreams 2.0 Person actor serialization.
 * Guarantees federation wire invariance regardless of underlying SQLite column alterations.
 */
export interface ActivityPubPersonActor {
  "@context": string[];
  id: string;
  type: "Person";
  preferredUsername: string;
  name: string;
  summary: string;
  inbox: string;
  outbox: string;
  publicKey?: {
    id: string;
    owner: string;
    publicKeyPem: string;
  };
  icon?: {
    type: "Image";
    mediaType: "image/png" | "image/jpeg" | string;
    url: string;
  };
  image?: {
    type: "Image";
    mediaType: "image/png" | "image/jpeg" | string;
    url: string;
  };
  published?: string;
}

export function toActivityPubActor(user: Partial<UserRow>, baseUrl: string): ActivityPubPersonActor {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const actorUri = user.actor_url || `${cleanBase}/users/${encodeURIComponent(user.username || "anonymous")}`;
  const inboxUri = user.inbox_url || `${actorUri}/inbox`;
  const outboxUri = user.outbox_url || `${actorUri}/outbox`;

  const actor: ActivityPubPersonActor = {
    "@context": ["https://www.w3.org/ns/activitystreams", "https://w3id.org/security/v1"],
    id: actorUri,
    type: "Person",
    preferredUsername: user.username || "",
    name: user.display_name || user.username || "",
    summary: user.bio || "",
    inbox: inboxUri,
    outbox: outboxUri,
    published: user.created_at || new Date().toISOString(),
  };

  if (user.rsa_public_key) {
    actor.publicKey = {
      id: `${actorUri}#main-key`,
      owner: actorUri,
      publicKeyPem: user.rsa_public_key,
    };
  }

  if (user.avatar_url) {
    actor.icon = {
      type: "Image",
      mediaType: "image/png",
      url: user.avatar_url,
    };
  }

  if (user.banner_url) {
    actor.image = {
      type: "Image",
      mediaType: "image/png",
      url: user.banner_url,
    };
  }

  return actor;
}

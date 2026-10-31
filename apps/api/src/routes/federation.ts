// SPDX-License-Identifier: AGPL-3.0-or-later

import type { NextFunction, Request, Response } from "express";
import { Router, json } from "express";
import crypto from "node:crypto";
import { LibraryDatabase, type PostVisibility } from "../database.js";
import {
  createActivityPubVerifier,
  createAuthorizedFetchVerifier,
  defaultInboxLimiter,
  invalidateCachedPublicKey,
} from "../middleware/activitypub.js";
import { optionalAuth } from "../middleware/auth-middleware.js";
import type { FederationWorker } from "../services/federation-worker.js";
import { computeFollowersSyncDigest, sendSignedGetRequest, sendSignedRequest } from "../util/activitypub-crypto.js";
import { ed25519PemToMultibase } from "../util/multikey.js";
import { assertSafePublicUrl, safePublicFetch } from "../util/ssrf.js";
import { isCorporateOrAirgapTier, isFederationDisabled } from "../util/tier-presets.js";

export function isNodeFederationDisabled(db?: LibraryDatabase): boolean {
  const settings = db?.getInstanceSettings();
  return isFederationDisabled(settings);
}

export function inferVisibilityFromAddressing(
  obj: Record<string, unknown>,
  parentActivity?: Record<string, unknown>,
): PostVisibility {
  const toRaw = obj["to"] ?? parentActivity?.["to"];
  const ccRaw = obj["cc"] ?? parentActivity?.["cc"];
  const toArr = Array.isArray(toRaw) ? toRaw.map(String) : typeof toRaw === "string" ? [toRaw] : [];
  const ccArr = Array.isArray(ccRaw) ? ccRaw.map(String) : typeof ccRaw === "string" ? [ccRaw] : [];

  const isPublicUri = (u: string) =>
    u === "https://www.w3.org/ns/activitystreams#Public" || u === "as:Public" || u === "Public";

  if (toArr.some(isPublicUri)) {
    return "public";
  }
  if (ccArr.some(isPublicUri)) {
    return "unlisted";
  }
  if ([...toArr, ...ccArr].some((u) => u.endsWith("/followers"))) {
    return "followers";
  }
  if (toArr.length > 0 || ccArr.length > 0) {
    return "direct";
  }
  return "public";
}

export function buildAddressingForVisibility(
  visibility: PostVisibility,
  actorUrl: string,
  mentionedActorUrls: string[] = [],
): { to: string[]; cc: string[] } {
  const publicUri = "https://www.w3.org/ns/activitystreams#Public";
  const followersUri = `${actorUrl}/followers`;
  switch (visibility) {
    case "unlisted":
      return {
        to: [followersUri],
        cc: [publicUri, ...mentionedActorUrls],
      };
    case "followers":
      return {
        to: [followersUri],
        cc: [...mentionedActorUrls],
      };
    case "direct":
      return {
        to: [...mentionedActorUrls],
        cc: [],
      };
    case "public":
    default:
      return {
        to: [publicUri],
        cc: [followersUri, ...mentionedActorUrls],
      };
  }
}

export interface ArtifactAttachmentInput {
  id: number | string;
  title?: string | null | undefined;
  view_type: string;
  source_type?: string | null | undefined;
  view_config?: string | Record<string, unknown> | null | undefined;
  remote_origin_url?: string | null | undefined;
  thumbnail_url?: string | null | undefined;
}

export function serializeArtifactAttachment(
  artifact: ArtifactAttachmentInput | null | undefined,
  publicUrl: string,
): Record<string, unknown> | null {
  if (!artifact) return null;
  let parsedConfig: Record<string, unknown> = {};
  try {
    parsedConfig =
      typeof artifact.view_config === "string" ? JSON.parse(artifact.view_config) : artifact.view_config || {};
  } catch {}

  const mimeMap: Record<string, string> = {
    "cad-step": "model/step",
    "3d-model": "model/gltf-binary",
    "simulation-plot": "application/vnd.vegalite.v5+json",
    chart: "application/vnd.vegalite.v5+json",
    "simulation-result": "application/vnd.vegalite.v5+json",
    "modelica-code": "text/x-modelica",
    fmu: "application/x-fmu",
    "cfd-result": "application/json",
    "fea-result": "application/json",
    pdf: "application/pdf",
    picture: "image/png",
    video: "video/mp4",
    audio: "audio/mpeg",
  };

  const mediaType = mimeMap[artifact.view_type] || "application/octet-stream";
  const url =
    (parsedConfig["url"] as string) ||
    artifact.remote_origin_url ||
    `${publicUrl}/api/v1/storage/artifacts/${artifact.id}`;

  const attachment: Record<string, unknown> = {
    type: "Document",
    mediaType,
    name: artifact.title || `artifact-${artifact.id}`,
    url,
    viewType: artifact.view_type,
    sourceType: artifact.source_type,
    viewConfig: parsedConfig,
  };

  const thumb = artifact.thumbnail_url || (parsedConfig["thumbnailUrl"] as string);
  if (thumb) {
    attachment["icon"] = {
      type: "Image",
      url: thumb,
    };
  }

  return attachment;
}

export async function resolveActorHandle(
  handleOrUrl: string,
  db: LibraryDatabase,
): Promise<{
  user: ReturnType<LibraryDatabase["getUserById"]>;
  actor: Record<string, unknown>;
  actorUrl: string;
}> {
  if (isNodeFederationDisabled(db)) {
    throw new Error("Federation is disabled on this node.");
  }

  let actorUrl = handleOrUrl.trim();
  if (!actorUrl.startsWith("http://") && !actorUrl.startsWith("https://")) {
    const cleanHandle = actorUrl.startsWith("acct:")
      ? actorUrl.slice(5)
      : actorUrl.startsWith("@")
        ? actorUrl.slice(1)
        : actorUrl;
    const [userPart, domainPart] = cleanHandle.split("@");
    if (!userPart || !domainPart) {
      throw new Error("Invalid handle format. Expected username@domain");
    }

    const webfingerUrl = `https://${domainPart}/.well-known/webfinger?resource=acct:${encodeURIComponent(cleanHandle)}`;
    const wfRes = await safePublicFetch(webfingerUrl, {
      headers: { Accept: "application/jrd+json, application/json" },
    });

    if (!wfRes.ok) {
      throw new Error(`WebFinger lookup failed for ${cleanHandle}`);
    }

    const wfData = (await wfRes.json()) as {
      links?: { rel?: string | undefined; type?: string | undefined; href?: string | undefined }[] | undefined;
    };
    const selfLink = wfData.links?.find(
      (l) => l.rel === "self" && (l.type === "application/activity+json" || l.type === "application/ld+json"),
    );

    if (!selfLink || !selfLink.href) {
      throw new Error("No ActivityPub actor link found in WebFinger response");
    }
    actorUrl = selfLink.href;
  }

  // Fetch actor profile using signed GET (compatible with remote AUTHORIZED_FETCH)
  const publicUrl = process.env["PUBLIC_URL"] || "https://hub.modelscript.org";
  const instanceKeys = db.getInstanceKeys();
  const actorRes = await sendSignedGetRequest(actorUrl, `${publicUrl}/actor#main-key`, instanceKeys.privateKey, db);

  if (!actorRes.ok) {
    throw new Error("Failed to fetch remote actor profile");
  }

  const actorProfile = (await actorRes.json()) as Record<string, unknown>;
  const remoteUser = db.getOrCreateRemoteUser(actorUrl, actorProfile);

  return {
    user: db.getUserById(remoteUser.id),
    actor: actorProfile,
    actorUrl,
  };
}

export function federationRouter(db: LibraryDatabase, _worker?: FederationWorker): Router {
  const router = Router();
  const verifier = createActivityPubVerifier(db);
  const authorizedFetchVerifier = createAuthorizedFetchVerifier(db);
  const inboxLimiter = defaultInboxLimiter.middleware();
  const publicUrl = process.env["PUBLIC_URL"] || "https://hub.modelscript.org";

  const requireFederationEnabled = (_req: Request, res: Response, next: NextFunction) => {
    if (isNodeFederationDisabled(db)) {
      res.status(403).json({ error: "Federation is disabled on this node." });
      return;
    }
    next();
  };

  // Check FEDERATION_MODE (env override or dynamic instance_settings)
  router.use((req: Request, res: Response, next) => {
    if (isNodeFederationDisabled(db)) {
      if (req.path.includes("/inbox")) {
        res.status(403).json({ error: "Federation is disabled on this node." });
        return;
      }
    }
    next();
  });

  // ── WebFinger (RFC 7033 / ActivityPub Discovery) ──────────────────

  router.get("/.well-known/webfinger", requireFederationEnabled, (req: Request, res: Response) => {
    const resource = req.query["resource"] as string;

    if (!resource || !resource.startsWith("acct:")) {
      res.status(400).json({ error: "Invalid or missing resource parameter. Must be acct:username@domain" });
      return;
    }

    const acct = resource.replace("acct:", "");
    const [username] = acct.split("@");

    const user = db.getUserByUsername(username as string);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Retrieve the full user with federation fields
    const fullUser = db.getUserFederationInfo(user.id);

    if (!fullUser || !fullUser.actor_url) {
      res.status(404).json({ error: "User not federated" });
      return;
    }

    res.json({
      subject: resource,
      aliases: [fullUser.actor_url],
      links: [
        {
          rel: "self",
          type: "application/activity+json",
          href: fullUser.actor_url,
        },
      ],
    });
  });

  // ── NodeInfo 2.0 / 2.1 Discovery ──────────────────────────────────

  router.get("/.well-known/nodeinfo", (_req: Request, res: Response) => {
    res.json({
      links: [
        {
          rel: "http://nodeinfo.diaspora.software/ns/schema/2.0",
          href: `${publicUrl}/nodeinfo/2.0`,
        },
        {
          rel: "http://nodeinfo.diaspora.software/ns/schema/2.1",
          href: `${publicUrl}/nodeinfo/2.1`,
        },
      ],
    });
  });

  const handleNodeInfo = (_req: Request, res: Response) => {
    const settings = db.getInstanceSettings();
    const fedDisabled = isNodeFederationDisabled(db);
    const corporateRestricted = isCorporateOrAirgapTier(settings) || fedDisabled;
    const totalUsers = corporateRestricted ? 0 : db.getTotalUsersCount();
    const totalPosts = corporateRestricted ? 0 : db.getTotalPostsCount();
    const customName =
      settings.instanceName && settings.instanceName !== "ModelScript Engineering Hub"
        ? settings.instanceName
        : "Ansatz";
    const customDesc =
      settings.instanceDescription &&
      settings.instanceDescription !==
        "Federated polyglot engineering simulation, Modelica, SysML v2, and digital twin platform."
        ? settings.instanceDescription
        : settings.instanceTagline || "The Federated Scientific & Engineering Network";

    res.type('application/json; profile="http://nodeinfo.diaspora.software/ns/schema/2.1#"').json({
      version: "2.1",
      software: {
        name: "modelscript-hub",
        version: "0.1.0",
        repository: corporateRestricted ? "" : "https://github.com/modelscript/modelscript",
      },
      protocols: fedDisabled ? [] : ["activitypub"],
      services: {
        inbound: [],
        outbound: [],
      },
      openRegistrations: !corporateRestricted && settings.registrationMode === "open",
      usage: {
        users: {
          total: totalUsers,
          activeHalfyear: totalUsers,
          activeMonth: totalUsers,
        },
        localPosts: totalPosts,
      },
      metadata: {
        nodeName: customName,
        nodeBadge: settings.instanceBadge,
        nodeTagline: settings.instanceTagline,
        nodeDescription: customDesc,
        brandLogoUrl: settings.brandLogoUrl,
        showPoweredBy: settings.showPoweredBy,
        contactEmail: corporateRestricted ? "" : settings.contactEmail,
        federationMode: fedDisabled ? "disabled" : settings.federationMode,
        registrationMode: settings.registrationMode,
        authorizedFetch: settings.authorizedFetchEnabled,
      },
    });
  };

  router.get("/nodeinfo/2.0", handleNodeInfo);
  router.get("/nodeinfo/2.1", handleNodeInfo);

  // ── Instance Actor Profile & Outbox ───────────────────────────────

  router.get("/actor", requireFederationEnabled, (req: Request, res: Response) => {
    const acceptsActivity = req.accepts("application/activity+json", "application/ld+json", "application/json");
    if (!acceptsActivity) {
      res.status(404).json({ error: "Not found or invalid content type" });
      return;
    }

    const instanceKeys = db.getInstanceKeys();
    const instanceEdKeys = db.getInstanceEd25519Keys();
    const settings = db.getInstanceSettings();
    const brandName = settings.instanceName || "Ansatz";
    const actorUrl = `${publicUrl}/actor`;
    const edMultibase = ed25519PemToMultibase(instanceEdKeys.publicKey);

    res.type("application/activity+json").json({
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/security/v1",
        "https://w3id.org/security/data-integrity/v1",
      ],
      id: actorUrl,
      type: "Application",
      preferredUsername: "hub",
      name: brandName,
      summary: "Instance actor for transport-layer signatures",
      inbox: `${actorUrl}/inbox`,
      outbox: `${actorUrl}/outbox`,
      endpoints: {
        sharedInbox: `${actorUrl}/inbox`,
      },
      publicKey: {
        id: `${actorUrl}#main-key`,
        owner: actorUrl,
        publicKeyPem: instanceKeys.publicKey,
      },
      assertionMethod: [
        {
          id: `${actorUrl}#ed25519-key`,
          type: "Multikey",
          controller: actorUrl,
          publicKeyMultibase: edMultibase,
          publicKeyPem: instanceEdKeys.publicKey,
        },
      ],
    });
  });

  router.get("/actor/outbox", requireFederationEnabled, (_req: Request, res: Response) => {
    const actorUrl = `${publicUrl}/actor`;
    res.type("application/activity+json").json({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `${actorUrl}/outbox`,
      type: "OrderedCollection",
      totalItems: 0,
      orderedItems: [],
    });
  });

  // ── User Actor Profile ────────────────────────────────────────────

  router.get("/users/:username", requireFederationEnabled, authorizedFetchVerifier, (req: Request, res: Response) => {
    const acceptsActivity = req.accepts("application/activity+json", "application/ld+json", "application/json");
    if (!acceptsActivity) {
      res.status(404).json({ error: "Not found or invalid content type" });
      return;
    }

    const username = req.params["username"];
    if (!username) {
      res.status(400).json({ error: "Missing username" });
      return;
    }

    const user = db.getUserByUsername(username as string);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const fullUser = db.db
      .prepare(
        `SELECT id, display_name, bio, avatar_url, rsa_public_key, ed25519_public_key,
                  actor_url, inbox_url, outbox_url,
                  COALESCE(discoverable, 1) as discoverable,
                  COALESCE(indexable, 1) as indexable,
                  COALESCE(locked, 0) as locked,
                  also_known_as, moved_to_actor_url, profile_fields
           FROM users WHERE id = ?`,
      )
      .get(user.id) as Record<string, unknown> | undefined;

    if (!fullUser || !fullUser["actor_url"]) {
      res.status(404).json({ error: "User not federated" });
      return;
    }

    const keys = db.getPublicKeysForUser(fullUser["id"] as number);

    let publicKeys: { id: string; owner: string; publicKeyPem: string }[] = keys.map((k) => ({
      id: `${fullUser["actor_url"]}#${k.key_id_string}`,
      owner: fullUser["actor_url"] as string,
      publicKeyPem: k.public_key_pem,
    }));

    if (publicKeys.length === 0) {
      const rsaKey = (fullUser["rsa_public_key"] as string) || db.ensureUserRSAKeys(fullUser["id"] as number).publicKey;
      publicKeys = [
        {
          id: `${fullUser["actor_url"]}#main-key`,
          owner: fullUser["actor_url"] as string,
          publicKeyPem: rsaKey,
        },
      ];
    }

    const assertionMethod: Record<string, string>[] = [];
    if (fullUser["ed25519_public_key"]) {
      const edMultibase = ed25519PemToMultibase(fullUser["ed25519_public_key"] as string);
      assertionMethod.push({
        id: `${fullUser["actor_url"]}#ed25519-key`,
        type: "Multikey",
        controller: fullUser["actor_url"] as string,
        publicKeyMultibase: edMultibase,
        publicKeyPem: fullUser["ed25519_public_key"] as string,
      });
    }

    let alsoKnownAs: string[] = [];
    if (typeof fullUser["also_known_as"] === "string" && fullUser["also_known_as"].trim()) {
      try {
        const parsed = JSON.parse(fullUser["also_known_as"] as string);
        if (Array.isArray(parsed)) {
          alsoKnownAs = parsed.map(String).filter(Boolean);
        }
      } catch {}
    }

    let propertyAttachments: Record<string, unknown>[] = [];
    if (typeof fullUser["profile_fields"] === "string" && fullUser["profile_fields"].trim()) {
      try {
        const parsed = JSON.parse(fullUser["profile_fields"] as string);
        if (Array.isArray(parsed)) {
          propertyAttachments = parsed
            .filter((f) => f && typeof f.name === "string" && typeof f.value === "string")
            .map((f) => ({
              type: "PropertyValue",
              name: f.name,
              value: f.value,
              verified_at: f.verified_at ?? null,
            }));
        }
      } catch {}
    }

    const brandName = db.getInstanceSettings().instanceName || "Ansatz";

    res.type("application/activity+json").json({
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/security/v1",
        "https://w3id.org/security/data-integrity/v1",
        {
          manuallyApprovesFollowers: "as:manuallyApprovesFollowers",
          discoverable: "toot:discoverable",
          indexable: "toot:indexable",
          alsoKnownAs: { "@id": "as:alsoKnownAs", "@type": "@id" },
          movedTo: { "@id": "as:movedTo", "@type": "@id" },
          schema: "http://schema.org#",
          PropertyValue: "schema:PropertyValue",
          value: "schema:value",
        },
      ],
      id: fullUser["actor_url"],
      type: "Person",
      preferredUsername: username,
      name: fullUser["display_name"] || username,
      summary: fullUser["bio"] || `Engineer on ${brandName}`,
      inbox: fullUser["inbox_url"],
      outbox: fullUser["outbox_url"],
      followers: `${fullUser["actor_url"]}/followers`,
      following: `${fullUser["actor_url"]}/following`,
      manuallyApprovesFollowers: Boolean(fullUser["locked"]),
      discoverable: Boolean(fullUser["discoverable"]),
      indexable: Boolean(fullUser["indexable"]),
      alsoKnownAs: alsoKnownAs.length > 0 ? alsoKnownAs : undefined,
      movedTo: (fullUser["moved_to_actor_url"] as string) || undefined,
      attachment: propertyAttachments.length > 0 ? propertyAttachments : undefined,
      endpoints: {
        sharedInbox: `${publicUrl}/actor/inbox`,
      },
      icon: {
        type: "Image",
        mediaType: "image/jpeg",
        url: fullUser["avatar_url"],
      },
      publicKey: publicKeys.length === 1 ? publicKeys[0] : publicKeys,
      assertionMethod: assertionMethod.length > 0 ? assertionMethod : undefined,
    });
  });

  // ── User Outbox (W3C ActivityPub §5.3) ─────────────────────────────

  router.get(
    "/users/:username/outbox",
    requireFederationEnabled,
    authorizedFetchVerifier,
    (req: Request, res: Response) => {
      const username = req.params["username"];
      const user = db.getUserByUsername(username as string);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const fullUser = db.getUserFederationInfo(user.id);

      if (!fullUser || !fullUser.actor_url) {
        res.status(404).json({ error: "User not federated" });
        return;
      }

      const outboxUrl = (fullUser.outbox_url as string) || `${fullUser.actor_url}/outbox`;
      const totalCount = db.getUserOutboxCount(user.id);
      const isPage = req.query["page"] === "true" || req.query["page"] === "1";

      if (!isPage) {
        res.type("application/activity+json").json({
          "@context": "https://www.w3.org/ns/activitystreams",
          id: outboxUrl,
          type: "OrderedCollection",
          totalItems: totalCount,
          first: `${outboxUrl}?page=true`,
          last: `${outboxUrl}?page=true`,
        });
        return;
      }

      const limit = Math.min(Number(req.query["limit"]) || 20, 100);
      const offset = Math.max(Number(req.query["offset"]) || 0, 0);
      const posts = db.getUserOutboxPosts(user.id, limit, offset);

      const orderedItems = posts.map((post) => {
        const apPostId = post.ap_id || `${fullUser.actor_url}/posts/${post.id}`;
        const visibility = (post.visibility as PostVisibility) || "public";
        const addressing = buildAddressingForVisibility(visibility, fullUser.actor_url as string);
        const poll = db.getPostPoll(post.id);

        const noteObject: Record<string, unknown> = {
          id: apPostId,
          type: poll ? "Question" : "Note",
          attributedTo: fullUser.actor_url,
          content: post.content || "",
          url: post.url || apPostId,
          published: post.created_at,
          to: addressing.to,
          cc: addressing.cc,
        };

        if (poll) {
          const pollField = poll.multiple ? "anyOf" : "oneOf";
          noteObject[pollField] = poll.options.map((opt) => ({
            type: "Note",
            name: opt.title,
            replies: {
              type: "Collection",
              totalItems: opt.votes_count,
            },
          }));
          if (poll.expires_at) {
            noteObject["endTime"] = poll.expires_at;
          }
        }

        if (post.metadata?.contentWarning) {
          noteObject["summary"] = post.metadata.contentWarning;
        }

        if (post.artifact_view_id) {
          const artifact = db.getArtifactView(post.artifact_view_id);
          const attachment = serializeArtifactAttachment(artifact, publicUrl);
          if (attachment) {
            noteObject["attachment"] = [attachment];
          }
        }

        return {
          "@context": [
            "https://www.w3.org/ns/activitystreams",
            {
              modelscript: "https://hub.modelscript.org/ns#",
              viewType: "modelscript:viewType",
              viewConfig: "modelscript:viewConfig",
              sourceType: "modelscript:sourceType",
            },
          ],
          id: `${apPostId}/activity`,
          type: "Create",
          actor: fullUser.actor_url,
          published: post.created_at,
          to: addressing.to,
          cc: addressing.cc,
          object: noteObject,
        };
      });

      res.type("application/activity+json").json({
        "@context": "https://www.w3.org/ns/activitystreams",
        id: `${outboxUrl}?page=true`,
        type: "OrderedCollectionPage",
        partOf: outboxUrl,
        totalItems: totalCount,
        orderedItems,
      });
    },
  );

  // ── Followers & Following Collections (W3C §5.4 + FEP-8fcf) ────────

  router.get(
    "/users/:username/followers",
    requireFederationEnabled,
    authorizedFetchVerifier,
    (req: Request, res: Response) => {
      const username = req.params["username"];
      const user = db.getUserByUsername(username as string);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const fullUser = db.getUserFederationInfo(user.id);

      if (!fullUser || !fullUser.actor_url) {
        res.status(404).json({ error: "User not federated" });
        return;
      }

      const followersUrl = `${fullUser.actor_url}/followers`;
      const totalCount = db.getUserFollowerActorsCount(user.id);
      const isPage = req.query["page"] === "true" || req.query["page"] === "1";

      if (!isPage) {
        res.type("application/activity+json").json({
          "@context": "https://www.w3.org/ns/activitystreams",
          id: followersUrl,
          type: "OrderedCollection",
          totalItems: totalCount,
          first: `${followersUrl}?page=true`,
        });
        return;
      }

      const limit = Math.min(Number(req.query["limit"]) || 50, 100);
      const offset = Math.max(Number(req.query["offset"]) || 0, 0);
      const followerActors = db.getUserFollowerActors(user.id, limit, offset);

      res.type("application/activity+json").json({
        "@context": "https://www.w3.org/ns/activitystreams",
        id: `${followersUrl}?page=true`,
        type: "OrderedCollectionPage",
        partOf: followersUrl,
        totalItems: totalCount,
        orderedItems: followerActors,
      });
    },
  );

  router.get(
    "/users/:username/followers/synchronization",
    requireFederationEnabled,
    authorizedFetchVerifier,
    (req: Request, res: Response) => {
      const username = req.params["username"];
      const user = db.getUserByUsername(username as string);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      const fullUser = db.getUserFederationInfo(user.id);
      if (!fullUser || !fullUser.actor_url) {
        res.status(404).json({ error: "User not federated" });
        return;
      }

      const domainParam = (req.query["domain"] as string | undefined)?.trim().toLowerCase();
      let remoteDomain = domainParam || "";
      const signedActor = (req as Request & { actorId?: string | undefined }).actorId;
      if (!remoteDomain && signedActor) {
        try {
          remoteDomain = new URL(signedActor).hostname.toLowerCase();
        } catch {}
      }

      const followerActors = remoteDomain
        ? (
            db.db
              .prepare(
                `SELECT u.actor_url FROM follows f JOIN users u ON f.follower_id = u.id
                 WHERE f.following_id = ? AND LOWER(u.remote_domain) = ? AND (f.state = 'accepted' OR f.state IS NULL)`,
              )
              .all(user.id, remoteDomain) as { actor_url: string | null }[]
          )
            .map((r) => r.actor_url)
            .filter((u): u is string => Boolean(u))
        : db.getUserFollowerActors(user.id, 500, 0);

      res.type("application/activity+json").json({
        "@context": "https://www.w3.org/ns/activitystreams",
        id: `${fullUser.actor_url}/followers/synchronization`,
        type: "OrderedCollectionPage",
        partOf: `${fullUser.actor_url}/followers`,
        orderedItems: followerActors,
        digest: computeFollowersSyncDigest(followerActors),
      });
    },
  );

  router.get(
    "/users/:username/following",
    requireFederationEnabled,
    authorizedFetchVerifier,
    (req: Request, res: Response) => {
      const username = req.params["username"];
      const user = db.getUserByUsername(username as string);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const fullUser = db.getUserFederationInfo(user.id);

      if (!fullUser || !fullUser.actor_url) {
        res.status(404).json({ error: "User not federated" });
        return;
      }

      const followingUrl = `${fullUser.actor_url}/following`;
      const totalCount = db.getUserFollowingActorsCount(user.id);
      const isPage = req.query["page"] === "true" || req.query["page"] === "1";

      if (!isPage) {
        res.type("application/activity+json").json({
          "@context": "https://www.w3.org/ns/activitystreams",
          id: followingUrl,
          type: "OrderedCollection",
          totalItems: totalCount,
          first: `${followingUrl}?page=true`,
        });
        return;
      }

      const limit = Math.min(Number(req.query["limit"]) || 50, 100);
      const offset = Math.max(Number(req.query["offset"]) || 0, 0);
      const followingActors = db.getUserFollowingActors(user.id, limit, offset);

      res.type("application/activity+json").json({
        "@context": "https://www.w3.org/ns/activitystreams",
        id: `${followingUrl}?page=true`,
        type: "OrderedCollectionPage",
        partOf: followingUrl,
        totalItems: totalCount,
        orderedItems: followingActors,
      });
    },
  );

  // ── Remote Media / Artifact Cache Proxy (with CSP Sandbox) ────────

  const handleMediaProxy = async (req: Request, res: Response) => {
    const rawUrl = (req.query["url"] as string | undefined)?.trim();
    if (!rawUrl) {
      res.status(400).json({ error: "Missing url query parameter" });
      return;
    }

    let safeUrl: URL;
    try {
      safeUrl = assertSafePublicUrl(rawUrl);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid or unsafe URL" });
      return;
    }

    const remoteDomain = safeUrl.hostname.toLowerCase();
    const domainPolicy = db.getDomainTier(remoteDomain);
    if (domainPolicy.tier === "suspend" || domainPolicy.rejectMedia) {
      res.status(403).json({
        error: `Media from remote domain '${remoteDomain}' is blocked by instance moderation policy.`,
      });
      return;
    }

    const cached = db.getCachedRemoteArtifact(safeUrl.href);
    if (cached && cached.data_blob) {
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("X-Cache", "HIT");
      if (cached.sha256) {
        res.setHeader("ETag", `"${cached.sha256}"`);
      }
      res.type(cached.media_type || "application/octet-stream").send(cached.data_blob);
      return;
    }

    try {
      const upstream = await safePublicFetch(safeUrl.href, {
        headers: { "User-Agent": "Ansatz-MediaProxy/1.0" },
      });
      if (!upstream.ok) {
        res.status(502).json({ error: `Upstream media fetch failed (${upstream.status})` });
        return;
      }

      const arrayBuf = await upstream.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      const maxCacheBytes = 15 * 1024 * 1024; // 15 MB
      if (buffer.byteLength > maxCacheBytes) {
        res.status(413).json({ error: "Remote media exceeds maximum proxy size limit (15 MB)" });
        return;
      }

      const mediaType = (upstream.headers.get("content-type") || "application/octet-stream").split(";")[0]!.trim();
      const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

      db.putCachedRemoteArtifact({
        sourceUrl: safeUrl.href,
        remoteDomain,
        mediaType,
        byteSize: buffer.byteLength,
        sha256,
        data: buffer,
      });

      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("X-Cache", "MISS");
      res.setHeader("ETag", `"${sha256}"`);
      res.type(mediaType).send(buffer);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Failed to fetch remote media",
      });
    }
  };

  router.get("/federation/media-proxy", requireFederationEnabled, handleMediaProxy);
  router.get("/api/v1/federation/media-proxy", requireFederationEnabled, handleMediaProxy);

  // ── Remote Actor WebFinger Resolution Endpoint ────────────────────

  const resolveRemoteActor = async (req: Request, res: Response) => {
    if (process.env["NODE_ENV"] === "production" && !req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const handleOrUrl = req.body?.handle || req.body?.url || req.query["resource"];
    if (!handleOrUrl || typeof handleOrUrl !== "string") {
      res.status(400).json({ error: "Missing handle or url in request" });
      return;
    }

    try {
      const resolved = await resolveActorHandle(handleOrUrl, db);
      res.json({
        success: true,
        user: resolved.user,
        actor: resolved.actor,
      });
    } catch (err: unknown) {
      console.error("[FederationResolve] Error:", err);
      res
        .status(500)
        .json({ error: (err instanceof Error ? err.message : String(err)) || "Failed to resolve remote actor" });
    }
  };

  router.post("/federation/resolve", requireFederationEnabled, optionalAuth, resolveRemoteActor);
  router.post("/api/v1/federation/resolve", requireFederationEnabled, optionalAuth, resolveRemoteActor);

  // ── Helper to ingest a remote Note/Question object ────────────────

  const ingestRemoteNoteOrQuestion = (
    note: Record<string, unknown>,
    authorUserId: number,
    remoteDomain: string,
    isSilencedFlag: boolean,
    parentActivity?: Record<string, unknown>,
  ): { id: number } | null => {
    const noteId = typeof note["id"] === "string" ? note["id"] : "";
    if (!noteId) return null;

    const existing = db.getPostByApId(noteId);
    if (existing) return { id: existing.id };

    const content = typeof note["content"] === "string" ? note["content"] : "";
    const domainPolicy = db.getDomainTier(remoteDomain);
    const isSilenced = isSilencedFlag || domainPolicy.tier === "silence" ? 1 : 0;

    let artifactViewId: number | undefined;
    if (!domainPolicy.rejectMedia) {
      const rawAttachments = Array.isArray(note["attachment"])
        ? note["attachment"]
        : note["attachment"]
          ? [note["attachment"]]
          : [];

      for (const att of rawAttachments) {
        if (att && typeof att === "object") {
          const attObj = att as Record<string, unknown>;
          const mediaType = String(attObj["mediaType"] || attObj["mimeType"] || "").toLowerCase();
          const rawAttUrl = attObj["url"];
          const attUrl =
            typeof rawAttUrl === "string"
              ? rawAttUrl
              : typeof (rawAttUrl as { href?: string } | undefined)?.href === "string"
                ? (rawAttUrl as { href: string }).href
                : "";
          const lowerUrl = attUrl.toLowerCase();

          let viewType: string | null = typeof attObj["viewType"] === "string" ? attObj["viewType"] : null;
          let sourceType: string = typeof attObj["sourceType"] === "string" ? attObj["sourceType"] : "federated";

          if (!viewType) {
            if (
              mediaType === "model/step" ||
              mediaType === "application/step" ||
              lowerUrl.endsWith(".step") ||
              lowerUrl.endsWith(".stp")
            ) {
              viewType = "cad-step";
              sourceType = "step";
            } else if (
              mediaType.includes("gltf") ||
              lowerUrl.endsWith(".glb") ||
              lowerUrl.endsWith(".gltf") ||
              lowerUrl.endsWith(".usdz")
            ) {
              viewType = "3d-model";
              sourceType = "gltf";
            } else if (mediaType.includes("vegalite") || mediaType.includes("chart")) {
              viewType = "simulation-plot";
              sourceType = "vegalite";
            } else if (mediaType === "text/x-modelica" || lowerUrl.endsWith(".mo")) {
              viewType = "modelica-code";
              sourceType = "modelica";
            } else if (mediaType.includes("fmu") || lowerUrl.endsWith(".fmu")) {
              viewType = "fmu";
              sourceType = "fmu";
            } else if (mediaType === "application/pdf") {
              viewType = "pdf";
              sourceType = "document";
            } else if (mediaType.startsWith("image/")) {
              viewType = "picture";
              sourceType = "image";
            }
          }

          if (viewType && attUrl) {
            try {
              const safeUrl = assertSafePublicUrl(attUrl);
              const config =
                typeof attObj["viewConfig"] === "object" && attObj["viewConfig"] !== null
                  ? { ...(attObj["viewConfig"] as Record<string, unknown>) }
                  : {};
              config["url"] = safeUrl.href;
              config["proxiedUrl"] =
                `${publicUrl}/api/v1/federation/media-proxy?url=${encodeURIComponent(safeUrl.href)}`;
              const iconObj = attObj["icon"] as { url?: string } | undefined;
              if (iconObj?.url) {
                config["thumbnailUrl"] = iconObj.url;
              }

              artifactViewId = db.createArtifactView(
                authorUserId,
                viewType,
                sourceType,
                JSON.stringify(config),
                typeof attObj["name"] === "string" ? attObj["name"] : "Federated Engineering Artifact",
                iconObj?.url || null,
                safeUrl.href,
              );
              break;
            } catch {
              // Discard unsafe attachment URLs
            }
          }
        }
      }
    }

    let replyToId: number | undefined;
    if (typeof note["inReplyTo"] === "string") {
      const parentPost = db.getPostByApId(note["inReplyTo"]);
      if (parentPost) {
        replyToId = parentPost.id;
      }
    }

    // If this is a poll vote reply (Note with name matching an option on a parent Question)
    if (replyToId && typeof note["name"] === "string" && note["name"].trim()) {
      const parentPoll = db.getPostPoll(replyToId);
      if (parentPoll) {
        const optionIdx = parentPoll.options.findIndex(
          (o) => o.title.toLowerCase() === String(note["name"]).trim().toLowerCase(),
        );
        if (optionIdx !== -1) {
          try {
            const voterActor = typeof note["attributedTo"] === "string" ? note["attributedTo"] : undefined;
            db.votePostPoll(replyToId, [optionIdx], null, voterActor);
          } catch {}
        }
      }
    }

    const contentWarning = typeof note["summary"] === "string" ? note["summary"].trim() : undefined;
    const postMetadata = contentWarning ? { contentWarning } : undefined;
    const visibility = inferVisibilityFromAddressing(note, parentActivity);

    const newPost = db.createPost(
      authorUserId,
      content,
      artifactViewId,
      replyToId,
      undefined,
      undefined,
      noteId,
      typeof note["url"] === "string" ? note["url"] : noteId,
      undefined,
      undefined,
      postMetadata,
      undefined,
      isSilenced,
      contentWarning ? 1 : 0,
      contentWarning,
      visibility,
    );

    // If Question (federated poll), persist options
    const oneOf = Array.isArray(note["oneOf"]) ? note["oneOf"] : null;
    const anyOf = Array.isArray(note["anyOf"]) ? note["anyOf"] : null;
    const rawPollOptions = oneOf || anyOf;
    if (rawPollOptions && rawPollOptions.length >= 2) {
      const parsedOptions = rawPollOptions
        .map((opt) => {
          if (!opt || typeof opt !== "object") return null;
          const o = opt as Record<string, unknown>;
          const title = typeof o["name"] === "string" ? o["name"].trim() : "";
          const replies = o["replies"] as { totalItems?: number } | undefined;
          const votesCount = Number(replies?.totalItems || 0);
          return title ? { title, votes_count: votesCount } : null;
        })
        .filter((o): o is { title: string; votes_count: number } => o !== null);
      if (parsedOptions.length >= 2) {
        const expiresAt =
          typeof note["endTime"] === "string"
            ? note["endTime"]
            : typeof note["closed"] === "string"
              ? note["closed"]
              : null;
        try {
          db.createPostPoll(newPost.id, parsedOptions, expiresAt, Boolean(anyOf));
        } catch {}
      }
    }

    if (replyToId) {
      const parent = db.getPost(replyToId);
      if (parent && parent.author_id) {
        db.createNotification(parent.author_id, authorUserId, "reply", newPost.id);
      }
    }

    return { id: newPost.id };
  };

  // ── Shared Inbox & User Inbox Handler ─────────────────────────────

  const handleInboxActivity = async (req: Request, res: Response) => {
    const username = req.params["username"];
    const activity = req.body;
    const remoteActorUrl = (req as Request & { actorId?: string | undefined }).actorId;
    const verifiedKeyId = (req as Request & { activityPubVerifiedKeyId?: string | undefined }).activityPubVerifiedKeyId;
    const remoteActorProfile = (req as Request & { actorProfile?: Record<string, unknown> | undefined }).actorProfile;

    if (activity?.actor !== undefined && typeof activity.actor !== "string") {
      res.status(400).json({ error: "Activity actor must be a string URI" });
      return;
    }

    if (activity?.actor && remoteActorUrl && typeof activity.actor === "string" && activity.actor !== remoteActorUrl) {
      res.status(403).json({ error: "Actor mismatch between HTTP signature and activity payload" });
      return;
    }

    if (verifiedKeyId && activity?.actor && typeof activity.actor === "string") {
      const keyActorPrefix = verifiedKeyId.split("#")[0];
      if (keyActorPrefix && keyActorPrefix !== activity.actor) {
        res.status(403).json({ error: "Signature keyId does not belong to activity actor" });
        return;
      }
    }

    let fullLocalUser: ReturnType<typeof db.getUserFederationInfo> | null = null;
    if (username) {
      const localUser = db.getUserByUsername(username as string);
      if (!localUser) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      fullLocalUser = db.getUserFederationInfo(localUser.id);
      if (!fullLocalUser || !fullLocalUser.actor_url) {
        res.status(400).json({ error: "User not federated" });
        return;
      }
    }

    if (!remoteActorUrl) {
      res.status(202).send();
      return;
    }

    let remoteDomain = "unknown";
    try {
      remoteDomain = new URL(remoteActorUrl).hostname.toLowerCase();
    } catch {}

    // Upsert the remote user in our database
    const remoteUser = db.getOrCreateRemoteUser(remoteActorUrl as string, remoteActorProfile);

    try {
      if (activity.type === "Follow" && fullLocalUser) {
        const isLocked = Boolean(fullLocalUser.locked);
        if (isLocked) {
          // Hold follow in pending state and notify user
          db.followUser(remoteUser.id, fullLocalUser.id as number, "pending");
          db.createNotification(fullLocalUser.id as number, remoteUser.id, "follow_request");
        } else {
          // Record the follow as accepted and auto-reply with Accept
          db.followUser(remoteUser.id, fullLocalUser.id as number, "accepted");

          const acceptActivity = {
            "@context": "https://www.w3.org/ns/activitystreams",
            id: `${fullLocalUser.actor_url}#accept-${Date.now()}`,
            type: "Accept",
            actor: fullLocalUser.actor_url,
            object: activity,
          };

          const targetInbox =
            (remoteActorProfile?.["endpoints"] as { sharedInbox?: string | undefined } | undefined)?.sharedInbox ||
            (remoteActorProfile?.["sharedInbox"] as string) ||
            (remoteActorProfile?.["inbox"] as string) ||
            `${remoteActorUrl}/inbox`;

          const instanceKeys = db.getInstanceKeys();
          const transportKey = instanceKeys.privateKey;
          const transportKeyId = `${publicUrl}/actor#main-key`;

          sendSignedRequest(targetInbox, acceptActivity, transportKeyId, transportKey, db).catch((err) =>
            console.error("Failed to send Accept activity:", err),
          );
        }
      } else if (activity.type === "Accept") {
        // Check if this Accept is from a federated Relay actor
        const matchedRelay = db.getFederationRelayByActor(remoteActorUrl);
        if (matchedRelay) {
          db.updateFederationRelayState(matchedRelay.id, "accepted", null);
        }
        if (
          fullLocalUser &&
          activity.object &&
          (activity.object.type === "Follow" || typeof activity.object === "string")
        ) {
          db.updateFollowState(fullLocalUser.id as number, remoteUser.id, "accepted");
        }
      } else if (activity.type === "Reject") {
        const matchedRelay = db.getFederationRelayByActor(remoteActorUrl);
        if (matchedRelay) {
          db.updateFederationRelayState(matchedRelay.id, "rejected", "Relay rejected Follow subscription");
        }
        if (
          fullLocalUser &&
          activity.object &&
          (activity.object.type === "Follow" || typeof activity.object === "string")
        ) {
          db.updateFollowState(fullLocalUser.id as number, remoteUser.id, "rejected");
        }
      } else if (activity.type === "Undo") {
        if (activity.object && activity.object.type === "Follow" && fullLocalUser) {
          db.unfollowUser(remoteUser.id, fullLocalUser.id as number);
        } else if (activity.object && activity.object.type === "Like") {
          const targetApId =
            typeof activity.object.object === "string" ? activity.object.object : activity.object.object?.id;
          if (targetApId) {
            const post = db.getPostByApId(targetApId);
            if (post) {
              db.unlikePost(remoteUser.id, post.id);
            }
          }
        } else if (activity.object && activity.object.type === "Announce") {
          const announceApId = typeof activity.object.id === "string" ? activity.object.id : undefined;
          if (announceApId) {
            db.deletePostByApId(announceApId, remoteUser.id);
          }
          const targetApId =
            typeof activity.object.object === "string" ? activity.object.object : activity.object.object?.id;
          if (targetApId) {
            const post = db.getPostByApId(targetApId);
            if (post) {
              const repostRow = db.db
                .prepare(`SELECT id FROM posts WHERE author_id = ? AND repost_of_id = ?`)
                .get(remoteUser.id, post.id) as { id: number } | undefined;
              if (repostRow) {
                db.deletePost(repostRow.id);
              }
            }
          }
        } else if (activity.object && activity.object.type === "Block" && fullLocalUser) {
          db.unblockUser(remoteUser.id, fullLocalUser.id as number);
        }
      } else if (activity.type === "Block") {
        const targetUri = typeof activity.object === "string" ? activity.object : activity.object?.id;
        const targetUser = fullLocalUser || (targetUri ? db.getUserByActorUrl(targetUri) : undefined);
        if (targetUser) {
          db.blockUser(remoteUser.id, targetUser.id as number);
        }
      } else if (activity.type === "Move") {
        const rawTarget = activity.target || activity.object;
        const targetActorUrl = typeof rawTarget === "string" ? rawTarget : rawTarget?.id;
        if (typeof targetActorUrl === "string" && targetActorUrl.trim()) {
          let targetAlsoKnownAs: string[] = [];
          let targetProfile:
            | {
                username?: string | undefined;
                displayName?: string | undefined;
                inboxUrl?: string | undefined;
                sharedInboxUrl?: string | undefined;
                publicKey?: string | undefined;
              }
            | undefined;

          if (typeof rawTarget === "object" && rawTarget !== null && Array.isArray(rawTarget.alsoKnownAs)) {
            targetAlsoKnownAs = rawTarget.alsoKnownAs.map(String);
            targetProfile = {
              username: rawTarget.preferredUsername,
              displayName: rawTarget.name,
              inboxUrl: rawTarget.inbox,
              sharedInboxUrl: rawTarget.endpoints?.sharedInbox || rawTarget.sharedInbox,
              publicKey: rawTarget.publicKey?.publicKeyPem,
            };
          } else {
            // Check if target is a local user or already known in DB
            const localTarget = db.getUserByActorUrl(targetActorUrl);
            if (localTarget) {
              const info = db.getUserFederationInfo(localTarget.id);
              if (info?.also_known_as) {
                try {
                  const parsed = JSON.parse(info.also_known_as);
                  if (Array.isArray(parsed)) targetAlsoKnownAs = parsed.map(String);
                } catch {}
              }
            } else {
              try {
                const resolved = await resolveActorHandle(targetActorUrl, db);
                const rawAliases = resolved.actor["alsoKnownAs"];
                if (Array.isArray(rawAliases)) {
                  targetAlsoKnownAs = rawAliases.map(String);
                }
              } catch {}
            }
          }

          db.executeInboundActorMove(remoteActorUrl, targetActorUrl, targetAlsoKnownAs, targetProfile);
        }
      } else if (activity.type === "Like") {
        const targetApId = typeof activity.object === "string" ? activity.object : activity.object?.id;
        if (targetApId) {
          const post = db.getPostByApId(targetApId);
          if (post) {
            db.likePost(remoteUser.id, post.id);
          }
        }
      } else if (activity.type === "Announce") {
        const matchedRelay = db.getFederationRelayByActor(remoteActorUrl);
        if (matchedRelay && matchedRelay.state === "accepted") {
          db.incrementRelayStats(matchedRelay.id, "received");
          if (
            activity.object &&
            typeof activity.object === "object" &&
            (activity.object.type === "Note" || activity.object.type === "Question")
          ) {
            const noteObj = activity.object as Record<string, unknown>;
            const attributedTo = typeof noteObj["attributedTo"] === "string" ? noteObj["attributedTo"] : remoteActorUrl;
            let originDomain = remoteDomain;
            try {
              originDomain = new URL(attributedTo).hostname.toLowerCase();
            } catch {}
            if (!db.isDomainSuspended(originDomain)) {
              const noteAuthor = db.getOrCreateRemoteUser(attributedTo);
              const isSilenced = Boolean((req as Request & { isDomainSilenced?: boolean }).isDomainSilenced);
              ingestRemoteNoteOrQuestion(noteObj, noteAuthor.id, originDomain, isSilenced, activity);
            }
          }
        } else {
          const targetApId = typeof activity.object === "string" ? activity.object : activity.object?.id;
          if (targetApId) {
            const post = db.getPostByApId(targetApId);
            if (post) {
              db.createPost(
                remoteUser.id,
                null,
                undefined,
                undefined,
                undefined,
                post.id,
                activity.id,
                activity.url || activity.id,
              );
              db.createNotification(post.author_id, remoteUser.id, "repost", post.id);
            }
          }
        }
      } else if (activity.type === "Delete") {
        const targetApId = typeof activity.object === "string" ? activity.object : activity.object?.id;
        if (targetApId) {
          db.deletePostByApId(targetApId, remoteUser.id);
          try {
            const parsed = new URL(targetApId as string, "http://localhost");
            const prefix = "/libraries/";
            const idx = parsed.pathname.indexOf(prefix);
            if (idx !== -1) {
              const rest = parsed.pathname.slice(idx + prefix.length);
              const lastSlash = rest.lastIndexOf("/");
              if (lastSlash > 0 && lastSlash < rest.length - 1) {
                db.deleteRemotePackage(
                  decodeURIComponent(rest.slice(0, lastSlash)),
                  decodeURIComponent(rest.slice(lastSlash + 1)),
                  remoteActorUrl as string,
                );
              }
            }
          } catch {
            // ignore invalid URI
          }
        }
      } else if (
        activity.type === "Update" &&
        activity.object &&
        (activity.object.type === "Person" ||
          activity.object.type === "Application" ||
          activity.object.type === "Service" ||
          activity.object.type === "Organization" ||
          activity.object.type === "Group")
      ) {
        const actorObj = activity.object as Record<string, unknown>;
        if (!actorObj["id"] || actorObj["id"] === remoteActorUrl) {
          invalidateCachedPublicKey(remoteActorUrl);
          db.updateRemoteActorProfile(remoteActorUrl, actorObj);
        }
      } else if (
        activity.type === "Update" &&
        activity.object &&
        (activity.object.type === "Note" || activity.object.type === "Question")
      ) {
        const note = activity.object;
        if (note.id && typeof note.content === "string") {
          db.updatePostContentByApId(note.id, note.content, remoteUser.id);
        }
        if (note.id && (Array.isArray(note.oneOf) || Array.isArray(note.anyOf))) {
          const existingPost = db.getPostByApId(note.id);
          if (existingPost && existingPost.author_id === remoteUser.id) {
            const rawOpts = (note.oneOf || note.anyOf) as Record<string, unknown>[];
            const parsedOpts = rawOpts
              .map((o) => ({
                title: typeof o["name"] === "string" ? o["name"].trim() : "",
                votes_count: Number((o["replies"] as { totalItems?: number } | undefined)?.totalItems || 0),
              }))
              .filter((o) => o.title.length > 0);
            if (parsedOpts.length >= 2) {
              db.createPostPoll(
                existingPost.id,
                parsedOpts,
                note.endTime || note.closed || null,
                Array.isArray(note.anyOf),
              );
            }
          }
        }
      } else if (activity.type === "Flag") {
        // Respect domain-level reject_reports policy
        const domainPolicy = db.getDomainTier(remoteDomain);
        if (domainPolicy.rejectReports) {
          res.status(202).send();
          return;
        }

        const rawObjects = Array.isArray(activity.object) ? activity.object : [activity.object];
        const flagReason =
          typeof activity.content === "string" && activity.content.trim()
            ? activity.content.trim()
            : "Federated ActivityPub Flag report";
        let reportedPostId: number | undefined;
        let reportedUserId: number | undefined;

        for (const obj of rawObjects) {
          const objUri = typeof obj === "string" ? obj : obj?.id;
          if (!objUri || typeof objUri !== "string") continue;
          const matchedPost = db.getPostByApId(objUri);
          if (matchedPost) {
            reportedPostId = matchedPost.id;
            reportedUserId = matchedPost.author_id;
          } else if (fullLocalUser && !reportedUserId) {
            reportedUserId = fullLocalUser.id as number;
          }
        }

        const report = db.createContentReport(remoteUser.id, {
          postId: reportedPostId,
          targetUserId: reportedUserId ?? (fullLocalUser?.id as number | undefined),
          reason: flagReason,
          details: `Federated Flag from ${remoteActorUrl}`,
          category: "federated_flag",
        });

        db.logAudit({
          actorId: remoteUser.id,
          action: "federated_flag_received",
          resourceType: reportedPostId ? "post" : "user",
          resourceId: String(reportedPostId ?? reportedUserId ?? "unknown"),
          ipAddress: (req.headers["x-forwarded-for"] as string) || req.ip,
          details: { reportId: report.id, remoteActor: remoteActorUrl, reason: flagReason },
        });
      } else if (
        activity.type === "Create" &&
        activity.object &&
        (activity.object.type === "SoftwareApplication" ||
          (Array.isArray(activity.object.type) && activity.object.type.includes("schema:SoftwareApplication")) ||
          activity.object.packageType === "modelica" ||
          (activity.object.name && activity.object.version && activity.object.checksum))
      ) {
        const pkgObj = activity.object;
        if (pkgObj.name && pkgObj.version) {
          let pkgName = pkgObj.name;
          const mode = process.env["FEDERATION_MODE"];
          let isHubDomain = false;
          try {
            const parsedHost = new URL(publicUrl).hostname;
            isHubDomain = parsedHost === "hub.modelscript.org" || parsedHost.endsWith(".hub.modelscript.org");
          } catch {
            isHubDomain = false;
          }
          if (mode === "curated-hub" || isHubDomain || (process.env["NODE_ENV"] === "production" && mode !== "open")) {
            if (!pkgName.startsWith("@")) {
              try {
                const originHost = new URL(remoteActorUrl as string).hostname;
                pkgName = `@${originHost}/${pkgName}`;
              } catch {
                // Keep original if actorUrl not a full URL
              }
            }
          }

          db.recordRemotePackage({
            name: pkgName,
            version: pkgObj.version,
            actorUrl: remoteActorUrl as string,
            downloadUrl: pkgObj.downloadUrl || pkgObj.url || pkgObj.id || "",
            checksum: pkgObj.checksum || "",
            license: pkgObj.license || null,
            description: pkgObj.description || pkgObj.content || null,
            metadata: JSON.stringify(pkgObj),
          });
        }
      } else if (
        activity.type === "Create" &&
        activity.object &&
        (activity.object.type === "Note" || activity.object.type === "Question")
      ) {
        const note = activity.object as Record<string, unknown>;
        const matchedRelay = db.getFederationRelayByActor(remoteActorUrl);
        if (matchedRelay && matchedRelay.state === "accepted") {
          db.incrementRelayStats(matchedRelay.id, "received");
        } else if (
          typeof note["id"] === "string" &&
          note["id"].startsWith("http") &&
          remoteActorUrl.startsWith("http")
        ) {
          try {
            if (new URL(note["id"]).origin !== new URL(remoteActorUrl).origin) {
              res.status(403).json({ error: "Note origin does not match actor origin" });
              return;
            }
          } catch {
            res.status(400).json({ error: "Invalid Note id URL" });
            return;
          }
        }

        const isSilenced = Boolean((req as Request & { isDomainSilenced?: boolean | undefined }).isDomainSilenced);
        ingestRemoteNoteOrQuestion(note, remoteUser.id, remoteDomain, isSilenced, activity);
      }

      // Always return 202 Accepted for ActivityPub inboxes unless malformed
      res.status(202).send();
    } catch (err) {
      console.error("Error processing Inbox activity:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  };

  router.post(
    "/inbox",
    inboxLimiter,
    json({ type: ["application/activity+json", "application/json", "application/ld+json"] }),
    verifier,
    handleInboxActivity,
  );

  router.post(
    "/actor/inbox",
    inboxLimiter,
    json({ type: ["application/activity+json", "application/json", "application/ld+json"] }),
    verifier,
    handleInboxActivity,
  );

  router.post(
    "/users/:username/inbox",
    inboxLimiter,
    json({ type: ["application/activity+json", "application/json", "application/ld+json"] }),
    verifier,
    handleInboxActivity,
  );

  router.get("/federation/packages", (req: Request, res: Response) => {
    const limit = Math.min(Number(req.query["limit"]) || 50, 100);
    const offset = Math.max(Number(req.query["offset"]) || 0, 0);
    const packages = db.getRemotePackages(limit, offset);
    res.json({
      total: packages.length,
      packages,
    });
  });

  return router;
}

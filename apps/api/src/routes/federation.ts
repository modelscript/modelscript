// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response } from "express";
import { Router, json } from "express";
import { LibraryDatabase } from "../database.js";
import { createActivityPubVerifier, defaultInboxLimiter } from "../middleware/activitypub.js";
import type { FederationWorker } from "../services/federation-worker.js";
import { sendSignedRequest } from "../util/activitypub-crypto.js";
import { ed25519PemToMultibase } from "../util/multikey.js";
import { assertSafePublicUrl, safePublicFetch } from "../util/ssrf.js";

export function serializeArtifactAttachment(artifact: any, publicUrl: string): Record<string, unknown> | null {
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
): Promise<{ user: any; actor: Record<string, unknown>; actorUrl: string }> {
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

    const wfData = (await wfRes.json()) as any;
    const selfLink = wfData.links?.find(
      (l: any) => l.rel === "self" && (l.type === "application/activity+json" || l.type === "application/ld+json"),
    );

    if (!selfLink || !selfLink.href) {
      throw new Error("No ActivityPub actor link found in WebFinger response");
    }
    actorUrl = selfLink.href;
  }

  // Fetch actor profile via SSRF-safe fetch
  const actorRes = await safePublicFetch(actorUrl, {
    headers: { Accept: "application/activity+json, application/ld+json" },
  });

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

export function federationRouter(db: LibraryDatabase, worker?: FederationWorker): Router {
  const router = Router();
  const verifier = createActivityPubVerifier(db);
  const inboxLimiter = defaultInboxLimiter.middleware();
  const publicUrl = process.env.PUBLIC_URL || "https://hub.modelscript.org";

  // Check FEDERATION_MODE
  router.use((req: Request, res: Response, next) => {
    const mode = process.env["FEDERATION_MODE"];
    if (mode === "disabled") {
      if (req.path.includes("/inbox")) {
        res.status(403).json({ error: "Federation is disabled on this node." });
        return;
      }
    }
    next();
  });

  // ── WebFinger (RFC 7033 / ActivityPub Discovery) ──────────────────

  router.get("/.well-known/webfinger", (req: Request, res: Response) => {
    const resource = req.query.resource as string;

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
    const totalUsers = db.getTotalUsersCount();
    const totalPosts = db.getTotalPostsCount();

    res.type('application/json; profile="http://nodeinfo.diaspora.software/ns/schema/2.1#"').json({
      version: "2.1",
      software: {
        name: "modelscript-hub",
        version: "0.1.0",
        repository: "https://github.com/modelscript/modelscript",
      },
      protocols: ["activitypub"],
      services: {
        inbound: [],
        outbound: [],
      },
      openRegistrations: false,
      usage: {
        users: {
          total: totalUsers,
          activeHalfyear: totalUsers,
          activeMonth: totalUsers,
        },
        localPosts: totalPosts,
      },
      metadata: {
        nodeName: "ModelScript Hub",
        nodeDescription: "Collaborative Engineering and Physical Modeling Hub",
      },
    });
  };

  router.get("/nodeinfo/2.0", handleNodeInfo);
  router.get("/nodeinfo/2.1", handleNodeInfo);

  // ── Instance Actor Profile & Outbox ───────────────────────────────

  router.get("/actor", (req: Request, res: Response) => {
    const acceptsActivity = req.accepts("application/activity+json", "application/ld+json", "application/json");
    if (!acceptsActivity) {
      res.status(404).json({ error: "Not found or invalid content type" });
      return;
    }

    const instanceKeys = db.getInstanceKeys();
    const instanceEdKeys = db.getInstanceEd25519Keys();
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
      name: "ModelScript Hub",
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

  router.get("/actor/outbox", (_req: Request, res: Response) => {
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

  router.get("/users/:username", (req: Request, res: Response) => {
    const acceptsActivity = req.accepts("application/activity+json", "application/ld+json", "application/json");
    if (!acceptsActivity) {
      res.status(404).json({ error: "Not found or invalid content type" });
      return;
    }

    const username = req.params.username;
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
        `SELECT id, display_name, bio, avatar_url, rsa_public_key, ed25519_public_key, actor_url, inbox_url, outbox_url FROM users WHERE id = ?`,
      )
      .get(user.id) as Record<string, unknown> | undefined;

    if (!fullUser || !fullUser.actor_url) {
      res.status(404).json({ error: "User not federated" });
      return;
    }

    const keys = db.getPublicKeysForUser(fullUser.id as number);

    // Fallback to legacy key if no new keys exist, or map all active keys
    let publicKeys: { id: string; owner: string; publicKeyPem: string }[] = keys.map((k) => ({
      id: `${fullUser.actor_url}#${k.key_id_string}`,
      owner: fullUser.actor_url as string,
      publicKeyPem: k.public_key_pem,
    }));

    if (publicKeys.length === 0 && fullUser.rsa_public_key) {
      publicKeys = [
        {
          id: `${fullUser.actor_url}#main-key`,
          owner: fullUser.actor_url as string,
          publicKeyPem: fullUser.rsa_public_key as string,
        },
      ];
    }

    const assertionMethod: Record<string, string>[] = [];
    if (fullUser.ed25519_public_key) {
      const edMultibase = ed25519PemToMultibase(fullUser.ed25519_public_key as string);
      assertionMethod.push({
        id: `${fullUser.actor_url}#ed25519-key`,
        type: "Multikey",
        controller: fullUser.actor_url as string,
        publicKeyMultibase: edMultibase,
        publicKeyPem: fullUser.ed25519_public_key as string,
      });
    }

    res.type("application/activity+json").json({
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/security/v1",
        "https://w3id.org/security/data-integrity/v1",
      ],
      id: fullUser.actor_url,
      type: "Person",
      preferredUsername: username,
      name: fullUser.display_name || username,
      summary: fullUser.bio || "ModelScript developer",
      inbox: fullUser.inbox_url,
      outbox: fullUser.outbox_url,
      followers: `${fullUser.actor_url}/followers`,
      following: `${fullUser.actor_url}/following`,
      endpoints: {
        sharedInbox: `${publicUrl}/actor/inbox`,
      },
      icon: {
        type: "Image",
        mediaType: "image/jpeg",
        url: fullUser.avatar_url,
      },
      publicKey: publicKeys.length === 1 ? publicKeys[0] : publicKeys,
      assertionMethod: assertionMethod.length > 0 ? assertionMethod : undefined,
    });
  });

  // ── User Outbox (W3C ActivityPub §5.3) ─────────────────────────────

  router.get("/users/:username/outbox", (req: Request, res: Response) => {
    const username = req.params.username;
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
    const isPage = req.query.page === "true" || req.query.page === "1";

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

    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const posts = db.getUserOutboxPosts(user.id, limit, offset);

    const orderedItems = posts.map((post) => {
      const apPostId = post.ap_id || `${fullUser.actor_url}/posts/${post.id}`;
      const noteObject: Record<string, unknown> = {
        id: apPostId,
        type: "Note",
        attributedTo: fullUser.actor_url,
        content: post.content || "",
        url: post.url || apPostId,
        published: post.created_at,
        to: ["https://www.w3.org/ns/activitystreams#Public"],
        cc: [`${fullUser.actor_url}/followers`],
      };

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
        to: ["https://www.w3.org/ns/activitystreams#Public"],
        cc: [`${fullUser.actor_url}/followers`],
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
  });

  // ── Followers & Following Collections (W3C §5.4) ──────────────────

  router.get("/users/:username/followers", (req: Request, res: Response) => {
    const username = req.params.username;
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
    const isPage = req.query.page === "true" || req.query.page === "1";

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

    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const followerActors = db.getUserFollowerActors(user.id, limit, offset);

    res.type("application/activity+json").json({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `${followersUrl}?page=true`,
      type: "OrderedCollectionPage",
      partOf: followersUrl,
      totalItems: totalCount,
      orderedItems: followerActors,
    });
  });

  router.get("/users/:username/following", (req: Request, res: Response) => {
    const username = req.params.username;
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
    const isPage = req.query.page === "true" || req.query.page === "1";

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

    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const followingActors = db.getUserFollowingActors(user.id, limit, offset);

    res.type("application/activity+json").json({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `${followingUrl}?page=true`,
      type: "OrderedCollectionPage",
      partOf: followingUrl,
      totalItems: totalCount,
      orderedItems: followingActors,
    });
  });

  // ── Remote Actor WebFinger Resolution Endpoint ────────────────────

  const resolveRemoteActor = async (req: Request, res: Response) => {
    const handleOrUrl = req.body?.handle || req.body?.url || req.query.resource;
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
    } catch (err: any) {
      console.error("[FederationResolve] Error:", err);
      res.status(500).json({ error: err.message || "Failed to resolve remote actor" });
    }
  };

  router.post("/federation/resolve", resolveRemoteActor);
  router.post("/api/v1/federation/resolve", resolveRemoteActor);

  // ── Shared Inbox / Actor Inbox endpoint ───────────────────────────

  router.post(
    "/actor/inbox",
    inboxLimiter,
    json({ type: ["application/activity+json", "application/json", "application/ld+json"] }),
    verifier,
    async (_req: Request, res: Response) => {
      res.status(202).send();
    },
  );

  // ── User Inbox endpoint (Full Activity Coverage & Threading) ──────

  router.post(
    "/users/:username/inbox",
    inboxLimiter,
    json({ type: ["application/activity+json", "application/json", "application/ld+json"] }),
    verifier,
    async (req: Request, res: Response) => {
      const username = req.params.username;
      const activity = req.body;
      const remoteActorUrl = (req as Request & { actorId?: string }).actorId;
      const remoteActorProfile = (req as Request & { actorProfile?: Record<string, unknown> }).actorProfile;

      const localUser = db.getUserByUsername(username as string);
      if (!localUser) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const fullLocalUser = db.getUserFederationInfo(localUser.id);

      if (!fullLocalUser || !fullLocalUser.actor_url) {
        res.status(400).json({ error: "User not federated" });
        return;
      }

      // Upsert the remote user in our database
      const remoteUser = db.getOrCreateRemoteUser(remoteActorUrl as string, remoteActorProfile);

      try {
        if (activity.type === "Follow") {
          // Record the follow
          db.followUser(remoteUser.id, fullLocalUser.id as number, "accepted");

          // Send an Accept activity back
          const acceptActivity = {
            "@context": "https://www.w3.org/ns/activitystreams",
            id: `${fullLocalUser.actor_url}#accept-${Date.now()}`,
            type: "Accept",
            actor: fullLocalUser.actor_url,
            object: activity,
          };

          const targetInbox =
            (remoteActorProfile?.endpoints as any)?.sharedInbox ||
            (remoteActorProfile?.sharedInbox as string) ||
            (remoteActorProfile?.inbox as string) ||
            `${remoteActorUrl}/inbox`;

          const instanceKeys = db.getInstanceKeys();
          const transportKey = instanceKeys.privateKey;
          const transportKeyId = `${publicUrl}/actor#main-key`;

          // Asynchronously send the Accept back (don't block the response)
          sendSignedRequest(targetInbox, acceptActivity, transportKeyId, transportKey, db).catch((err) =>
            console.error("Failed to send Accept activity:", err),
          );
        } else if (activity.type === "Accept") {
          if (activity.object && (activity.object.type === "Follow" || typeof activity.object === "string")) {
            db.updateFollowState(fullLocalUser.id as number, remoteUser.id, "accepted");
          }
        } else if (activity.type === "Reject") {
          if (activity.object && (activity.object.type === "Follow" || typeof activity.object === "string")) {
            db.updateFollowState(fullLocalUser.id as number, remoteUser.id, "rejected");
          }
        } else if (activity.type === "Undo") {
          if (activity.object && activity.object.type === "Follow") {
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
        } else if (activity.type === "Delete") {
          const targetApId = typeof activity.object === "string" ? activity.object : activity.object?.id;
          if (targetApId) {
            db.deletePostByApId(targetApId);
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
        } else if (activity.type === "Update" && activity.object && activity.object.type === "Note") {
          const note = activity.object;
          if (note.id && note.content) {
            db.updatePostContentByApId(note.id, note.content);
          }
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
            if (mode === "curated-hub" || isHubDomain) {
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
        } else if (activity.type === "Create" && activity.object && activity.object.type === "Note") {
          const note = activity.object;

          // Check if post already exists
          const existing = db.getPostByApId(note.id);
          if (!existing) {
            const content = note.content || "";
            const isSilenced = (req as any).isDomainSilenced ? 1 : 0;

            // Ingest engineering media attachments into artifact_views
            let artifactViewId: number | undefined;
            const rawAttachments = Array.isArray(note.attachment)
              ? note.attachment
              : note.attachment
                ? [note.attachment]
                : [];

            for (const att of rawAttachments) {
              if (att && typeof att === "object") {
                const mediaType = (att.mediaType || att.mimeType || "").toLowerCase();
                const attUrl = typeof att.url === "string" ? att.url : att.url?.href || "";
                const lowerUrl = attUrl.toLowerCase();

                let viewType: string | null = att.viewType || null;
                let sourceType: string = att.sourceType || "federated";

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
                    const config = typeof att.viewConfig === "object" ? { ...att.viewConfig } : {};
                    config.url = safeUrl.href;
                    if (att.icon?.url) {
                      config.thumbnailUrl = att.icon.url;
                    }

                    artifactViewId = db.createArtifactView(
                      remoteUser.id,
                      viewType,
                      sourceType,
                      JSON.stringify(config),
                      att.name || "Federated Engineering Artifact",
                      att.icon?.url || null,
                      safeUrl.href,
                    );
                    break;
                  } catch {
                    // Discard unsafe attachment URLs
                  }
                }
              }
            }

            // Threading: resolve inReplyTo if pointing to a local or previously federated post
            let replyToId: number | undefined;
            if (note.inReplyTo) {
              const parentPost = db.getPostByApId(note.inReplyTo);
              if (parentPost) {
                replyToId = parentPost.id;
              }
            }

            const newPost = db.createPost(
              remoteUser.id,
              content,
              artifactViewId,
              replyToId,
              undefined,
              undefined,
              note.id,
              note.url || note.id,
              undefined,
              undefined,
              undefined,
              undefined,
              isSilenced,
            );

            if (replyToId) {
              const parent = db.getPost(replyToId);
              if (parent && parent.author_id) {
                db.createNotification(parent.author_id, remoteUser.id, "reply", newPost.id);
              }
            }
          }
        }

        // Always return 202 Accepted for ActivityPub inboxes unless malformed
        res.status(202).send();
      } catch (err) {
        console.error("Error processing Inbox activity:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  router.get("/federation/packages", (req: Request, res: Response) => {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const packages = db.getRemotePackages(limit, offset);
    res.json({
      total: packages.length,
      packages,
    });
  });

  return router;
}

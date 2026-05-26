import type { Request, Response } from "express";
import { Router, json } from "express";
import { LibraryDatabase } from "../database.js";
import { verifyActivityPubSignature } from "../middleware/activitypub.js";
import { sendSignedRequest } from "../util/activitypub-crypto.js";

export function federationRouter(db: LibraryDatabase): Router {
  const router = Router();

  // WebFinger endpoint for ActivityPub discovery
  router.get("/.well-known/webfinger", (req: Request, res: Response) => {
    const resource = req.query.resource as string;

    if (!resource || !resource.startsWith("acct:")) {
      res.status(400).json({ error: "Invalid or missing resource parameter. Must be acct:username@domain" });
      return;
    }

    const acct = resource.replace("acct:", "");
    const [username] = acct.split("@");

    // In a real app, you might verify the domain matches your instance domain
    const user = db.getUserByUsername(username as string);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Retrieve the full user with federation fields
    const fullUser = db.db.prepare(`SELECT actor_url, rsa_public_key FROM users WHERE id = ?`).get(user.id) as
      | Record<string, unknown>
      | undefined;

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

  // Instance Actor Profile endpoint
  router.get("/actor", (req: Request, res: Response) => {
    const acceptsActivity = req.accepts("application/activity+json", "application/ld+json");
    if (!acceptsActivity) {
      res.status(404).json({ error: "Not found or invalid content type" });
      return;
    }

    const instanceKeys = db.getInstanceKeys();
    const publicUrl = process.env.PUBLIC_URL || "https://hub.modelscript.org";
    const actorUrl = `${publicUrl}/actor`;

    res.type("application/activity+json").json({
      "@context": ["https://www.w3.org/ns/activitystreams", "https://w3id.org/security/v1"],
      id: actorUrl,
      type: "Application",
      preferredUsername: "hub",
      name: "ModelScript Hub",
      summary: "Instance actor for transport-layer signatures",
      inbox: `${actorUrl}/inbox`,
      outbox: `${actorUrl}/outbox`,
      publicKey: {
        id: `${actorUrl}#main-key`,
        owner: actorUrl,
        publicKeyPem: instanceKeys.publicKey,
      },
    });
  });

  // Actor Profile endpoint
  router.get("/users/:username", (req: Request, res: Response) => {
    // Only return ActivityPub JSON if requested, otherwise you could fall through to a frontend or return 404
    const acceptsActivity = req.accepts("application/activity+json", "application/ld+json");
    if (!acceptsActivity) {
      // If they want HTML, redirect or return a simple message since we don't have SSR HTML here
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
        `SELECT id, display_name, bio, avatar_url, rsa_public_key, actor_url, inbox_url, outbox_url FROM users WHERE id = ?`,
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

    res.type("application/activity+json").json({
      "@context": ["https://www.w3.org/ns/activitystreams", "https://w3id.org/security/v1"],
      id: fullUser.actor_url,
      type: "Person",
      preferredUsername: username,
      name: fullUser.display_name || username,
      summary: fullUser.bio || "ModelScript developer",
      inbox: fullUser.inbox_url,
      outbox: fullUser.outbox_url,
      icon: {
        type: "Image",
        mediaType: "image/jpeg",
        url: fullUser.avatar_url,
      },
      publicKey: publicKeys.length === 1 ? publicKeys[0] : publicKeys,
    });
  });

  // Inbox endpoint
  router.post(
    "/users/:username/inbox",
    json({ type: ["application/activity+json", "application/json", "application/ld+json"] }),
    verifyActivityPubSignature,
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

      const fullLocalUser = db.db.prepare(`SELECT id, actor_url FROM users WHERE id = ?`).get(localUser.id) as
        | Record<string, unknown>
        | undefined;

      if (!fullLocalUser || !fullLocalUser.actor_url) {
        res.status(400).json({ error: "User not federated" });
        return;
      }

      // Upsert the remote user in our database
      const remoteUser = db.getOrCreateRemoteUser(remoteActorUrl as string, remoteActorProfile);

      try {
        if (activity.type === "Follow") {
          // Record the follow
          db.followUser(remoteUser.id, fullLocalUser.id as number);

          // Send an Accept activity back
          const acceptActivity = {
            "@context": "https://www.w3.org/ns/activitystreams",
            id: `${fullLocalUser.actor_url}#accept-${Date.now()}`,
            type: "Accept",
            actor: fullLocalUser.actor_url,
            object: activity,
          };

          const targetInbox = (remoteActorProfile?.inbox as string) || `${remoteActorUrl}/inbox`;
          // Use instance key for HTTP transport signature
          const instanceKeys = db.getInstanceKeys();
          const transportKey = instanceKeys.privateKey;
          const transportKeyId = `${process.env.PUBLIC_URL || "https://hub.modelscript.org"}/actor#main-key`;

          // Asynchronously send the Accept back (don't block the response)
          sendSignedRequest(targetInbox, acceptActivity, transportKeyId, transportKey).catch((err) =>
            console.error("Failed to send Accept activity:", err),
          );
        } else if (activity.type === "Undo") {
          if (activity.object && activity.object.type === "Follow") {
            db.unfollowUser(remoteUser.id, fullLocalUser.id as number);
          }
        } else if (activity.type === "Create" && activity.object && activity.object.type === "Note") {
          const note = activity.object;

          // Check if post already exists
          const existing = db.db.prepare(`SELECT id FROM posts WHERE ap_id = ?`).get(note.id);
          if (!existing) {
            // Strip simple HTML tags for text content, or store as is
            const content = note.content || "";
            db.createPost(
              remoteUser.id,
              content,
              undefined,
              undefined,
              undefined,
              undefined,
              note.id,
              note.url || note.id,
            );
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

  return router;
}

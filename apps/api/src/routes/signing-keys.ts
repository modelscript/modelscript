// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router, type Request, type Response } from "express";
import type { LibraryDatabase } from "../database.js";
import { requireAuth } from "../middleware/auth-middleware.js";
import {
  appendKeyLogEntry,
  createDelegationStatement,
  createRegistrationChallenge,
  verifyDelegationSignature,
  verifyKeyLogChain,
  verifyProofOfPossession,
} from "../services/git-sync/key-registry.js";
import { parseSshPublicKey } from "../services/git-sync/sshsig.js";

export function createSigningKeysRouter(database: LibraryDatabase): Router {
  const router = Router();

  /**
   * GET /api/v1/users/:username/signing-keys
   * Public inspection endpoint for verified account keys & badge info.
   */
  router.get("/:username/signing-keys", (req: Request, res: Response): void => {
    const username = String(req.params["username"] || "");
    if (!username) {
      res.status(400).json({ error: "Username required" });
      return;
    }

    const user = database.getUserByUsername(username);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const keys = database.getSigningKeysForUser(user.id, false);
    const isVerified = Boolean(user.signing_verified && keys.length > 0);

    res.json({
      username: user.username,
      signing_verified: isVerified,
      signing_policy_strict: Boolean(user.signing_policy_strict),
      keys: keys.map((k) => ({
        id: k.id,
        fingerprint_sha256: k.fingerprint_sha256,
        public_key_openssh: k.public_key_openssh,
        public_key_multibase: k.public_key_multibase,
        algo: k.algo,
        label: k.label,
        trust_level: k.trust_level,
        created_at: k.created_at,
        activated_at: k.activated_at,
        prev_key_id: k.prev_key_id,
        rotation_proof: k.rotation_proof,
      })),
    });
  });

  /**
   * GET /api/v1/users/:username/signing-keys/log
   * Public transparency log for key lifecycle events.
   */
  router.get("/:username/signing-keys/log", (req: Request, res: Response): void => {
    const username = String(req.params["username"] || "");
    if (!username) {
      res.status(400).json({ error: "Username required" });
      return;
    }

    const user = database.getUserByUsername(username);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const log = database.getKeyLogForUser(user.id);
    const chainValid = verifyKeyLogChain(log);

    res.json({
      username: user.username,
      chain_valid: chainValid,
      log,
    });
  });

  /**
   * GET /api/v1/users/me/signing-challenge
   * Generates a nonce-based challenge for Proof of Possession (PoP).
   */
  router.get("/me/signing-challenge", requireAuth, (req: Request, res: Response): void => {
    const user = req.user!;
    const challenge = createRegistrationChallenge(user.id);
    res.json({
      challenge,
      challengeText: challenge,
      challengeId: challenge,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
  });

  /**
   * POST /api/v1/users/me/signing-keys
   * Registers a new signing key for the authenticated user with Proof of Possession.
   */
  router.post("/me/signing-keys", requireAuth, (req: Request, res: Response): void => {
    const user = req.user!;
    const { label, trustLevel } = req.body || {};
    const publicKeyOpenssh = (req.body?.publicKeyOpenssh || req.body?.publicKeyOpenSsh) as string | undefined;
    const challenge = (req.body?.challenge || req.body?.challengeText || req.body?.challengeId) as string | undefined;
    const signature = (req.body?.signature || req.body?.proofOfPossession) as string | undefined;

    if (!publicKeyOpenssh || typeof publicKeyOpenssh !== "string") {
      res.status(400).json({ error: "Missing publicKeyOpenssh in body" });
      return;
    }

    let parsedKey;
    try {
      parsedKey = parseSshPublicKey(publicKeyOpenssh);
    } catch (err) {
      res.status(400).json({ error: `Invalid public key: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }

    // Check if key is banned
    if (database.isSigningKeyBanned(parsedKey.fingerprintSha256)) {
      res.status(403).json({ error: "This signing key has been banned from the instance." });
      return;
    }

    // Verify Proof of Possession if signature provided
    let validPoP = false;
    if (challenge && signature) {
      const parts = String(challenge).split(":");
      if (parts[0] !== "register" || parts[1] !== String(user.id)) {
        res.status(400).json({ error: "Challenge does not match authenticated user ID" });
        return;
      }
      validPoP = verifyProofOfPossession(challenge, signature, parsedKey.rawPubkey);
      if (!validPoP) {
        res.status(400).json({ error: "Proof of possession signature failed verification" });
        return;
      }
    }

    // Check if key already registered (with anti-squatting reclamation)
    const existing = database.getSigningKeyByFingerprint(parsedKey.fingerprintSha256);
    if (existing) {
      if (existing.user_id === user.id) {
        res.status(409).json({ error: "You have already registered this signing key." });
        return;
      }
      // If previous claimant was unverified (no PoP) and current claimant provides valid PoP:
      if (existing.trust_level === "unverified_paste" && validPoP) {
        const effectiveTrustLevel = typeof trustLevel === "string" ? trustLevel : "hardware_or_cli";
        database.db
          .prepare(
            `UPDATE account_signing_keys
             SET user_id = ?, label = ?, trust_level = ?, prev_key_id = ?, rotation_proof = ?, revoked_at = NULL, revoked_reason = NULL
             WHERE id = ?`,
          )
          .run(
            user.id,
            typeof label === "string" ? label.slice(0, 100) : null,
            effectiveTrustLevel,
            null,
            null,
            existing.id,
          );

        database.db.prepare(`UPDATE users SET signing_verified = 1 WHERE id = ?`).run(user.id);

        appendKeyLogEntry(database, existing.user_id, "revoke", {
          keyId: existing.id,
          fingerprint: existing.fingerprint_sha256,
          reason: "unverified_squat_claimed_by_verified_owner",
        });

        appendKeyLogEntry(database, user.id, "register", {
          keyId: existing.id,
          fingerprint: existing.fingerprint_sha256,
          multibase: existing.public_key_multibase,
          label: typeof label === "string" ? label.slice(0, 100) : null,
          trustLevel: effectiveTrustLevel,
          reclaimedFromUserId: existing.user_id,
        });

        const updated = database.getSigningKeyById(existing.id)!;
        res.status(201).json(updated);
        return;
      } else {
        res.status(409).json({ error: "This signing key is already claimed by another account." });
        return;
      }
    }

    const { delegation } = req.body || {};
    let prevKeyId: number | null = null;
    let rotationProof: string | null = null;
    let validDelegation = false;

    if (delegation && typeof delegation === "object") {
      const masterKey = database.getSigningKeyById(Number(delegation.masterKeyId));
      if (!masterKey || masterKey.user_id !== user.id || masterKey.revoked_at) {
        res.status(400).json({ error: "Master key not found or revoked" });
        return;
      }
      validDelegation = verifyDelegationSignature(
        user.id,
        masterKey.public_key_openssh,
        masterKey.fingerprint_sha256,
        parsedKey.fingerprintSha256,
        String(delegation.signature || ""),
      );
      if (!validDelegation) {
        res.status(400).json({ error: "Delegation signature verification failed" });
        return;
      }
      prevKeyId = masterKey.id;
      rotationProof = String(delegation.signature);
    }

    let effectiveTrustLevel: string;
    if (validDelegation) {
      effectiveTrustLevel = "delegated_by_master";
    } else if (validPoP) {
      effectiveTrustLevel = typeof trustLevel === "string" ? trustLevel : "hardware_or_cli";
    } else {
      effectiveTrustLevel = "unverified_paste";
    }

    const registered = database.registerSigningKey({
      userId: user.id,
      publicKeyMultibase: parsedKey.multibase,
      publicKeyOpenssh: parsedKey.openssh,
      fingerprintSha256: parsedKey.fingerprintSha256,
      algo: parsedKey.algo,
      label: typeof label === "string" ? label.slice(0, 100) : null,
      trustLevel: effectiveTrustLevel,
      prevKeyId,
      rotationProof,
    });

    // Append to transparency log
    appendKeyLogEntry(database, user.id, "register", {
      keyId: registered.id,
      fingerprint: registered.fingerprint_sha256,
      multibase: registered.public_key_multibase,
      label: registered.label,
      trustLevel: effectiveTrustLevel,
      prevKeyId,
    });

    if (prevKeyId) {
      appendKeyLogEntry(database, user.id, "delegate_device", {
        keyId: registered.id,
        masterKeyId: prevKeyId,
        fingerprint: registered.fingerprint_sha256,
        delegationProof: rotationProof,
      });
    }

    database.logAudit({
      actorId: user.id,
      action: "signing_key_registered",
      resourceType: "signing_key",
      resourceId: String(registered.id),
      details: { fingerprint: registered.fingerprint_sha256, label: registered.label },
    });

    res.status(201).json(registered);
  });

  /**
   * GET /api/v1/users/me/signing-keys/:id/delegation-statement
   * Generates the deterministic delegation statement for signing offline.
   */
  router.get("/me/signing-keys/:id/delegation-statement", requireAuth, (req: Request, res: Response): void => {
    const user = req.user!;
    const keyId = Number.parseInt(String(req.params["id"] || ""), 10);
    const masterKeyId = Number.parseInt(String(req.query["masterKeyId"] || ""), 10);
    if (!Number.isFinite(keyId) || !Number.isFinite(masterKeyId)) {
      res.status(400).json({ error: "Device key ID and masterKeyId query param required" });
      return;
    }

    const deviceKey = database.getSigningKeyById(keyId);
    const masterKey = database.getSigningKeyById(masterKeyId);
    if (!deviceKey || deviceKey.user_id !== user.id || !masterKey || masterKey.user_id !== user.id) {
      res.status(404).json({ error: "Signing key not found" });
      return;
    }

    const statement = createDelegationStatement(user.id, masterKey.fingerprint_sha256, deviceKey.fingerprint_sha256);
    res.json({ statement });
  });

  /**
   * POST /api/v1/users/me/signing-keys/:id/delegate
   * Attests and links an existing device key to an authorized master key.
   */
  router.post("/me/signing-keys/:id/delegate", requireAuth, (req: Request, res: Response): void => {
    const user = req.user!;
    const keyId = Number.parseInt(String(req.params["id"] || ""), 10);
    if (!Number.isFinite(keyId)) {
      res.status(400).json({ error: "Invalid key ID" });
      return;
    }

    const deviceKey = database.getSigningKeyById(keyId);
    if (!deviceKey || deviceKey.user_id !== user.id || deviceKey.revoked_at) {
      res.status(404).json({ error: "Device signing key not found or revoked" });
      return;
    }

    const { masterKeyId, signature } = req.body || {};
    if (!masterKeyId || !signature) {
      res.status(400).json({ error: "Missing masterKeyId or signature" });
      return;
    }

    const masterKey = database.getSigningKeyById(Number(masterKeyId));
    if (!masterKey || masterKey.user_id !== user.id || masterKey.revoked_at) {
      res.status(400).json({ error: "Master signing key not found or revoked" });
      return;
    }

    const valid = verifyDelegationSignature(
      user.id,
      masterKey.public_key_openssh,
      masterKey.fingerprint_sha256,
      deviceKey.fingerprint_sha256,
      String(signature),
    );
    if (!valid) {
      res.status(400).json({ error: "Delegation signature verification failed" });
      return;
    }

    const updated = database.delegateSigningKey(deviceKey.id, user.id, masterKey.id, String(signature));
    if (!updated) {
      res.status(500).json({ error: "Failed to update key delegation status" });
      return;
    }

    appendKeyLogEntry(database, user.id, "delegate_device", {
      keyId: deviceKey.id,
      masterKeyId: masterKey.id,
      masterFingerprint: masterKey.fingerprint_sha256,
      deviceFingerprint: deviceKey.fingerprint_sha256,
    });

    database.logAudit({
      actorId: user.id,
      action: "signing_key_delegated",
      resourceType: "signing_key",
      resourceId: String(deviceKey.id),
      details: {
        masterKeyId: masterKey.id,
        masterFingerprint: masterKey.fingerprint_sha256,
        deviceFingerprint: deviceKey.fingerprint_sha256,
      },
    });

    res.json({ success: true, key: database.getSigningKeyById(deviceKey.id) });
  });

  /**
   * POST /api/v1/users/me/signing-keys/:id/revoke
   * Revokes an active signing key.
   */
  router.post("/me/signing-keys/:id/revoke", requireAuth, (req: Request, res: Response): void => {
    const user = req.user!;
    const keyId = Number.parseInt(String(req.params["id"] || ""), 10);
    if (!Number.isFinite(keyId)) {
      res.status(400).json({ error: "Invalid key ID" });
      return;
    }

    const key = database.getSigningKeyById(keyId);
    if (!key || key.user_id !== user.id) {
      res.status(404).json({ error: "Signing key not found" });
      return;
    }

    const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 200) : "User revoked key";
    const ok = database.revokeSigningKey(keyId, user.id, reason);
    if (!ok) {
      res.status(400).json({ error: "Key is already revoked" });
      return;
    }

    appendKeyLogEntry(database, user.id, "revoke", {
      keyId,
      fingerprint: key.fingerprint_sha256,
      reason,
    });

    database.logAudit({
      actorId: user.id,
      action: "signing_key_revoked",
      resourceType: "signing_key",
      resourceId: String(keyId),
      details: { fingerprint: key.fingerprint_sha256, reason },
    });

    res.json({ success: true, revokedId: keyId });
  });

  /**
   * PUT /api/v1/users/me/signing-policy
   * Updates strict signing policy.
   */
  router.put("/me/signing-policy", requireAuth, (req: Request, res: Response): void => {
    const user = req.user!;
    const strict = Boolean(req.body?.strict);
    database.setSigningPolicyStrict(user.id, strict);

    database.logAudit({
      actorId: user.id,
      action: "signing_policy_updated",
      resourceType: "user",
      resourceId: String(user.id),
      details: { strict },
    });

    res.json({ success: true, signing_policy_strict: strict });
  });

  return router;
}

/**
 * Creates the public post evidence verification router.
 */
export function createPostEvidenceRouter(database: LibraryDatabase): Router {
  const router = Router();

  /**
   * GET /api/v1/posts/:postId/evidence
   * Returns cryptographic evidence (payload, proof, commit) for a post.
   */
  router.get("/:postId/evidence", (req: Request, res: Response): void => {
    const postId = String(req.params["postId"] || "");
    if (!postId) {
      res.status(400).json({ error: "Post ID required" });
      return;
    }

    const evidence = database.getSignedPostEvidence(postId);
    if (!evidence) {
      res.status(404).json({ error: "No cryptographic evidence found for this post" });
      return;
    }

    let payload: Record<string, unknown> = {};
    let proof: Record<string, unknown> = {};
    try {
      payload = JSON.parse(evidence.payload_json);
      proof = JSON.parse(evidence.proof_json);
    } catch {}

    const key = evidence.key_id ? database.getSigningKeyById(evidence.key_id) : null;

    res.json({
      post_id: evidence.post_id,
      rev: evidence.rev,
      received_at: evidence.received_at,
      commit_oid: evidence.commit_oid,
      key: key
        ? {
            fingerprint_sha256: key.fingerprint_sha256,
            public_key_openssh: key.public_key_openssh,
            public_key_multibase: key.public_key_multibase,
            algo: key.algo,
            label: key.label,
          }
        : null,
      payload,
      proof,
    });
  });

  return router;
}

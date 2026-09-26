import type { NextFunction, Request, Response } from "express";
import crypto from "node:crypto";
import { assertSafePublicUrl } from "../util/ssrf.js";

export async function verifyActivityPubSignature(req: Request, res: Response, next: NextFunction) {
  try {
    const signatureHeader = req.headers.signature as string;
    if (!signatureHeader) {
      res.status(401).json({ error: "Missing Signature header" });
      return;
    }

    // Parse Signature header
    const parts: Record<string, string> = {};
    for (const part of signatureHeader.split(",")) {
      const eqIdx = part.indexOf("=");
      if (eqIdx !== -1) {
        const key = part.slice(0, eqIdx).trim();
        let val = part.slice(eqIdx + 1).trim();
        if (val.startsWith('"') && val.endsWith('"')) {
          val = val.slice(1, -1);
        }
        parts[key] = val;
      }
    }

    if (!parts.keyId || !parts.signature || !parts.headers) {
      res.status(401).json({ error: "Invalid Signature header format" });
      return;
    }

    let actorUrl: URL;
    try {
      actorUrl = assertSafePublicUrl(parts.keyId);
    } catch {
      res.status(400).json({ error: "Invalid or forbidden keyId URL" });
      return;
    }

    // Fetch the public key from the keyId URL
    const actorResponse = await fetch(actorUrl.href, {
      headers: { Accept: "application/activity+json" },
    });

    if (!actorResponse.ok) {
      res.status(401).json({ error: "Could not fetch public key from keyId" });
      return;
    }

    interface ActorPayload {
      publicKey?: { publicKeyPem?: string };
      publicKeyPem?: string;
    }
    const actor = (await actorResponse.json()) as ActorPayload;
    const publicKeyPem = actor.publicKey?.publicKeyPem || actor.publicKeyPem;

    if (!publicKeyPem) {
      res.status(401).json({ error: "No public key found for actor" });
      return;
    }

    // Reconstruct the string to sign
    const headersList = parts.headers.split(" ");
    const signedString = headersList
      .map((header) => {
        if (header === "(request-target)") {
          return `(request-target): ${req.method.toLowerCase()} ${req.originalUrl}`;
        }
        return `${header}: ${req.headers[header] || ""}`;
      })
      .join("\n");

    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(signedString);

    const isValid = verifier.verify(publicKeyPem, parts.signature, "base64");

    if (!isValid) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    // Add actor data to request for downstream handlers
    (req as Request & { actorId?: string | undefined }).actorId = (parts.keyId as string).split("#")[0];
    (req as Request & { actorProfile?: Record<string, unknown> }).actorProfile = actor as unknown as Record<
      string,
      unknown
    >;

    next();
  } catch (err) {
    console.error("Signature verification failed:", err);
    res.status(500).json({ error: "Internal server error during signature verification" });
  }
}

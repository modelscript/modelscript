import type { NextFunction, Request, Response } from "express";
import crypto from "node:crypto";

export async function verifyActivityPubSignature(req: Request, res: Response, next: NextFunction) {
  try {
    const signatureHeader = req.headers.signature as string;
    if (!signatureHeader) {
      res.status(401).json({ error: "Missing Signature header" });
      return;
    }

    // Parse Signature header
    const parts = signatureHeader.split(",").reduce(
      (acc, part) => {
        const match = part.match(/([^=]+)="([^"]+)"/);
        if (match) acc[match[1] as string] = match[2] as string;
        return acc;
      },
      {} as Record<string, string>,
    );

    if (!parts.keyId || !parts.signature || !parts.headers) {
      res.status(401).json({ error: "Invalid Signature header format" });
      return;
    }

    // Fetch the public key from the keyId URL
    const actorResponse = await fetch(parts.keyId, {
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

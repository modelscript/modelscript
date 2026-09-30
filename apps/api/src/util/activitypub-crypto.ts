// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import { assertSafePublicUrl, safePublicFetch } from "./ssrf.js";

export async function sendSignedRequest(
  targetInboxUrl: string,
  body: Record<string, unknown>,
  keyId: string,
  privateKeyPem: string,
  database?: { isDomainSuspended: (domain: string) => boolean },
) {
  const url = assertSafePublicUrl(targetInboxUrl);
  if (database && database.isDomainSuspended(url.hostname)) {
    throw new Error(
      `Outbound federation blocked: Target domain '${url.hostname}' is suspended by instance administration.`,
    );
  }
  const bodyString = JSON.stringify(body);
  const digest = `SHA-256=${crypto.createHash("sha256").update(bodyString).digest("base64")}`;
  const date = new Date().toUTCString();

  const headers: Record<string, string> = {
    Host: url.host,
    Date: date,
    Digest: digest,
    "Content-Type": "application/activity+json",
    Accept: "application/activity+json",
  };

  const signedString = [
    `(request-target): post ${url.pathname}`,
    `host: ${headers.Host}`,
    `date: ${headers.Date}`,
    `digest: ${headers.Digest}`,
  ].join("\n");

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signedString);
  const signature = signer.sign(privateKeyPem, "base64");

  const signatureHeader = `keyId="${keyId}",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${signature}"`;
  headers["Signature"] = signatureHeader;

  const response = await safePublicFetch(url.href, {
    method: "POST",
    headers,
    body: bodyString,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to send signed request: ${response.status} ${errText}`);
  }

  return response;
}

export async function sendRfc9421SignedRequest(
  targetInboxUrl: string,
  body: Record<string, unknown>,
  keyId: string,
  privateKeyPem: string,
  algorithm: "ed25519" | "rsa-v1_5-sha256" = "ed25519",
  database?: { isDomainSuspended: (domain: string) => boolean },
) {
  const url = assertSafePublicUrl(targetInboxUrl);
  if (database && database.isDomainSuspended(url.hostname)) {
    throw new Error(
      `Outbound federation blocked: Target domain '${url.hostname}' is suspended by instance administration.`,
    );
  }
  const bodyString = JSON.stringify(body);
  const hashBase64 = crypto.createHash("sha256").update(bodyString).digest("base64");
  const contentDigest = `sha-256=:${hashBase64}:`;
  const date = new Date().toUTCString();

  const headers: Record<string, string> = {
    Host: url.host,
    Date: date,
    "Content-Digest": contentDigest,
    "Content-Type": "application/activity+json",
    Accept: "application/activity+json",
  };

  const sigParams = `("@method" "@path" "date" "content-digest");keyid="${keyId}";alg="${algorithm}"`;

  const signatureBase = [
    `"@method": POST`,
    `"@path": ${url.pathname}`,
    `"date": ${date}`,
    `"content-digest": ${contentDigest}`,
    `"@signature-params": ("@method" "@path" "date" "content-digest");keyid="${keyId}";alg="${algorithm}"`,
  ].join("\n");

  let signature: string;
  if (algorithm === "ed25519") {
    const sigBuf = crypto.sign(null, Buffer.from(signatureBase), privateKeyPem);
    signature = sigBuf.toString("base64");
  } else {
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(signatureBase);
    signature = signer.sign(privateKeyPem, "base64");
  }

  headers["Signature-Input"] = `sig1=${sigParams}`;
  headers["Signature"] = `sig1=:${signature}:`;

  const response = await safePublicFetch(url.href, {
    method: "POST",
    headers,
    body: bodyString,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to send RFC 9421 signed request: ${response.status} ${errText}`);
  }

  return response;
}

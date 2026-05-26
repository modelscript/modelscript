import crypto from "node:crypto";

export async function sendSignedRequest(
  targetInboxUrl: string,
  body: Record<string, unknown>,
  keyId: string,
  privateKeyPem: string,
) {
  const url = new URL(targetInboxUrl);
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

  const response = await fetch(targetInboxUrl, {
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

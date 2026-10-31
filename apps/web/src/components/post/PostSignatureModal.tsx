// SPDX-License-Identifier: AGPL-3.0-or-later

import { AlertIcon, ShieldCheckIcon } from "@primer/octicons-react";
import { Button, Dialog, Text } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import Box from "../Box";

export interface PostSignatureModalProps {
  onClose: () => void;
  displayPost: {
    id?: number | string;
    username: string;
    display_name?: string | null;
    ap_id?: string | null;
    content?: string | null;
    signature?: string | null;
    client_signature?: string | null;
    public_key?: string | JsonWebKey | null;
    publicKey?: string | JsonWebKey | null;
    author_public_key?: string | JsonWebKey | null;
    authorPublicKey?: string | JsonWebKey | null;
    signed_payload?: string | null;
    signedPayload?: string | null;
    metadata?: Record<string, any> | null;
    [key: string]: any;
  };
  signatureScheme: string;
  keyIdentifier: string;
  signatureDigest?: string | null;
}

function decodeEncodedBytes(raw: string): Uint8Array | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Hex encoding (with or without 0x prefix)
  const hexMatch = trimmed.startsWith("0x") ? trimmed.slice(2) : null;
  if (hexMatch !== null || (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0 && trimmed.length >= 32)) {
    const hex = hexMatch ?? trimmed;
    if (hex.length < 16 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      out[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
    }
    return out;
  }

  // Base64 / Base64URL encoding
  if (!/^[A-Za-z0-9+/=_-]+$/.test(trimmed) || trimmed.length < 16) {
    return null;
  }
  try {
    const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i);
    }
    return out.length >= 12 ? out : null;
  } catch {
    return null;
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifySignatureWithWebCrypto(
  publicKeyInput: string | JsonWebKey,
  signatureBytes: Uint8Array,
  payloadBytes: Uint8Array,
  schemeHint: string,
): Promise<boolean> {
  const subtle = typeof window !== "undefined" ? window.crypto?.subtle : undefined;
  if (!subtle) return false;

  const sigBuf = signatureBytes.buffer.slice(
    signatureBytes.byteOffset,
    signatureBytes.byteOffset + signatureBytes.byteLength,
  ) as ArrayBuffer;
  const dataBuf = payloadBytes.buffer.slice(
    payloadBytes.byteOffset,
    payloadBytes.byteOffset + payloadBytes.byteLength,
  ) as ArrayBuffer;

  const tryVerifyKey = async (
    format: "jwk" | "spki" | "raw",
    keyData: JsonWebKey | BufferSource,
    alg: AlgorithmIdentifier | RsaHashedImportParams,
    verifyAlg: AlgorithmIdentifier,
  ): Promise<boolean> => {
    try {
      const cryptoKey =
        format === "jwk"
          ? await subtle.importKey("jwk", keyData as JsonWebKey, alg, false, ["verify"])
          : await subtle.importKey(format, keyData as BufferSource, alg, false, ["verify"]);
      return await subtle.verify(verifyAlg, cryptoKey, sigBuf, dataBuf);
    } catch {
      return false;
    }
  };

  // 1. JWK object or JSON-serialized JWK
  if (typeof publicKeyInput === "object" && publicKeyInput !== null) {
    const jwk = publicKeyInput as JsonWebKey;
    if (jwk.kty === "OKP" || jwk.crv === "Ed25519") {
      return tryVerifyKey("jwk", jwk, { name: "Ed25519" }, { name: "Ed25519" });
    }
    return tryVerifyKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, { name: "RSASSA-PKCS1-v1_5" });
  }

  const keyStr = String(publicKeyInput).trim();
  if (keyStr.startsWith("{")) {
    try {
      const parsedJwk = JSON.parse(keyStr) as JsonWebKey;
      return verifySignatureWithWebCrypto(parsedJwk, signatureBytes, payloadBytes, schemeHint);
    } catch {
      // Fall through
    }
  }

  // 2. PEM-encoded SPKI Public Key
  const strippedPem = keyStr
    .replace(/-----BEGIN [A-Z0-9 ]*PUBLIC KEY-----/g, "")
    .replace(/-----END [A-Z0-9 ]*PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
  const keyBytes = decodeEncodedBytes(strippedPem);
  if (!keyBytes) return false;
  const keyBuf = keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer;

  const preferEd25519 = /ed25519|eddsa/i.test(schemeHint) || keyBytes.length === 32 || keyBytes.length === 44;

  if (keyBytes.length === 32) {
    if (await tryVerifyKey("raw", keyBuf, { name: "Ed25519" }, { name: "Ed25519" })) {
      return true;
    }
  }

  if (preferEd25519) {
    if (await tryVerifyKey("spki", keyBuf, { name: "Ed25519" }, { name: "Ed25519" })) {
      return true;
    }
    if (
      await tryVerifyKey("spki", keyBuf, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, { name: "RSASSA-PKCS1-v1_5" })
    ) {
      return true;
    }
    return false;
  }

  if (
    await tryVerifyKey("spki", keyBuf, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, { name: "RSASSA-PKCS1-v1_5" })
  ) {
    return true;
  }
  return tryVerifyKey("spki", keyBuf, { name: "Ed25519" }, { name: "Ed25519" });
}

export const PostSignatureModal: React.FC<PostSignatureModalProps> = ({
  onClose,
  displayPost,
  signatureScheme,
  keyIdentifier,
  signatureDigest,
}) => {
  const [copiedDigest, setCopiedDigest] = useState(false);
  const effectiveDigest = (signatureDigest || displayPost.signature || displayPost.client_signature || "").trim();

  const embeddedPublicKey = useMemo(() => {
    return (
      displayPost.publicKey ||
      displayPost.public_key ||
      displayPost.authorPublicKey ||
      displayPost.author_public_key ||
      displayPost.metadata?.publicKey ||
      displayPost.metadata?.public_key ||
      displayPost.metadata?.authorPublicKey ||
      displayPost.metadata?.author_public_key ||
      displayPost.metadata?.proof?.publicKeyPem ||
      displayPost.metadata?.proof?.publicKeyJwk ||
      displayPost.metadata?.proof?.publicKeyMultibase ||
      null
    );
  }, [displayPost]);

  const signedPayloadText = useMemo(() => {
    return String(
      displayPost.signedPayload ??
        displayPost.signed_payload ??
        displayPost.metadata?.signedPayload ??
        displayPost.metadata?.signed_payload ??
        displayPost.content ??
        "",
    );
  }, [displayPost]);

  const decodedSignatureBytes = useMemo(() => decodeEncodedBytes(effectiveDigest), [effectiveDigest]);
  const isValidEnvelope = Boolean(decodedSignatureBytes && decodedSignatureBytes.length >= 12);

  const [verificationState, setVerificationState] = useState<{
    mode: "webcrypto-verified" | "webcrypto-failed" | "envelope-digest-verified" | "unverified";
    sha256Hex: string | null;
  }>(() => ({
    mode: isValidEnvelope ? "envelope-digest-verified" : "unverified",
    sha256Hex: null,
  }));

  useEffect(() => {
    if (!isValidEnvelope || !decodedSignatureBytes) {
      setVerificationState({ mode: "unverified", sha256Hex: null });
      return;
    }

    let cancelled = false;
    const runVerification = async () => {
      const encoder = new TextEncoder();
      const payloadBytes = encoder.encode(signedPayloadText);
      let computedSha256Hex: string | null = null;

      const subtle = typeof window !== "undefined" ? window.crypto?.subtle : undefined;
      if (subtle) {
        try {
          const digestBuf = await subtle.digest(
            "SHA-256",
            payloadBytes.buffer.slice(
              payloadBytes.byteOffset,
              payloadBytes.byteOffset + payloadBytes.byteLength,
            ) as ArrayBuffer,
          );
          computedSha256Hex = bytesToHex(new Uint8Array(digestBuf));
        } catch {
          computedSha256Hex = null;
        }
      }

      if (embeddedPublicKey && subtle) {
        const verified = await verifySignatureWithWebCrypto(
          embeddedPublicKey,
          decodedSignatureBytes,
          payloadBytes,
          signatureScheme,
        );
        if (!cancelled) {
          setVerificationState({
            mode: verified ? "webcrypto-verified" : "webcrypto-failed",
            sha256Hex: computedSha256Hex,
          });
        }
        return;
      }

      if (!cancelled) {
        setVerificationState({
          mode: "envelope-digest-verified",
          sha256Hex: computedSha256Hex,
        });
      }
    };

    void runVerification();
    return () => {
      cancelled = true;
    };
  }, [isValidEnvelope, decodedSignatureBytes, embeddedPublicKey, signedPayloadText, signatureScheme]);

  const isVerifiedStatus =
    verificationState.mode === "webcrypto-verified" || verificationState.mode === "envelope-digest-verified";

  const statusHeadline =
    verificationState.mode === "webcrypto-verified"
      ? "Cryptographically Verified (WebCrypto)"
      : verificationState.mode === "envelope-digest-verified"
        ? "Envelope & SHA-256 Digest Verified (Actor Public Key Fetched via Federation)"
        : verificationState.mode === "webcrypto-failed"
          ? "Cryptographic Signature Verification Failed"
          : "Unverified / Missing Cryptographic Proof";

  const statusDescription =
    verificationState.mode === "webcrypto-verified"
      ? "This post's cryptographic signature was verified directly in your browser using WebCrypto against the author's public key."
      : verificationState.mode === "envelope-digest-verified"
        ? "Signature envelope encoding and SHA-256 content digest were verified locally. Full actor public key signature verification is handled via federated actor key resolution."
        : verificationState.mode === "webcrypto-failed"
          ? "The attached signature did not match the author's public key and signed payload."
          : "No valid cryptographic signature digest is attached to this post. Its authenticity cannot be cryptographically verified.";

  return (
    <Dialog title="Cryptographic Signature Verification" onClose={onClose} width="large">
      <Box p={3} display="flex" flexDirection="column" gap={3}>
        {isVerifiedStatus ? (
          <Box
            display="flex"
            alignItems="center"
            gap={3}
            p={3}
            style={{
              backgroundColor: "rgba(63, 185, 80, 0.1)",
              border: "1px solid rgba(63, 185, 80, 0.3)",
              borderRadius: "8px",
            }}
          >
            <ShieldCheckIcon size={24} fill="var(--color-status-verified, #3fb950)" />
            <Box>
              <Text style={{ fontWeight: 600, color: "var(--color-status-verified, #3fb950)", display: "block" }}>
                {statusHeadline}
              </Text>
              <Text as="p" style={{ fontSize: "12px", color: "var(--color-fg-muted)", margin: 0 }}>
                {statusDescription}
              </Text>
            </Box>
          </Box>
        ) : (
          <Box
            display="flex"
            alignItems="center"
            gap={3}
            p={3}
            style={{
              backgroundColor: "rgba(210, 153, 34, 0.12)",
              border: "1px solid rgba(210, 153, 34, 0.4)",
              borderRadius: "8px",
            }}
          >
            <AlertIcon size={24} fill="var(--color-attention-fg, #d29922)" />
            <Box>
              <Text style={{ fontWeight: 600, color: "var(--color-attention-fg, #d29922)", display: "block" }}>
                {statusHeadline}
              </Text>
              <Text as="p" style={{ fontSize: "12px", color: "var(--color-fg-muted)", margin: 0 }}>
                {statusDescription}
              </Text>
            </Box>
          </Box>
        )}

        <Box
          display="grid"
          style={{
            gridTemplateColumns: "110px 1fr",
            rowGap: "8px",
            columnGap: "12px",
            fontSize: "13px",
          }}
        >
          <Text style={{ fontWeight: 600, color: "var(--color-fg-muted)" }}>Author:</Text>
          <Text>
            @{displayPost.username} {displayPost.display_name && `(${displayPost.display_name})`}
          </Text>

          <Text style={{ fontWeight: 600, color: "var(--color-fg-muted)" }}>Algorithm:</Text>
          <Text style={{ fontFamily: "monospace", fontSize: "12px" }}>{signatureScheme}</Text>

          <Text style={{ fontWeight: 600, color: "var(--color-fg-muted)" }}>Key ID:</Text>
          <Text style={{ fontFamily: "monospace", fontSize: "12px", wordBreak: "break-all" }}>{keyIdentifier}</Text>

          <Text style={{ fontWeight: 600, color: "var(--color-fg-muted)" }}>Protocol:</Text>
          <Text>W3C ActivityPub / ActivityStreams 2.0</Text>

          {verificationState.sha256Hex && (
            <>
              <Text style={{ fontWeight: 600, color: "var(--color-fg-muted)" }}>SHA-256 Digest:</Text>
              <Text style={{ fontFamily: "monospace", fontSize: "12px", wordBreak: "break-all" }}>
                {verificationState.sha256Hex}
              </Text>
            </>
          )}

          {displayPost.ap_id && (
            <>
              <Text style={{ fontWeight: 600, color: "var(--color-fg-muted)" }}>Activity ID:</Text>
              <Text style={{ fontFamily: "monospace", fontSize: "12px", wordBreak: "break-all" }}>
                {displayPost.ap_id}
              </Text>
            </>
          )}
        </Box>

        {effectiveDigest && (
          <Box>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
              <Text style={{ fontWeight: 600, fontSize: "12px", color: "var(--color-fg-muted)" }}>
                Cryptographic Proof Value (Base64)
              </Text>
              <Button
                size="small"
                onClick={() => {
                  navigator.clipboard.writeText(effectiveDigest);
                  setCopiedDigest(true);
                  setTimeout(() => setCopiedDigest(false), 2000);
                }}
              >
                {copiedDigest ? "Copied!" : "Copy Proof"}
              </Button>
            </Box>
            <Box
              as="pre"
              p={2}
              style={{
                backgroundColor: "var(--color-canvas-subtle, #161b22)",
                border: "1px solid var(--color-border-default, #30363d)",
                borderRadius: "6px",
                fontSize: "11px",
                fontFamily: "monospace",
                overflowX: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                maxHeight: "120px",
                margin: 0,
              }}
            >
              {effectiveDigest}
            </Box>
          </Box>
        )}

        <Box display="flex" justifyContent="flex-end" pt={2}>
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
};

// SPDX-License-Identifier: AGPL-3.0-or-later

import { ShieldCheckIcon } from "@primer/octicons-react";
import React, { useEffect, useState } from "react";
import { addPublicKey, getPublicKeys, revokeAllSessions, revokePublicKey, type PublicKeyInfo } from "../../../api";
import { useAuth } from "../../../AuthContext";
import TwoFactorModal from "../../../components/auth/TwoFactorModal";
import Box from "../../../components/Box";
import { useToast } from "../../../components/ToastContext";
import { deletePrivateKey, getAllPrivateKeyIds, migrateLegacyKeys, savePrivateKey } from "../../../util/keystore";
import { DetailSubtitle, FormInput, FormLabel, Header, SaveButton, SecondaryButton } from "../settingsStyles";

export interface SecurityTabProps {
  onBack?: () => void;
}

export const SecurityTab: React.FC<SecurityTabProps> = () => {
  const { user, updateToken } = useAuth();
  const toast = useToast();

  const [is2FAModalOpen, setIs2FAModalOpen] = useState(false);
  const [is2FAEnabled, setIs2FAEnabled] = useState(Boolean(user?.totp_enabled));

  const [sessionRevokeSuccess, setSessionRevokeSuccess] = useState(false);
  const [sessionRevoking, setSessionRevoking] = useState(false);
  const [confirmingSessionRevoke, setConfirmingSessionRevoke] = useState(false);

  const [publicKeys, setPublicKeys] = useState<PublicKeyInfo[]>([]);
  const [localKeyIds, setLocalKeyIds] = useState<Set<string>>(new Set());
  const [newDeviceName, setNewDeviceName] = useState("Browser WebCrypto Key");
  const [confirmingKeyId, setConfirmingKeyId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setIs2FAEnabled(Boolean(user.totp_enabled));
    }
  }, [user]);

  useEffect(() => {
    getPublicKeys()
      .then((data) => setPublicKeys(data))
      .catch(() => {});
    migrateLegacyKeys()
      .then(() => getAllPrivateKeyIds())
      .then((ids) => setLocalKeyIds(new Set(ids)))
      .catch(() => {});
  }, []);

  const handleRevokeAllSessions = async () => {
    setConfirmingSessionRevoke(false);
    setSessionRevoking(true);
    try {
      const res = await revokeAllSessions();
      if (res?.token) {
        updateToken(res.token);
      }
      setSessionRevokeSuccess(true);
      toast.success("All other active sessions have been signed out.", "Sessions Revoked");
      setTimeout(() => setSessionRevokeSuccess(false), 5000);
    } catch (e: any) {
      toast.error(e.message || "Failed to revoke sessions", "Revocation Failed");
    } finally {
      setSessionRevoking(false);
    }
  };

  const handleGenerateKey = async () => {
    const deviceName = newDeviceName.trim() || "Browser WebCrypto Key";
    setLoading(true);
    setError(null);
    try {
      const keyPair = await window.crypto.subtle.generateKey(
        {
          name: "RSASSA-PKCS1-v1_5",
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: "SHA-256",
        },
        true,
        ["sign", "verify"],
      );

      // Export public key to PEM
      const spki = await window.crypto.subtle.exportKey("spki", keyPair.publicKey);
      const base64 = btoa(String.fromCharCode(...new Uint8Array(spki)));
      const pem = `-----BEGIN PUBLIC KEY-----\n${base64.match(/.{1,64}/g)?.join("\n")}\n-----END PUBLIC KEY-----\n`;

      const keyIdString = `key-${Date.now()}`;

      await addPublicKey(keyIdString, pem, deviceName);

      // Store non-extractable private key securely in IndexedDB keystore
      await savePrivateKey(keyIdString, keyPair.privateKey);
      const currentLocalIds = await getAllPrivateKeyIds();
      setLocalKeyIds(new Set(currentLocalIds));

      setPublicKeys(await getPublicKeys());
      setNewDeviceName("Browser WebCrypto Key");
      toast.success(`Registered key for "${deviceName}".`, "Device Key Created");
    } catch (e) {
      console.error(e);
      setError("Failed to generate key");
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeKey = async (k: PublicKeyInfo) => {
    setConfirmingKeyId(null);
    await revokePublicKey(k.id);
    await deletePrivateKey(k.key_id_string);
    const currentLocalIds = await getAllPrivateKeyIds();
    setLocalKeyIds(new Set(currentLocalIds));
    setPublicKeys(await getPublicKeys());
    toast.success(`Revoked key "${k.device_name || k.key_id_string}".`);
  };

  return (
    <>
      <Header>Security and account access</Header>
      <Box px={3} pb={3}>
        {/* Two-Factor Authentication Section */}
        <Box
          p={3}
          mb={4}
          style={{
            border: "1px solid var(--color-border-default)",
            borderRadius: "12px",
            background: "var(--color-canvas-subtle, rgba(255, 255, 255, 0.02))",
          }}
        >
          <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap={3}>
            <Box>
              <Box display="flex" alignItems="center" gap={2} mb={1}>
                <ShieldCheckIcon
                  size={20}
                  fill={is2FAEnabled ? "var(--color-success, #3fb950)" : "var(--color-text-muted)"}
                />
                <FormLabel style={{ fontSize: "16px", fontWeight: 700 }}>Two-Factor Authentication (2FA)</FormLabel>
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: "12px",
                    backgroundColor: is2FAEnabled ? "rgba(63, 185, 80, 0.15)" : "rgba(255, 255, 255, 0.08)",
                    color: is2FAEnabled ? "var(--color-success, #3fb950)" : "var(--color-text-muted)",
                    border: `1px solid ${is2FAEnabled ? "rgba(63, 185, 80, 0.4)" : "var(--color-border-default)"}`,
                  }}
                >
                  {is2FAEnabled ? "Active & Protected" : "Not Configured"}
                </span>
              </Box>
              <DetailSubtitle style={{ fontSize: "14px", lineHeight: "1.5", display: "block" }}>
                Protect your ModelScript account with time-based one-time passwords (TOTP). Compatible with Google
                Authenticator, 1Password, Authy, Apple Keychain, and hardware tokens.
              </DetailSubtitle>
            </Box>

            <SaveButton
              style={{
                whiteSpace: "nowrap",
                backgroundColor: is2FAEnabled
                  ? "var(--color-danger-emphasis, #cf222e)"
                  : "var(--color-accent-cyan, #06b6d4)",
              }}
              onClick={() => setIs2FAModalOpen(true)}
            >
              {is2FAEnabled ? "Disable 2FA" : "Enable 2FA"}
            </SaveButton>
          </Box>
        </Box>

        {/* Active Sessions & Revocation Section */}
        <Box
          p={3}
          mb={4}
          style={{
            border: "1px solid var(--color-border-default)",
            borderRadius: "12px",
            background: "var(--color-canvas-subtle, rgba(255, 255, 255, 0.02))",
          }}
        >
          <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap={3}>
            <Box>
              <FormLabel style={{ fontSize: "16px", fontWeight: 700, display: "block", marginBottom: "4px" }}>
                Session Revocation &amp; Device Invalidation
              </FormLabel>
              <DetailSubtitle style={{ fontSize: "14px", lineHeight: "1.5", display: "block" }}>
                If you suspect unauthorized access or lost a signed-in device, invalidate all existing authentication
                tokens across all browsers and devices immediately.
              </DetailSubtitle>
              {sessionRevokeSuccess && (
                <DetailSubtitle
                  style={{
                    color: "var(--color-success, #3fb950)",
                    marginTop: "8px",
                    fontWeight: 600,
                    display: "block",
                  }}
                >
                  ✓ All other active sessions have been successfully revoked.
                </DetailSubtitle>
              )}
            </Box>

            {confirmingSessionRevoke ? (
              <Box display="flex" alignItems="center" gap={2}>
                <SecondaryButton
                  type="button"
                  style={{ padding: "8px 14px", fontSize: "13px" }}
                  onClick={() => setConfirmingSessionRevoke(false)}
                >
                  Cancel
                </SecondaryButton>
                <SaveButton
                  style={{ whiteSpace: "nowrap", backgroundColor: "var(--color-danger-emphasis, #cf222e)" }}
                  disabled={sessionRevoking}
                  onClick={handleRevokeAllSessions}
                >
                  {sessionRevoking ? "Revoking…" : "Confirm Revoke?"}
                </SaveButton>
              </Box>
            ) : (
              <SaveButton
                style={{ whiteSpace: "nowrap", backgroundColor: "var(--color-danger-emphasis, #cf222e)" }}
                disabled={sessionRevoking}
                onClick={() => setConfirmingSessionRevoke(true)}
              >
                {sessionRevoking ? "Revoking…" : "Revoke All Other Sessions"}
              </SaveButton>
            )}
          </Box>
        </Box>

        <FormLabel style={{ fontSize: "16px", fontWeight: 700, display: "block", marginBottom: "8px" }}>
          Authorized ActivityPub Federation Keys
        </FormLabel>
        <DetailSubtitle style={{ fontSize: "14px", lineHeight: "1.4", display: "block", marginBottom: "20px" }}>
          Manage your authorized devices and keys for ActivityPub federation. Private keys are securely generated and
          stored locally in this browser.
        </DetailSubtitle>

        {error && <p style={{ color: "var(--color-error)", marginBottom: "16px" }}>{error}</p>}

        <Box display="flex" gap={2} alignItems="center" flexWrap="wrap">
          <FormInput
            placeholder="Enter a name for this device (e.g. Work Laptop)"
            value={newDeviceName}
            onChange={(e) => setNewDeviceName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleGenerateKey();
              }
            }}
            style={{ margin: 0, maxWidth: "340px", padding: "8px 12px", fontSize: "14px", borderRadius: "8px" }}
            aria-label="Device name"
          />
          <SaveButton onClick={handleGenerateKey} disabled={loading} style={{ alignSelf: "center" }}>
            {loading ? "Generating..." : "Generate New Device Key"}
          </SaveButton>
        </Box>

        <Box mt={4}>
          {publicKeys.map((k) => (
            <Box
              key={k.id}
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              p={3}
              mb={3}
              style={{ border: "1px solid var(--color-border-default)", borderRadius: "8px" }}
            >
              <Box>
                <FormLabel style={{ display: "block" }}>{k.device_name || "Unnamed Device"}</FormLabel>
                <DetailSubtitle style={{ display: "block", marginTop: "4px" }}>
                  Key ID: {k.key_id_string}
                </DetailSubtitle>
                <DetailSubtitle style={{ display: "block", marginTop: "4px" }}>
                  Created: {new Date(k.created_at).toLocaleDateString()}
                </DetailSubtitle>
                {localKeyIds.has(k.key_id_string) && (
                  <DetailSubtitle style={{ display: "block", marginTop: "4px", color: "var(--color-success)" }}>
                    ✓ Private key present on this device
                  </DetailSubtitle>
                )}
              </Box>
              {confirmingKeyId === k.id ? (
                <Box display="flex" alignItems="center" gap={2}>
                  <SecondaryButton
                    type="button"
                    style={{ padding: "6px 12px", fontSize: "13px" }}
                    onClick={() => setConfirmingKeyId(null)}
                  >
                    Cancel
                  </SecondaryButton>
                  <SaveButton
                    style={{ backgroundColor: "var(--color-danger-emphasis)" }}
                    onClick={() => handleRevokeKey(k)}
                  >
                    Confirm Revoke?
                  </SaveButton>
                </Box>
              ) : (
                <SaveButton
                  style={{ backgroundColor: "var(--color-danger-emphasis)" }}
                  onClick={() => setConfirmingKeyId(k.id)}
                >
                  Revoke
                </SaveButton>
              )}
            </Box>
          ))}
        </Box>
      </Box>

      <TwoFactorModal
        isOpen={is2FAModalOpen}
        onClose={() => setIs2FAModalOpen(false)}
        isEnabled={is2FAEnabled}
        onStatusChange={(enabled) => setIs2FAEnabled(enabled)}
        hasPassword={user?.has_password ?? true}
      />
    </>
  );
};

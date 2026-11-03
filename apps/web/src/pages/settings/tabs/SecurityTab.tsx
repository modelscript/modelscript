// SPDX-License-Identifier: AGPL-3.0-or-later

import { CopyIcon, DownloadIcon, KeyIcon, ShieldCheckIcon } from "@primer/octicons-react";
import React, { useEffect, useState } from "react";
import {
  addPublicKey,
  getPublicKeys,
  regenerateBackupCodes2FA,
  revokeAllSessions,
  revokePublicKey,
  type PublicKeyInfo,
} from "../../../api";
import { useAuth } from "../../../AuthContext";
import TwoFactorModal from "../../../components/auth/TwoFactorModal";
import Box from "../../../components/Box";
import { useToast } from "../../../components/ToastContext";
import { useInstanceBranding } from "../../../InstanceBrandingContext";
import { deletePrivateKey, getAllPrivateKeyIds, migrateLegacyKeys, savePrivateKey } from "../../../util/keystore";
import {
  DangerButton,
  DetailSubtitle,
  FormInput,
  FormLabel,
  Header,
  SaveButton,
  SecondaryButton,
} from "../settingsStyles";

export interface SecurityTabProps {
  onBack?: () => void;
}

export const SecurityTab: React.FC<SecurityTabProps> = () => {
  const { user, updateToken, refreshUser } = useAuth();
  const branding = useInstanceBranding();
  const brandName = branding.instanceName || "Ansatz";
  const toast = useToast();

  const [is2FAModalOpen, setIs2FAModalOpen] = useState(false);
  const [twoFactorModalMode, setTwoFactorModalMode] = useState<"manage" | "regenerate">("manage");
  const [is2FAEnabled, setIs2FAEnabled] = useState(Boolean(user?.totp_enabled));
  const [backupCodesRemaining, setBackupCodesRemaining] = useState<number>(
    typeof (user as any)?.backup_codes_remaining === "number" ? (user as any).backup_codes_remaining : 10,
  );
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [showInlineRegenerate, setShowInlineRegenerate] = useState(false);
  const [regenPassword, setRegenPassword] = useState("");
  const [regenCode, setRegenCode] = useState("");
  const [regeneratingCodes, setRegeneratingCodes] = useState(false);

  const [sessionRevokeSuccess, setSessionRevokeSuccess] = useState(false);
  const [sessionRevoking, setSessionRevoking] = useState(false);
  const [confirmingSessionRevoke, setConfirmingSessionRevoke] = useState(false);

  const [keys, setKeys] = useState<PublicKeyInfo[]>([]);
  const [localKeyIds, setLocalKeyIds] = useState<Set<string>>(new Set());
  const [newDeviceName, setNewDeviceName] = useState("Browser WebCrypto Key");
  const [confirmingKeyId, setConfirmingKeyId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setIs2FAEnabled(Boolean(user.totp_enabled));
      if (typeof (user as any).backup_codes_remaining === "number") {
        setBackupCodesRemaining((user as any).backup_codes_remaining);
      }
    }
  }, [user]);

  useEffect(() => {
    getPublicKeys()
      .then((data) => setKeys(data))
      .catch(() => {});
    migrateLegacyKeys()
      .then(() => getAllPrivateKeyIds())
      .then((ids) => setLocalKeyIds(new Set(ids)))
      .catch(() => {});
  }, []);

  const handleRevokeAllSessions = async () => {
    setConfirmingSessionRevoke(false);
    setSessionRevoking(true);
    setError(null);
    try {
      const res = await revokeAllSessions();
      if (res?.token) {
        updateToken(res.token);
      }
      setSessionRevokeSuccess(true);
      toast.success("All other active sessions have been signed out.", "Sessions Revoked");
      setTimeout(() => setSessionRevokeSuccess(false), 5000);
    } catch (err: any) {
      const errMsg = err.response?.data?.error || err.message || "Failed to revoke sessions";
      setError(errMsg);
      toast.error(errMsg, "Revocation Failed");
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

      setKeys(await getPublicKeys());
      setNewDeviceName("Browser WebCrypto Key");
      toast.success(`Registered key for "${deviceName}".`, "Device Key Created");
    } catch (err: any) {
      console.error(err);
      const errMsg = err.response?.data?.error || err.message || "Failed to generate key";
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeKey = async (k: PublicKeyInfo) => {
    setConfirmingKeyId(null);
    setError(null);
    try {
      await revokePublicKey(k.id);
      await deletePrivateKey(k.key_id_string);
      const currentLocalIds = await getAllPrivateKeyIds();
      setLocalKeyIds(new Set(currentLocalIds));
      setKeys(await getPublicKeys());
      toast.success(`Revoked key "${k.device_name || k.key_id_string}".`);
    } catch (err: any) {
      const errMsg = err.response?.data?.error || err.message || "Failed to revoke public key";
      setError(errMsg);
      toast.error(errMsg, "Revocation Failed");
    }
  };

  const handleRegenerateBackupCodesInline = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegeneratingCodes(true);
    setError(null);
    try {
      const res = await regenerateBackupCodes2FA(regenPassword || undefined, regenCode || undefined);
      const newCodes = res.backupCodes || [];
      setBackupCodes(newCodes);
      setBackupCodesRemaining(newCodes.length || 10);
      setShowInlineRegenerate(false);
      setRegenPassword("");
      setRegenCode("");
      void refreshUser();
      toast.success("Generated 10 new backup recovery codes.");
    } catch (err: any) {
      const errMsg = err.response?.data?.error || err.message || "Failed to regenerate backup codes.";
      setError(errMsg);
      toast.error(errMsg);
    } finally {
      setRegeneratingCodes(false);
    }
  };

  const handleCopyBackupCodes = () => {
    if (backupCodes.length === 0) return;
    navigator.clipboard.writeText(backupCodes.join("\n"));
    toast.success("Backup codes copied to clipboard!");
  };

  const handleDownloadBackupCodes = () => {
    if (backupCodes.length === 0) return;
    const text = `${brandName} Two-Factor Authentication Backup Codes\nGenerated: ${new Date().toISOString()}\n\nEach code can only be used once:\n${backupCodes.join("\n")}\n\nKeep these codes in a safe place.`;
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${brandName.toLowerCase()}-backup-codes-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
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
              <Box display="flex" alignItems="center" gap={2} mb={1} flexWrap="wrap">
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
                {is2FAEnabled && (
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      padding: "2px 8px",
                      borderRadius: "12px",
                      backgroundColor:
                        backupCodesRemaining <= 2 ? "rgba(210, 153, 34, 0.15)" : "rgba(6, 182, 212, 0.12)",
                      color: backupCodesRemaining <= 2 ? "#d29922" : "var(--color-accent-cyan, #06b6d4)",
                      border: `1px solid ${backupCodesRemaining <= 2 ? "rgba(210, 153, 34, 0.4)" : "rgba(6, 182, 212, 0.35)"}`,
                    }}
                  >
                    {backupCodesRemaining} Recovery {backupCodesRemaining === 1 ? "Code" : "Codes"} Left
                  </span>
                )}
              </Box>
              <DetailSubtitle style={{ fontSize: "14px", lineHeight: "1.5", display: "block" }}>
                Protect your {brandName} account with time-based one-time passwords (TOTP). Compatible with Google
                Authenticator, 1Password, Authy, Apple Keychain, and hardware tokens.
              </DetailSubtitle>
            </Box>

            <Box display="flex" gap={2} alignItems="center" flexWrap="wrap">
              {is2FAEnabled && (
                <SecondaryButton
                  type="button"
                  style={{ whiteSpace: "nowrap", padding: "8px 14px", fontSize: "13px" }}
                  onClick={() => {
                    setTwoFactorModalMode("regenerate");
                    setIs2FAModalOpen(true);
                  }}
                >
                  Regenerate Backup Codes
                </SecondaryButton>
              )}
              {is2FAEnabled ? (
                <DangerButton
                  type="button"
                  style={{ whiteSpace: "nowrap", padding: "8px 16px" }}
                  onClick={() => {
                    setTwoFactorModalMode("manage");
                    setIs2FAModalOpen(true);
                  }}
                >
                  Disable 2FA
                </DangerButton>
              ) : (
                <SaveButton
                  type="button"
                  style={{ whiteSpace: "nowrap" }}
                  onClick={() => {
                    setTwoFactorModalMode("manage");
                    setIs2FAModalOpen(true);
                  }}
                >
                  Enable 2FA
                </SaveButton>
              )}
            </Box>
          </Box>

          {showInlineRegenerate && is2FAEnabled && (
            <form
              onSubmit={handleRegenerateBackupCodesInline}
              style={{
                marginTop: "16px",
                paddingTop: "16px",
                borderTop: "1px solid var(--color-border-default)",
              }}
            >
              <FormLabel style={{ marginBottom: "8px" }}>
                Confirm credentials to generate 10 new single-use backup codes:
              </FormLabel>
              <Box display="flex" gap={2} flexWrap="wrap" alignItems="center">
                {user?.has_password !== false && (
                  <FormInput
                    type="password"
                    placeholder="Account password"
                    value={regenPassword}
                    onChange={(e) => setRegenPassword(e.target.value)}
                    style={{ margin: 0, maxWidth: "220px", padding: "8px 12px", fontSize: "13px" }}
                    required
                  />
                )}
                <FormInput
                  type="text"
                  placeholder="6-digit 2FA or backup code"
                  value={regenCode}
                  onChange={(e) => setRegenCode(e.target.value)}
                  style={{ margin: 0, maxWidth: "220px", padding: "8px 12px", fontSize: "13px" }}
                  required
                />
                <SaveButton
                  type="submit"
                  disabled={regeneratingCodes}
                  style={{ padding: "8px 14px", fontSize: "13px" }}
                >
                  {regeneratingCodes ? "Generating…" : "Generate Codes"}
                </SaveButton>
                <SecondaryButton
                  type="button"
                  onClick={() => setShowInlineRegenerate(false)}
                  style={{ padding: "8px 14px", fontSize: "13px" }}
                >
                  Cancel
                </SecondaryButton>
              </Box>
            </form>
          )}

          {backupCodes.length > 0 && (
            <Box
              mt={3}
              p={3}
              style={{
                border: "1px solid var(--color-border-default)",
                borderRadius: "8px",
                background: "var(--color-canvas-default)",
              }}
            >
              <FormLabel style={{ display: "block", marginBottom: "6px" }}>
                Recovery Backup Codes (Single-Use)
              </FormLabel>
              <DetailSubtitle style={{ display: "block", marginBottom: "12px" }}>
                Store these codes in a password manager or safe location. Each code can be used once if you lose your
                authenticator device.
              </DetailSubtitle>
              <Box
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                  gap: "8px",
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: "13px",
                  marginBottom: "12px",
                }}
              >
                {backupCodes.map((code, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: "6px 10px",
                      borderRadius: "4px",
                      border: "1px solid var(--color-border-subtle)",
                      textAlign: "center",
                      fontWeight: 600,
                      color: "var(--color-accent-cyan, #06b6d4)",
                    }}
                  >
                    {code}
                  </div>
                ))}
              </Box>
              <Box display="flex" gap={2} flexWrap="wrap">
                <SecondaryButton
                  type="button"
                  onClick={handleCopyBackupCodes}
                  style={{ padding: "6px 14px", fontSize: "13px" }}
                >
                  <CopyIcon size={14} />
                  Copy Backup Codes
                </SecondaryButton>
                <SecondaryButton
                  type="button"
                  onClick={handleDownloadBackupCodes}
                  style={{ padding: "6px 14px", fontSize: "13px" }}
                >
                  <DownloadIcon size={14} />
                  Download .txt
                </SecondaryButton>
              </Box>
            </Box>
          )}
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
                <DangerButton
                  type="button"
                  style={{ whiteSpace: "nowrap", padding: "8px 16px" }}
                  disabled={sessionRevoking}
                  onClick={handleRevokeAllSessions}
                >
                  {sessionRevoking ? "Revoking…" : "Confirm Revoke?"}
                </DangerButton>
              </Box>
            ) : (
              <DangerButton
                type="button"
                style={{ whiteSpace: "nowrap", padding: "8px 16px" }}
                disabled={sessionRevoking}
                onClick={() => setConfirmingSessionRevoke(true)}
              >
                {sessionRevoking ? "Revoking…" : "Revoke All Other Sessions"}
              </DangerButton>
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
          {keys.length === 0 ? (
            <Box
              p={4}
              style={{
                border: "1px dashed var(--color-border-default)",
                borderRadius: "10px",
                background: "var(--color-canvas-subtle, rgba(255, 255, 255, 0.02))",
                textAlign: "center",
              }}
            >
              <Box display="flex" justifyContent="center" mb={2} style={{ color: "var(--color-text-muted)" }}>
                <KeyIcon size={24} />
              </Box>
              <FormLabel style={{ display: "block", fontSize: "15px", marginBottom: "6px" }}>
                No cryptographic device keys registered yet
              </FormLabel>
              <DetailSubtitle style={{ display: "block", maxWidth: "560px", margin: "0 auto", lineHeight: "1.5" }}>
                Ed25519 and RSA public keys are used to verify ActivityPub HTTP signatures for decentralized federation
                and to sign ModelScript CLI packages. Generate a device key above to store a non-extractable private key
                in this browser&apos;s WebCrypto keystore.
              </DetailSubtitle>
            </Box>
          ) : (
            keys.map((k) => (
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
                    <DangerButton
                      type="button"
                      style={{ padding: "6px 14px", fontSize: "13px" }}
                      onClick={() => handleRevokeKey(k)}
                    >
                      Confirm Revoke?
                    </DangerButton>
                  </Box>
                ) : (
                  <DangerButton
                    type="button"
                    style={{ padding: "6px 14px", fontSize: "13px" }}
                    onClick={() => setConfirmingKeyId(k.id)}
                  >
                    Revoke
                  </DangerButton>
                )}
              </Box>
            ))
          )}
        </Box>
      </Box>

      <TwoFactorModal
        isOpen={is2FAModalOpen}
        onClose={() => setIs2FAModalOpen(false)}
        isEnabled={is2FAEnabled}
        onStatusChange={(enabled) => {
          setIs2FAEnabled(enabled);
          void refreshUser();
        }}
        onBackupCodesRegenerated={(remaining) => {
          setBackupCodesRemaining(remaining);
          void refreshUser();
        }}
        hasPassword={user?.has_password ?? true}
        mode={twoFactorModalMode}
      />
    </>
  );
};

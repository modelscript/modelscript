// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArrowLeftIcon, KeyIcon, ShieldCheckIcon } from "@primer/octicons-react";
import React, { useEffect, useRef, useState } from "react";
import { addPublicKey, getPublicKeys, revokeAllSessions, revokePublicKey, type PublicKeyInfo } from "../../../api";
import { useAuth } from "../../../AuthContext";
import TwoFactorModal from "../../../components/auth/TwoFactorModal";
import Box from "../../../components/Box";
import { CircleIconButton } from "../../../components/SharedStyles";
import { useToast } from "../../../components/ToastContext";
import { useInstanceBranding } from "../../../InstanceBrandingContext";
import { getApiErrorMessage } from "../../../util/error";
import { deletePrivateKey, getAllPrivateKeyIds, migrateLegacyKeys, savePrivateKey } from "../../../util/keystore";
import { SigningKeysSection } from "../components/SigningKeysSection";
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

interface BackupCodesUserFields {
  backup_codes_remaining?: number | undefined;
}

export const SecurityTab: React.FC<SecurityTabProps> = ({ onBack }) => {
  const { user, updateToken, refreshUser } = useAuth();
  const branding = useInstanceBranding();
  const brandName = branding.instanceName || "Ansatz";
  const toast = useToast();

  const [is2FAModalOpen, setIs2FAModalOpen] = useState(false);
  const [twoFactorModalMode, setTwoFactorModalMode] = useState<"manage" | "regenerate">("manage");
  const [is2FAEnabled, setIs2FAEnabled] = useState(Boolean(user?.totp_enabled));
  const initialBackupCodes = (user as (typeof user & BackupCodesUserFields) | null)?.backup_codes_remaining;
  const [backupCodesRemaining, setBackupCodesRemaining] = useState<number | undefined>(
    typeof initialBackupCodes === "number" ? initialBackupCodes : undefined,
  );

  const [sessionRevokeSuccess, setSessionRevokeSuccess] = useState(false);
  const [sessionRevoking, setSessionRevoking] = useState(false);
  const [confirmingSessionRevoke, setConfirmingSessionRevoke] = useState(false);
  const sessionRevokeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [keys, setKeys] = useState<PublicKeyInfo[]>([]);
  const [localKeyIds, setLocalKeyIds] = useState<Set<string>>(new Set());
  const [newDeviceName, setNewDeviceName] = useState("Browser WebCrypto Key");
  const [confirmingKeyId, setConfirmingKeyId] = useState<number | null>(null);
  const [revokingKeyId, setRevokingKeyId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setIs2FAEnabled(Boolean(user.totp_enabled));
      const remaining = (user as typeof user & BackupCodesUserFields).backup_codes_remaining;
      setBackupCodesRemaining(typeof remaining === "number" ? remaining : undefined);
    }
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    getPublicKeys()
      .then((data) => {
        if (!cancelled) {
          setKeys(data);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(getApiErrorMessage(err, "Failed to load authorized device keys."));
        }
      });
    migrateLegacyKeys()
      .then(() => getAllPrivateKeyIds())
      .then((ids) => {
        if (!cancelled) {
          setLocalKeyIds(new Set(ids));
        }
      })
      .catch(() => {
        // IndexedDB keystore may be unavailable in restricted/private contexts
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (sessionRevokeTimerRef.current) {
        clearTimeout(sessionRevokeTimerRef.current);
        sessionRevokeTimerRef.current = null;
      }
    };
  }, []);

  const handleRevokeAllSessions = async () => {
    if (sessionRevoking) return;
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
      if (sessionRevokeTimerRef.current) {
        clearTimeout(sessionRevokeTimerRef.current);
      }
      sessionRevokeTimerRef.current = setTimeout(() => {
        setSessionRevokeSuccess(false);
        sessionRevokeTimerRef.current = null;
      }, 5000);
    } catch (err: unknown) {
      const errMsg = getApiErrorMessage(err, "Failed to revoke sessions");
      setError(errMsg);
      toast.error(errMsg, "Revocation Failed");
    } finally {
      setSessionRevoking(false);
    }
  };

  const handleGenerateKey = async () => {
    if (loading) return;
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
        false,
        ["sign", "verify"],
      );

      // Export public key to PEM
      const spki = await window.crypto.subtle.exportKey("spki", keyPair.publicKey);
      const base64 = btoa(String.fromCharCode(...new Uint8Array(spki)));
      const pem = `-----BEGIN PUBLIC KEY-----\n${base64.match(/.{1,64}/g)?.join("\n")}\n-----END PUBLIC KEY-----\n`;

      const keySuffix =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const keyIdString = `key-${keySuffix}`;

      // Store non-extractable private key securely in IndexedDB keystore before registering on server
      try {
        await savePrivateKey(keyIdString, keyPair.privateKey);
      } catch (storeErr: unknown) {
        const msg =
          storeErr instanceof Error && storeErr.message
            ? `Failed to save private key to browser keystore: ${storeErr.message}`
            : "Failed to save private key to browser keystore. Check browser storage permissions.";
        setError(msg);
        toast.error(msg, "Keystore Error");
        return;
      }

      try {
        await addPublicKey(keyIdString, pem, deviceName);
      } catch (apiErr: unknown) {
        await deletePrivateKey(keyIdString).catch(() => {});
        throw apiErr;
      }

      const currentLocalIds = await getAllPrivateKeyIds();
      setLocalKeyIds(new Set(currentLocalIds));

      setKeys(await getPublicKeys());
      setNewDeviceName("Browser WebCrypto Key");
      toast.success(`Registered key for "${deviceName}".`, "Device Key Created");
    } catch (err: unknown) {
      const errMsg = getApiErrorMessage(err, "Failed to generate key");
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeKey = async (k: PublicKeyInfo) => {
    if (revokingKeyId === k.id) return;
    setRevokingKeyId(k.id);
    setError(null);
    try {
      await revokePublicKey(k.id);
      await deletePrivateKey(k.key_id_string).catch(() => {});
      const currentLocalIds = await getAllPrivateKeyIds();
      setLocalKeyIds(new Set(currentLocalIds));
      setKeys(await getPublicKeys());
      toast.success(`Revoked key "${k.device_name || k.key_id_string}".`);
    } catch (err: unknown) {
      const errMsg = getApiErrorMessage(err, "Failed to revoke public key");
      setError(errMsg);
      toast.error(errMsg, "Revocation Failed");
    } finally {
      setRevokingKeyId(null);
      setConfirmingKeyId(null);
    }
  };

  return (
    <>
      <Header>
        {onBack && (
          <CircleIconButton onClick={onBack} aria-label="Go back" style={{ marginRight: "8px" }}>
            <ArrowLeftIcon size={20} />
          </CircleIconButton>
        )}
        Security and account access
      </Header>
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
                {is2FAEnabled && typeof backupCodesRemaining === "number" && (
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
                  disabled={sessionRevoking}
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

        {error && (
          <p role="alert" style={{ color: "var(--color-error)", marginBottom: "16px" }}>
            {error}
          </p>
        )}

        <Box display="flex" gap={2} alignItems="center" flexWrap="wrap">
          <FormInput
            placeholder="Enter a name for this device (e.g. Work Laptop)"
            value={newDeviceName}
            disabled={loading}
            onChange={(e) => setNewDeviceName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (loading) return;
                void handleGenerateKey();
              }
            }}
            style={{ margin: 0, maxWidth: "340px", padding: "8px 12px", fontSize: "14px", borderRadius: "8px" }}
            aria-label="Device name"
          />
          <SaveButton type="button" onClick={handleGenerateKey} disabled={loading} style={{ alignSelf: "center" }}>
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
              <DetailSubtitle style={{ display: "block", maxWidth: "560px", margin: "0 auto", lineHeight: 1.5 }}>
                Ed25519 and RSA public keys are used to verify ActivityPub HTTP signatures for decentralized federation
                and to sign ModelScript CLI packages. Generate a device key above to store a non-extractable private key
                in this browser&apos;s WebCrypto keystore.
              </DetailSubtitle>
            </Box>
          ) : (
            keys.map((k) => {
              const isRevoking = revokingKeyId === k.id;
              return (
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
                        disabled={isRevoking}
                        style={{ padding: "6px 12px", fontSize: "13px" }}
                        onClick={() => setConfirmingKeyId(null)}
                      >
                        Cancel
                      </SecondaryButton>
                      <DangerButton
                        type="button"
                        disabled={isRevoking}
                        style={{ padding: "6px 14px", fontSize: "13px" }}
                        onClick={() => void handleRevokeKey(k)}
                      >
                        {isRevoking ? "Revoking…" : "Confirm Revoke?"}
                      </DangerButton>
                    </Box>
                  ) : (
                    <DangerButton
                      type="button"
                      disabled={revokingKeyId !== null}
                      style={{ padding: "6px 14px", fontSize: "13px" }}
                      onClick={() => setConfirmingKeyId(k.id)}
                    >
                      Revoke
                    </DangerButton>
                  )}
                </Box>
              );
            })
          )}
        </Box>

        <SigningKeysSection />
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

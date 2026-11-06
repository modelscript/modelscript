// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertIcon,
  CheckIcon,
  CopyIcon,
  KeyIcon,
  LinkIcon,
  PlusIcon,
  ShieldCheckIcon,
  ShieldLockIcon,
  TerminalIcon,
  TrashIcon,
  VerifiedIcon,
  XIcon,
} from "@primer/octicons-react";
import React, { useCallback, useEffect, useState } from "react";
import styled from "styled-components";
import {
  delegateAccountSigningKey,
  getDelegationStatement,
  getSigningKeyChallenge,
  getSigningKeyLog,
  getUserSigningKeys,
  registerAccountSigningKey,
  revokeAccountSigningKey,
  updateSigningPolicy,
  type AccountSigningKeyInfo,
  type SigningKeyLogItem,
  type UserSigningKeysResponse,
} from "../../../api";
import { useAuth } from "../../../AuthContext";
import Box from "../../../components/Box";
import { useToast } from "../../../components/ToastContext";
import {
  getAllDeviceSigningKeys,
  removeDeviceSigningKey,
  saveDeviceSigningKey,
  type StoredDeviceKey,
} from "../../../util/keystore";
import {
  DangerButton,
  DetailSubtitle,
  DetailText,
  DetailTitle,
  FormInput,
  FormLabel,
  PrimaryButton,
  SecondaryButton,
} from "../settingsStyles";

const StatusCard = styled.div<{ $verified: boolean }>`
  border: 1px solid ${(props) => (props.$verified ? "var(--color-success-emphasis, #2da44e)" : "var(--color-border)")};
  border-radius: 8px;
  padding: 16px;
  background-color: ${(props) =>
    props.$verified ? "var(--color-success-subtle, rgba(46, 160, 67, 0.1))" : "var(--color-canvas-subtle)"};
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 20px;
`;

const StatusIcon = styled.div<{ $verified: boolean }>`
  color: ${(props) => (props.$verified ? "var(--color-success-fg, #1a7f37)" : "var(--color-text-muted)")};
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 2px;
`;

const KeyCard = styled.div`
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 14px 16px;
  background-color: var(--color-canvas-default);
  margin-bottom: 12px;
  transition: border-color 0.2s;

  &:hover {
    border-color: var(--color-accent-fg, #0969da);
  }
`;

const KeyHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
`;

const KeyLabel = styled.span`
  font-weight: 600;
  font-size: 14px;
  color: var(--color-text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
`;

const AlgoTag = styled.span`
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 12px;
  font-weight: 500;
  background-color: var(--color-accent-subtle, rgba(9, 105, 218, 0.1));
  color: var(--color-accent-fg, #0969da);
  font-family: var(--font-mono, monospace);
`;

const FingerprintText = styled.code`
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  color: var(--color-text-muted);
  background-color: var(--color-canvas-subtle);
  padding: 3px 6px;
  border-radius: 4px;
  word-break: break-all;
`;

const CopyButton = styled.button`
  background: none;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 3px 8px;
  font-size: 12px;
  color: var(--color-text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 8px;
  transition: all 0.2s;

  &:hover {
    color: var(--color-text-primary);
    border-color: var(--color-text-muted);
  }
`;

const ModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 16px;
`;

const ModalContent = styled.div`
  background-color: var(--color-canvas-default);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 24px;
  max-width: 580px;
  width: 100%;
  box-shadow: var(--shadow-floating, 0 8px 24px rgba(0, 0, 0, 0.2));
  max-height: 90vh;
  overflow-y: auto;
`;

const ModalHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
`;

const ModalTitle = styled.h3`
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text-heading);
  display: flex;
  align-items: center;
  gap: 8px;
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 4px;

  &:hover {
    color: var(--color-text-primary);
  }
`;

const CodeSnippet = styled.pre`
  background-color: var(--color-canvas-subtle);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 12px;
  font-family: var(--font-mono, monospace);
  overflow-x: auto;
  color: var(--color-text-primary);
  position: relative;
  margin: 8px 0;
`;

const ToggleSwitch = styled.label`
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;

  input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  span {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: var(--color-border);
    transition: 0.3s;
    border-radius: 24px;
  }

  span:before {
    position: absolute;
    content: "";
    height: 18px;
    width: 18px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    transition: 0.3s;
    border-radius: 50%;
  }

  input:checked + span {
    background-color: var(--color-success-emphasis, #2da44e);
  }

  input:checked + span:before {
    transform: translateX(20px);
  }
`;

export const SigningKeysSection: React.FC = () => {
  const { user } = useAuth();
  const toast = useToast();

  const [data, setData] = useState<UserSigningKeysResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [_error, setError] = useState<string | null>(null);
  const [localDeviceKeys, setLocalDeviceKeys] = useState<StoredDeviceKey[]>([]);

  // Modal state
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const [registerMode, setRegisterMode] = useState<"paste" | "browser">("paste");
  const [newKeyOpenssh, setNewKeyOpenssh] = useState("");
  const [newKeyLabel, setNewKeyLabel] = useState("");
  const [registering, setRegistering] = useState(false);

  // Revocation state
  const [confirmingRevokeKey, setConfirmingRevokeKey] = useState<AccountSigningKeyInfo | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [revoking, setRevoking] = useState(false);

  // Transparency log state
  const [showLog, setShowLog] = useState(false);
  const [logEntries, setLogEntries] = useState<SigningKeyLogItem[]>([]);
  const [loadingLog, setLoadingLog] = useState(false);

  // Copied indicator
  const [copiedKeyId, setCopiedKeyId] = useState<number | string | null>(null);

  // Delegation state
  const [delegatingDeviceKey, setDelegatingDeviceKey] = useState<AccountSigningKeyInfo | null>(null);
  const [delegationMasterKeyId, setDelegationMasterKeyId] = useState<number | null>(null);
  const [delegationSignature, setDelegationSignature] = useState<string>("");
  const [delegating, setDelegating] = useState<boolean>(false);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getUserSigningKeys();
      setData(res);
      const localKeys = await getAllDeviceSigningKeys();
      setLocalDeviceKeys(localKeys);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || "Failed to load signing keys");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCopy = (text: string, id: number | string) => {
    navigator.clipboard.writeText(text);
    setCopiedKeyId(id);
    setTimeout(() => setCopiedKeyId(null), 2000);
    toast.success("Copied to clipboard!");
  };

  const handleStrictToggle = async () => {
    if (!data) return;
    const newStrict = !data.signing_policy_strict;
    try {
      await updateSigningPolicy(newStrict);
      setData({ ...data, signing_policy_strict: newStrict });
      toast.success(
        newStrict
          ? "Strict signing mode enabled. Unsigned Git commits and posts will be rejected."
          : "Strict signing mode disabled.",
        "Signing Policy Updated",
      );
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || "Failed to update signing policy");
    }
  };

  const handleRegisterPasteKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyOpenssh.trim()) return;

    setRegistering(true);
    try {
      // 1. Get challenge
      const { challenge } = await getSigningKeyChallenge(newKeyOpenssh.trim());

      // 2. Register key
      await registerAccountSigningKey({
        publicKeyOpenssh: newKeyOpenssh.trim(),
        label: newKeyLabel.trim() || undefined,
        trustLevel: "hardware_or_cli",
        challenge,
      });

      toast.success("Signing key registered successfully! Your account is now verified.", "Key Added");
      setIsRegisterModalOpen(false);
      setNewKeyOpenssh("");
      setNewKeyLabel("");
      await fetchKeys();
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || "Failed to register signing key", "Registration Error");
    } finally {
      setRegistering(false);
    }
  };

  const handleGenerateBrowserKey = async () => {
    setRegistering(true);
    try {
      // Generate Ed25519 WebCrypto keypair if supported by browser
      let keyPair: CryptoKeyPair;
      try {
        keyPair = (await window.crypto.subtle.generateKey({ name: "Ed25519" }, true, [
          "sign",
          "verify",
        ])) as CryptoKeyPair;
      } catch {
        throw new Error(
          "Ed25519 WebCrypto is not supported in this browser version. Please register an OpenSSH Ed25519 key instead.",
        );
      }

      // Export raw public key
      const rawPub = await window.crypto.subtle.exportKey("raw", keyPair.publicKey);
      const rawPubBytes = new Uint8Array(rawPub);

      // Build OpenSSH wire representation
      const wireParts: Uint8Array[] = [];
      const prefix = new TextEncoder().encode("ssh-ed25519");
      const len1 = new Uint8Array(4);
      new DataView(len1.buffer).setUint32(0, prefix.length, false);
      wireParts.push(len1, prefix);

      const len2 = new Uint8Array(4);
      new DataView(len2.buffer).setUint32(0, rawPubBytes.length, false);
      wireParts.push(len2, rawPubBytes);

      const totalLength = wireParts.reduce((acc, p) => acc + p.length, 0);
      const wire = new Uint8Array(totalLength);
      let offset = 0;
      for (const p of wireParts) {
        wire.set(p, offset);
        offset += p.length;
      }

      const base64Wire = btoa(String.fromCharCode(...wire));
      const openSsh = `ssh-ed25519 ${base64Wire} web-device@${window.location.hostname}`;

      // Get challenge
      const { challenge } = await getSigningKeyChallenge(openSsh);

      // Sign challenge with private key
      const sig = await window.crypto.subtle.sign(
        { name: "Ed25519" },
        keyPair.privateKey,
        new TextEncoder().encode(challenge),
      );
      const sigBase64 = btoa(String.fromCharCode(...new Uint8Array(sig)));

      const regResult = await registerAccountSigningKey({
        publicKeyOpenssh: openSsh,
        label: newKeyLabel.trim() || "Web Browser Device Key",
        trustLevel: "web_browser",
        challenge,
        signature: sigBase64,
      });

      await saveDeviceSigningKey({
        id: String(regResult.id),
        privateKey: keyPair.privateKey,
        publicKeyOpenssh: openSsh,
        publicKeyMultibase: regResult.publicKeyMultibase,
        fingerprintSha256: regResult.fingerprintSha256,
        label: regResult.label || newKeyLabel.trim() || "Web Browser Device Key",
        createdAt: regResult.createdAt || new Date().toISOString(),
        trustLevel: "web_browser",
        isActive: true,
      });

      toast.success("Web Browser Device Key generated and registered!", "Verified Account Active");
      setIsRegisterModalOpen(false);
      setNewKeyLabel("");
      await fetchKeys();
    } catch (err: any) {
      toast.error(err.message || "Failed to create web device key", "Key Generation Failed");
    } finally {
      setRegistering(false);
    }
  };

  const handleStartDelegation = async (deviceKey: AccountSigningKeyInfo) => {
    const candidateMasters = (data?.keys || []).filter(
      (k) => !k.revoked_at && (k.trust_level === "hardware_or_cli" || k.id !== deviceKey.id),
    );
    const chosenMasterId = candidateMasters.length > 0 ? candidateMasters[0]!.id : null;
    setDelegatingDeviceKey(deviceKey);
    setDelegationMasterKeyId(chosenMasterId);
    setDelegationSignature("");

    if (chosenMasterId) {
      try {
        const { statement } = await getDelegationStatement(deviceKey.id, chosenMasterId);
        setDelegationStatement(statement);
      } catch {
        setDelegationStatement("");
      }
    }
  };

  const handleMasterKeySelectChange = async (masterId: number) => {
    setDelegationMasterKeyId(masterId);
    if (delegatingDeviceKey) {
      try {
        const { statement } = await getDelegationStatement(delegatingDeviceKey.id, masterId);
        setDelegationStatement(statement);
      } catch {
        setDelegationStatement("");
      }
    }
  };

  const handleSubmitDelegation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!delegatingDeviceKey || !delegationMasterKeyId || !delegationSignature.trim()) return;
    setDelegating(true);
    try {
      await delegateAccountSigningKey(delegatingDeviceKey.id, delegationMasterKeyId, delegationSignature.trim());
      toast.success(
        "Device key successfully linked to your Master Key! Provenance chain established.",
        "Delegation Verified",
      );
      setDelegatingDeviceKey(null);
      setDelegationSignature("");
      await fetchKeys();
    } catch (err: any) {
      toast.error(
        err.response?.data?.error || err.message || "Failed to link device key to master key",
        "Delegation Failed",
      );
    } finally {
      setDelegating(false);
    }
  };

  const handleRevoke = async () => {
    if (!confirmingRevokeKey) return;
    setRevoking(true);
    try {
      await revokeAccountSigningKey(confirmingRevokeKey.id, revokeReason.trim() || undefined);
      await removeDeviceSigningKey(confirmingRevokeKey.fingerprint_sha256);
      toast.success("Signing key revoked.");
      setConfirmingRevokeKey(null);
      setRevokeReason("");
      await fetchKeys();
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || "Failed to revoke key");
    } finally {
      setRevoking(false);
    }
  };

  const toggleTransparencyLog = async () => {
    if (showLog) {
      setShowLog(false);
      return;
    }
    if (!user) return;
    setLoadingLog(true);
    setShowLog(true);
    try {
      const entries = await getSigningKeyLog(user.username);
      setLogEntries(entries);
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || "Failed to fetch transparency log");
    } finally {
      setLoadingLog(false);
    }
  };

  const isVerified = Boolean(data?.signing_verified && (data?.keys?.length || 0) > 0);
  const activeKeys = (data?.keys || []).filter((k) => !k.revoked_at);

  return (
    <Box mt={4}>
      <DetailTitle style={{ fontSize: "17px", fontWeight: 700, marginBottom: "4px", display: "block" }}>
        Verified Account & Cryptographic Signing Keys
      </DetailTitle>
      <DetailSubtitle style={{ marginBottom: "16px", display: "block" }}>
        Cryptographic keys held exclusively by you. The server only holds your public key, ensuring that no
        administrator or server vulnerability can forge your Git commits, ActivityPub posts, or profile modifications.
      </DetailSubtitle>

      {/* Verification Status Card */}
      <StatusCard $verified={isVerified}>
        <StatusIcon $verified={isVerified}>
          {isVerified ? <VerifiedIcon size={24} /> : <AlertIcon size={24} />}
        </StatusIcon>
        <DetailText>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                fontWeight: 600,
                fontSize: "15px",
                color: isVerified ? "var(--color-success-fg, #1a7f37)" : "var(--color-text-primary)",
              }}
            >
              {isVerified ? "Verified Account (User Keys Active)" : "Standard Account (Server-Held Keys)"}
            </span>
          </div>
          <DetailSubtitle style={{ marginTop: "4px", lineHeight: "1.4" }}>
            {isVerified
              ? "Your account carries the Verified Account badge. Commits pushed to your handle branch and outbound posts are signed with your personal Ed25519 keys."
              : "Register an OpenSSH Ed25519 key or hardware key (e.g. YubiKey) to activate Verified Account status and prevent unauthorized server-side authoring."}
          </DetailSubtitle>
        </DetailText>
      </StatusCard>

      {/* Strict Mode Setting */}
      <Box mb={4} p={3} style={{ border: "1px solid var(--color-border)", borderRadius: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <span style={{ fontWeight: 600, fontSize: "14px", display: "flex", alignItems: "center", gap: "6px" }}>
              <ShieldLockIcon size={16} /> Strict Signing Policy
            </span>
            <DetailSubtitle style={{ marginTop: "2px", maxWidth: "520px" }}>
              Enforce cryptographic signature validation for all writes. Git pushes and posts lacking a valid signature
              under your registered keys will be strictly rejected.
            </DetailSubtitle>
          </div>
          <ToggleSwitch>
            <input
              type="checkbox"
              checked={Boolean(data?.signing_policy_strict)}
              onChange={handleStrictToggle}
              disabled={!isVerified}
            />
            <span />
          </ToggleSwitch>
        </div>
      </Box>

      {/* Keys Header & Action */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
        <span style={{ fontWeight: 600, fontSize: "14px", color: "var(--color-text-primary)" }}>
          Registered Signing Keys ({activeKeys.length})
        </span>
        <PrimaryButton
          onClick={() => setIsRegisterModalOpen(true)}
          style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13px", padding: "6px 12px" }}
        >
          <PlusIcon size={14} /> Add Signing Key
        </PrimaryButton>
      </div>

      {/* Keys List */}
      {loading ? (
        <DetailSubtitle>Loading keys...</DetailSubtitle>
      ) : activeKeys.length === 0 ? (
        <Box
          p={4}
          style={{
            background: "linear-gradient(135deg, rgba(9, 105, 218, 0.04) 0%, rgba(46, 160, 67, 0.06) 100%)",
            border: "1px solid var(--color-border)",
            borderRadius: "12px",
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "50%",
              background: "var(--color-accent-subtle, rgba(9, 105, 218, 0.1))",
              color: "var(--color-accent-fg, #0969da)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: "12px",
            }}
          >
            <ShieldCheckIcon size={24} />
          </div>
          <div style={{ fontWeight: 700, fontSize: "16px", color: "var(--color-text-primary)", marginBottom: "6px" }}>
            Establish Your Cryptographic Identity
          </div>
          <DetailSubtitle style={{ maxWidth: "480px", margin: "0 auto 20px auto", lineHeight: "1.5" }}>
            Sign your engineering notes, simulation models, and posts with mathematical non-repudiation. Keys are
            created non-extractably in your browser, with optional master GPG or OpenSSH key delegation.
          </DetailSubtitle>
          <div
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "12px", flexWrap: "wrap" }}
          >
            <PrimaryButton
              onClick={handleGenerateBrowserKey}
              disabled={registering}
              style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}
            >
              <ShieldCheckIcon size={14} />
              {registering ? "Generating Key..." : "1-Click Enable Device Signing"}
            </PrimaryButton>
            <SecondaryButton
              onClick={() => {
                setRegisterMode("paste");
                setIsRegisterModalOpen(true);
              }}
              style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}
            >
              <KeyIcon size={14} /> Link GPG / SSH Master Key
            </SecondaryButton>
          </div>
        </Box>
      ) : (
        <>
          {!localDeviceKeys.some((ldk) => activeKeys.some((k) => k.fingerprint_sha256 === ldk.fingerprintSha256)) && (
            <Box
              mb={3}
              p={3}
              style={{
                background: "var(--color-accent-subtle, rgba(9, 105, 218, 0.08))",
                border: "1px solid var(--color-accent-emphasis, rgba(9, 105, 218, 0.3))",
                borderRadius: "8px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <ShieldCheckIcon size={18} style={{ color: "var(--color-accent-fg, #0969da)", flexShrink: 0 }} />
                <div>
                  <span style={{ fontWeight: 600, fontSize: "13px", color: "var(--color-text-primary)" }}>
                    Enable auto-signing on this device
                  </span>
                  <div style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                    Generate a fast in-browser Ed25519 device key to automatically sign posts from this computer.
                  </div>
                </div>
              </div>
              <PrimaryButton
                onClick={handleGenerateBrowserKey}
                disabled={registering}
                style={{ fontSize: "12px", padding: "5px 12px" }}
              >
                {registering ? "Generating..." : "✨ Enable This Browser"}
              </PrimaryButton>
            </Box>
          )}

          {activeKeys.map((key) => (
            <KeyCard key={key.id}>
              <KeyHeader>
                <KeyLabel>
                  <KeyIcon size={16} />
                  {key.label || "Ed25519 Signing Key"}
                  <AlgoTag>{key.algo}</AlgoTag>
                  {key.trust_level === "hardware_or_cli" && (
                    <AlgoTag
                      style={{
                        background: "rgba(9, 105, 218, 0.12)",
                        color: "var(--color-accent-fg, #0969da)",
                        border: "1px solid rgba(9, 105, 218, 0.3)",
                      }}
                    >
                      🔑 Master Key
                    </AlgoTag>
                  )}
                  {key.trust_level === "delegated_by_master" && (
                    <AlgoTag
                      style={{
                        background: "rgba(130, 80, 223, 0.15)",
                        color: "var(--color-done-fg, #8250df)",
                        border: "1px solid rgba(130, 80, 223, 0.4)",
                      }}
                    >
                      ✨ Delegated by Master Key
                    </AlgoTag>
                  )}
                  {key.trust_level === "pinned_tofu" && (
                    <AlgoTag style={{ background: "var(--color-warning-subtle)", color: "var(--color-warning-fg)" }}>
                      TOFU Pinned
                    </AlgoTag>
                  )}
                  {key.trust_level === "web_browser" && !key.prev_key_id && (
                    <AlgoTag style={{ background: "var(--color-neutral-subtle)", color: "var(--color-text-muted)" }}>
                      Browser Device
                    </AlgoTag>
                  )}
                  {localDeviceKeys.some((ldk) => ldk.fingerprintSha256 === key.fingerprint_sha256) && (
                    <AlgoTag
                      style={{
                        background: "rgba(46, 160, 67, 0.15)",
                        color: "var(--color-success-fg, #1a7f37)",
                        border: "1px solid var(--color-success-emphasis, #2da44e)",
                      }}
                    >
                      This Browser (Active)
                    </AlgoTag>
                  )}
                </KeyLabel>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  {key.trust_level === "web_browser" && !key.prev_key_id && (
                    <button
                      onClick={() => handleStartDelegation(key)}
                      style={{
                        background: "none",
                        border: "1px solid var(--color-border)",
                        borderRadius: "6px",
                        padding: "3px 8px",
                        fontSize: "12px",
                        fontWeight: 500,
                        color: "var(--color-accent-fg, #0969da)",
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                      title="Link this browser key to an authoritative master GPG or OpenSSH key"
                    >
                      <LinkIcon size={12} /> Link to Master Key
                    </button>
                  )}
                  <button
                    onClick={() => setConfirmingRevokeKey(key)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--color-danger-fg, #cf222e)",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                      fontSize: "12px",
                    }}
                    title="Revoke this key"
                  >
                    <TrashIcon size={14} /> Revoke
                  </button>
                </div>
              </KeyHeader>
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "8px", marginTop: "6px" }}>
                <FingerprintText title="SHA-256 Fingerprint">{key.fingerprint_sha256}</FingerprintText>
                <CopyButton onClick={() => handleCopy(key.fingerprint_sha256, `fp-${key.id}`)}>
                  {copiedKeyId === `fp-${key.id}` ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
                  {copiedKeyId === `fp-${key.id}` ? "Copied" : "Copy Fingerprint"}
                </CopyButton>
                <CopyButton onClick={() => handleCopy(key.public_key_openssh, `pk-${key.id}`)}>
                  {copiedKeyId === `pk-${key.id}` ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
                  {copiedKeyId === `pk-${key.id}` ? "Copied" : "Copy OpenSSH"}
                </CopyButton>
              </div>
              <DetailSubtitle style={{ marginTop: "8px", fontSize: "11px" }}>
                Added on {new Date(key.created_at).toLocaleDateString()}
              </DetailSubtitle>
            </KeyCard>
          ))}
        </>
      )}

      {/* CLI Quickstart Tip */}
      <Box
        mt={3}
        p={3}
        style={{
          backgroundColor: "var(--color-canvas-subtle)",
          borderRadius: "8px",
          border: "1px solid var(--color-border)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontWeight: 600,
            fontSize: "13px",
            color: "var(--color-text-primary)",
          }}
        >
          <TerminalIcon size={16} /> CLI Quickstart: Manage & Sign via ModelScript CLI
        </div>
        <DetailSubtitle style={{ marginTop: "4px" }}>
          You can also register and sign directly from your terminal using{" "}
          <code style={{ fontFamily: "monospace" }}>msx</code>:
        </DetailSubtitle>
        <CodeSnippet>
          {`# Generate and register a local Ed25519 signing key\nmsx keys generate\nmsx keys register ~/.ssh/id_ed25519.pub --label "Workstation"\n\n# Configure Git commit signing\ngit config user.signingkey ~/.ssh/id_ed25519.pub\ngit config gpg.format ssh\ngit commit -S -m "Verified commit"`}
        </CodeSnippet>
      </Box>

      {/* Transparency Log Accordion */}
      <Box mt={4}>
        <SecondaryButton onClick={toggleTransparencyLog} style={{ fontSize: "13px" }}>
          {showLog ? "Hide Transparency Key Log" : "View Cryptographic Transparency Key Log"}
        </SecondaryButton>

        {showLog && (
          <Box
            mt={3}
            p={3}
            style={{
              border: "1px solid var(--color-border)",
              borderRadius: "8px",
              backgroundColor: "var(--color-canvas-subtle)",
            }}
          >
            <span style={{ fontWeight: 600, fontSize: "13px", display: "block", marginBottom: "8px" }}>
              Key Transparency Hash Chain
            </span>
            {loadingLog ? (
              <DetailSubtitle>Loading audit entries...</DetailSubtitle>
            ) : logEntries.length === 0 ? (
              <DetailSubtitle>No transparency log entries recorded yet.</DetailSubtitle>
            ) : (
              logEntries.map((entry) => (
                <Box
                  key={entry.seq}
                  mb={2}
                  p={2}
                  style={{
                    backgroundColor: "var(--color-canvas-default)",
                    borderRadius: "6px",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "12px" }}
                  >
                    <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>
                      #{entry.seq} {entry.event.toUpperCase()}
                    </span>
                    <span style={{ color: "var(--color-text-muted)" }}>
                      {new Date(entry.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      fontFamily: "var(--font-mono, monospace)",
                      color: "var(--color-text-muted)",
                      marginTop: "4px",
                    }}
                  >
                    Entry Hash: {entry.entry_hash.slice(0, 24)}... (Prev: {entry.prev_hash.slice(0, 16)}...)
                  </div>
                </Box>
              ))
            )}
          </Box>
        )}
      </Box>

      {/* Register Key Modal */}
      {isRegisterModalOpen && (
        <ModalOverlay onClick={() => setIsRegisterModalOpen(false)}>
          <ModalContent onClick={(e) => e.stopPropagation()}>
            <ModalHeader>
              <ModalTitle>
                <KeyIcon size={20} /> Register User Signing Key
              </ModalTitle>
              <CloseButton onClick={() => setIsRegisterModalOpen(false)}>
                <XIcon size={18} />
              </CloseButton>
            </ModalHeader>

            <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
              <SecondaryButton
                onClick={() => setRegisterMode("paste")}
                style={{
                  flex: 1,
                  fontWeight: registerMode === "paste" ? 600 : 400,
                  backgroundColor: registerMode === "paste" ? "var(--color-canvas-subtle)" : "transparent",
                }}
              >
                OpenSSH Key (Recommended)
              </SecondaryButton>
              <SecondaryButton
                onClick={() => setRegisterMode("browser")}
                style={{
                  flex: 1,
                  fontWeight: registerMode === "browser" ? 600 : 400,
                  backgroundColor: registerMode === "browser" ? "var(--color-canvas-subtle)" : "transparent",
                }}
              >
                Web Browser Key
              </SecondaryButton>
            </div>

            {registerMode === "paste" ? (
              <form onSubmit={handleRegisterPasteKey}>
                <FormLabel>Key Label (Optional)</FormLabel>
                <FormInput
                  placeholder="e.g. MacBook Pro, YubiKey 5C"
                  value={newKeyLabel}
                  onChange={(e) => setNewKeyLabel(e.target.value)}
                  style={{ marginBottom: "12px" }}
                />

                <FormLabel>OpenSSH Public Key (Ed25519 or FIDO2)</FormLabel>
                <textarea
                  rows={4}
                  placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... or sk-ssh-ed25519@openssh.com..."
                  value={newKeyOpenssh}
                  onChange={(e) => setNewKeyOpenssh(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px",
                    borderRadius: "6px",
                    border: "1px solid var(--color-border)",
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: "12px",
                    backgroundColor: "var(--color-canvas-default)",
                    color: "var(--color-text-primary)",
                    marginBottom: "16px",
                  }}
                  required
                />

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                  <SecondaryButton type="button" onClick={() => setIsRegisterModalOpen(false)}>
                    Cancel
                  </SecondaryButton>
                  <PrimaryButton type="submit" disabled={registering || !newKeyOpenssh.trim()}>
                    {registering ? "Registering..." : "Register Key"}
                  </PrimaryButton>
                </div>
              </form>
            ) : (
              <div>
                <DetailSubtitle style={{ marginBottom: "16px" }}>
                  Generates a non-extractable Ed25519 keypair inside your browser using the WebCrypto API. This enables
                  automatic post signing in the web client without installing external tools.
                </DetailSubtitle>

                <FormLabel>Key Label</FormLabel>
                <FormInput
                  placeholder="e.g. Web Browser Device Key"
                  value={newKeyLabel}
                  onChange={(e) => setNewKeyLabel(e.target.value)}
                  style={{ marginBottom: "16px" }}
                />

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                  <SecondaryButton type="button" onClick={() => setIsRegisterModalOpen(false)}>
                    Cancel
                  </SecondaryButton>
                  <PrimaryButton type="button" onClick={handleGenerateBrowserKey} disabled={registering}>
                    {registering ? "Generating..." : "Generate & Register"}
                  </PrimaryButton>
                </div>
              </div>
            )}
          </ModalContent>
        </ModalOverlay>
      )}

      {/* Revocation Confirmation Modal */}
      {confirmingRevokeKey && (
        <ModalOverlay onClick={() => setConfirmingRevokeKey(null)}>
          <ModalContent onClick={(e) => e.stopPropagation()}>
            <ModalHeader>
              <ModalTitle style={{ color: "var(--color-danger-fg, #cf222e)" }}>
                <AlertIcon size={20} /> Revoke Signing Key
              </ModalTitle>
              <CloseButton onClick={() => setConfirmingRevokeKey(null)}>
                <XIcon size={18} />
              </CloseButton>
            </ModalHeader>

            <DetailSubtitle style={{ marginBottom: "12px" }}>
              Are you sure you want to revoke{" "}
              <strong>{confirmingRevokeKey.label || confirmingRevokeKey.fingerprint_sha256}</strong>? Once revoked,
              commits and posts signed with this key will no longer be accepted.
            </DetailSubtitle>

            <FormLabel>Revocation Reason (Optional)</FormLabel>
            <FormInput
              placeholder="e.g. Key retired, device replaced"
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              style={{ marginBottom: "16px" }}
            />

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <SecondaryButton onClick={() => setConfirmingRevokeKey(null)}>Cancel</SecondaryButton>
              <DangerButton onClick={handleRevoke} disabled={revoking}>
                {revoking ? "Revoking..." : "Confirm Revocation"}
              </DangerButton>
            </div>
          </ModalContent>
        </ModalOverlay>
      )}
      {/* Master Key Delegation Attestation Modal */}
      {delegatingDeviceKey && (
        <ModalOverlay onClick={() => setDelegatingDeviceKey(null)}>
          <ModalContent onClick={(e) => e.stopPropagation()}>
            <ModalHeader>
              <ModalTitle style={{ color: "var(--color-done-fg, #8250df)" }}>
                <LinkIcon size={20} /> Master Key Delegation
              </ModalTitle>
              <CloseButton onClick={() => setDelegatingDeviceKey(null)}>
                <XIcon size={18} />
              </CloseButton>
            </ModalHeader>

            <DetailSubtitle style={{ marginBottom: "16px" }}>
              Attest and link device key{" "}
              <strong>{delegatingDeviceKey.label || delegatingDeviceKey.fingerprint_sha256}</strong> to your master GPG
              or OpenSSH key. This establishes a cryptographic delegation chain so posts signed by this browser device
              carry the full authority of your master key.
            </DetailSubtitle>

            <form onSubmit={handleSubmitDelegation}>
              <FormLabel>1. Select Authorizing Master Key</FormLabel>
              <select
                value={delegationMasterKeyId || ""}
                onChange={(e) => handleMasterKeySelectChange(Number(e.target.value))}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid var(--color-border)",
                  backgroundColor: "var(--color-canvas-default)",
                  color: "var(--color-text-primary)",
                  fontSize: "13px",
                  marginBottom: "16px",
                }}
                required
              >
                {(data?.keys || [])
                  .filter(
                    (k) => !k.revoked_at && (k.trust_level === "hardware_or_cli" || k.id !== delegatingDeviceKey.id),
                  )
                  .map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.label ? `${k.label} (${k.fingerprint_sha256.slice(0, 16)}...)` : k.fingerprint_sha256}
                    </option>
                  ))}
              </select>

              <FormLabel>2. Run Terminal Attestation Command</FormLabel>
              <DetailSubtitle style={{ marginBottom: "6px", fontSize: "12px" }}>
                Sign the delegation statement using your master key with <code>msx</code> or standard OpenSSH:
              </DetailSubtitle>
              <CodeSnippet style={{ marginBottom: "16px" }}>
                msx keys attest --master ~/.ssh/id_ed25519 --device {delegatingDeviceKey.fingerprint_sha256}
              </CodeSnippet>

              <FormLabel>3. Delegation Signature</FormLabel>
              <textarea
                rows={3}
                placeholder="Paste the generated attestation signature (multibase z... or base64)..."
                value={delegationSignature}
                onChange={(e) => setDelegationSignature(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px",
                  borderRadius: "6px",
                  border: "1px solid var(--color-border)",
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: "12px",
                  backgroundColor: "var(--color-canvas-default)",
                  color: "var(--color-text-primary)",
                  marginBottom: "16px",
                }}
                required
              />

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                <SecondaryButton type="button" onClick={() => setDelegatingDeviceKey(null)}>
                  Cancel
                </SecondaryButton>
                <PrimaryButton
                  type="submit"
                  disabled={delegating || !delegationSignature.trim() || !delegationMasterKeyId}
                >
                  {delegating ? "Verifying..." : "✨ Verify & Establish Delegation"}
                </PrimaryButton>
              </div>
            </form>
          </ModalContent>
        </ModalOverlay>
      )}
    </Box>
  );
};

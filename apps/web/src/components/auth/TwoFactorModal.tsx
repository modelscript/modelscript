// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, CopyIcon, DownloadIcon, ShieldCheckIcon, ShieldLockIcon, XIcon } from "@primer/octicons-react";
import QRCode from "qrcode";
import React, { useEffect, useState } from "react";
import styled from "styled-components";
import { disable2FA, setup2FA, verify2FA } from "../../api";

interface TwoFactorModalProps {
  isOpen: boolean;
  onClose: () => void;
  isEnabled: boolean;
  onStatusChange: (enabled: boolean) => void;
  hasPassword?: boolean;
}

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  padding: 16px;
`;

const ModalCard = styled.div`
  background: var(--surface-overlay, #0e1424);
  border: 1px solid var(--color-border-glass, rgba(255, 255, 255, 0.15));
  border-radius: var(--radius-xl, 16px);
  width: 100%;
  max-width: 520px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const ModalHeader = styled.div`
  padding: 20px 24px;
  border-bottom: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.1));
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const ModalTitle = styled.h2`
  font-size: 18px;
  font-weight: 700;
  color: var(--color-text-heading, #fff);
  margin: 0;
  display: flex;
  align-items: center;
  gap: 10px;
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  color: var(--color-text-muted, #8b949e);
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  &:hover {
    color: var(--color-text-primary, #fff);
    background: rgba(255, 255, 255, 0.1);
  }
`;

const ModalBody = styled.div`
  padding: 24px;
  max-height: 80vh;
  overflow-y: auto;
`;

const QrContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #ffffff;
  padding: 16px;
  border-radius: 12px;
  margin: 16px auto;
  width: fit-content;
`;

const SecretBox = styled.div`
  background: var(--color-canvas-subtle, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.1));
  border-radius: 8px;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
  font-family: monospace;
  font-size: 15px;
  letter-spacing: 0.1em;
  color: var(--color-text-primary, #fff);
`;

const CopyButton = styled.button`
  background: transparent;
  border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.2));
  color: var(--color-text-primary, #fff);
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  &:hover {
    background: rgba(255, 255, 255, 0.1);
  }
`;

const CodeInput = styled.input`
  width: 100%;
  padding: 12px 16px;
  border-radius: 8px;
  border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.2));
  background: var(--color-canvas-default, #0d1117);
  color: #fff;
  font-size: 20px;
  font-family: monospace;
  letter-spacing: 0.25em;
  text-align: center;
  margin-top: 12px;
  outline: none;
  &:focus {
    border-color: var(--color-accent-cyan, #06b6d4);
    box-shadow: 0 0 0 2px rgba(6, 182, 212, 0.3);
  }
`;

const BackupCodeGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  background: var(--color-canvas-subtle, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.1));
  border-radius: 8px;
  padding: 16px;
  margin: 16px 0;
  font-family: monospace;
  font-size: 14px;
  text-align: center;
`;

const BackupCodeItem = styled.div`
  padding: 6px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 4px;
  letter-spacing: 0.1em;
  font-weight: 600;
  color: var(--color-accent-cyan, #06b6d4);
`;

const ActionButton = styled.button<{ $variant?: "primary" | "danger" }>`
  width: 100%;
  padding: 12px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: all 0.15s ease-in-out;
  background: ${(props) =>
    props.$variant === "danger" ? "var(--color-danger-emphasis, #cf222e)" : "var(--color-accent-cyan, #06b6d4)"};
  color: #ffffff;
  &:hover:not(:disabled) {
    opacity: 0.9;
    transform: translateY(-1px);
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const ErrorBanner = styled.div`
  background: rgba(248, 81, 73, 0.12);
  border: 1px solid rgba(248, 81, 73, 0.4);
  color: #f85149;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  margin-bottom: 16px;
  line-height: 1.4;
`;

export default function TwoFactorModal({
  isOpen,
  onClose,
  isEnabled,
  onStatusChange,
  hasPassword = true,
}: TwoFactorModalProps) {
  const [step, setStep] = useState<"setup" | "backup">("setup");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [secret, setSecret] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [hasCopiedSecret, setHasCopiedSecret] = useState(false);
  const [hasCopiedCodes, setHasCopiedCodes] = useState(false);
  const [acknowledgedBackup, setAcknowledgedBackup] = useState(false);

  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");

  useEffect(() => {
    if (!isOpen) {
      setStep("setup");
      setError("");
      setVerificationCode("");
      setDisablePassword("");
      setDisableCode("");
      setAcknowledgedBackup(false);
      return;
    }

    if (!isEnabled) {
      setLoading(true);
      setError("");
      setup2FA()
        .then(async (data) => {
          setSecret(data.secret);
          try {
            const url = await QRCode.toDataURL(data.otpauthUri, {
              width: 200,
              margin: 1,
              color: { dark: "#000000", light: "#ffffff" },
            });
            setQrDataUrl(url);
          } catch (qrErr) {
            console.error("QR Code generation error:", qrErr);
          }
        })
        .catch((err) => {
          setError(err.response?.data?.error || "Failed to initialize 2FA setup");
        })
        .finally(() => setLoading(false));
    }
  }, [isOpen, isEnabled]);

  if (!isOpen) return null;

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verificationCode.trim()) return;
    setError("");
    setLoading(true);
    try {
      const res = await verify2FA(verificationCode.trim());
      setBackupCodes(res.backupCodes || []);
      setStep("backup");
      onStatusChange(true);
    } catch (err: any) {
      setError(err.response?.data?.error || "Invalid verification code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await disable2FA(disablePassword || undefined, disableCode || undefined);
      onStatusChange(false);
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to disable 2FA. Please verify your credentials.");
    } finally {
      setLoading(false);
    }
  };

  const copySecret = () => {
    navigator.clipboard.writeText(secret);
    setHasCopiedSecret(true);
    setTimeout(() => setHasCopiedSecret(false), 2000);
  };

  const copyAllBackupCodes = () => {
    navigator.clipboard.writeText(backupCodes.join("\n"));
    setHasCopiedCodes(true);
    setTimeout(() => setHasCopiedCodes(false), 2000);
  };

  const downloadBackupCodes = () => {
    const text = `ModelScript Two-Factor Authentication Backup Codes\nGenerated: ${new Date().toISOString()}\n\nEach code can only be used once:\n${backupCodes.join("\n")}\n\nKeep these codes in a safe place.`;
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `modelscript-backup-codes-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Overlay onClick={onClose}>
      <ModalCard onClick={(e) => e.stopPropagation()}>
        <ModalHeader>
          <ModalTitle>
            {isEnabled ? (
              <>
                <ShieldLockIcon size={20} />
                Disable Two-Factor Authentication
              </>
            ) : step === "setup" ? (
              <>
                <ShieldCheckIcon size={20} />
                Set Up Two-Factor Authentication
              </>
            ) : (
              <>
                <ShieldCheckIcon size={20} />
                Save Recovery Backup Codes
              </>
            )}
          </ModalTitle>
          <CloseButton onClick={onClose} aria-label="Close modal">
            <XIcon size={18} />
          </CloseButton>
        </ModalHeader>

        <ModalBody>
          {error && <ErrorBanner>{error}</ErrorBanner>}

          {isEnabled ? (
            <form onSubmit={handleDisable}>
              <p style={{ color: "var(--color-text-muted)", fontSize: "14px", lineHeight: "1.5", margin: "0 0 16px" }}>
                Disabling two-factor authentication will remove the extra layer of security on your account. You will
                only need your email and password to log in.
              </p>

              {hasPassword && (
                <div style={{ marginBottom: "16px" }}>
                  <label
                    style={{
                      display: "block",
                      fontSize: "13px",
                      fontWeight: 600,
                      marginBottom: "6px",
                      color: "var(--color-text-primary)",
                    }}
                  >
                    Account Password
                  </label>
                  <input
                    type="password"
                    value={disablePassword}
                    onChange={(e) => setDisablePassword(e.target.value)}
                    placeholder="Enter your current password"
                    required
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      background: "var(--color-canvas-default)",
                      color: "#fff",
                      fontSize: "14px",
                    }}
                  />
                </div>
              )}

              <div style={{ marginBottom: "20px" }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "13px",
                    fontWeight: 600,
                    marginBottom: "6px",
                    color: "var(--color-text-primary)",
                  }}
                >
                  Current 2FA Code or Backup Code
                </label>
                <input
                  type="text"
                  value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value)}
                  placeholder="6-digit code or 8-char recovery code"
                  required
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: "6px",
                    border: "1px solid var(--color-border-default)",
                    background: "var(--color-canvas-default)",
                    color: "#fff",
                    fontSize: "14px",
                    fontFamily: "monospace",
                  }}
                />
              </div>

              <ActionButton type="submit" $variant="danger" disabled={loading}>
                {loading ? "Disabling 2FA…" : "Confirm and Disable 2FA"}
              </ActionButton>
            </form>
          ) : step === "setup" ? (
            <form onSubmit={handleVerify}>
              <p style={{ color: "var(--color-text-muted)", fontSize: "14px", lineHeight: "1.5", margin: "0 0 12px" }}>
                Scan the QR code below using your authenticator app (Google Authenticator, 1Password, Authy, Apple
                Keychain, etc.):
              </p>

              {qrDataUrl && (
                <QrContainer>
                  <img src={qrDataUrl} alt="2FA QR Code" width="180" height="180" style={{ display: "block" }} />
                </QrContainer>
              )}

              <p style={{ color: "var(--color-text-muted)", fontSize: "13px", margin: "12px 0 6px" }}>
                Or manually enter this secret key into your authenticator:
              </p>

              <SecretBox>
                <span>{secret.match(/.{1,4}/g)?.join(" ") || secret}</span>
                <CopyButton type="button" onClick={copySecret}>
                  {hasCopiedSecret ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                  {hasCopiedSecret ? "Copied" : "Copy"}
                </CopyButton>
              </SecretBox>

              <div style={{ marginTop: "20px" }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "13px",
                    fontWeight: 600,
                    marginBottom: "6px",
                    color: "var(--color-text-primary)",
                  }}
                >
                  Enter the 6-digit code generated by your app:
                </label>
                <CodeInput
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="123456"
                  autoFocus
                  required
                />
              </div>

              <div style={{ marginTop: "20px" }}>
                <ActionButton type="submit" disabled={loading || verificationCode.length !== 6}>
                  {loading ? "Verifying…" : "Verify and Activate 2FA"}
                </ActionButton>
              </div>
            </form>
          ) : (
            <div>
              <p style={{ color: "var(--color-text-primary)", fontSize: "14px", fontWeight: 600, margin: "0 0 8px" }}>
                Two-Factor Authentication is now active! 🎉
              </p>
              <p style={{ color: "var(--color-text-muted)", fontSize: "13px", lineHeight: "1.5", margin: "0 0 16px" }}>
                Save these 10 backup recovery codes. Each code can be used once to access your account if you lose
                access to your authenticator device.
              </p>

              <BackupCodeGrid>
                {backupCodes.map((c, i) => (
                  <BackupCodeItem key={i}>{c}</BackupCodeItem>
                ))}
              </BackupCodeGrid>

              <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
                <CopyButton type="button" onClick={copyAllBackupCodes} style={{ flex: 1, padding: "10px" }}>
                  {hasCopiedCodes ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                  {hasCopiedCodes ? "Copied All Codes" : "Copy All Codes"}
                </CopyButton>
                <CopyButton type="button" onClick={downloadBackupCodes} style={{ flex: 1, padding: "10px" }}>
                  <DownloadIcon size={14} />
                  Download .txt
                </CopyButton>
              </div>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  fontSize: "13px",
                  color: "var(--color-text-primary)",
                  cursor: "pointer",
                  marginBottom: "20px",
                }}
              >
                <input
                  type="checkbox"
                  checked={acknowledgedBackup}
                  onChange={(e) => setAcknowledgedBackup(e.target.checked)}
                />
                I have saved my backup recovery codes in a safe location
              </label>

              <ActionButton type="button" onClick={onClose} disabled={!acknowledgedBackup}>
                Done
              </ActionButton>
            </div>
          )}
        </ModalBody>
      </ModalCard>
    </Overlay>
  );
}

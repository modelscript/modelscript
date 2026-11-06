// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, CopyIcon, KeyIcon, XIcon } from "@primer/octicons-react";
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";

interface SigningKeyData {
  id: number;
  fingerprint_sha256: string;
  public_key_openssh: string;
  public_key_multibase: string;
  algo: string;
  label?: string | null;
  trust_level: string;
  created_at: string;
  activated_at: string;
}

interface SigningKeysResponse {
  username: string;
  signing_verified: boolean;
  signing_policy_strict: boolean;
  keys: SigningKeyData[];
}

const BadgeButton = styled.button<{ $size: number }>`
  background: none;
  border: none;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--color-done-fg, #8250df);
  vertical-align: middle;
  transition:
    transform 0.15s ease,
    color 0.15s ease;
  line-height: 1;

  &:hover {
    color: var(--color-accent-emphasis, #0550ae);
    transform: scale(1.1);
  }

  &:focus-visible {
    outline: 2px solid var(--color-done-fg, #8250df);
    outline-offset: 2px;
    border-radius: 50%;
  }
`;

const ModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100000;
  padding: 16px;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
`;

const ModalContent = styled.div`
  background: var(--color-canvas-default, #ffffff);
  border: 1px solid var(--color-border-default, #d0d7de);
  border-radius: 12px;
  width: 100%;
  max-width: 580px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--color-shadow-large, 0 12px 28px 0 rgba(0, 0, 0, 0.28));
  overflow: hidden;
  position: relative;
  z-index: 1;
`;

const ModalHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border-muted, #d8dee4);
  background: var(--color-canvas-default, #ffffff);
  flex-shrink: 0;

  h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-fg-default, #1f2328);
  }
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  color: var(--color-fg-muted, #656d76);
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover {
    color: var(--color-fg-default, #1f2328);
    background: var(--color-neutral-muted, rgba(175, 184, 193, 0.2));
  }
`;

const ModalBody = styled.div`
  padding: 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: var(--color-canvas-default, #ffffff);
`;

const DescriptionBox = styled.div`
  background: var(--color-canvas-subtle, #f6f8fa);
  border: 1px solid var(--color-border-muted, #d8dee4);
  border-radius: 8px;
  padding: 12px 14px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--color-fg-muted, #656d76);

  strong {
    color: var(--color-fg-default, #1f2328);
  }
`;

const KeyCard = styled.div`
  border: 1px solid var(--color-border-default, #d0d7de);
  border-radius: 8px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--color-canvas-default, #ffffff);
`;

const KeyHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-fg-default, #1f2328);
`;

const CodeBlock = styled.div`
  position: relative;
  background: var(--color-canvas-subtle, #f6f8fa);
  border: 1px solid var(--color-border-muted, #d8dee4);
  border-radius: 6px;
  padding: 8px 10px;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  word-break: break-all;
  color: var(--color-fg-default, #1f2328);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
`;

const CopyBtn = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-fg-muted, #656d76);
  padding: 2px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  &:hover {
    color: var(--color-fg-default, #1f2328);
  }
`;

interface VerifiedAccountBadgeProps {
  username: string;
  size?: number;
  className?: string;
  title?: string;
}

export function VerifiedAccountBadge({
  username,
  size = 18,
  className,
  title,
}: VerifiedAccountBadgeProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SigningKeysResponse | null>(null);
  const [copiedFp, setCopiedFp] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const defaultTitle =
    title ||
    "Signed Account — Posts and Git commits from this account are cryptographically signed with a user-held private key.";

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsOpen(true);
  };

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    fetch(`/api/v1/users/${encodeURIComponent(username)}/signing-keys`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json: SigningKeysResponse | null) => {
        setData(json);
      })
      .catch(() => {
        setData(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isOpen, username]);

  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const copyToClipboard = (text: string, type: "fp" | "key") => {
    navigator.clipboard.writeText(text);
    if (type === "fp") {
      setCopiedFp(text);
      setTimeout(() => setCopiedFp(null), 2000);
    } else {
      setCopiedKey(text);
      setTimeout(() => setCopiedKey(null), 2000);
    }
  };

  const modalNode = isOpen ? (
    <ModalOverlay onClick={() => setIsOpen(false)}>
      <ModalContent onClick={(e) => e.stopPropagation()}>
        <ModalHeader>
          <h3>
            <KeyIcon size={18} /> Signed Account — Cryptographic Identity
          </h3>
          <CloseButton type="button" onClick={() => setIsOpen(false)} aria-label="Close">
            <XIcon size={16} />
          </CloseButton>
        </ModalHeader>

        <ModalBody>
          <DescriptionBox>
            Posts and Git commits from <strong>@{username}</strong> are cryptographically signed with a user-held
            private key (Ed25519 or hardware key). The server never holds the private key, ensuring mathematical
            authenticity, key continuity, and preventing forgery.
            <div style={{ marginTop: "6px", fontSize: "12px", opacity: 0.85 }}>
              <em>
                Note: This guarantees cryptographic authorship and tamper resistance, not legal or real-world identity
                verification.
              </em>
            </div>
          </DescriptionBox>

          {loading && <p style={{ fontSize: "14px", color: "var(--color-fg-muted)" }}>Loading public keys...</p>}

          {!loading && (!data || data.keys.length === 0) && (
            <p style={{ fontSize: "14px", color: "var(--color-fg-muted)" }}>No active signing keys registered.</p>
          )}

          {!loading &&
            data &&
            data.keys.map((k) => (
              <KeyCard key={k.id}>
                <KeyHeader>
                  <span>{k.label || "Ed25519 Signing Key"}</span>
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 500,
                      color: "var(--color-success-fg, #1a7f37)",
                      background: "var(--color-success-subtle, #dafbe1)",
                      padding: "2px 8px",
                      borderRadius: "12px",
                    }}
                  >
                    Active
                  </span>
                </KeyHeader>

                <div>
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      color: "var(--color-fg-muted)",
                      display: "block",
                      marginBottom: "4px",
                    }}
                  >
                    SHA-256 FINGERPRINT
                  </span>
                  <CodeBlock>
                    <span>{k.fingerprint_sha256}</span>
                    <CopyBtn
                      type="button"
                      onClick={() => copyToClipboard(k.fingerprint_sha256, "fp")}
                      title="Copy fingerprint"
                    >
                      {copiedFp === k.fingerprint_sha256 ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                    </CopyBtn>
                  </CodeBlock>
                </div>

                <div>
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      color: "var(--color-fg-muted)",
                      display: "block",
                      marginBottom: "4px",
                    }}
                  >
                    OPENSSH PUBLIC KEY
                  </span>
                  <CodeBlock>
                    <span>{k.public_key_openssh}</span>
                    <CopyBtn
                      type="button"
                      onClick={() => copyToClipboard(k.public_key_openssh, "key")}
                      title="Copy public key"
                    >
                      {copiedKey === k.public_key_openssh ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                    </CopyBtn>
                  </CodeBlock>
                </div>

                <div style={{ fontSize: "11px", color: "var(--color-fg-muted)", marginTop: "4px" }}>
                  Registered on {new Date(k.created_at).toLocaleDateString()} &bull; Algorithm: {k.algo.toUpperCase()}
                </div>
              </KeyCard>
            ))}
        </ModalBody>
      </ModalContent>
    </ModalOverlay>
  ) : null;

  return (
    <>
      <BadgeButton
        type="button"
        $size={size}
        className={className}
        title={defaultTitle}
        aria-label={defaultTitle}
        onClick={handleClick}
      >
        <KeyIcon size={size} />
      </BadgeButton>

      {modalNode && (typeof document !== "undefined" ? createPortal(modalNode, document.body) : modalNode)}
    </>
  );
}

export default VerifiedAccountBadge;

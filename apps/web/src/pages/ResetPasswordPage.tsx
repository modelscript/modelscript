// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleIcon, KeyIcon, LockIcon, XCircleIcon } from "@primer/octicons-react";
import React, { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import styled, { keyframes } from "styled-components";
import { requestPasswordReset, resetPassword } from "../api";
import { usePageTitle } from "../util/title";

const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

const PageWrapper = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: calc(100vh - 60px);
  padding: 40px 16px;
`;

const Card = styled.div`
  width: 100%;
  max-width: 460px;
  background: var(--surface-overlay, rgba(14, 20, 36, 0.9));
  border: 1px solid var(--color-border-glass, rgba(255, 255, 255, 0.12));
  border-radius: var(--radius-xl, 16px);
  padding: 40px 32px;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow:
    0 20px 48px -12px rgba(0, 0, 0, 0.4),
    var(--glow-card);
  display: flex;
  flex-direction: column;
  align-items: center;
  box-sizing: border-box;
`;

const LogoBadge = styled.div`
  width: 52px;
  height: 52px;
  border-radius: var(--radius-lg, 14px);
  background: var(--surface-hud, rgba(14, 20, 36, 0.65));
  border: 1px solid var(--color-border-glass, rgba(255, 255, 255, 0.15));
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 24px rgba(6, 182, 212, 0.22);
  margin-bottom: 14px;
`;

const Title = styled.h1`
  font-size: 22px;
  font-weight: 800;
  color: var(--color-text-heading);
  margin: 0 0 6px 0;
  text-align: center;
  letter-spacing: -0.02em;
`;

const Subtitle = styled.p`
  font-size: 13px;
  color: var(--color-text-muted);
  margin: 0 0 24px 0;
  text-align: center;
  font-weight: 500;
  line-height: 1.4;
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
`;

const Input = styled.input`
  height: 44px;
  padding: 0 14px;
  background: var(--color-search-bg, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md, 8px);
  color: var(--color-text-primary);
  font-size: 14px;
  outline: none;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
  width: 100%;
  box-sizing: border-box;

  &::placeholder {
    color: var(--color-text-muted);
  }

  &:focus {
    border-color: var(--color-accent-cyan, #06b6d4);
    box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.18);
  }
`;

const Button = styled.button`
  height: 44px;
  background: var(--gradient-cta);
  color: #ffffff;
  border: none;
  border-radius: 9999px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition:
    opacity 0.2s,
    transform 0.15s ease,
    box-shadow 0.2s;
  box-shadow: 0 4px 14px rgba(6, 182, 212, 0.35);
  margin-top: 6px;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;

  &:hover {
    opacity: 0.95;
    transform: translateY(-1px);
    box-shadow: 0 6px 18px rgba(6, 182, 212, 0.45);
  }

  &:active {
    transform: translateY(0);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }
`;

const GhostButton = styled.button`
  height: 38px;
  background: transparent;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  border-radius: 9999px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  width: 100%;

  &:hover {
    background: var(--surface-row-hover, rgba(255, 255, 255, 0.04));
    color: var(--color-text-primary);
    border-color: var(--color-text-muted);
  }
`;

const ErrorBanner = styled.div`
  background: var(--status-unstable-bg, rgba(248, 81, 73, 0.1));
  border: 1px solid var(--status-unstable-border, rgba(248, 81, 73, 0.4));
  color: var(--status-unstable-fg, #f85149);
  padding: 10px 14px;
  border-radius: var(--radius-md, 8px);
  font-size: 13px;
  line-height: 1.4;
  width: 100%;
  box-sizing: border-box;
  display: flex;
  align-items: flex-start;
  gap: 8px;
`;

const SuccessCard = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  text-align: center;
  width: 100%;
`;

const SuccessBadge = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(34, 197, 94, 0.12);
  border: 1px solid rgba(34, 197, 94, 0.3);
  color: #22c55e;
  padding: 8px 16px;
  border-radius: 9999px;
  font-size: 14px;
  font-weight: 600;
`;

const InlineSpinner = styled.div`
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #ffffff;
  border-radius: 50%;
  animation: ${spin} 0.8s linear infinite;
`;

export default function ResetPasswordPage() {
  usePageTitle("Reset Password");
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Request new link state if token is missing/expired
  const [requestEmail, setRequestEmail] = useState("");
  const [requestSent, setRequestSent] = useState(false);
  const [requestLoading, setRequestLoading] = useState(false);

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await resetPassword(token, newPassword);
      if (res.success) {
        setSuccess(true);
      } else {
        setError(res.message || "Failed to reset password.");
      }
    } catch (err: any) {
      setError(
        err.response?.data?.error || "This password reset link is invalid or has expired. Please request a new one.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleRequestLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestEmail) return;
    setRequestLoading(true);
    setError(null);
    try {
      await requestPasswordReset(requestEmail);
      setRequestSent(true);
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to send reset link. Please try again.");
    } finally {
      setRequestLoading(false);
    }
  };

  return (
    <PageWrapper>
      <Card>
        <LogoBadge>
          <KeyIcon size={24} fill="#06b6d4" />
        </LogoBadge>

        <Title>Reset Password</Title>
        <Subtitle>
          {token
            ? "Enter your new password below to secure your ModelScript account."
            : "Request a password reset link to regain access."}
        </Subtitle>

        {success ? (
          <SuccessCard>
            <SuccessBadge>
              <CheckCircleIcon size={18} />
              Password Reset Successfully
            </SuccessBadge>
            <p style={{ fontSize: "14px", color: "var(--color-text-muted)", lineHeight: 1.5 }}>
              Your password has been updated. All previous active sessions have been invalidated for security.
            </p>
            <Button onClick={() => navigate("/login")}>Continue to Sign In</Button>
          </SuccessCard>
        ) : token ? (
          <Form onSubmit={handleResetSubmit}>
            {error && (
              <ErrorBanner role="alert">
                <XCircleIcon size={16} />
                <span>{error}</span>
              </ErrorBanner>
            )}

            <Input
              type="password"
              placeholder="New password (min. 8 characters)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              autoFocus
            />

            <Input
              type="password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />

            <Button type="submit" disabled={loading || !newPassword || !confirmPassword}>
              {loading ? (
                <>
                  <InlineSpinner /> Resetting…
                </>
              ) : (
                <>
                  <LockIcon size={16} /> Set New Password
                </>
              )}
            </Button>

            <GhostButton type="button" onClick={() => navigate("/login")}>
              Back to Sign In
            </GhostButton>
          </Form>
        ) : (
          <Form onSubmit={handleRequestLink}>
            {error && (
              <ErrorBanner role="alert">
                <XCircleIcon size={16} />
                <span>{error}</span>
              </ErrorBanner>
            )}

            {requestSent ? (
              <div
                style={{
                  background: "rgba(6, 182, 212, 0.12)",
                  border: "1px solid rgba(6, 182, 212, 0.35)",
                  color: "var(--color-accent-cyan)",
                  padding: "14px",
                  borderRadius: "var(--radius-md, 8px)",
                  fontSize: "13px",
                  lineHeight: "1.4",
                  textAlign: "center",
                }}
              >
                If an account exists with <strong>{requestEmail}</strong>, a password reset link has been dispatched.
                Please check your inbox.
              </div>
            ) : (
              <>
                <Input
                  type="email"
                  placeholder="Enter your registered email address"
                  value={requestEmail}
                  onChange={(e) => setRequestEmail(e.target.value)}
                  required
                  autoFocus
                />

                <Button type="submit" disabled={requestLoading || !requestEmail}>
                  {requestLoading ? (
                    <>
                      <InlineSpinner /> Sending link…
                    </>
                  ) : (
                    "Send Reset Link"
                  )}
                </Button>
              </>
            )}

            <GhostButton type="button" onClick={() => navigate("/login")}>
              Back to Sign In
            </GhostButton>
          </Form>
        )}
      </Card>
    </PageWrapper>
  );
}

// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleIcon, EyeClosedIcon, EyeIcon, KeyIcon, LockIcon, XCircleIcon } from "@primer/octicons-react";
import React, { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import styled, { keyframes } from "styled-components";
import { requestPasswordReset, resetPassword } from "../api";
import { useInstanceBranding } from "../InstanceBrandingContext";
import { usePageTitle } from "../util/title";
import {
  Button,
  Card,
  ErrorBanner,
  evaluatePasswordStrength,
  FieldGroup,
  FieldLabel,
  Form,
  GhostButton,
  Input,
  LogoBadge,
  PageWrapper,
  PasswordInputWrapper,
  PasswordToggleButton,
  StrengthBars,
  StrengthLabel,
  StrengthMeterContainer,
  StrengthSegment,
  Subtitle,
  Title,
} from "./login/styles";

const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
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
  const branding = useInstanceBranding();
  const brandName = branding.instanceName || "Ansatz";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Request new link state if token is missing/expired
  const [requestEmail, setRequestEmail] = useState("");
  const [requestSent, setRequestSent] = useState(false);
  const [requestLoading, setRequestLoading] = useState(false);

  const passwordStrength = evaluatePasswordStrength(newPassword);

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
      <Card style={{ maxWidth: "460px" }}>
        <LogoBadge>
          <KeyIcon size={24} fill="#06b6d4" />
        </LogoBadge>

        <Title style={{ fontSize: "22px" }}>Reset Password</Title>
        <Subtitle>
          {token
            ? `Enter your new password below to secure your ${brandName} account.`
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

            <FieldGroup>
              <FieldLabel htmlFor="reset-new-password">New password</FieldLabel>
              <PasswordInputWrapper>
                <Input
                  id="reset-new-password"
                  type={showNewPassword ? "text" : "password"}
                  placeholder="New password (min. 8 characters)"
                  aria-label="New password (min. 8 characters)"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  autoFocus
                />
                <PasswordToggleButton
                  type="button"
                  onClick={() => setShowNewPassword((prev) => !prev)}
                  aria-label={showNewPassword ? "Hide password" : "Show password"}
                  title={showNewPassword ? "Hide password" : "Show password"}
                >
                  {showNewPassword ? <EyeClosedIcon size={16} /> : <EyeIcon size={16} />}
                </PasswordToggleButton>
              </PasswordInputWrapper>
              {newPassword.length > 0 && (
                <StrengthMeterContainer aria-live="polite">
                  <StrengthBars>
                    {[1, 2, 3, 4].map((seg) => (
                      <StrengthSegment
                        key={seg}
                        $active={passwordStrength.score >= seg}
                        $color={passwordStrength.color}
                      />
                    ))}
                  </StrengthBars>
                  <StrengthLabel $color={passwordStrength.color}>
                    <span>Password strength: {passwordStrength.label}</span>
                    <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>
                      {newPassword.length < 8 ? `${8 - newPassword.length} more chars needed` : "Min. 8 chars"}
                    </span>
                  </StrengthLabel>
                </StrengthMeterContainer>
              )}
            </FieldGroup>

            <FieldGroup>
              <FieldLabel htmlFor="reset-confirm-password">Confirm new password</FieldLabel>
              <PasswordInputWrapper>
                <Input
                  id="reset-confirm-password"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Confirm new password"
                  aria-label="Confirm new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
                <PasswordToggleButton
                  type="button"
                  onClick={() => setShowConfirmPassword((prev) => !prev)}
                  aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                  title={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                >
                  {showConfirmPassword ? <EyeClosedIcon size={16} /> : <EyeIcon size={16} />}
                </PasswordToggleButton>
              </PasswordInputWrapper>
            </FieldGroup>

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
                <FieldGroup>
                  <FieldLabel htmlFor="reset-request-email">Email address</FieldLabel>
                  <Input
                    id="reset-request-email"
                    type="email"
                    placeholder="Enter your registered email address"
                    aria-label="Enter your registered email address"
                    value={requestEmail}
                    onChange={(e) => setRequestEmail(e.target.value)}
                    autoComplete="email"
                    required
                    autoFocus
                  />
                </FieldGroup>

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

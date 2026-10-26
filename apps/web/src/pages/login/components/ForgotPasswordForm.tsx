// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import { Link } from "react-router-dom";
import { Button, ErrorBanner, Form, GhostButton, Input } from "../styles";

export interface ForgotPasswordFormProps {
  forgotEmail: string;
  setForgotEmail: (val: string) => void;
  forgotSent: boolean;
  forgotLoading: boolean;
  forgotError: string;
  onSubmit: (e: React.FormEvent) => void;
  onBackToLogin: () => void;
}

export const ForgotPasswordForm: React.FC<ForgotPasswordFormProps> = ({
  forgotEmail,
  setForgotEmail,
  forgotSent,
  forgotLoading,
  forgotError,
  onSubmit,
  onBackToLogin,
}) => {
  return (
    <Form onSubmit={onSubmit} aria-label="Forgot password form">
      {forgotError && (
        <ErrorBanner role="alert" aria-live="polite">
          {forgotError}
        </ErrorBanner>
      )}

      {forgotSent ? (
        <div
          style={{
            background: "rgba(6, 182, 212, 0.12)",
            border: "1px solid rgba(6, 182, 212, 0.35)",
            color: "var(--color-accent-cyan)",
            padding: "16px",
            borderRadius: "var(--radius-md, 8px)",
            fontSize: "13px",
            lineHeight: "1.5",
            textAlign: "center",
          }}
        >
          If an account exists with <strong>{forgotEmail}</strong>, a password reset link has been sent. Please check
          your inbox and follow the instructions.
          <div style={{ marginTop: "12px" }}>
            <Link to="/reset-password" style={{ color: "var(--color-accent-cyan)", fontWeight: 700 }}>
              Already have a reset token? Enter it here →
            </Link>
          </div>
        </div>
      ) : (
        <>
          <Input
            id="forgot-email"
            name="forgotEmail"
            type="email"
            value={forgotEmail}
            onChange={(e) => setForgotEmail(e.target.value)}
            placeholder="Enter your account email"
            aria-label="Email address for password reset"
            autoComplete="email"
            required
            autoFocus
          />
          <Button type="submit" disabled={forgotLoading || !forgotEmail}>
            {forgotLoading ? "Sending reset link…" : "Send Reset Link"}
          </Button>
        </>
      )}

      <GhostButton type="button" onClick={onBackToLogin}>
        Back to Sign In
      </GhostButton>
    </Form>
  );
};

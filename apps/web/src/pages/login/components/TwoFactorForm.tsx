// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import { Button, ErrorBanner, Form, GhostButton, Input } from "../styles";

export interface TwoFactorFormProps {
  twoFactorCode: string;
  setTwoFactorCode: (val: string) => void;
  useBackupCode: boolean;
  setUseBackupCode: (val: boolean) => void;
  error: string;
  setError: (val: string) => void;
  loading: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onBackToLogin: () => void;
}

export const TwoFactorForm: React.FC<TwoFactorFormProps> = ({
  twoFactorCode,
  setTwoFactorCode,
  useBackupCode,
  setUseBackupCode,
  error,
  setError,
  loading,
  onSubmit,
  onBackToLogin,
}) => {
  return (
    <Form onSubmit={onSubmit} aria-label="Two-factor challenge form">
      {error && (
        <ErrorBanner role="alert" aria-live="polite">
          {error}
        </ErrorBanner>
      )}

      <Input
        id="two-factor-code"
        name="twoFactorCode"
        type="text"
        inputMode={useBackupCode ? "text" : "numeric"}
        autoComplete="one-time-code"
        value={twoFactorCode}
        onChange={(e) => setTwoFactorCode(e.target.value)}
        placeholder={useBackupCode ? "e.g. A1B2C3D4" : "123456"}
        aria-label={useBackupCode ? "8-character backup recovery code" : "6-digit verification code"}
        required
        autoFocus
        style={{
          textAlign: "center",
          fontSize: "20px",
          letterSpacing: useBackupCode ? "0.15em" : "0.3em",
          fontWeight: 700,
          fontFamily: "monospace",
        }}
      />

      <Button type="submit" disabled={loading || !twoFactorCode.trim()}>
        {loading ? "Verifying…" : "Verify and Continue"}
      </Button>

      <GhostButton
        type="button"
        onClick={() => {
          setUseBackupCode(!useBackupCode);
          setTwoFactorCode("");
          setError("");
        }}
      >
        {useBackupCode ? "Use 6-digit authenticator code instead" : "Use a backup recovery code"}
      </GhostButton>

      <GhostButton type="button" onClick={onBackToLogin}>
        Back to Sign In
      </GhostButton>
    </Form>
  );
};

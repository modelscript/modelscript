// SPDX-License-Identifier: AGPL-3.0-or-later

import { Spinner, Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/client";
import Box from "../components/Box";
import { TwoFactorForm } from "./login/components/TwoFactorForm";

const OAuthCallbackPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [authError, setAuthError] = useState<string | null>(null);
  const [requires2FA, setRequires2FA] = useState(false);
  const [tempToken, setTempToken] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [twoFactorError, setTwoFactorError] = useState("");
  const [verifying2FA, setVerifying2FA] = useState(false);

  useEffect(() => {
    const req2fa = searchParams.get("requires2FA") === "true";
    const challengeToken = searchParams.get("tempToken");
    if (req2fa && challengeToken) {
      window.history.replaceState({}, document.title, window.location.pathname);
      setTempToken(challengeToken);
      setRequires2FA(true);
      return undefined;
    }

    // Check search params or hash fragment for token
    let token = searchParams.get("token");
    if (!token && window.location.hash) {
      const match = window.location.hash.match(/token=([^&]+)/);
      if (match) token = decodeURIComponent(match[1]!);
    }

    if (token) {
      // Immediately scrub token from address bar and history to prevent leakage
      window.history.replaceState({}, document.title, window.location.pathname);
      localStorage.setItem("modelscript-auth-token", token);
      window.location.href = "/"; // Hard reload to re-init auth context and respect onboarding route
      return undefined;
    } else if (!requires2FA) {
      const errorParam =
        searchParams.get("message") || searchParams.get("error_description") || searchParams.get("error");
      setAuthError(
        errorParam
          ? `Authentication failed: ${errorParam}. Redirecting to login...`
          : "Authentication failed or was cancelled. Redirecting to login...",
      );
      const timer = setTimeout(() => navigate("/login"), 4000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [searchParams, navigate, requires2FA]);

  const handleTwoFactorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tempToken || !twoFactorCode.trim()) return;
    setVerifying2FA(true);
    setTwoFactorError("");
    try {
      const res = await api.post("/auth/2fa/challenge", {
        tempToken,
        code: twoFactorCode.trim(),
      });
      if (res.data?.token) {
        localStorage.setItem("modelscript-auth-token", res.data.token);
        window.location.href = "/";
      } else {
        setTwoFactorError("Invalid response from server.");
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        "Invalid two-factor authentication code.";
      setTwoFactorError(msg);
    } finally {
      setVerifying2FA(false);
    }
  };

  return (
    <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" height="100vh" px={3}>
      {requires2FA ? (
        <Box
          p={4}
          style={{
            background: "var(--color-canvas-subtle, #0f172a)",
            border: "1px solid var(--color-border-default, #1e293b)",
            borderRadius: "12px",
            maxWidth: "400px",
            width: "100%",
          }}
        >
          <Text fontWeight="bold" fontSize={3} display="block" mb={1}>
            Two-Factor Verification Required
          </Text>
          <Text fontSize={1} color="var(--color-fg-muted)" display="block" mb={3}>
            {useBackupCode
              ? "Enter one of your 8-character single-use backup recovery codes."
              : "Enter the 6-digit verification code from your authenticator app to complete single sign-on."}
          </Text>
          <TwoFactorForm
            twoFactorCode={twoFactorCode}
            setTwoFactorCode={setTwoFactorCode}
            useBackupCode={useBackupCode}
            setUseBackupCode={setUseBackupCode}
            error={twoFactorError}
            setError={setTwoFactorError}
            loading={verifying2FA}
            onSubmit={handleTwoFactorSubmit}
            onBackToLogin={() => navigate("/login")}
          />
        </Box>
      ) : authError ? (
        <Box
          p={3}
          style={{
            background: "rgba(248, 81, 73, 0.1)",
            border: "1px solid rgba(248, 81, 73, 0.4)",
            borderRadius: "8px",
            color: "var(--color-danger-fg)",
            maxWidth: "420px",
            textAlign: "center",
          }}
          role="alert"
        >
          <Text fontWeight="bold" display="block" mb={1}>
            OAuth Sign-In Failed
          </Text>
          <Text fontSize={1} display="block" mb={2}>
            {authError}
          </Text>
          <Link
            to="/login"
            style={{
              color: "var(--color-accent-cyan)",
              fontSize: "13px",
              fontWeight: 600,
              textDecoration: "underline",
            }}
          >
            Return to Sign In
          </Link>
        </Box>
      ) : (
        <>
          <Spinner size="large" />
          <Text mt={3} color="var(--color-fg-muted)">
            Authenticating with provider...
          </Text>
        </>
      )}
    </Box>
  );
};

export default OAuthCallbackPage;

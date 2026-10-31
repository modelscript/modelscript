// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api, { requestPasswordReset } from "../api";
import { useAuth } from "../AuthContext";
import AnsatzMark from "../components/AnsatzLogo";
import { useInstanceBranding } from "../InstanceBrandingContext";
import { usePageTitle } from "../util/title";
import {
  Card,
  Divider,
  ForgotPasswordForm,
  LoginForm,
  type LoginMode,
  OAuthProviders,
  PageWrapper,
  Subtitle,
  Title,
  TwoFactorForm,
} from "./login";

export default function LoginPage() {
  usePageTitle("Sign In");
  const branding = useInstanceBranding();
  const [mode, setMode] = useState<LoginMode>("login");
  const [email, setEmail] = useState(import.meta.env.DEV ? "dev@modelscript.org" : "");
  const [password, setPassword] = useState(import.meta.env.DEV ? "password" : "");
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tempToken, setTempToken] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [authConfig, setAuthConfig] = useState<{
    oidcEnabled?: boolean | undefined;
    airgapEnforced?: boolean | undefined;
    oauthProviders?: string[] | undefined;
  } | null>(null);
  const { login, complete2FALogin } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Only same-origin relative paths ("/x", not "//evil.com") to avoid open redirects.
  const nextParam = searchParams.get("next");
  const redirectTo = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";

  useEffect(() => {
    let active = true;
    api
      .get("/auth/config")
      .then((res) => {
        if (active && res.data && typeof res.data === "object") {
          setAuthConfig(res.data);
        }
      })
      .catch(() => {
        // Fallback if /auth/config is unavailable
      });
    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await login(email, password);
      if (res?.requires2FA && res.tempToken) {
        setTempToken(res.tempToken);
        setMode("2fa");
        setTwoFactorCode("");
      } else {
        navigate(redirectTo);
      }
    } catch (err: unknown) {
      if (err && typeof err === "object" && "response" in err) {
        const axiosErr = err as { response?: { data?: { error?: string | undefined } | undefined } | undefined };
        setError(axiosErr.response?.data?.error || "Login failed");
      } else {
        setError("Login failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handle2FASubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await complete2FALogin(tempToken, twoFactorCode.trim());
      navigate(redirectTo);
    } catch (err: unknown) {
      if (err && typeof err === "object" && "response" in err) {
        const axiosErr = err as { response?: { data?: { error?: string | undefined } | undefined } | undefined };
        setError(axiosErr.response?.data?.error || "Invalid verification code. Please try again.");
      } else {
        setError("Verification failed. Please check your code and try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError("");
    setForgotLoading(true);
    try {
      await requestPasswordReset(forgotEmail);
      setForgotSent(true);
    } catch (err: any) {
      setForgotError(err.response?.data?.error || "Failed to send password reset link. Please try again.");
    } finally {
      setForgotLoading(false);
    }
  };

  const brandName = branding.instanceName || "Ansatz";

  return (
    <PageWrapper>
      <Card>
        <div style={{ marginBottom: "12px" }}>
          <AnsatzMark
            size={48}
            logoUrl={branding.brandLogoUrl}
            alt={brandName}
            accentColor={branding.brandAccentColor}
          />
        </div>
        <Title>
          {mode === "login"
            ? `Sign in to ${brandName}`
            : mode === "2fa"
              ? "Two-Factor Verification"
              : "Reset your password"}
        </Title>
        <Subtitle>
          {mode === "login"
            ? branding.instanceTagline || "The Federated Scientific & Engineering Network"
            : mode === "2fa"
              ? useBackupCode
                ? "Enter one of your 8-character single-use recovery backup codes."
                : "Enter the 6-digit verification code from your authenticator app."
              : "Enter your registered email and we'll send you a password reset link."}
        </Subtitle>

        {mode === "login" ? (
          <>
            <OAuthProviders
              oidcEnabled={authConfig?.oidcEnabled}
              airgapEnforced={authConfig?.airgapEnforced}
              oauthProviders={authConfig?.oauthProviders}
            />
            {(!authConfig?.airgapEnforced || authConfig?.oidcEnabled) && <Divider>or</Divider>}
            <LoginForm
              email={email}
              setEmail={setEmail}
              password={password}
              setPassword={setPassword}
              error={error}
              loading={loading}
              onSubmit={handleSubmit}
              onForgotPassword={() => {
                setForgotEmail(email);
                setMode("forgot");
                setForgotSent(false);
                setForgotError("");
              }}
            />
          </>
        ) : mode === "2fa" ? (
          <TwoFactorForm
            twoFactorCode={twoFactorCode}
            setTwoFactorCode={setTwoFactorCode}
            useBackupCode={useBackupCode}
            setUseBackupCode={setUseBackupCode}
            error={error}
            setError={setError}
            loading={loading}
            onSubmit={handle2FASubmit}
            onBackToLogin={() => {
              setMode("login");
              setTempToken("");
              setTwoFactorCode("");
              setError("");
            }}
          />
        ) : (
          <ForgotPasswordForm
            forgotEmail={forgotEmail}
            setForgotEmail={setForgotEmail}
            forgotSent={forgotSent}
            forgotLoading={forgotLoading}
            forgotError={forgotError}
            onSubmit={handleForgotSubmit}
            onBackToLogin={() => {
              setMode("login");
              setError("");
            }}
          />
        )}
      </Card>
    </PageWrapper>
  );
}

export { LoginPage };

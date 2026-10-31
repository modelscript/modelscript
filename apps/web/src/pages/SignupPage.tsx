// SPDX-License-Identifier: AGPL-3.0-or-later

import { EyeClosedIcon, EyeIcon, MarkGithubIcon, MortarBoardIcon } from "@primer/octicons-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import styled from "styled-components";
import api from "../api/client";
import { useAuth } from "../AuthContext";
import AnsatzMark from "../components/AnsatzLogo";
import WaitlistModal from "../components/auth/WaitlistModal";
import { useInstanceBranding } from "../InstanceBrandingContext";
import { usePageTitle } from "../util/title";
import { GitLabIcon } from "./login/icons";
import {
  Button,
  Card,
  Divider,
  ErrorBanner,
  evaluatePasswordStrength,
  FieldGroup,
  FieldLabel,
  FooterText,
  Form,
  Input,
  PageWrapper,
  PasswordInputWrapper,
  PasswordToggleButton,
  ProviderButton,
  StrengthBars,
  StrengthLabel,
  StrengthMeterContainer,
  StrengthSegment,
  Subtitle,
  Title,
} from "./login/styles";

const CheckboxWrapper = styled.label`
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 13px;
  color: var(--color-text-secondary, #94a3b8);
  cursor: pointer;
  user-select: none;
  line-height: 1.4;
  margin-top: 4px;

  input[type="checkbox"] {
    margin-top: 2px;
    width: 16px;
    height: 16px;
    accent-color: var(--color-accent-cyan, #06b6d4);
    cursor: pointer;
  }

  a {
    color: var(--color-accent-cyan, #06b6d4);
    text-decoration: none;
    font-weight: 600;

    &:hover {
      text-decoration: underline;
    }
  }
`;

export default function SignupPage() {
  usePageTitle("Sign Up");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [inviteCode, setInviteCode] = useState(() => {
    if (typeof window !== "undefined") {
      return new URLSearchParams(window.location.search).get("invite") || "";
    }
    return "";
  });
  const [showInviteField, setShowInviteField] = useState(() => {
    if (typeof window !== "undefined") {
      return Boolean(new URLSearchParams(window.location.search).get("invite"));
    }
    return false;
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [devVerificationToken, setDevVerificationToken] = useState<string | null>(null);
  const [authConfig, setAuthConfig] = useState<{
    airgapEnforced?: boolean;
    turnstileEnabled?: boolean;
    oauthProviders?: string[];
    oidcEnabled?: boolean;
    registrationMode?: string;
    allowedEmailDomains?: string;
    mailerConfigured?: boolean;
  } | null>(null);
  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const { register } = useAuth();
  const navigate = useNavigate();

  const passwordStrength = evaluatePasswordStrength(password);
  const rawTurnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
  const turnstileSiteKey =
    authConfig?.airgapEnforced || authConfig?.turnstileEnabled === false ? undefined : rawTurnstileSiteKey;

  useEffect(() => {
    let active = true;
    api
      .get("/auth/config")
      .then((res) => {
        if (active && res.data) {
          setAuthConfig(res.data);
        }
      })
      .catch(() => {
        // Fallback to client env defaults
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!turnstileSiteKey || typeof window === "undefined") return;

    let widgetId: string | undefined;
    const renderWidget = () => {
      const turnstile = (window as any).turnstile;
      if (turnstile && turnstileContainerRef.current && !widgetId) {
        widgetId = turnstile.render(turnstileContainerRef.current, {
          sitekey: turnstileSiteKey,
          callback: (token: string) => {
            (window as any).__MODEL_SCRIPT_CAPTCHA_TOKEN__ = token;
            setCaptchaToken(token);
          },
          "expired-callback": () => {
            (window as any).__MODEL_SCRIPT_CAPTCHA_TOKEN__ = "";
            setCaptchaToken("");
          },
        });
      }
    };

    if ((window as any).turnstile) {
      renderWidget();
    } else {
      const existingScript = document.querySelector<HTMLScriptElement>(
        'script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]',
      );
      if (existingScript) {
        existingScript.addEventListener("load", renderWidget);
      } else {
        const script = document.createElement("script");
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        script.addEventListener("load", renderWidget);
        document.head.appendChild(script);
      }
    }

    return () => {
      const turnstile = (window as any).turnstile;
      if (turnstile && widgetId) {
        try {
          turnstile.remove(widgetId);
        } catch {
          // Ignore cleanup errors
        }
      }
    };
  }, [turnstileSiteKey]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!acceptTerms) {
      setError("You must accept the Terms of Service and Privacy Policy to register");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);
    try {
      const effectiveCaptchaToken =
        captchaToken ||
        (typeof window !== "undefined" && (window as any).__MODEL_SCRIPT_CAPTCHA_TOKEN__) ||
        (turnstileSiteKey ? "" : "mock-token");

      if (turnstileSiteKey && !effectiveCaptchaToken) {
        setError("Please complete the security verification challenge before registering.");
        setLoading(false);
        return;
      }

      const res = await register(
        username,
        email,
        password,
        acceptTerms,
        effectiveCaptchaToken,
        inviteCode.trim() || undefined,
      );
      if (res?.verificationToken) {
        setDevVerificationToken(res.verificationToken);
      }
      if (res?.verificationRequired) {
        setVerificationSent(true);
      } else {
        navigate("/");
      }
    } catch (err: unknown) {
      if (err && typeof err === "object" && "response" in err) {
        const axiosErr = err as { response?: { data?: { error?: string | undefined } | undefined } | undefined };
        setError(axiosErr.response?.data?.error || "Registration failed");
      } else {
        setError("Registration failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const branding = useInstanceBranding();
  const brandName = branding.instanceName || "Ansatz";
  const [waitlistOpen, setWaitlistOpen] = useState(false);

  const isAcademicEmail = Boolean(
    email &&
    branding.academicFastTrackEnabled &&
    (email.toLowerCase().endsWith(".edu") ||
      email.toLowerCase().endsWith(".ac.uk") ||
      (branding.academicDomainPatterns &&
        branding.academicDomainPatterns.some((p) => email.toLowerCase().includes(p.toLowerCase())))),
  );

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
        <Title>Join {brandName}</Title>
        <Subtitle>{branding.instanceTagline || "The Federated Scientific & Engineering Network"}</Subtitle>

        {verificationSent ? (
          <div style={{ textAlign: "center", padding: "16px 0", width: "100%" }}>
            <div style={{ fontSize: "44px", marginBottom: "12px" }}>📬</div>
            <h2 style={{ fontSize: "20px", fontWeight: 700, color: "var(--color-text-heading)", margin: "0 0 8px 0" }}>
              Verify your email address
            </h2>
            <p
              style={{
                fontSize: "14px",
                color: "var(--color-text-muted)",
                lineHeight: "1.5",
                margin: "0 0 20px 0",
              }}
            >
              {authConfig?.mailerConfigured === false ? (
                <>
                  Account created for <strong>{email}</strong>. Outbound email delivery is not configured on this
                  instance — you can continue directly into your workspace or verify below to unlock{" "}
                  <strong>50 free compute credits</strong>.
                </>
              ) : (
                <>
                  We sent a verification link to <strong>{email}</strong>. Verify your address to activate full features
                  and unlock your <strong>50 free compute credits</strong>, or continue directly to your workspace now.
                </>
              )}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {devVerificationToken && (
                <Button
                  type="button"
                  onClick={() => navigate(`/verify-email?token=${encodeURIComponent(devVerificationToken)}`)}
                >
                  Verify Instantly &amp; Claim 50 Credits
                </Button>
              )}
              <Button
                type="button"
                onClick={() => navigate("/")}
                style={
                  devVerificationToken
                    ? {
                        background: "transparent",
                        border: "1px solid var(--ms-border, rgba(148, 163, 184, 0.3))",
                        color: "var(--color-text-heading)",
                      }
                    : undefined
                }
              >
                Continue to {brandName}
              </Button>
            </div>
          </div>
        ) : authConfig?.registrationMode === "closed" ? (
          <div style={{ textAlign: "center", padding: "16px 0", width: "100%" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 700, color: "var(--color-text-heading)", margin: "0 0 8px 0" }}>
              Registration Closed
            </h2>
            <p
              style={{
                fontSize: "14px",
                color: "var(--color-text-muted)",
                lineHeight: "1.5",
                margin: "0 0 20px 0",
              }}
            >
              Self-service registration is disabled on this {brandName} instance. Please contact your instance
              administrator to provision an account.
            </p>
            <Button type="button" onClick={() => navigate("/login")}>
              Return to Sign In
            </Button>
          </div>
        ) : (
          <>
            {!authConfig?.airgapEnforced &&
              ((authConfig?.oauthProviders && authConfig.oauthProviders.length > 0) ||
                authConfig?.oidcEnabled ||
                !authConfig) && (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%" }}>
                    {(!authConfig || authConfig.oauthProviders?.includes("github")) && (
                      <ProviderButton onClick={() => (window.location.href = "/api/v1/auth/login/github")}>
                        <MarkGithubIcon size={16} />
                        Sign up with GitHub
                      </ProviderButton>
                    )}
                    {(!authConfig || authConfig.oauthProviders?.includes("gitlab")) && (
                      <ProviderButton onClick={() => (window.location.href = "/api/v1/auth/login/gitlab")}>
                        <GitLabIcon />
                        Sign up with GitLab
                      </ProviderButton>
                    )}
                    {authConfig?.oidcEnabled && (
                      <ProviderButton onClick={() => (window.location.href = "/api/v1/auth/oidc/login")}>
                        Sign up with Enterprise SSO (OIDC)
                      </ProviderButton>
                    )}
                  </div>

                  <Divider>or</Divider>
                </>
              )}

            <Form onSubmit={handleSubmit} aria-label="Sign up form">
              {error && (
                <ErrorBanner role="alert" aria-live="polite">
                  {error}
                </ErrorBanner>
              )}
              <FieldGroup>
                <FieldLabel htmlFor="signup-username">Username</FieldLabel>
                <Input
                  id="signup-username"
                  name="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Username (e.g. johndoe)"
                  aria-label="Username"
                  autoComplete="username"
                  required
                  autoFocus
                  minLength={3}
                />
              </FieldGroup>
              <FieldGroup>
                <FieldLabel htmlFor="signup-email">
                  Email address
                  {authConfig?.registrationMode === "domain_allowlist" && authConfig.allowedEmailDomains && (
                    <span style={{ fontWeight: 400, color: "var(--color-text-muted)", marginLeft: "6px" }}>
                      (Allowed: {authConfig.allowedEmailDomains})
                    </span>
                  )}
                </FieldLabel>
                <Input
                  id="signup-email"
                  name="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email address"
                  aria-label="Email address"
                  autoComplete="email"
                  required
                />
              </FieldGroup>
              <FieldGroup>
                <FieldLabel htmlFor="signup-password">Password</FieldLabel>
                <PasswordInputWrapper>
                  <Input
                    id="signup-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password (minimum 8 characters)"
                    aria-label="Password (minimum 8 characters)"
                    autoComplete="new-password"
                    required
                    minLength={8}
                  />
                  <PasswordToggleButton
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    title={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeClosedIcon size={16} /> : <EyeIcon size={16} />}
                  </PasswordToggleButton>
                </PasswordInputWrapper>
                {password.length > 0 && (
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
                        {password.length < 8 ? `${8 - password.length} more chars needed` : "Min. 8 chars"}
                      </span>
                    </StrengthLabel>
                  </StrengthMeterContainer>
                )}
              </FieldGroup>
              <FieldGroup>
                <FieldLabel htmlFor="signup-confirm-password">Confirm password</FieldLabel>
                <PasswordInputWrapper>
                  <Input
                    id="signup-confirm-password"
                    name="confirm-password"
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm password"
                    aria-label="Confirm password"
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
              <FieldGroup>
                {isAcademicEmail && (
                  <div
                    style={{
                      background: "rgba(16, 185, 129, 0.1)",
                      border: "1px solid rgba(16, 185, 129, 0.3)",
                      borderRadius: "6px",
                      padding: "6px 10px",
                      fontSize: "12px",
                      color: "#10b981",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      margin: "2px 0 4px 0",
                    }}
                  >
                    <MortarBoardIcon size={14} />
                    <span>Academic institution detected — Instant Access unlocked!</span>
                  </div>
                )}

                {authConfig?.registrationMode === "invite_only" || showInviteField || Boolean(inviteCode) ? (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <FieldLabel htmlFor="signup-invite-code" style={{ marginBottom: 0 }}>
                        {authConfig?.registrationMode === "invite_only" && !isAcademicEmail
                          ? "Invite Code (required)"
                          : "Invite or Referral Code (optional)"}
                      </FieldLabel>
                      {branding.waitlistEnabled && !isAcademicEmail && (
                        <button
                          type="button"
                          onClick={() => setWaitlistOpen(true)}
                          style={{
                            background: "none",
                            border: "none",
                            color: "var(--color-accent-cyan, #06b6d4)",
                            fontSize: "12px",
                            fontWeight: 600,
                            cursor: "pointer",
                            padding: 0,
                          }}
                        >
                          Request an Access Key
                        </button>
                      )}
                    </div>

                    <Input
                      id="signup-invite-code"
                      name="inviteCode"
                      type="text"
                      value={inviteCode}
                      onChange={(e) => setInviteCode(e.target.value)}
                      placeholder={isAcademicEmail ? "Not required for verified academic domains" : "msx-inv-..."}
                      aria-label="Invite Code"
                      required={authConfig?.registrationMode === "invite_only" && !isAcademicEmail}
                    />
                  </>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      fontSize: "12px",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setShowInviteField(true)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--color-text-secondary, #94a3b8)",
                        fontWeight: 500,
                        cursor: "pointer",
                        padding: 0,
                        textDecoration: "underline",
                      }}
                    >
                      Have an invite or referral code?
                    </button>
                    {branding.waitlistEnabled && !isAcademicEmail && (
                      <button
                        type="button"
                        onClick={() => setWaitlistOpen(true)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--color-accent-cyan, #06b6d4)",
                          fontWeight: 600,
                          cursor: "pointer",
                          padding: 0,
                        }}
                      >
                        Request an Access Key
                      </button>
                    )}
                  </div>
                )}
              </FieldGroup>

              <CheckboxWrapper>
                <input
                  type="checkbox"
                  id="signup-accept-terms"
                  name="acceptTerms"
                  checked={acceptTerms}
                  onChange={(e) => setAcceptTerms(e.target.checked)}
                  required
                />
                <span>
                  I agree to the{" "}
                  <Link to="/terms" target="_blank">
                    Terms of Service
                  </Link>{" "}
                  and{" "}
                  <Link to="/privacy" target="_blank">
                    Privacy Policy
                  </Link>
                </span>
              </CheckboxWrapper>

              {turnstileSiteKey && (
                <div
                  ref={turnstileContainerRef}
                  data-testid="turnstile-widget"
                  style={{ display: "flex", justifyContent: "center", minHeight: "65px", marginTop: "4px" }}
                />
              )}

              <Button type="submit" disabled={loading || !acceptTerms}>
                {loading ? "Creating account…" : "Create Account"}
              </Button>
            </Form>
            <FooterText>
              Already have an account? <Link to="/login">Sign in</Link>
            </FooterText>
          </>
        )}
      </Card>
      <WaitlistModal
        isOpen={waitlistOpen}
        onClose={() => setWaitlistOpen(false)}
        defaultEmail={email}
        brandName={brandName}
      />
    </PageWrapper>
  );
}

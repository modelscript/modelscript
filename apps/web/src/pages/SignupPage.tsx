// SPDX-License-Identifier: AGPL-3.0-or-later

import { EyeClosedIcon, EyeIcon, MarkGithubIcon } from "@primer/octicons-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import { usePageTitle } from "../util/title";
import { GitLabIcon, GoogleIcon, XIcon } from "./login/icons";
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
  LogoBadge,
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
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const { register } = useAuth();
  const navigate = useNavigate();

  const passwordStrength = evaluatePasswordStrength(password);
  const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

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

      const res = await register(username, email, password, acceptTerms, effectiveCaptchaToken);
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

  return (
    <PageWrapper>
      <Card>
        <LogoBadge>
          <img src="/ms-logo.png" alt="ModelScript" width="34" height="34" />
        </LogoBadge>
        <Title>Join ModelScript</Title>
        <Subtitle>The Collaborative Simulation & Modeling Platform</Subtitle>

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
                margin: "0 0 24px 0",
              }}
            >
              We sent a verification link to <strong>{email}</strong>. Please check your inbox and verify your address
              to activate full features and unlock your <strong>50 free compute credits</strong>!
            </p>
            <Button type="button" onClick={() => navigate("/home")}>
              Continue to ModelScript
            </Button>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%" }}>
              <ProviderButton onClick={() => (window.location.href = "/api/v1/auth/login/github")}>
                <MarkGithubIcon size={16} />
                Sign up with GitHub
              </ProviderButton>
              <ProviderButton onClick={() => (window.location.href = "/api/v1/auth/login/gitlab")}>
                <GitLabIcon />
                Sign up with GitLab
              </ProviderButton>
              <ProviderButton onClick={() => (window.location.href = "/api/v1/auth/login/twitter")}>
                <XIcon />
                Sign up with X
              </ProviderButton>
              <ProviderButton onClick={() => (window.location.href = "/api/v1/auth/login/google")}>
                <GoogleIcon />
                Continue with Google
              </ProviderButton>
            </div>

            <Divider>or</Divider>

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
                <FieldLabel htmlFor="signup-email">Email address</FieldLabel>
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
    </PageWrapper>
  );
}

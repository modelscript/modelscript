// SPDX-License-Identifier: AGPL-3.0-or-later

import { MarkGithubIcon } from "@primer/octicons-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import { usePageTitle } from "../util/title";

const GitLabIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M15.82 7.42L14.07 2.05C13.98 1.77 13.58 1.77 13.49 2.05L11.83 7.15H4.17L2.51 2.05C2.42 1.77 2.02 1.77 1.93 2.05L0.18 7.42C0.09 7.69 0.19 8.01 0.43 8.18L8 13.68L15.57 8.18C15.81 8.01 15.91 7.69 15.82 7.42Z"
      fill="#FC6D26"
    />
    <path d="M8 13.68L4.17 7.15H11.83L8 13.68Z" fill="#E24329" />
    <path
      d="M8 13.68L11.83 7.15H15.57C15.81 8.01 15.91 7.69 15.82 7.42L14.07 2.05C13.98 1.77 13.58 1.77 13.49 2.05L11.83 7.15Z"
      fill="#FCA326"
    />
    <path
      d="M8 13.68L4.17 7.15H0.43C0.19 8.01 0.09 7.69 0.18 7.42L1.93 2.05C2.02 1.77 2.42 1.77 2.51 2.05L4.17 7.15Z"
      fill="#FCA326"
    />
  </svg>
);

const XIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const GoogleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24">
    <path
      fill="#4285F4"
      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.65v3.03h3.88c2.27-2.09 3.665-5.17 3.665-9.12z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.03c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.13C3.26 21.36 7.33 24 12 24z"
    />
    <path
      fill="#FBBC05"
      d="M5.28 14.29c-.25-.72-.38-1.49-.38-2.29s.13-1.57.38-2.29V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.13z"
    />
    <path
      fill="#EA4335"
      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.13c.95-2.83 3.6-4.96 6.72-4.96z"
    />
  </svg>
);

const PageWrapper = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: calc(100vh - 60px);
  padding: 40px 16px;
`;

const Card = styled.div`
  width: 100%;
  max-width: 440px;
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
  font-size: 24px;
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

const ProviderButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 42px;
  background: var(--surface-overlay, var(--color-canvas-subtle));
  color: var(--color-text-primary, var(--color-fg-default));
  border: 1px solid var(--color-border);
  border-radius: 9999px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  width: 100%;

  &:hover {
    background: var(--surface-row-hover, var(--color-canvas-default));
    border-color: var(--color-accent-cyan, #06b6d4);
    box-shadow: 0 2px 8px rgba(6, 182, 212, 0.15);
    transform: translateY(-1px);
  }

  &:active {
    transform: translateY(0);
  }
`;

const Divider = styled.div`
  display: flex;
  align-items: center;
  text-align: center;
  margin: 20px 0;
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  width: 100%;

  &::before,
  &::after {
    content: "";
    flex: 1;
    border-bottom: 1px solid var(--color-border);
  }

  &:not(:empty)::before {
    margin-right: 0.8em;
  }

  &:not(:empty)::after {
    margin-left: 0.8em;
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
`;

const FooterText = styled.p`
  text-align: center;
  font-size: 14px;
  color: var(--color-text-muted);
  margin: 28px 0 0 0;
  width: 100%;

  a {
    color: var(--color-accent-cyan);
    text-decoration: none;
    font-weight: 700;

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
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

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
      await register(username, email, password);
      navigate("/");
    } catch (err: unknown) {
      if (err && typeof err === "object" && "response" in err) {
        const axiosErr = err as { response?: { data?: { error?: string } } };
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
          <Input
            id="signup-password"
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (minimum 8 characters)"
            aria-label="Password (minimum 8 characters)"
            autoComplete="new-password"
            required
            minLength={8}
          />
          <Input
            id="signup-confirm-password"
            name="confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm password"
            aria-label="Confirm password"
            autoComplete="new-password"
            required
          />
          <Button type="submit" disabled={loading}>
            {loading ? "Creating account…" : "Create Account"}
          </Button>
        </Form>
        <FooterText>
          Already have an account? <Link to="/login">Sign in</Link>
        </FooterText>
      </Card>
    </PageWrapper>
  );
}

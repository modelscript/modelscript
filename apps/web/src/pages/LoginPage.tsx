/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { MarkGithubIcon } from "@primer/octicons-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";

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

const PageWrapper = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: 40px 20px;
`;

const Card = styled.div`
  width: 100%;
  max-width: 600px;
  background: var(--color-glass-bg);
  border: none;
  border-radius: 16px;
  padding: 48px;
  backdrop-filter: blur(12px);
  box-shadow: 0 0 15px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  align-items: center;
`;

const Title = styled.h1`
  font-size: 31px;
  font-weight: 700;
  color: var(--color-text-heading);
  margin: 32px 0;
  text-align: center;
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 300px;
`;

const Label = styled.label`
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-primary);
`;

const Input = styled.input`
  height: 48px;
  padding: 16px;
  background: var(--color-search-bg);
  border: 1px solid var(--color-search-border);
  border-radius: 4px;
  color: var(--color-text-primary);
  font-size: 15px;
  outline: none;
  transition: border-color 0.2s;
  width: 100%;
  box-sizing: border-box;

  &:focus {
    border-color: #1f1f1f;
  }
`;

const Button = styled.button`
  height: 40px;
  background: #1f1f1f;
  color: #fff;
  border: none;
  border-radius: 9999px;
  font-size: 15px;
  font-weight: bold;
  cursor: pointer;
  transition: opacity 0.2s;
  margin-top: 12px;
  width: 100%;

  &:hover {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const ProviderButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 40px;
  background: var(--color-canvas-subtle);
  color: var(--color-fg-default);
  border: 1px solid #cfd9de;
  border-radius: 9999px;
  font-size: 15px;
  font-weight: bold;
  cursor: pointer;
  transition: background-color 0.2s;
  width: 100%;

  &:hover {
    background: var(--color-canvas-default);
  }
`;

const Divider = styled.div`
  display: flex;
  align-items: center;
  text-align: center;
  margin: 24px 0;
  color: var(--color-text-muted);
  font-size: 15px;
  width: 100%;
  max-width: 300px;

  &::before,
  &::after {
    content: "";
    flex: 1;
    border-bottom: 1px solid var(--color-border);
  }

  &:not(:empty)::before {
    margin-right: 0.5em;
  }

  &:not(:empty)::after {
    margin-left: 0.5em;
  }
`;

const ErrorBanner = styled.div`
  background: rgba(248, 81, 73, 0.1);
  border: 1px solid rgba(248, 81, 73, 0.4);
  color: #f85149;
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 13px;
`;

const FooterText = styled.p`
  text-align: left;
  font-size: 15px;
  color: var(--color-text-muted);
  margin: 48px 0 0 0;
  width: 100%;
  max-width: 300px;

  a {
    color: #1f1f1f;
    text-decoration: none;
    font-weight: bold;

    &:hover {
      text-decoration: underline;
    }
  }
`;

export default function LoginPage() {
  const [email, setEmail] = useState(import.meta.env.DEV ? "dev@modelscript.org" : "");
  const [password, setPassword] = useState(import.meta.env.DEV ? "password" : "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (err: unknown) {
      if (err && typeof err === "object" && "response" in err) {
        const axiosErr = err as any;
        setError(axiosErr.response?.data?.error || "Login failed");
      } else {
        setError("Login failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageWrapper>
      <Card>
        <img src="/ms-logo.png" alt="ModelScript" width="40" height="40" />
        <Title>Sign in to ModelScript</Title>

        <div style={{ display: "flex", flexDirection: "column", gap: "12px", width: "100%", maxWidth: "300px" }}>
          <ProviderButton onClick={() => (window.location.href = "/api/v1/auth/login/github")}>
            <MarkGithubIcon size={16} />
            Sign up with GitHub
          </ProviderButton>
          <ProviderButton onClick={() => (window.location.href = "/api/v1/auth/login/gitlab")}>
            <GitLabIcon />
            Sign up with GitLab
          </ProviderButton>
          <ProviderButton onClick={() => (window.location.href = "/api/v1/auth/login/google")}>
            Continue with Google
          </ProviderButton>
        </div>

        <Divider>or</Divider>

        <Form onSubmit={handleSubmit}>
          {error && <ErrorBanner>{error}</ErrorBanner>}
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email address"
            required
            autoFocus
          />
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            required
          />
          <Button type="submit" disabled={loading}>
            {loading ? "Signing in…" : "Next"}
          </Button>
          <Button
            type="button"
            onClick={() => navigate("/forgot-password")}
            style={{ backgroundColor: "transparent", color: "#1f1f1f", border: "1px solid #cfd9de" }}
          >
            Forgot password?
          </Button>
        </Form>

        <FooterText>
          Don't have an account? <Link to="/signup">Sign up</Link>
        </FooterText>
      </Card>
    </PageWrapper>
  );
}

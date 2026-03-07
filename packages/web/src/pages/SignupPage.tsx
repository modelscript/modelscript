import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";

const PageWrapper = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: 40px 20px;
`;

const Card = styled.div`
  width: 100%;
  max-width: 420px;
  background: var(--color-glass-bg);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 40px 32px;
  backdrop-filter: blur(12px);
`;

const Title = styled.h1`
  font-size: 24px;
  font-weight: 600;
  color: var(--color-text-heading);
  margin: 0 0 8px 0;
  text-align: center;
`;

const Subtitle = styled.p`
  font-size: 14px;
  color: var(--color-text-muted);
  margin: 0 0 28px 0;
  text-align: center;
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 16px;
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
  height: 40px;
  padding: 0 12px;
  background: var(--color-search-bg);
  border: 1px solid var(--color-search-border);
  border-radius: 6px;
  color: var(--color-text-primary);
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;

  &:focus {
    border-color: var(--color-search-focus);
  }
`;

const Button = styled.button`
  height: 40px;
  background: var(--color-accent, #6366f1);
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
  margin-top: 4px;

  &:hover {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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
  text-align: center;
  font-size: 13px;
  color: var(--color-text-muted);
  margin: 20px 0 0 0;

  a {
    color: var(--color-accent, #6366f1);
    text-decoration: none;
    font-weight: 500;

    &:hover {
      text-decoration: underline;
    }
  }
`;

export default function SignupPage() {
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const axiosErr = err as any;
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
        <Title>Create account</Title>
        <Subtitle>Join the ModelScript Registry</Subtitle>
        <Form onSubmit={handleSubmit}>
          {error && <ErrorBanner>{error}</ErrorBanner>}
          <Label>
            Username
            <Input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="johndoe"
              required
              autoFocus
              minLength={3}
            />
          </Label>
          <Label>
            Email
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </Label>
          <Label>
            Password
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={8}
            />
          </Label>
          <Label>
            Confirm password
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </Label>
          <Button type="submit" disabled={loading}>
            {loading ? "Creating account…" : "Create account"}
          </Button>
        </Form>
        <FooterText>
          Already have an account? <Link to="/login">Sign in</Link>
        </FooterText>
      </Card>
    </PageWrapper>
  );
}

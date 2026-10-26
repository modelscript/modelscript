// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import { Link } from "react-router-dom";
import { Button, ErrorBanner, FooterText, Form, GhostButton, Input } from "../styles";

export interface LoginFormProps {
  email: string;
  setEmail: (val: string) => void;
  password: string;
  setPassword: (val: string) => void;
  error: string;
  loading: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onForgotPassword: () => void;
}

export const LoginForm: React.FC<LoginFormProps> = ({
  email,
  setEmail,
  password,
  setPassword,
  error,
  loading,
  onSubmit,
  onForgotPassword,
}) => {
  return (
    <>
      <Form onSubmit={onSubmit} aria-label="Sign in form">
        {error && (
          <ErrorBanner role="alert" aria-live="polite">
            {error}
          </ErrorBanner>
        )}
        <Input
          id="login-email"
          name="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email address"
          aria-label="Email address"
          autoComplete="email"
          required
          autoFocus
        />
        <Input
          id="login-password"
          name="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          aria-label="Password"
          autoComplete="current-password"
          required
        />
        <Button type="submit" disabled={loading}>
          {loading ? "Signing in…" : "Sign In"}
        </Button>
        <GhostButton type="button" onClick={onForgotPassword}>
          Forgot password?
        </GhostButton>
      </Form>

      <FooterText>
        Don't have an account? <Link to="/signup">Sign up</Link>
      </FooterText>
    </>
  );
};

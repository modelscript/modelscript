// SPDX-License-Identifier: AGPL-3.0-or-later

import { EyeClosedIcon, EyeIcon } from "@primer/octicons-react";
import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  Button,
  ErrorBanner,
  FieldGroup,
  FieldLabel,
  FooterText,
  Form,
  Input,
  PasswordInputWrapper,
  PasswordToggleButton,
} from "../styles";

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
  const [showPassword, setShowPassword] = useState(false);

  return (
    <>
      <Form onSubmit={onSubmit} aria-label="Sign in form">
        {error && (
          <ErrorBanner role="alert" aria-live="polite">
            {error}
          </ErrorBanner>
        )}
        <FieldGroup>
          <FieldLabel htmlFor="login-email">Email address</FieldLabel>
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
        </FieldGroup>
        <FieldGroup>
          <FieldLabel htmlFor="login-password">Password</FieldLabel>
          <PasswordInputWrapper>
            <Input
              id="login-password"
              name="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              aria-label="Password"
              autoComplete="current-password"
              required
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
        </FieldGroup>
        <button
          type="button"
          className="ms-btn ms-btn-quiet ms-btn-sm"
          onClick={onForgotPassword}
          style={{ alignSelf: "flex-end", marginTop: "-6px" }}
        >
          Forgot password?
        </button>
        <Button type="submit" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </Button>
      </Form>

      <FooterText>
        Don't have an account? <Link to="/signup">Sign up</Link>
      </FooterText>
    </>
  );
};

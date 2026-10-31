// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleIcon, XCircleIcon } from "@primer/octicons-react";
import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import styled, { keyframes } from "styled-components";
import { resendVerificationEmail, verifyEmail } from "../api";
import { useAuth } from "../AuthContext";
import { AnsatzMark } from "../components/AnsatzLogo";
import { useInstanceBranding } from "../InstanceBrandingContext";
import { usePageTitle } from "../util/title";
import {
  Button,
  Card,
  ErrorBanner,
  FieldGroup,
  FieldLabel,
  FooterText,
  Input,
  LogoBadge,
  PageWrapper,
  Subtitle,
  Title,
} from "./login/styles";

const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

const Spinner = styled.div`
  width: 40px;
  height: 40px;
  border: 3px solid rgba(6, 182, 212, 0.2);
  border-top-color: var(--color-accent-cyan, #06b6d4);
  border-radius: 50%;
  animation: ${spin} 0.8s linear infinite;
  margin: 20px 0;
`;

const SuccessBadge = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(34, 197, 94, 0.12);
  border: 1px solid rgba(34, 197, 94, 0.3);
  color: #22c55e;
  padding: 8px 16px;
  border-radius: 9999px;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 20px;
`;

export default function VerifyEmailPage() {
  usePageTitle("Verify Email");
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const navigate = useNavigate();
  const { refreshWallet } = useAuth();
  const branding = useInstanceBranding();
  const brandName = branding.instanceName || "Ansatz";

  const [status, setStatus] = useState<"loading" | "success" | "error">(token ? "loading" : "error");
  const [message, setMessage] = useState<string>(token ? "" : "No verification token provided in URL.");
  const [creditsGranted, setCreditsGranted] = useState<number>(0);

  // Resend state
  const [resendEmail, setResendEmail] = useState("");
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState("");
  const [resendError, setResendError] = useState("");

  useEffect(() => {
    if (!token) return;

    let isMounted = true;
    verifyEmail(token)
      .then((res) => {
        if (!isMounted) return;
        setStatus("success");
        setMessage(res.message || "Email address verified successfully!");
        setCreditsGranted(res.creditsGranted || 50.0);
        window.dispatchEvent(new CustomEvent("modelscript:wallet-update"));
        void refreshWallet();
      })
      .catch((err) => {
        if (!isMounted) return;
        setStatus("error");
        const errMsg =
          err?.response?.data?.error ||
          "Verification token is invalid, expired, or has already been used. Please request a new link.";
        setMessage(errMsg);
      });

    return () => {
      isMounted = false;
    };
  }, [token, refreshWallet]);

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resendEmail) return;
    setResendLoading(true);
    setResendMessage("");
    setResendError("");
    try {
      const res = await resendVerificationEmail(resendEmail);
      setResendMessage(res.message || "A fresh verification link has been sent to your email.");
    } catch (err: any) {
      setResendError(err?.response?.data?.error || "Failed to resend verification email.");
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <PageWrapper>
      <Card style={{ maxWidth: "480px", textAlign: "center" }}>
        <LogoBadge style={{ width: "56px", height: "56px", marginBottom: "20px" }}>
          <AnsatzMark
            size={38}
            logoUrl={branding.brandLogoUrl}
            alt={brandName}
            accentColor={branding.brandAccentColor}
          />
        </LogoBadge>

        {status === "loading" && (
          <>
            <Title style={{ fontSize: "22px", marginBottom: "10px" }}>Verifying Your Email…</Title>
            <Subtitle style={{ fontSize: "14px", lineHeight: 1.5 }}>
              Please wait while we validate your security token and activate compute credits.
            </Subtitle>
            <Spinner />
          </>
        )}

        {status === "success" && (
          <>
            <div style={{ color: "#22c55e", marginBottom: "16px" }}>
              <CheckCircleIcon size={48} />
            </div>
            <Title style={{ fontSize: "22px", marginBottom: "10px" }}>Email Verified!</Title>
            <SuccessBadge>
              +{creditsGranted > 0 ? creditsGranted.toFixed(1) : "50.0"} Free Compute Credits Unlocked
            </SuccessBadge>
            <Subtitle style={{ fontSize: "14px", lineHeight: 1.5 }}>
              {message} Your account is fully active. You can now publish packages, submit HPC simulation jobs, and
              access cloud engineering workflows.
            </Subtitle>
            <Button onClick={() => navigate("/")}>Continue to Workspace</Button>
          </>
        )}

        {status === "error" && (
          <>
            <div style={{ color: "var(--ms-danger)", marginBottom: "16px" }}>
              <XCircleIcon size={48} />
            </div>
            <Title style={{ fontSize: "22px", marginBottom: "10px" }}>Verification Failed</Title>
            <ErrorBanner style={{ marginBottom: "20px", justifyContent: "center" }}>{message}</ErrorBanner>
            <Subtitle style={{ fontSize: "14px", lineHeight: 1.5 }}>
              Need a fresh link? Enter your account email below to resend your verification token:
            </Subtitle>
            <form onSubmit={handleResend} style={{ width: "100%", marginBottom: "16px" }}>
              <FieldGroup style={{ marginBottom: "12px" }}>
                <FieldLabel htmlFor="verify-resend-email">Account email address</FieldLabel>
                <Input
                  id="verify-resend-email"
                  type="email"
                  placeholder="your.email@organization.com"
                  aria-label="Account email address"
                  value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </FieldGroup>
              <Button type="submit" disabled={resendLoading}>
                {resendLoading ? "Sending…" : "Resend Verification Link"}
              </Button>
              {resendError && (
                <ErrorBanner role="alert" style={{ marginTop: "12px", marginBottom: 0 }}>
                  {resendError}
                </ErrorBanner>
              )}
              {resendMessage && (
                <p style={{ fontSize: "13px", color: "var(--color-accent-cyan)", marginTop: "12px" }}>
                  {resendMessage}
                </p>
              )}
            </form>
            <FooterText style={{ marginTop: "8px", fontSize: "13px" }}>
              Already verified? <Link to="/login">Sign in here</Link>
            </FooterText>
          </>
        )}
      </Card>
    </PageWrapper>
  );
}

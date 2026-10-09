// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleIcon, XCircleIcon } from "@primer/octicons-react";
import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import styled, { keyframes } from "styled-components";
import { resendVerificationEmail, verifyEmail } from "../api";
import { useAuth } from "../AuthContext";
import { usePageTitle } from "../util/title";

const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

const PageWrapper = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: calc(100vh - 60px);
  padding: 40px 16px;
`;

const Card = styled.div`
  width: 100%;
  max-width: 480px;
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
  text-align: center;
  box-sizing: border-box;
`;

const LogoBadge = styled.div`
  width: 56px;
  height: 56px;
  border-radius: var(--radius-lg, 14px);
  background: var(--surface-hud, rgba(14, 20, 36, 0.65));
  border: 1px solid var(--color-border-glass, rgba(255, 255, 255, 0.15));
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 24px rgba(6, 182, 212, 0.22);
  margin-bottom: 20px;
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

const Title = styled.h1`
  font-size: 22px;
  font-weight: 800;
  color: var(--color-text-heading);
  margin: 0 0 10px 0;
  letter-spacing: -0.02em;
`;

const Description = styled.p`
  font-size: 14px;
  color: var(--color-text-muted);
  margin: 0 0 24px 0;
  line-height: 1.5;
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

const ErrorBanner = styled.div`
  background: var(--status-unstable-bg, rgba(248, 81, 73, 0.1));
  border: 1px solid var(--status-unstable-border, rgba(248, 81, 73, 0.4));
  color: var(--status-unstable-fg, #f85149);
  padding: 12px 16px;
  border-radius: var(--radius-md, 8px);
  font-size: 13px;
  line-height: 1.4;
  margin-bottom: 20px;
  width: 100%;
  box-sizing: border-box;
`;

const ActionButton = styled.button`
  height: 44px;
  background: var(--gradient-cta);
  color: #ffffff;
  border: none;
  border-radius: 9999px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s ease;
  box-shadow: 0 4px 14px rgba(6, 182, 212, 0.35);
  width: 100%;

  &:hover {
    opacity: 0.95;
    transform: translateY(-1px);
    box-shadow: 0 6px 18px rgba(6, 182, 212, 0.45);
  }
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
  width: 100%;
  box-sizing: border-box;
  margin-bottom: 12px;

  &:focus {
    border-color: var(--color-accent-cyan, #06b6d4);
  }
`;

export default function VerifyEmailPage() {
  usePageTitle("Verify Email");
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const navigate = useNavigate();
  const { refreshWallet } = useAuth();

  const [status, setStatus] = useState<"loading" | "success" | "error">(token ? "loading" : "error");
  const [message, setMessage] = useState<string>(token ? "" : "No verification token provided in URL.");
  const [creditsGranted, setCreditsGranted] = useState<number>(0);

  // Resend state
  const [resendEmail, setResendEmail] = useState("");
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState("");

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
    try {
      const res = await resendVerificationEmail(resendEmail);
      setResendMessage(res.message || "A fresh verification link has been sent to your email.");
    } catch (err: any) {
      setResendMessage(err?.response?.data?.error || "Failed to resend verification email.");
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <PageWrapper>
      <Card>
        <LogoBadge>
          <img src="/ms-logo.png" alt="ModelScript" width="34" height="34" />
        </LogoBadge>

        {status === "loading" && (
          <>
            <Title>Verifying Your Email…</Title>
            <Description>Please wait while we validate your security token and activate compute credits.</Description>
            <Spinner />
          </>
        )}

        {status === "success" && (
          <>
            <div style={{ color: "#22c55e", marginBottom: "16px" }}>
              <CheckCircleIcon size={48} />
            </div>
            <Title>Email Verified!</Title>
            <SuccessBadge>
              +{creditsGranted > 0 ? creditsGranted.toFixed(1) : "50.0"} Free Compute Credits Unlocked
            </SuccessBadge>
            <Description>
              {message} Your account is fully active. You can now publish packages, submit HPC simulation jobs, and
              access cloud engineering workflows.
            </Description>
            <ActionButton onClick={() => navigate("/home")}>Go to Dashboard</ActionButton>
          </>
        )}

        {status === "error" && (
          <>
            <div style={{ color: "#f85149", marginBottom: "16px" }}>
              <XCircleIcon size={48} />
            </div>
            <Title>Verification Failed</Title>
            <ErrorBanner>{message}</ErrorBanner>
            <Description>
              Need a fresh link? Enter your account email below to resend your verification token:
            </Description>
            <form onSubmit={handleResend} style={{ width: "100%", marginBottom: "16px" }}>
              <Input
                type="email"
                placeholder="your.email@organization.com"
                value={resendEmail}
                onChange={(e) => setResendEmail(e.target.value)}
                required
              />
              <ActionButton type="submit" disabled={resendLoading}>
                {resendLoading ? "Sending…" : "Resend Verification Link"}
              </ActionButton>
              {resendMessage && (
                <p style={{ fontSize: "13px", color: "var(--color-accent-cyan)", marginTop: "12px" }}>
                  {resendMessage}
                </p>
              )}
            </form>
            <p style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
              Already verified?{" "}
              <Link to="/login" style={{ color: "var(--color-accent-cyan)" }}>
                Sign in here
              </Link>
            </p>
          </>
        )}
      </Card>
    </PageWrapper>
  );
}

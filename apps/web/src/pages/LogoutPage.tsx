// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArrowRightIcon,
  CheckCircleFillIcon,
  LockIcon,
  MoonIcon,
  PersonAddIcon,
  RepoIcon,
  SignInIcon,
  SunIcon,
  TelescopeIcon,
} from "@primer/octicons-react";
import React, { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import styled, { keyframes } from "styled-components";
import { useAuth } from "../AuthContext";
import { AnsatzMark } from "../components/AnsatzLogo";
import { useFeatureFlag } from "../FeatureFlagContext";
import { useInstanceBranding } from "../InstanceBrandingContext";
import { useTheme } from "../theme";
import { usePageTitle } from "../util/title";

const cardEnter = keyframes`
  from {
    opacity: 0;
    transform: translateY(14px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
`;

const haloPulse = keyframes`
  0%, 100% {
    transform: scale(1);
    opacity: 0.55;
  }
  50% {
    transform: scale(1.12);
    opacity: 0.85;
  }
`;

const checkPop = keyframes`
  0% {
    transform: scale(0.6);
    opacity: 0;
  }
  70% {
    transform: scale(1.08);
    opacity: 1;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
`;

const PageShell = styled.div`
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  position: relative;
  overflow: hidden;
  padding: 20px 24px 28px;
  box-sizing: border-box;

  &::before {
    content: "";
    position: absolute;
    top: -120px;
    left: 50%;
    transform: translateX(-50%);
    width: min(860px, 95vw);
    height: 420px;
    background: radial-gradient(
      ellipse at center,
      color-mix(in srgb, var(--ms-accent-teal, #14b8a6) 16%, transparent) 0%,
      color-mix(in srgb, var(--ms-accent-cyan, #06b6d4) 10%, transparent) 42%,
      transparent 74%
    );
    pointer-events: none;
    z-index: 0;
  }
`;

const TopBar = styled.header`
  position: relative;
  z-index: 2;
  max-width: 1120px;
  width: 100%;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
`;

const BrandLink = styled(Link)`
  display: inline-flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: var(--color-text-heading);
  font-weight: 800;
  font-size: 16px;
  letter-spacing: -0.02em;
  transition: opacity 0.15s ease;

  &:hover {
    opacity: 0.9;
  }
`;

const BrandMeta = styled.div`
  display: flex;
  flex-direction: column;
  line-height: 1.15;

  .brand-title {
    font-size: 15px;
    font-weight: 800;
    color: var(--color-text-heading);
  }

  .brand-sub {
    font-size: 11px;
    font-weight: 500;
    color: var(--color-text-muted);
  }
`;

const TopBarActions = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const ThemeToggleBtn = styled.button`
  width: 36px;
  height: 36px;
  border-radius: 999px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-card);
  color: var(--color-text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    color 0.15s ease,
    border-color 0.15s ease,
    background 0.15s ease,
    transform 0.15s ease;

  &:hover {
    color: var(--color-text-heading);
    border-color: var(--ms-brand);
    transform: translateY(-1px);
  }
`;

const MainStage = styled.main`
  position: relative;
  z-index: 2;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px 0;
`;

const ConfirmationCard = styled.section`
  position: relative;
  width: 100%;
  max-width: 440px;
  background: var(--surface-overlay);
  border: 1px solid var(--color-border-glass);
  border-radius: 20px;
  padding: 32px 28px 28px;
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  box-shadow:
    0 24px 60px -16px rgba(0, 0, 0, 0.38),
    var(--glow-card);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  box-sizing: border-box;
  overflow: hidden;
  animation: ${cardEnter} 0.35s cubic-bezier(0.16, 1, 0.3, 1) both;

  &::before {
    content: "";
    position: absolute;
    top: 0;
    left: 15%;
    right: 15%;
    height: 2px;
    background: linear-gradient(
      90deg,
      transparent 0%,
      var(--ms-accent-teal, #14b8a6) 25%,
      var(--ms-accent-cyan, #06b6d4) 50%,
      var(--ms-accent-indigo, #6366f1) 75%,
      transparent 100%
    );
    opacity: 0.85;
  }

  @media (max-width: 540px) {
    padding: 24px 20px 22px;
    border-radius: 16px;
  }
`;

const EmblemContainer = styled.div`
  position: relative;
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  margin-bottom: 16px;
`;

const EmblemHalo = styled.div`
  position: absolute;
  inset: -4px;
  border-radius: 20px;
  background: radial-gradient(
    circle,
    color-mix(in srgb, var(--ms-success, #10b981) 22%, transparent) 0%,
    color-mix(in srgb, var(--ms-brand, #0891b2) 10%, transparent) 60%,
    transparent 100%
  );
  animation: ${haloPulse} 3.2s ease-in-out infinite;
`;

const EmblemTile = styled.div`
  position: relative;
  width: 50px;
  height: 50px;
  border-radius: 15px;
  display: grid;
  place-items: center;
  color: var(--ms-success, #10b981);
  background: linear-gradient(
    145deg,
    color-mix(in srgb, var(--ms-success, #10b981) 16%, var(--color-bg-card)),
    color-mix(in srgb, var(--ms-brand, #0891b2) 12%, var(--color-bg-card))
  );
  border: 1px solid color-mix(in srgb, var(--ms-success, #10b981) 36%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.14),
    0 10px 24px -8px color-mix(in srgb, var(--ms-success, #10b981) 30%, transparent);
  animation: ${checkPop} 0.42s cubic-bezier(0.16, 1, 0.3, 1) both;
`;

const Title = styled.h1`
  margin: 0 0 6px 0;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.025em;
  color: var(--color-text-heading);
  line-height: 1.25;
`;

const Subtitle = styled.p`
  margin: 0 0 20px 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--color-text-muted);
  max-width: 380px;
`;

const UserSessionChip = styled.div`
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  margin-bottom: 20px;
  border-radius: 14px;
  background: var(--color-canvas-subtle);
  border: 1px solid var(--color-border);
  box-sizing: border-box;
  text-align: left;
`;

const UserAvatar = styled.div<{ $url?: string | undefined }>`
  width: 36px;
  height: 36px;
  border-radius: 50%;
  flex-shrink: 0;
  background: ${(p) =>
    p.$url
      ? `url(${p.$url}) center/cover no-repeat`
      : "linear-gradient(135deg, var(--ms-brand), var(--ms-accent-indigo))"};
  color: #ffffff;
  font-weight: 700;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-border);
`;

const UserDetails = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;

  .user-name {
    font-size: 13px;
    font-weight: 700;
    color: var(--color-text-heading);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .user-handle {
    font-size: 11.5px;
    color: var(--color-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;

const SignedOutPill = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--color-text-muted);
  background: var(--ms-surface-hover);
  border: 1px solid var(--color-border);
  flex-shrink: 0;
`;

const ActionContainer = styled.div`
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const PrimaryExploreButton = styled(Link)`
  width: 100%;
  height: 44px;
  border-radius: 999px;
  background: var(--ms-brand);
  color: var(--ms-brand-contrast, #ffffff) !important;
  font-size: 14.5px;
  font-weight: 700;
  text-decoration: none !important;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  box-shadow: var(--ms-brand-shadow);
  border: 1px solid transparent;
  box-sizing: border-box;
  transition:
    background-color 0.18s ease,
    transform 0.18s ease,
    box-shadow 0.18s ease;

  &:hover {
    background: var(--ms-brand-hover);
    transform: translateY(-1px);
  }

  &:active {
    background: var(--ms-brand-active);
    transform: translateY(0);
  }
`;

const SecondaryActionsGrid = styled.div`
  width: 100%;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;

  @media (max-width: 440px) {
    grid-template-columns: 1fr;
  }
`;

const SecondaryActionLink = styled(Link)`
  height: 38px;
  border-radius: 999px;
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text-primary) !important;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none !important;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  transition:
    border-color 0.15s ease,
    color 0.15s ease,
    background-color 0.15s ease,
    transform 0.15s ease;

  &:hover {
    border-color: var(--ms-brand);
    color: var(--ms-brand) !important;
    background: var(--ms-surface-hover);
    transform: translateY(-1px);
  }
`;

const FooterBar = styled.footer`
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  flex-wrap: wrap;
  font-size: 12.5px;
  color: var(--color-text-muted);

  a {
    color: var(--color-text-muted);
    text-decoration: none;
    transition: color 0.15s ease;

    &:hover {
      color: var(--color-text-primary);
      text-decoration: underline;
    }
  }
`;

export const LogoutPage: React.FC = () => {
  usePageTitle("Signed Out");
  const navigate = useNavigate();
  const { user, logout, lastLoggedOutUser, clearJustLoggedOut } = useAuth();
  const branding = useInstanceBranding();
  const { theme, toggleTheme } = useTheme();
  const brandName = branding.instanceName || "Ansatz";
  const hasRepos = useFeatureFlag(["git_repositories", "repositories"]);

  // If a signed-in user navigates directly to /logout, sign them out immediately.
  useEffect(() => {
    if (user) {
      logout({ redirect: false });
    }
  }, [user, logout]);

  // Keyboard shortcut: press E to jump to Explore
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput =
        activeEl?.tagName === "INPUT" ||
        activeEl?.tagName === "TEXTAREA" ||
        (activeEl as HTMLElement)?.isContentEditable;
      if (isInput || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        clearJustLoggedOut();
        navigate("/explore");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate, clearJustLoggedOut]);

  const loginHref = lastLoggedOutUser?.email ? `/login?email=${encodeURIComponent(lastLoggedOutUser.email)}` : "/login";

  return (
    <PageShell data-testid="logout-confirmation-page">
      <TopBar>
        <BrandLink to="/explore" onClick={() => clearJustLoggedOut()}>
          <AnsatzMark
            size={34}
            logoUrl={branding.brandLogoUrl}
            alt={brandName}
            accentColor={branding.brandAccentColor}
          />
          <BrandMeta>
            <span className="brand-title">{brandName}</span>
            <span className="brand-sub">
              {branding.instanceTagline || "Federated Scientific & Engineering Network"}
            </span>
          </BrandMeta>
        </BrandLink>

        <TopBarActions>
          <ThemeToggleBtn
            type="button"
            onClick={toggleTheme}
            title={`Switch to ${theme === "dark" ? "Light" : "Dark"} Theme`}
            aria-label={`Switch to ${theme === "dark" ? "Light" : "Dark"} Theme`}
          >
            {theme === "dark" ? <SunIcon size={16} /> : <MoonIcon size={16} />}
          </ThemeToggleBtn>
          <Link to={loginHref} className="ms-btn ms-btn-secondary ms-btn-sm" onClick={() => clearJustLoggedOut()}>
            <SignInIcon size={14} />
            Sign in
          </Link>
        </TopBarActions>
      </TopBar>

      <MainStage>
        <ConfirmationCard role="status" aria-live="polite">
          <EmblemContainer aria-hidden="true">
            <EmblemHalo />
            <EmblemTile>
              <CheckCircleFillIcon size={26} />
            </EmblemTile>
          </EmblemContainer>

          <Title>You&apos;ve been signed out</Title>
          <Subtitle>
            Your {brandName} session has safely ended. Local credentials and private workspace caches have been cleared.
          </Subtitle>

          {lastLoggedOutUser && (
            <UserSessionChip data-testid="logout-user-chip">
              <div style={{ display: "flex", alignItems: "center", gap: "11px", minWidth: 0 }}>
                <UserAvatar $url={lastLoggedOutUser.avatar_url}>
                  {lastLoggedOutUser.avatar_url
                    ? null
                    : (lastLoggedOutUser.display_name || lastLoggedOutUser.username).charAt(0).toUpperCase()}
                </UserAvatar>
                <UserDetails>
                  <span className="user-name">
                    {lastLoggedOutUser.display_name || `@${lastLoggedOutUser.username}`}
                  </span>
                  <span className="user-handle">@{lastLoggedOutUser.username}</span>
                </UserDetails>
              </div>
              <SignedOutPill>
                <LockIcon size={11} />
                Signed out
              </SignedOutPill>
            </UserSessionChip>
          )}

          <ActionContainer>
            <PrimaryExploreButton
              to="/explore"
              data-testid="logout-explore-button"
              onClick={() => clearJustLoggedOut()}
            >
              <TelescopeIcon size={16} />
              <span>Continue to Explore</span>
              <ArrowRightIcon size={15} />
            </PrimaryExploreButton>

            <SecondaryActionsGrid>
              <SecondaryActionLink
                to={loginHref}
                data-testid="logout-signin-button"
                onClick={() => clearJustLoggedOut()}
              >
                <SignInIcon size={14} />
                <span>Sign back in</span>
              </SecondaryActionLink>
              <SecondaryActionLink to="/signup" data-testid="logout-signup-button" onClick={() => clearJustLoggedOut()}>
                <PersonAddIcon size={14} />
                <span>Create account</span>
              </SecondaryActionLink>
            </SecondaryActionsGrid>
          </ActionContainer>
        </ConfirmationCard>
      </MainStage>

      <FooterBar>
        <Link to="/explore" onClick={() => clearJustLoggedOut()}>
          Explore {brandName}
        </Link>
        {hasRepos && (
          <>
            <span>·</span>
            <Link to="/repos" onClick={() => clearJustLoggedOut()}>
              <RepoIcon size={12} style={{ marginRight: "4px", verticalAlign: "-1px" }} />
              Repositories
            </Link>
          </>
        )}
        <span>·</span>
        <Link to="/terms" onClick={() => clearJustLoggedOut()}>
          Terms
        </Link>
        <span>·</span>
        <Link to="/privacy" onClick={() => clearJustLoggedOut()}>
          Privacy
        </Link>
      </FooterBar>
    </PageShell>
  );
};

export default LogoutPage;

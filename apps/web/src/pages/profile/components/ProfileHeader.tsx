// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArrowLeftIcon,
  CalendarIcon,
  ChevronRightIcon,
  XIcon as CloseIcon,
  GlobeIcon,
  HistoryIcon,
  HubotIcon,
  InfoIcon,
  KebabHorizontalIcon,
  LinkExternalIcon,
  LinkIcon,
  LocationIcon,
  MuteIcon,
  NoEntryIcon,
  ReportIcon,
  RssIcon,
} from "@primer/octicons-react";
import { Button, Heading, Text } from "@primer/react";
import React from "react";
import { Link, useNavigate } from "react-router-dom";
import styled from "styled-components";
import { getUserAbout, type UserAboutData } from "../../../api";
import Box from "../../../components/Box";
import FederatedDomainPill from "../../../components/FederatedDomainPill";
import FollowButton from "../../../components/FollowButton";
import { CircleIconButton, StickyHeader } from "../../../components/SharedStyles";
import { useToast } from "../../../components/ToastContext";
import { useClickOutside } from "../../../hooks/useClickOutside";
import { getAvatarUrl, getBannerUrl } from "../../../util/avatar";
import { parseFederatedHandle } from "../../../util/federation";
import { safeCssImageUrl, sanitizeHttpUrl } from "../../../util/url";
import type { LinkedAccount, ProfileData } from "../types";

function formatMonthYear(isoDate?: string | null): string {
  if (!isoDate) return "";
  try {
    const d = new Date(isoDate);
    if (Number.isNaN(d.getTime())) return isoDate;
    return d.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
  } catch {
    return isoDate;
  }
}

const JoinedDateContainer = styled.div`
  position: relative;
  display: inline-flex;
  align-items: center;
`;

const JoinedDateLink = styled(Link)`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--color-fg-muted);
  text-decoration: none;
  font-size: 15px;
  line-height: 20px;
  cursor: pointer;
  transition: color 0.15s ease;

  &:hover {
    color: var(--color-fg-default);
    text-decoration: underline;

    .chevron {
      color: var(--color-fg-default);
    }
  }

  .chevron {
    color: var(--color-fg-muted);
    transition: color 0.15s ease;
  }
`;

const StatLink = styled(Link)`
  color: var(--color-fg-muted);
  text-decoration: none;
  font-size: 15px;
  line-height: 20px;

  &:hover {
    text-decoration: underline;
  }
`;

const StatCount = styled.span`
  color: var(--color-fg-default);
  font-weight: 700;
`;

const StatLabel = styled.span`
  color: var(--color-fg-muted);
`;

const AboutHoverCard = styled.div`
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 1000;
  width: 320px;
  max-width: calc(100vw - 32px);
  box-sizing: border-box;
  background-color: var(--color-canvas-overlay, var(--color-canvas-default, #ffffff));
  border: 1px solid var(--color-border-default, #d0d7de);
  border-radius: 16px;
  box-shadow: var(--color-shadow-large, 0 12px 28px 0 rgba(0, 0, 0, 0.2), 0 2px 4px 0 rgba(0, 0, 0, 0.1));
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  cursor: pointer;
  text-decoration: none;
  animation: fadeInAboutCard 0.15s ease-out;

  @keyframes fadeInAboutCard {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`;

const XIcon: React.FC = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

export interface ProfileHeaderProps {
  profile: ProfileData;
  isOwnProfile: boolean;
  isFollowing: boolean;
  isBlocked: boolean;
  isMuted: boolean;
  linkedAccounts: LinkedAccount[];
  showBlockMenu: boolean;
  setShowBlockMenu: (show: boolean) => void;
  onFollowToggle: (following: boolean) => void;
  onMuteToggle: () => void;
  onBlock: () => void;
  onOpenUnblockModal: () => void;
  onOpenReportModal: () => void;
  onEditProfile: () => void;
}

export const ProfileHeader: React.FC<ProfileHeaderProps> = ({
  profile,
  isOwnProfile,
  isFollowing,
  isBlocked,
  isMuted,
  linkedAccounts,
  showBlockMenu,
  setShowBlockMenu,
  onFollowToggle,
  onMuteToggle,
  onBlock,
  onOpenUnblockModal,
  onOpenReportModal,
  onEditProfile,
}) => {
  const parsed = parseFederatedHandle(profile.username);
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [confirmingBlock, setConfirmingBlock] = React.useState(false);
  const [showAvatarModal, setShowAvatarModal] = React.useState(false);
  const [showBannerModal, setShowBannerModal] = React.useState(false);
  const avatarBgImage = safeCssImageUrl(getAvatarUrl(profile.username, profile.avatar_url || undefined));
  const bannerBgImage = safeCssImageUrl(getBannerUrl(profile.username, profile.banner_url));

  const blockMenuContainerRef = React.useRef<HTMLDivElement>(null);

  const [aboutData, setAboutData] = React.useState<UserAboutData | null>(null);
  const [aboutLoading, setAboutLoading] = React.useState(false);
  const [showHoverCard, setShowHoverCard] = React.useState(false);
  const hideTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  React.useEffect(() => {
    setAboutData(null);
    setShowHoverCard(false);
  }, [profile.username]);

  React.useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);

  const fetchAbout = React.useCallback(async () => {
    if (aboutData || aboutLoading) return;
    setAboutLoading(true);
    try {
      const data = await getUserAbout(profile.username);
      setAboutData(data);
    } catch {
      // silently ignore
    } finally {
      setAboutLoading(false);
    }
  }, [profile.username, aboutData, aboutLoading]);

  const handleMouseEnterJoined = () => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    setShowHoverCard(true);
    void fetchAbout();
  };

  const handleMouseLeaveJoined = () => {
    hideTimeoutRef.current = setTimeout(() => {
      setShowHoverCard(false);
    }, 250);
  };

  useClickOutside(
    blockMenuContainerRef,
    () => {
      setConfirmingBlock(false);
      setShowBlockMenu(false);
    },
    showBlockMenu,
  );

  React.useEffect(() => {
    if (!showBlockMenu) {
      setConfirmingBlock(false);
    }
  }, [showBlockMenu]);

  React.useEffect(() => {
    if (!showAvatarModal && !showBannerModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowAvatarModal(false);
        setShowBannerModal(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showAvatarModal, showBannerModal]);

  return (
    <>
      <StickyHeader style={{ padding: "8px 16px", gap: "12px" }}>
        <CircleIconButton onClick={() => window.history.back()}>
          <ArrowLeftIcon size={20} />
        </CircleIconButton>
        <Box display="flex" flexDirection="column">
          <Heading
            as="h2"
            style={{
              fontSize: "20px",
              lineHeight: "24px",
              fontWeight: 700,
              margin: 0,
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            {profile.display_name || profile.username}
            {profile.account_type === "rss" && <RssIcon size={20} color="var(--color-fg-muted)" />}
            {profile.account_type === "bot" && <HubotIcon size={20} color="var(--color-fg-muted)" />}
            {profile.account_type === "remote" && <GlobeIcon size={20} color="var(--color-accent-cyan)" />}
          </Heading>
          <Text
            style={{
              fontSize: "13px",
              lineHeight: "16px",
              color: "var(--color-fg-muted, var(--color-text-muted, #536471))",
            }}
          >
            {Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
              profile.post_count || 0,
            )}{" "}
            posts
          </Text>
        </Box>
      </StickyHeader>

      <Box
        role="button"
        tabIndex={0}
        aria-label={`View ${profile.display_name || profile.username}'s header photo`}
        onClick={() => setShowBannerModal(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setShowBannerModal(true);
          }
        }}
        style={{
          position: "relative",
          zIndex: 0,
          height: "clamp(124px, 32vw, 200px)",
          backgroundColor: "var(--color-canvas-subtle)",
          backgroundImage: bannerBgImage || "none",
          backgroundSize: "cover",
          backgroundPosition: "center",
          cursor: "pointer",
          transition: "filter 0.15s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.filter = "brightness(0.92)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.filter = "none";
        }}
      />
      <Box px={4} style={{ marginTop: "clamp(-65px, -11vw, -44px)", position: "relative", zIndex: 1 }}>
        <Box
          display="flex"
          justifyContent="space-between"
          alignItems="flex-end"
          style={{ gap: "8px", flexWrap: "wrap" }}
        >
          <Box
            role="button"
            tabIndex={0}
            aria-label={`View ${profile.display_name || profile.username}'s profile photo`}
            onClick={() => setShowAvatarModal(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setShowAvatarModal(true);
              }
            }}
            style={{
              position: "relative",
              zIndex: 2,
              width: "clamp(88px, 24vw, 134px)",
              height: "clamp(88px, 24vw, 134px)",
              borderRadius: "50%",
              backgroundColor: "var(--color-accent-purple)",
              border: "4px solid var(--color-bg-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontSize: "clamp(32px, 8vw, 48px)",
              fontWeight: "bold",
              backgroundImage: avatarBgImage || "none",
              backgroundSize: "cover",
              backgroundPosition: "center",
              cursor: "pointer",
              transition: "filter 0.15s ease",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.filter = "brightness(0.9)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.filter = "none";
            }}
          >
            {!avatarBgImage && profile.username.charAt(0).toUpperCase()}
          </Box>
          <Box mb={2} display="flex" gap={2} alignItems="center">
            {isOwnProfile ? (
              <Button onClick={onEditProfile} style={{ borderRadius: "9999px", fontWeight: "bold" }}>
                Edit profile
              </Button>
            ) : (
              <>
                <Box ref={blockMenuContainerRef} position="relative">
                  <button
                    onClick={() => setShowBlockMenu(!showBlockMenu)}
                    style={{
                      width: "32px",
                      height: "32px",
                      borderRadius: "50%",
                      border: "1px solid var(--color-border-default)",
                      background: "none",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--color-fg-default)",
                      padding: 0,
                    }}
                  >
                    <KebabHorizontalIcon size={16} />
                  </button>
                  {showBlockMenu && (
                    <Box
                      position="absolute"
                      top="100%"
                      right="0"
                      mt={1}
                      style={{
                        backgroundColor: "var(--surface-overlay, rgba(14, 20, 36, 0.95))",
                        backdropFilter: "blur(16px)",
                        WebkitBackdropFilter: "blur(16px)",
                        border: "1px solid var(--color-border-glass, rgba(255, 255, 255, 0.12))",
                        borderRadius: "12px",
                        boxShadow: "0 10px 30px rgba(0, 0, 0, 0.5)",
                        padding: "8px 0",
                        zIndex: 100,
                        minWidth: "280px",
                      }}
                    >
                      <button
                        onClick={() => {
                          setShowBlockMenu(false);
                          navigate(`/@${profile.username}/about`);
                        }}
                        style={{
                          width: "100%",
                          padding: "12px 16px",
                          background: "none",
                          border: "none",
                          textAlign: "left",
                          cursor: "pointer",
                          fontSize: "15px",
                          lineHeight: "20px",
                          fontWeight: 700,
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          color: "var(--color-fg-default)",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-canvas-subtle)")}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                      >
                        <InfoIcon size={20} /> About this account
                      </button>
                      <button
                        onClick={() => {
                          navigator.clipboard?.writeText(window.location.href);
                          showToast("Profile link copied to clipboard", "success");
                          setShowBlockMenu(false);
                        }}
                        style={{
                          width: "100%",
                          padding: "12px 16px",
                          background: "none",
                          border: "none",
                          textAlign: "left",
                          cursor: "pointer",
                          fontSize: "15px",
                          lineHeight: "20px",
                          fontWeight: 700,
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          color: "var(--color-fg-default)",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-canvas-subtle)")}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                      >
                        <LinkIcon size={20} /> Copy link to profile
                      </button>
                      <button
                        onClick={onMuteToggle}
                        style={{
                          width: "100%",
                          padding: "12px 16px",
                          background: "none",
                          border: "none",
                          textAlign: "left",
                          cursor: "pointer",
                          fontSize: "15px",
                          lineHeight: "20px",
                          fontWeight: 700,
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          color: "var(--color-fg-default)",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-canvas-subtle)")}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                      >
                        <MuteIcon size={20} /> {isMuted ? "Unmute" : "Mute"} @{profile.username}
                      </button>
                      <button
                        onClick={() => {
                          if (isBlocked) {
                            onOpenUnblockModal();
                            setShowBlockMenu(false);
                            return;
                          }
                          if (!confirmingBlock) {
                            setConfirmingBlock(true);
                            return;
                          }
                          setConfirmingBlock(false);
                          onBlock();
                        }}
                        style={{
                          width: "100%",
                          padding: "12px 16px",
                          background: confirmingBlock ? "var(--color-danger-emphasis, #da3633)" : "none",
                          border: "none",
                          textAlign: "left",
                          cursor: "pointer",
                          fontSize: "15px",
                          lineHeight: "20px",
                          fontWeight: 700,
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          color: confirmingBlock
                            ? "#ffffff"
                            : isBlocked
                              ? "var(--color-fg-default)"
                              : "var(--color-danger-fg)",
                        }}
                        onMouseEnter={(e) => {
                          if (!confirmingBlock) {
                            e.currentTarget.style.backgroundColor = "var(--color-canvas-subtle)";
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!confirmingBlock) {
                            e.currentTarget.style.backgroundColor = "transparent";
                          }
                        }}
                      >
                        <NoEntryIcon size={20} />{" "}
                        {isBlocked
                          ? `Unblock @${profile.username}`
                          : confirmingBlock
                            ? `Confirm block @${profile.username}?`
                            : `Block @${profile.username}`}
                      </button>
                      <button
                        onClick={() => {
                          setShowBlockMenu(false);
                          onOpenReportModal();
                        }}
                        style={{
                          width: "100%",
                          padding: "12px 16px",
                          background: "none",
                          border: "none",
                          textAlign: "left",
                          cursor: "pointer",
                          fontSize: "15px",
                          lineHeight: "20px",
                          fontWeight: 700,
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          color: "var(--color-fg-default)",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-canvas-subtle)")}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                      >
                        <ReportIcon size={20} /> Report @{profile.username}
                      </button>
                    </Box>
                  )}
                </Box>
                {isBlocked ? (
                  <Button
                    variant="danger"
                    onClick={onOpenUnblockModal}
                    style={{ borderRadius: "9999px", fontWeight: "bold" }}
                  >
                    Blocked
                  </Button>
                ) : (
                  <FollowButton
                    username={profile.username}
                    initialIsFollowing={isFollowing}
                    isRssFeed={profile.account_type === "rss"}
                    onToggle={onFollowToggle}
                  />
                )}
              </>
            )}
          </Box>
        </Box>

        <Heading
          as="h1"
          style={{
            marginTop: "16px",
            marginBottom: "2px",
            fontSize: "20px",
            lineHeight: "24px",
            fontWeight: 800,
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          {profile.display_name || profile.username}
          {profile.account_type === "rss" && <RssIcon size={20} color="var(--color-fg-muted)" />}
          {profile.account_type === "bot" && <HubotIcon size={20} color="var(--color-fg-muted)" />}
          {profile.account_type === "remote" && <GlobeIcon size={20} color="var(--color-accent-cyan)" />}
          {linkedAccounts.some((acc) => acc.provider === "twitter") && (
            <span
              style={{
                fontSize: "13px",
                lineHeight: "16px",
                padding: "2px 8px",
                backgroundColor: "var(--color-neutral-muted, rgba(128, 128, 128, 0.2))",
                color: "var(--color-fg-default)",
                borderRadius: "12px",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                fontWeight: "normal",
              }}
            >
              <XIcon /> Verified
            </span>
          )}
        </Heading>

        <Box display="flex" alignItems="center" gap={1.5} flexWrap="wrap">
          <Text
            style={{
              fontSize: "15px",
              lineHeight: "20px",
              color: "var(--color-fg-muted, var(--color-text-muted, #536471))",
            }}
          >
            @{parsed.localUsername}
          </Text>
          {parsed.isFederated && parsed.remoteDomain && <FederatedDomainPill domain={parsed.remoteDomain} />}
        </Box>

        {profile.account_type === "remote" && (
          <Box mt={2} mb={1} display="flex" alignItems="center" gap={2} flexWrap="wrap">
            <span
              style={{
                fontSize: "13px",
                lineHeight: "16px",
                padding: "2px 8px",
                backgroundColor: "rgba(6, 182, 212, 0.1)",
                color: "var(--color-accent-cyan)",
                border: "1px solid rgba(6, 182, 212, 0.3)",
                borderRadius: "12px",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                fontWeight: 600,
              }}
            >
              <GlobeIcon size={13} /> ActivityPub Federated Actor
            </span>
            {sanitizeHttpUrl(profile.actor_url, { allowRelative: false }) && (
              <a
                href={sanitizeHttpUrl(profile.actor_url, { allowRelative: false })}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: "13px",
                  lineHeight: "16px",
                  color: "var(--color-text-muted)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  textDecoration: "none",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
              >
                <LinkExternalIcon size={12} /> Canonical Actor URL
              </a>
            )}
          </Box>
        )}

        {profile.account_type === "bot" && profile.owner_username && (
          <Box mt={1} mb={2}>
            <Text color="var(--color-fg-muted)" style={{ fontSize: "15px", lineHeight: "20px" }}>
              <HubotIcon size={14} style={{ marginRight: "4px" }} />
              Managed by <Link to={`/@${profile.owner_username}`}>@{profile.owner_username}</Link>
            </Text>
          </Box>
        )}

        {profile.bio && (
          <Box mt={3}>
            <Text style={{ fontSize: "15px", lineHeight: "20px", display: "block" }}>{profile.bio}</Text>
          </Box>
        )}

        <Box mt={3} display="flex" gap={3} flexWrap="wrap">
          {profile.location && (
            <Box display="flex" alignItems="center" gap={1} color="var(--color-fg-muted)">
              <LocationIcon size={16} />{" "}
              <Text style={{ fontSize: "15px", lineHeight: "20px" }}>{profile.location}</Text>
            </Box>
          )}
          {sanitizeHttpUrl(profile.website, { allowRelative: false, prependHttpsIfMissingScheme: true }) && (
            <Box display="flex" alignItems="center" gap={1} color="var(--color-fg-muted)">
              <LinkIcon size={16} />{" "}
              <a
                href={sanitizeHttpUrl(profile.website, { allowRelative: false, prependHttpsIfMissingScheme: true })}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: "var(--color-accent-emphasis)",
                  textDecoration: "none",
                  fontSize: "15px",
                  lineHeight: "20px",
                }}
              >
                {profile.website}
              </a>
            </Box>
          )}
          {profile.account_type !== "rss" && (
            <JoinedDateContainer onMouseEnter={handleMouseEnterJoined} onMouseLeave={handleMouseLeaveJoined}>
              <JoinedDateLink to={`/@${profile.username}/about`} title="About this account">
                <CalendarIcon size={16} />
                <span>Joined {formatMonthYear(profile.created_at)}</span>
                <ChevronRightIcon size={14} className="chevron" />
              </JoinedDateLink>

              {showHoverCard && (
                <AboutHoverCard
                  onMouseEnter={handleMouseEnterJoined}
                  onMouseLeave={handleMouseLeaveJoined}
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/@${profile.username}/about`);
                  }}
                >
                  <Text
                    style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-fg-default)", lineHeight: "20px" }}
                  >
                    About this account
                  </Text>
                  <Box display="flex" flexDirection="column" gap={3}>
                    <Box display="flex" alignItems="center" gap={3}>
                      <Box
                        style={{
                          color: "var(--color-fg-default)",
                          display: "flex",
                          alignItems: "center",
                          width: "20px",
                        }}
                      >
                        <CalendarIcon size={18} />
                      </Box>
                      <Text style={{ fontSize: "14px", color: "var(--color-fg-default)", lineHeight: "18px" }}>
                        Joined {formatMonthYear(profile.created_at)}
                      </Text>
                    </Box>

                    {Boolean(
                      aboutData?.basedIn?.countryName && aboutData.basedIn.countryName !== "Not yet established",
                    ) && (
                      <Box display="flex" alignItems="center" gap={3} justifyContent="space-between">
                        <Box display="flex" alignItems="center" gap={3}>
                          <Box
                            style={{
                              color: "var(--color-fg-default)",
                              display: "flex",
                              alignItems: "center",
                              width: "20px",
                            }}
                          >
                            <LocationIcon size={18} />
                          </Box>
                          <Text style={{ fontSize: "14px", color: "var(--color-fg-default)", lineHeight: "18px" }}>
                            Account based in {aboutData?.basedIn?.countryName}
                          </Text>
                        </Box>
                        <InfoIcon size={16} color="var(--color-fg-muted)" />
                      </Box>
                    )}

                    {parsed.isFederated && parsed.remoteDomain && (
                      <Box display="flex" alignItems="center" gap={3}>
                        <Box
                          style={{
                            color: "var(--color-fg-default)",
                            display: "flex",
                            alignItems: "center",
                            width: "20px",
                          }}
                        >
                          <GlobeIcon size={18} />
                        </Box>
                        <Text style={{ fontSize: "14px", color: "var(--color-fg-default)", lineHeight: "18px" }}>
                          Federated via {parsed.remoteDomain}
                        </Text>
                      </Box>
                    )}

                    {(aboutData?.usernameChanges?.count ?? 0) > 0 && (
                      <Box display="flex" alignItems="center" gap={3}>
                        <Box
                          style={{
                            color: "var(--color-fg-default)",
                            display: "flex",
                            alignItems: "center",
                            width: "20px",
                          }}
                        >
                          <HistoryIcon size={18} />
                        </Box>
                        <Text style={{ fontSize: "14px", color: "var(--color-fg-default)", lineHeight: "18px" }}>
                          {`${aboutData?.usernameChanges?.count} former username${aboutData?.usernameChanges?.count === 1 ? "" : "s"}`}
                        </Text>
                      </Box>
                    )}
                  </Box>
                </AboutHoverCard>
              )}
            </JoinedDateContainer>
          )}
        </Box>

        {profile.account_type !== "rss" && (
          <Box mt={3} display="flex" gap={4}>
            <StatLink to={`/@${profile.username}/following`}>
              <StatCount>{profile.following_count}</StatCount> <StatLabel>Following</StatLabel>
            </StatLink>
            <StatLink to={`/@${profile.username}/followers`}>
              <StatCount>{profile.follower_count}</StatCount> <StatLabel>Followers</StatLabel>
            </StatLink>
          </Box>
        )}
      </Box>

      {showAvatarModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${profile.display_name || profile.username}'s profile photo`}
          onClick={() => setShowAvatarModal(false)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 1000,
            backgroundColor: "rgba(0, 0, 0, 0.9)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
        >
          <CircleIconButton
            aria-label="Close"
            onClick={(e) => {
              e.stopPropagation();
              setShowAvatarModal(false);
            }}
            style={{
              position: "fixed",
              top: "16px",
              left: "16px",
              width: "40px",
              height: "40px",
              backgroundColor: "rgba(0, 0, 0, 0.65)",
              color: "#ffffff",
            }}
          >
            <CloseIcon size={20} />
          </CircleIconButton>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(368px, 85vw)",
              height: "min(368px, 85vw)",
              borderRadius: "50%",
              backgroundColor: "var(--color-accent-purple)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontSize: "120px",
              fontWeight: "bold",
              backgroundImage: avatarBgImage || "none",
              backgroundSize: "cover",
              backgroundPosition: "center",
              boxShadow: "0 20px 60px rgba(0, 0, 0, 0.6)",
              overflow: "hidden",
            }}
          >
            {!avatarBgImage && profile.username.charAt(0).toUpperCase()}
          </div>
        </div>
      )}

      {showBannerModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${profile.display_name || profile.username}'s header photo`}
          onClick={() => setShowBannerModal(false)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 1000,
            backgroundColor: "rgba(0, 0, 0, 0.9)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
        >
          <CircleIconButton
            aria-label="Close"
            onClick={(e) => {
              e.stopPropagation();
              setShowBannerModal(false);
            }}
            style={{
              position: "fixed",
              top: "16px",
              left: "16px",
              width: "40px",
              height: "40px",
              backgroundColor: "rgba(0, 0, 0, 0.65)",
              color: "#ffffff",
            }}
          >
            <CloseIcon size={20} />
          </CircleIconButton>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(1200px, 95vw)",
              maxHeight: "85vh",
              aspectRatio: "3 / 1",
              backgroundColor: "var(--color-canvas-subtle)",
              backgroundImage: bannerBgImage || "none",
              backgroundSize: "cover",
              backgroundPosition: "center",
              borderRadius: "16px",
              boxShadow: "0 20px 60px rgba(0, 0, 0, 0.6)",
              overflow: "hidden",
            }}
          />
        </div>
      )}
    </>
  );
};

// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArrowLeftIcon,
  CalendarIcon,
  GlobeIcon,
  HubotIcon,
  InfoIcon,
  KebabHorizontalIcon,
  LinkExternalIcon,
  LinkIcon,
  ListUnorderedIcon,
  LocationIcon,
  MuteIcon,
  NoEntryIcon,
  ReportIcon,
  RssIcon,
} from "@primer/octicons-react";
import { Button, Heading, Text } from "@primer/react";
import React from "react";
import { Link } from "react-router-dom";
import Box from "../../../components/Box";
import FederatedDomainPill from "../../../components/FederatedDomainPill";
import FollowButton from "../../../components/FollowButton";
import { CircleIconButton, StickyHeader } from "../../../components/SharedStyles";
import { parseFederatedHandle } from "../../../util/federation";
import type { LinkedAccount, ProfileData } from "../types";

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

  return (
    <>
      <StickyHeader style={{ padding: "8px 16px", gap: "12px" }}>
        <CircleIconButton onClick={() => window.history.back()}>
          <ArrowLeftIcon size={20} />
        </CircleIconButton>
        <Box display="flex" flexDirection="column">
          <Heading
            as="h2"
            style={{ fontSize: "20px", margin: 0, lineHeight: 1.2, display: "flex", alignItems: "center", gap: "6px" }}
          >
            {profile.display_name || profile.username}
            {profile.account_type === "rss" && <RssIcon size={20} color="var(--color-fg-muted)" />}
            {profile.account_type === "bot" && <HubotIcon size={20} color="var(--color-fg-muted)" />}
            {profile.account_type === "remote" && <GlobeIcon size={20} color="var(--color-accent-cyan)" />}
          </Heading>
          <Text color="var(--color-fg-muted)" style={{ fontSize: "13px" }}>
            {Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
              profile.post_count || 0,
            )}{" "}
            posts
          </Text>
        </Box>
      </StickyHeader>

      <Box
        style={{
          height: "200px",
          backgroundColor: "var(--color-canvas-subtle)",
          backgroundImage: safeCssImageUrl(profile.banner_url) || "none",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
      <Box px={4} style={{ marginTop: "-65px" }}>
        <Box display="flex" justifyContent="space-between" alignItems="flex-end">
          <Box
            style={{
              width: "134px",
              height: "134px",
              borderRadius: "50%",
              backgroundColor: "var(--color-accent-purple)",
              border: "4px solid var(--color-bg-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontSize: "48px",
              fontWeight: "bold",
              backgroundImage: safeCssImageUrl(profile.avatar_url) || "none",
              backgroundSize: "cover",
            }}
          >
            {!safeCssImageUrl(profile.avatar_url) && profile.username.charAt(0).toUpperCase()}
          </Box>
          <Box mb={2} display="flex" gap={2} alignItems="center">
            {isOwnProfile ? (
              <Button onClick={onEditProfile} style={{ borderRadius: "9999px", fontWeight: "bold" }}>
                Edit profile
              </Button>
            ) : (
              <>
                <Box position="relative">
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
                    <>
                      <div
                        style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }}
                        onClick={() => setShowBlockMenu(false)}
                      />
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
                          style={{
                            width: "100%",
                            padding: "12px 16px",
                            background: "none",
                            border: "none",
                            textAlign: "left",
                            cursor: "pointer",
                            fontWeight: "bold",
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
                          style={{
                            width: "100%",
                            padding: "12px 16px",
                            background: "none",
                            border: "none",
                            textAlign: "left",
                            cursor: "pointer",
                            fontWeight: "bold",
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                            color: "var(--color-fg-default)",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-canvas-subtle)")}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                        >
                          <ListUnorderedIcon size={20} /> Add/remove from Lists
                        </button>
                        <button
                          style={{
                            width: "100%",
                            padding: "12px 16px",
                            background: "none",
                            border: "none",
                            textAlign: "left",
                            cursor: "pointer",
                            fontWeight: "bold",
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                            color: "var(--color-fg-default)",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-canvas-subtle)")}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                        >
                          <ListUnorderedIcon size={20} /> View Lists
                        </button>
                        <button
                          style={{
                            width: "100%",
                            padding: "12px 16px",
                            background: "none",
                            border: "none",
                            textAlign: "left",
                            cursor: "pointer",
                            fontWeight: "bold",
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
                            fontWeight: "bold",
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
                          onClick={onBlock}
                          style={{
                            width: "100%",
                            padding: "12px 16px",
                            background: "none",
                            border: "none",
                            textAlign: "left",
                            cursor: "pointer",
                            fontWeight: "bold",
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                            color: "var(--color-fg-default)",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-canvas-subtle)")}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                        >
                          <NoEntryIcon size={20} /> Block @{profile.username}
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
                            fontWeight: "bold",
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
                    </>
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
            fontSize: "24px",
            fontWeight: 800,
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          {profile.display_name || profile.username}
          {profile.account_type === "rss" && <RssIcon size={24} color="var(--color-fg-muted)" />}
          {profile.account_type === "bot" && <HubotIcon size={24} color="var(--color-fg-muted)" />}
          {profile.account_type === "remote" && <GlobeIcon size={24} color="var(--color-accent-cyan)" />}
          {linkedAccounts.some((acc) => acc.provider === "twitter") && (
            <span
              style={{
                fontSize: "12px",
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
          <Text color="var(--color-fg-muted)">@{parsed.localUsername}</Text>
          {parsed.isFederated && parsed.remoteDomain && <FederatedDomainPill domain={parsed.remoteDomain} />}
        </Box>

        {profile.account_type === "remote" && (
          <Box mt={2} mb={1} display="flex" alignItems="center" gap={2} flexWrap="wrap">
            <span
              style={{
                fontSize: "12px",
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
                  fontSize: "12px",
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
            <Text color="var(--color-fg-muted)" fontSize="14px">
              <HubotIcon size={14} style={{ marginRight: "4px" }} />
              Managed by <Link to={`/${profile.owner_username}`}>@{profile.owner_username}</Link>
            </Text>
          </Box>
        )}

        {profile.bio && (
          <Box mt={3}>
            <Text>{profile.bio}</Text>
          </Box>
        )}

        <Box mt={3} display="flex" gap={3} flexWrap="wrap">
          {profile.location && (
            <Box display="flex" alignItems="center" gap={1} color="var(--color-fg-muted)">
              <LocationIcon size={16} /> <Text style={{ fontSize: "14px" }}>{profile.location}</Text>
            </Box>
          )}
          {sanitizeHttpUrl(profile.website, { allowRelative: false, prependHttpsIfMissingScheme: true }) && (
            <Box display="flex" alignItems="center" gap={1} color="var(--color-fg-muted)">
              <LinkIcon size={16} />{" "}
              <a
                href={sanitizeHttpUrl(profile.website, { allowRelative: false, prependHttpsIfMissingScheme: true })}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--color-accent-emphasis)", textDecoration: "none" }}
              >
                {profile.website}
              </a>
            </Box>
          )}
          {profile.account_type !== "rss" && (
            <Box display="flex" alignItems="center" gap={1} color="var(--color-fg-muted)">
              <CalendarIcon size={16} />{" "}
              <Text style={{ fontSize: "14px" }}>Joined {new Date(profile.created_at).toLocaleDateString()}</Text>
            </Box>
          )}
        </Box>

        {profile.account_type !== "rss" && (
          <Box mt={3} display="flex" gap={4}>
            <Link
              to={`/${profile.username}/following`}
              style={{ textDecoration: "none", color: "var(--color-fg-default)" }}
            >
              <Text style={{ fontWeight: "bold" }}>{profile.following_count}</Text>{" "}
              <Text color="var(--color-fg-muted)">Following</Text>
            </Link>
            <Link
              to={`/${profile.username}/followers`}
              style={{ textDecoration: "none", color: "var(--color-fg-default)" }}
            >
              <Text style={{ fontWeight: "bold" }}>{profile.follower_count}</Text>{" "}
              <Text color="var(--color-fg-muted)">Followers</Text>
            </Link>
          </Box>
        )}
      </Box>
    </>
  );
};

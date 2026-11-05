// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CalendarIcon,
  CheckCircleFillIcon,
  GlobeIcon,
  HistoryIcon,
  HubotIcon,
  LocationIcon,
  NoEntryIcon,
  RssIcon,
} from "@primer/octicons-react";
import { Button, Heading, Text } from "@primer/react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import styled from "styled-components";
import { getUserAbout, unblockUser, type UserAboutData } from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";
import { useToast } from "../components/ToastContext";
import { getAvatarUrl } from "../util/avatar";
import { parseFederatedHandle } from "../util/federation";
import { usePageTitle } from "../util/title";
import { safeCssImageUrl } from "../util/url";

function getCountryFlag(countryCode?: string | null): string {
  if (!countryCode || countryCode.length !== 2) return "🌐";
  const codePoints = countryCode
    .toUpperCase()
    .split("")
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

function formatDate(isoDate?: string | null): string {
  if (!isoDate) return "Unknown";
  try {
    const d = new Date(isoDate);
    if (Number.isNaN(d.getTime())) return isoDate;
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return isoDate;
  }
}

function formatRelativeTime(isoDate?: string | null): string {
  if (!isoDate) return "";
  try {
    const d = new Date(isoDate);
    const ms = Date.now() - d.getTime();
    if (Number.isNaN(ms) || ms < 0) return "";
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    if (days === 0) return "today";
    if (days === 1) return "1 day ago";
    if (days < 30) return `${days} days ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months} month${months > 1 ? "s" : ""} ago`;
    const years = Math.floor(days / 365);
    return `${years} year${years > 1 ? "s" : ""} ago`;
  } catch {
    return "";
  }
}

const Avatar = styled.div<{ $url?: string | undefined; $letter?: string | undefined }>`
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background-color: var(--color-accent-purple, #8250df);
  background-image: ${(props) => safeCssImageUrl(props.$url)};
  background-size: cover;
  background-position: center;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 28px;
  color: #ffffff;
  border: 3px solid var(--color-bg-primary);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  &::before {
    content: "${(props) => (!props.$url && props.$letter ? props.$letter : "")}";
  }
`;

const InfoCard = styled.div`
  background-color: var(--color-canvas-subtle, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.12));
  border-radius: 12px;
  padding: 16px;
  display: flex;
  gap: 16px;
  align-items: flex-start;
  transition: border-color 0.2s ease;
  width: 100%;
  box-sizing: border-box;

  &:hover {
    border-color: var(--color-accent-fg, #0969da);
  }
`;

const IconCircle = styled.div`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--surface-overlay, rgba(14, 20, 36, 0.6));
  border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.1));
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-fg-default);
  flex-shrink: 0;
`;

const HistoryRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border-muted, rgba(255, 255, 255, 0.06));
  font-size: 13px;

  &:last-child {
    border-bottom: none;
  }
`;

export default function AboutAccountPage() {
  const { username: rawUsername } = useParams<{ username?: string }>();
  const username = rawUsername?.startsWith("@") ? rawUsername.slice(1) : rawUsername || "";
  const navigate = useNavigate();
  const { token } = useAuth();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<UserAboutData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBlocked, setIsBlocked] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  usePageTitle(data ? `About @${data.username}` : `About @${username}`);

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      if (!username) return;
      setLoading(true);
      setError(null);
      try {
        const res = await getUserAbout(username);
        if (!cancelled) {
          setData(res);
          setIsBlocked(Boolean(res.isBlocked));
        }
      } catch (err: any) {
        if (!cancelled) {
          const msg = err?.response?.data?.error || err?.message || "Failed to load account information";
          setError(msg);
          if (err?.response?.data?.isBlockedBy) {
            setData((prev) => ({
              ...(prev || {
                username,
                displayName: username,
                accountType: "user",
                createdAt: "",
                joinedAt: "",
                basedIn: null,
                usernameChanges: { count: 0, lastChangedAt: null, history: [] },
              }),
              isBlockedBy: true,
            }));
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadData();
    return () => {
      cancelled = true;
    };
  }, [username, token]);

  const handleUnblock = async () => {
    try {
      await unblockUser(username);
      setIsBlocked(false);
      showToast(`@${username} has been unblocked.`, "success");
    } catch {
      showToast(`Failed to unblock @${username}.`, "error");
    }
  };

  const parsed = parseFederatedHandle(username);

  return (
    <Box style={{ width: "100%", maxWidth: "740px", margin: "0 auto", paddingBottom: "48px" }}>
      <PageHeader title="About this account" back={() => navigate(`/@${username}`)} />

      {loading ? (
        <Box p={6} display="flex" justifyContent="center">
          <Spinner size="large" />
        </Box>
      ) : error && !data?.isBlockedBy ? (
        <Box p={4} textAlign="center">
          <Heading as="h2" style={{ fontSize: "20px", color: "var(--color-danger-fg)" }}>
            {error}
          </Heading>
          <Box mt={3}>
            <Button onClick={() => navigate(`/@${username}`)}>Return to profile</Button>
          </Box>
        </Box>
      ) : data?.isBlockedBy ? (
        <Box p={5} textAlign="center">
          <NoEntryIcon size={48} color="var(--color-danger-fg)" />
          <Heading as="h2" style={{ fontSize: "20px", marginTop: "16px" }}>
            You are blocked
          </Heading>
          <Text color="var(--color-fg-muted)" style={{ fontSize: "14px", display: "block", marginTop: "8px" }}>
            You cannot view information about @{username} because they have blocked your account.
          </Text>
          <Box mt={4}>
            <Button onClick={() => navigate("/home")}>Back to home</Button>
          </Box>
        </Box>
      ) : !data ? null : (
        <Box px={3} py={2} display="flex" flexDirection="column" gap={3}>
          {/* Header Card */}
          <Box
            p={3}
            display="flex"
            alignItems="center"
            gap={3}
            style={{
              paddingBottom: "16px",
            }}
          >
            <Avatar
              $url={getAvatarUrl(data.username, data.avatarUrl || undefined)}
              $letter={data.username.charAt(0).toUpperCase()}
            />
            <Box display="flex" flexDirection="column" flex={1}>
              <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
                <Heading as="h2" style={{ fontSize: "20px", fontWeight: 700, margin: 0 }}>
                  {data.displayName || data.username}
                </Heading>
                {data.isVerified && (
                  <CheckCircleFillIcon size={18} fill="var(--color-accent-fg, #0969da)" title="Verified Account" />
                )}
                {data.accountType === "bot" && <HubotIcon size={18} color="var(--color-fg-muted)" title="Bot" />}
                {data.accountType === "rss" && <RssIcon size={18} color="var(--color-fg-muted)" title="RSS Feed" />}
                {parsed.isFederated && (
                  <GlobeIcon size={18} color="var(--color-accent-cyan, #0550ae)" title="Federated Remote Actor" />
                )}
              </Box>
              <Text
                style={{
                  fontSize: "14px",
                  color: "var(--color-fg-muted, var(--color-text-muted, #536471))",
                  marginTop: "2px",
                }}
              >
                @{data.username}
              </Text>
            </Box>
            <Button as={Link as any} to={`/@${data.username}`} style={{ borderRadius: "9999px", fontWeight: 600 }}>
              View Profile
            </Button>
          </Box>

          {isBlocked && (
            <Box
              p={3}
              style={{
                backgroundColor: "var(--color-danger-subtle, rgba(218, 54, 51, 0.1))",
                border: "1px solid var(--color-danger-muted, rgba(218, 54, 51, 0.3))",
                borderRadius: "12px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Box display="flex" alignItems="center" gap={2}>
                <NoEntryIcon size={20} color="var(--color-danger-fg)" />
                <Text style={{ fontSize: "14px", fontWeight: 600 }}>You have blocked @{data.username}.</Text>
              </Box>
              <Button size="small" onClick={handleUnblock}>
                Unblock
              </Button>
            </Box>
          )}

          {/* Date Joined Card */}
          <InfoCard>
            <IconCircle>
              <CalendarIcon size={20} />
            </IconCircle>
            <Box display="flex" flexDirection="column" flex={1}>
              <Text style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-fg-muted)" }}>Date joined</Text>
              <Text style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-fg-default)", marginTop: "2px" }}>
                {formatDate(data.joinedAt || data.createdAt)}
              </Text>
            </Box>
          </InfoCard>

          {/* Account Based In Card */}
          {Boolean(data.basedIn?.countryName && data.basedIn.countryName !== "Not yet established") && (
            <InfoCard>
              <IconCircle>
                <LocationIcon size={20} />
              </IconCircle>
              <Box display="flex" flexDirection="column" flex={1}>
                <Text style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-fg-muted)" }}>
                  Account based in
                </Text>
                <Box display="flex" alignItems="center" gap={2} style={{ marginTop: "2px" }}>
                  {data.basedIn?.countryCode && (
                    <span style={{ fontSize: "20px", lineHeight: "1" }}>
                      {getCountryFlag(data.basedIn.countryCode)}
                    </span>
                  )}
                  <Text style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-fg-default)" }}>
                    {data.basedIn?.countryName}
                    {data.basedIn?.regionCode ? ` (${data.basedIn.regionCode})` : ""}
                  </Text>
                </Box>
              </Box>
            </InfoCard>
          )}

          {/* Former Usernames Card */}
          {(data.usernameChanges?.count ?? 0) > 0 && (
            <InfoCard style={{ flexDirection: "column" }}>
              <Box display="flex" gap={3} alignItems="flex-start" width="100%">
                <IconCircle>
                  <HistoryIcon size={20} />
                </IconCircle>
                <Box display="flex" flexDirection="column" flex={1}>
                  <Text style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-fg-muted)" }}>
                    Former usernames
                  </Text>
                  <Text
                    style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-fg-default)", marginTop: "2px" }}
                  >
                    {`${data.usernameChanges.count} username change${data.usernameChanges.count > 1 ? "s" : ""}`}
                  </Text>
                  {data.usernameChanges.lastChangedAt && (
                    <Text color="var(--color-fg-muted)" style={{ fontSize: "12px", marginTop: "4px" }}>
                      Last changed on {formatDate(data.usernameChanges.lastChangedAt)} (
                      {formatRelativeTime(data.usernameChanges.lastChangedAt)})
                    </Text>
                  )}
                </Box>
                {data.usernameChanges.count > 0 && (
                  <Button size="small" onClick={() => setShowHistory(!showHistory)} style={{ alignSelf: "flex-start" }}>
                    {showHistory ? "Hide history" : "View history"}
                  </Button>
                )}
              </Box>

              {showHistory && data.usernameChanges.history.length > 0 && (
                <Box
                  mt={2}
                  width="100%"
                  style={{
                    backgroundColor: "var(--color-canvas-default, rgba(0, 0, 0, 0.2))",
                    borderRadius: "8px",
                    border: "1px solid var(--color-border-muted)",
                  }}
                >
                  {data.usernameChanges.history.map((h, i) => (
                    <HistoryRow key={i}>
                      <Box display="flex" alignItems="center" gap={2}>
                        <span style={{ color: "var(--color-fg-muted)" }}>@{h.oldUsername}</span>
                        <span style={{ color: "var(--color-fg-muted)" }}>&rarr;</span>
                        <span style={{ fontWeight: 600, color: "var(--color-fg-default)" }}>@{h.newUsername}</span>
                      </Box>
                      <span style={{ color: "var(--color-fg-muted)", fontSize: "12px" }}>
                        {formatDate(h.changedAt)}
                      </span>
                    </HistoryRow>
                  ))}
                </Box>
              )}
            </InfoCard>
          )}
        </Box>
      )}
    </Box>
  );
}

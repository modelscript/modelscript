// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  AlertIcon,
  BellIcon,
  ClockIcon,
  CpuIcon,
  CreditCardIcon,
  FileCodeIcon,
  FilterIcon,
  HeartFillIcon,
  MentionIcon,
  PackageIcon,
  PersonIcon,
  PlayIcon,
  ReplyIcon,
  RocketIcon,
  ShieldIcon,
  StarIcon,
} from "@primer/octicons-react";
import { Button, Heading, Label, Spinner, Text } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import styled from "styled-components";
import { getNotifications, markNotificationsRead } from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import FederatedDomainPill from "../components/FederatedDomainPill";
import ProfileHoverCard from "../components/ProfileHoverCard";
import { StickyHeader } from "../components/SharedStyles";
import { parseFederatedHandle } from "../util/federation";
import { safeJsonParse } from "../util/json";
import { usePageTitle } from "../util/title";

export type NotificationCategory = "all" | "engineering" | "packages" | "mentions" | "system";

function formatRelativeTime(dateString: string): string {
  if (!dateString) return "";
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return `${Math.max(1, diffInSeconds)}s`;
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h`;

  if (now.getFullYear() !== date.getFullYear()) {
    return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatPostContent(content: string) {
  if (!content) return null;
  const parts = content.split(/((?:^|\s)@[a-zA-Z0-9_.-]+(?:@[a-zA-Z0-9_.-]+)?)/g);
  return parts.map((part, idx) => {
    const match = part.match(/^(\s*)(@[a-zA-Z0-9_.-]+(?:@[a-zA-Z0-9_.-]+)?)$/);
    if (match) {
      const rawHandle = match[2].substring(1);
      const parsed = parseFederatedHandle(rawHandle);
      return (
        <React.Fragment key={idx}>
          {match[1]}
          <ProfileHoverCard username={rawHandle}>
            <Link
              to={`/${rawHandle}`}
              style={{ color: "var(--color-link)", textDecoration: "none" }}
              onClick={(e) => e.stopPropagation()}
              onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
              onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
            >
              @{parsed.localUsername}
            </Link>
          </ProfileHoverCard>
          {parsed.isFederated && parsed.remoteDomain && (
            <FederatedDomainPill domain={parsed.remoteDomain} style={{ marginLeft: "4px" }} />
          )}
        </React.Fragment>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

/* ─── Styled Components ─── */

const NotificationWrapper = styled.div<{ $unread: boolean }>`
  display: flex;
  gap: 14px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border-default);
  background-color: ${(props) => (props.$unread ? "var(--color-canvas-subtle)" : "transparent")};
  cursor: pointer;
  transition: background-color 0.15s ease;

  &:hover {
    background-color: var(--color-canvas-subtle);
  }
`;

const EngineeringCard = styled.div<{ $status: "completed" | "failed" | "package" | "security" | "credit" }>`
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--color-canvas-default);
  border: 1px solid
    ${(props) => {
      switch (props.$status) {
        case "completed":
          return "var(--color-success-emphasis, rgba(46, 160, 67, 0.4))";
        case "failed":
          return "var(--color-danger-emphasis, rgba(248, 81, 73, 0.4))";
        case "security":
          return "var(--color-danger-emphasis, rgba(248, 81, 73, 0.5))";
        case "credit":
          return "var(--color-attention-emphasis, rgba(210, 153, 34, 0.4))";
        case "package":
        default:
          return "var(--color-accent-emphasis, rgba(56, 139, 253, 0.4))";
      }
    }};
`;

const ModelBadge = styled.span`
  font-family: var(--font-mono, monospace);
  font-size: 13px;
  font-weight: 600;
  color: var(--color-fg-default);
  background: var(--color-canvas-subtle);
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid var(--color-border-default);
  word-break: break-all;
`;

const MetricChip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--color-fg-muted);
  background: var(--color-canvas-subtle);
  padding: 2px 8px;
  border-radius: 12px;
  border: 1px solid var(--color-border-default);
`;

const Avatar = styled.div<{ $url?: string }>`
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--gradient-ai, linear-gradient(135deg, #8b5cf6 0%, #06b6d4 100%));
  background-image: ${(props) => (props.$url ? `url(${props.$url})` : "none")};
  background-size: cover;
  flex-shrink: 0;
`;

const AvatarsRow = styled.div`
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
`;

const TabButton = styled.button<{ $active: boolean }>`
  flex: 1;
  min-width: 90px;
  padding: 12px 10px;
  background: none;
  border: none;
  border-bottom: 2px solid ${(props) => (props.$active ? "var(--color-accent-fg)" : "transparent")};
  color: ${(props) => (props.$active ? "var(--color-fg-default)" : "var(--color-fg-muted)")};
  font-weight: ${(props) => (props.$active ? 600 : 500)};
  cursor: pointer;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  white-space: nowrap;
  transition: all 0.15s ease;

  &:hover {
    color: var(--color-fg-default);
    background: var(--color-canvas-subtle);
  }
`;

const UnreadPill = styled.span`
  background: var(--color-accent-emphasis);
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 10px;
  line-height: 1.2;
`;

const getIconForType = (type: string) => {
  switch (type) {
    case "like":
      return <HeartFillIcon color="var(--color-danger-fg)" size={22} />;
    case "follow":
      return <PersonIcon color="var(--color-accent-fg)" size={22} />;
    case "reply":
      return <ReplyIcon color="var(--color-fg-muted)" size={22} />;
    case "repost":
      return <StarIcon color="var(--color-attention-fg)" size={22} />;
    case "mention":
      return <MentionIcon color="var(--color-done-fg)" size={22} />;
    case "simulation":
    case "simulation_completed":
      return <RocketIcon color="var(--color-success-fg)" size={22} />;
    case "simulation_failed":
      return <AlertIcon color="var(--color-danger-fg)" size={22} />;
    case "package":
    case "package_published":
      return <PackageIcon color="var(--color-accent-fg)" size={22} />;
    case "security_alert":
      return <ShieldIcon color="var(--color-danger-fg)" size={22} />;
    case "credit_warning":
      return <CreditCardIcon color="var(--color-attention-fg)" size={22} />;
    default:
      return null;
  }
};

const getMessageForType = (type: string, actors: any[] = [], currentUsername?: string) => {
  const count = actors?.length || 0;
  if (count === 0 && type !== "security_alert" && type !== "credit_warning") return null;

  const firstActor = actors[0] || {};
  const isSelf = Boolean(currentUsername && firstActor.username === currentUsername);
  const name = isSelf ? "You" : firstActor.display_name || firstActor.username || "Someone";

  let actorText;
  if (isSelf) {
    actorText = <Text fontWeight="bold">You</Text>;
  } else if (count === 1) {
    actorText = <Text fontWeight="bold">{name}</Text>;
  } else if (count === 2) {
    const secondActor = actors[1] || {};
    actorText = (
      <>
        <Text fontWeight="bold">{name}</Text> and{" "}
        <Text fontWeight="bold">{secondActor.display_name || secondActor.username || "someone"}</Text>
      </>
    );
  } else {
    actorText = (
      <>
        <Text fontWeight="bold">{name}</Text> and {count - 1} others
      </>
    );
  }

  switch (type) {
    case "like":
      return <>{actorText} liked your post</>;
    case "follow":
      return <>{actorText} followed you</>;
    case "reply":
      return <>{actorText} replied to your post</>;
    case "repost":
      return <>{actorText} reposted your post</>;
    case "mention":
      return <>{actorText} mentioned you</>;
    case "simulation":
    case "simulation_completed":
      return isSelf ? <>Your simulation completed successfully</> : <>{actorText} completed a simulation run</>;
    case "simulation_failed":
      return isSelf ? <>Your simulation run terminated with errors</> : <>{actorText}'s simulation failed</>;
    case "package":
    case "package_published":
      return isSelf ? <>Your package was published to registry</> : <>{actorText} published a package</>;
    case "security_alert":
      return <>Security advisory: Vulnerability detected in package dependencies</>;
    case "credit_warning":
      return <>Compute wallet notice: Account compute balance threshold warning</>;
    default:
      return null;
  }
};

function groupNotifications(notifs: any[]) {
  const grouped: any[] = [];
  const postGroups = new Map<string, any>();

  for (const notif of notifs) {
    if (notif.post_id && (notif.type === "like" || notif.type === "repost")) {
      const key = `${notif.type}-${notif.post_id}`;
      if (postGroups.has(key)) {
        const group = postGroups.get(key);
        if (!group.actors.some((a: any) => a.username === notif.actor_username)) {
          group.actors.push({
            username: notif.actor_username,
            display_name: notif.actor_display_name,
            avatar_url: notif.actor_avatar_url,
          });
        }
        if (notif.read === 0) {
          group.read = 0;
        }
      } else {
        const group = {
          ...notif,
          isGroup: true,
          actors: [
            {
              username: notif.actor_username,
              display_name: notif.actor_display_name,
              avatar_url: notif.actor_avatar_url,
            },
          ],
        };
        postGroups.set(key, group);
        grouped.push(group);
      }
    } else {
      grouped.push({
        ...notif,
        isGroup: false,
        actors: [
          {
            username: notif.actor_username,
            display_name: notif.actor_display_name,
            avatar_url: notif.actor_avatar_url,
          },
        ],
      });
    }
  }

  return grouped;
}

const NotificationsPage: React.FC = () => {
  usePageTitle("Notifications");
  const { token, user, setUnreadCount } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<NotificationCategory>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);

  const fetchNotifications = async (cat?: NotificationCategory) => {
    if (!token) return;
    try {
      const data = await getNotifications(cat === "all" ? undefined : cat);
      setNotifications(groupNotifications(data.notifications || []));
      if (typeof data.unreadCount === "number") {
        setUnreadCount(data.unreadCount);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    void fetchNotifications(activeTab);
  }, [token, activeTab]);

  const markAllRead = () => {
    if (!token) return;
    const cat = activeTab === "all" ? undefined : activeTab;
    markNotificationsRead(cat)
      .then(() => {
        setNotifications((prev) =>
          prev.map((n) => {
            if (activeTab === "all") return { ...n, read: 1 };
            if (
              activeTab === "engineering" &&
              ["simulation", "simulation_completed", "simulation_failed"].includes(n.type)
            ) {
              return { ...n, read: 1 };
            }
            if (activeTab === "packages" && ["package", "package_published", "package_yanked"].includes(n.type)) {
              return { ...n, read: 1 };
            }
            if (activeTab === "mentions" && ["mention", "reply", "repost", "like", "follow"].includes(n.type)) {
              return { ...n, read: 1 };
            }
            if (activeTab === "system" && ["security_alert", "credit_warning"].includes(n.type)) {
              return { ...n, read: 1 };
            }
            return n;
          }),
        );
        setUnreadCount(0);
      })
      .catch(() => {});
  };

  const unreadCounts = useMemo(() => {
    const counts: Record<NotificationCategory, number> = {
      all: 0,
      engineering: 0,
      packages: 0,
      mentions: 0,
      system: 0,
    };
    for (const n of notifications) {
      if (!n.read) {
        counts.all++;
        if (["simulation", "simulation_completed", "simulation_failed"].includes(n.type)) {
          counts.engineering++;
        } else if (["package", "package_published", "package_yanked"].includes(n.type)) {
          counts.packages++;
        } else if (["mention", "reply", "repost", "like", "follow"].includes(n.type)) {
          counts.mentions++;
        } else if (["security_alert", "credit_warning"].includes(n.type)) {
          counts.system++;
        }
      }
    }
    return counts;
  }, [notifications]);

  const filteredNotifications = useMemo(() => {
    return notifications.filter((notif) => {
      if (unreadOnly && notif.read) return false;
      if (activeTab === "engineering") {
        return ["simulation", "simulation_completed", "simulation_failed"].includes(notif.type);
      }
      if (activeTab === "packages") {
        return ["package", "package_published", "package_yanked"].includes(notif.type);
      }
      if (activeTab === "mentions") {
        return ["mention", "reply", "repost", "like", "follow"].includes(notif.type);
      }
      if (activeTab === "system") {
        return ["security_alert", "credit_warning"].includes(notif.type);
      }
      return true;
    });
  }, [notifications, activeTab, unreadOnly]);

  return (
    <Box>
      <StickyHeader style={{ justifyContent: "space-between", alignItems: "center" }}>
        <Box display="flex" alignItems="center" gap={2}>
          <Heading as="h2" style={{ fontSize: "20px", margin: 0 }}>
            Notifications
          </Heading>
          {unreadCounts.all > 0 && <UnreadPill>{unreadCounts.all} unread</UnreadPill>}
        </Box>
        <Box display="flex" gap={2} alignItems="center">
          <Button
            size="small"
            variant={unreadOnly ? "primary" : "invisible"}
            leadingVisual={FilterIcon}
            onClick={() => setUnreadOnly((prev) => !prev)}
          >
            {unreadOnly ? "Unread Only" : "Filter Unread"}
          </Button>
          {notifications.some((n) => !n.read) && (
            <Button size="small" variant="invisible" onClick={markAllRead}>
              Mark read
            </Button>
          )}
        </Box>
      </StickyHeader>

      {/* ── Category Filter Bar ── */}
      <Box
        display="flex"
        borderBottom="1px solid var(--color-border-default)"
        style={{ overflowX: "auto", scrollbarWidth: "none" }}
      >
        <TabButton $active={activeTab === "all"} onClick={() => setActiveTab("all")}>
          <BellIcon size={14} /> All {unreadCounts.all > 0 && <UnreadPill>{unreadCounts.all}</UnreadPill>}
        </TabButton>
        <TabButton $active={activeTab === "engineering"} onClick={() => setActiveTab("engineering")}>
          <RocketIcon size={14} /> Engineering{" "}
          {unreadCounts.engineering > 0 && <UnreadPill>{unreadCounts.engineering}</UnreadPill>}
        </TabButton>
        <TabButton $active={activeTab === "packages"} onClick={() => setActiveTab("packages")}>
          <PackageIcon size={14} /> Packages{" "}
          {unreadCounts.packages > 0 && <UnreadPill>{unreadCounts.packages}</UnreadPill>}
        </TabButton>
        <TabButton $active={activeTab === "mentions"} onClick={() => setActiveTab("mentions")}>
          <MentionIcon size={14} /> Mentions{" "}
          {unreadCounts.mentions > 0 && <UnreadPill>{unreadCounts.mentions}</UnreadPill>}
        </TabButton>
        <TabButton $active={activeTab === "system"} onClick={() => setActiveTab("system")}>
          <ShieldIcon size={14} /> System {unreadCounts.system > 0 && <UnreadPill>{unreadCounts.system}</UnreadPill>}
        </TabButton>
      </Box>

      {loading ? (
        <Box p={4} display="flex" justifyContent="center">
          <Spinner size="large" />
        </Box>
      ) : filteredNotifications.length === 0 ? (
        <Box p={6} textAlign="center" color="var(--color-fg-muted)">
          {unreadOnly ? "No unread notifications in this category." : "You have no notifications in this category."}
        </Box>
      ) : (
        <Box>
          {filteredNotifications.map((notif) => {
            const meta = notif.metadata || {};
            const isSimulation = notif.type === "simulation_completed" || notif.type === "simulation";
            const isSimFailed = notif.type === "simulation_failed";
            const isPackage = notif.type === "package" || notif.type === "package_published";
            const isSecurity = notif.type === "security_alert";
            const isCredit = notif.type === "credit_warning";

            // Specialized Engineering Notification Card
            if (isSimulation || isSimFailed || isPackage || isSecurity || isCredit) {
              const cardStatus = isSimulation
                ? "completed"
                : isSimFailed
                  ? "failed"
                  : isSecurity
                    ? "security"
                    : isCredit
                      ? "credit"
                      : "package";

              return (
                <NotificationWrapper
                  key={notif.id}
                  $unread={!notif.read}
                  onClick={() => {
                    if (isSimulation || isSimFailed) {
                      const targetModel = meta.name;
                      if (targetModel) {
                        navigate(`/playground?model=${encodeURIComponent(targetModel)}`);
                      } else {
                        navigate(meta.jobId || notif.job_id ? `/jobs/${meta.jobId || notif.job_id}` : "/jobs");
                      }
                    } else if (isPackage) {
                      navigate(
                        meta.packageName || notif.package_name
                          ? `/packages/${meta.packageName || notif.package_name}`
                          : "/packages",
                      );
                    } else if (isCredit) {
                      navigate("/settings/billing");
                    } else if (isSecurity) {
                      navigate("/settings");
                    }
                  }}
                >
                  <Box width={36} display="flex" justifyContent="center" pt={1}>
                    {getIconForType(notif.type)}
                  </Box>
                  <Box flex={1}>
                    <EngineeringCard $status={cardStatus}>
                      <Box display="flex" justifyContent="space-between" alignItems="center">
                        <Box display="flex" alignItems="center" gap={2}>
                          {isSimulation && <Label variant="success">Simulation Completed</Label>}
                          {isSimFailed && <Label variant="danger">Simulation Failed</Label>}
                          {isPackage && <Label variant="accent">Package Release</Label>}
                          {isSecurity && <Label variant="danger">Security Advisory</Label>}
                          {isCredit && <Label variant="attention">Compute Quota</Label>}
                          {meta.profile && (
                            <MetricChip>
                              <CpuIcon size={12} /> {meta.profile}
                            </MetricChip>
                          )}
                          {meta.duration && (
                            <MetricChip>
                              <ClockIcon size={12} /> {meta.duration}s
                            </MetricChip>
                          )}
                        </Box>
                        <Text fontSize="12px" color="var(--color-fg-muted)">
                          {formatRelativeTime(notif.created_at || new Date().toISOString())}
                        </Text>
                      </Box>

                      {/* Title & Body */}
                      <Box mt={1}>
                        {(isSimulation || isSimFailed) && meta.name && (
                          <Box display="flex" alignItems="center" gap={2} mb={1}>
                            <ModelBadge>{meta.name}</ModelBadge>
                          </Box>
                        )}
                        {isSimFailed && meta.error && (
                          <Box
                            p={2}
                            borderRadius={6}
                            background="rgba(248, 81, 73, 0.1)"
                            border="1px solid rgba(248, 81, 73, 0.25)"
                            fontSize="13px"
                            color="var(--color-danger-fg)"
                            style={{ fontFamily: "var(--font-mono, monospace)" }}
                          >
                            {meta.error}
                          </Box>
                        )}
                        {isPackage && (
                          <Box display="flex" alignItems="center" gap={2}>
                            <ModelBadge>
                              {meta.packageName || notif.package_name}
                              {meta.packageVersion ? `@${meta.packageVersion}` : ""}
                            </ModelBadge>
                            {meta.distTag && <Label variant="secondary">{meta.distTag}</Label>}
                            {meta.totalFiles && (
                              <Text fontSize="13px" color="var(--color-fg-muted)">
                                {meta.totalFiles} files
                              </Text>
                            )}
                          </Box>
                        )}
                        {isSecurity && (
                          <Text fontSize="13px" color="var(--color-danger-fg)">
                            {meta.reason || "Vulnerability detected in package dependencies."}
                          </Text>
                        )}
                        {isCredit && (
                          <Text fontSize="13px" color="var(--color-attention-fg)">
                            {meta.message ||
                              `Account compute balance has dropped to ${meta.balance ?? "< 10"} credits.`}
                          </Text>
                        )}
                      </Box>

                      {/* Quick Actions */}
                      <Box
                        display="flex"
                        gap={2}
                        mt={1}
                        pt={1}
                        borderTop="1px solid var(--color-border-subtle, rgba(255,255,255,0.06))"
                      >
                        {isSimulation && (
                          <>
                            <Button
                              size="small"
                              variant="primary"
                              leadingVisual={PlayIcon}
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(
                                  meta.name ? `/playground?model=${encodeURIComponent(meta.name)}` : "/playground",
                                );
                              }}
                            >
                              Open in Playground
                            </Button>
                            {meta.jobId && (
                              <Button
                                size="small"
                                leadingVisual={FileCodeIcon}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/jobs/${meta.jobId}`);
                                }}
                              >
                                View Job Log
                              </Button>
                            )}
                          </>
                        )}
                        {isSimFailed && (
                          <>
                            {meta.jobId && (
                              <Button
                                size="small"
                                variant="danger"
                                leadingVisual={FileCodeIcon}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/jobs/${meta.jobId}`);
                                }}
                              >
                                Inspect Failure Log
                              </Button>
                            )}
                            <Button
                              size="small"
                              leadingVisual={PlayIcon}
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(
                                  meta.name ? `/playground?model=${encodeURIComponent(meta.name)}` : "/playground",
                                );
                              }}
                            >
                              Open in Editor
                            </Button>
                          </>
                        )}
                        {isPackage && (
                          <Button
                            size="small"
                            variant="primary"
                            leadingVisual={PackageIcon}
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/packages/${meta.packageName || notif.package_name}`);
                            }}
                          >
                            Inspect Package
                          </Button>
                        )}
                        {isSecurity && (
                          <Button
                            size="small"
                            variant="danger"
                            leadingVisual={ShieldIcon}
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate("/settings");
                            }}
                          >
                            Review Security Settings
                          </Button>
                        )}
                        {isCredit && (
                          <Button
                            size="small"
                            variant="primary"
                            leadingVisual={CreditCardIcon}
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate("/settings/billing");
                            }}
                          >
                            Top-Up Compute Wallet
                          </Button>
                        )}
                      </Box>
                    </EngineeringCard>
                  </Box>
                </NotificationWrapper>
              );
            }

            // Social & Mention Notification Row
            let thumbnail = null;
            if (notif.post_artifact_config && notif.post_artifact_type === "picture") {
              const conf = safeJsonParse<{ url?: string }>(notif.post_artifact_config, {});
              if (conf.url) thumbnail = conf.url;
            } else if (notif.post_artifact_config && notif.post_artifact_type === "link-preview") {
              const conf = safeJsonParse<{ image?: string }>(notif.post_artifact_config, {});
              if (conf.image) thumbnail = conf.image;
            }

            const primaryActor = notif.actors?.[0] || {
              username: notif.actor_username || "user",
              display_name: notif.actor_display_name || notif.actor_username || "User",
              avatar_url: notif.actor_avatar_url,
            };

            return (
              <NotificationWrapper
                key={notif.id}
                $unread={!notif.read}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("a, button, .interactive-element")) return;
                  const postAuthor =
                    notif.post_author || notif.author_username || primaryActor.username || user?.username;
                  const url =
                    notif.type === "follow"
                      ? primaryActor.username
                        ? `/${primaryActor.username}`
                        : "/home"
                      : `/${postAuthor}/status/${notif.post_id}`;
                  navigate(url);
                }}
              >
                {notif.type === "mention" || notif.type === "reply" ? (
                  <>
                    <Box width={36} display="flex" justifyContent="flex-end" pt={1}>
                      <Avatar $url={primaryActor.avatar_url} style={{ width: 36, height: 36 }} />
                    </Box>
                    <Box flex={1} display="flex" flexDirection="row">
                      <Box flex={1}>
                        <Box display="flex" alignItems="center" gap="4px" mb="4px" fontSize="14px">
                          <ProfileHoverCard username={primaryActor.username}>
                            <Link
                              to={`/${primaryActor.username}`}
                              style={{
                                fontWeight: "bold",
                                color: "var(--color-fg-default)",
                                textDecoration: "none",
                              }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {primaryActor.display_name || primaryActor.username}
                            </Link>
                          </ProfileHoverCard>
                          <span style={{ color: "var(--color-fg-muted)" }}>@{primaryActor.username}</span>
                          <span style={{ color: "var(--color-fg-muted)" }}>·</span>
                          <span style={{ color: "var(--color-fg-muted)" }}>
                            {formatRelativeTime(notif.created_at || new Date().toISOString())}
                          </span>
                        </Box>
                        {notif.post_content && (
                          <Box fontSize="14px" color="var(--color-fg-muted)">
                            {formatPostContent(notif.post_content)}
                          </Box>
                        )}
                      </Box>
                      {thumbnail && (
                        <Box width="60px" height="60px" borderRadius="8px" overflow="hidden" ml={2} flexShrink={0}>
                          <img
                            src={thumbnail}
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            alt="attachment thumbnail"
                          />
                        </Box>
                      )}
                    </Box>
                  </>
                ) : (
                  <>
                    <Box width={36} display="flex" justifyContent="center" pt={1}>
                      {getIconForType(notif.type)}
                    </Box>
                    <Box flex={1}>
                      <AvatarsRow>
                        {notif.actors.slice(0, 10).map((a: any) => (
                          <Avatar key={a.username} $url={a.avatar_url} />
                        ))}
                      </AvatarsRow>
                      <Box mt={1} fontSize="14px">
                        {getMessageForType(notif.type, notif.actors, user?.username)}
                      </Box>
                      {notif.post_content && (
                        <Box mt={1} color="var(--color-fg-muted)" fontSize="14px">
                          {formatPostContent(notif.post_content)}
                        </Box>
                      )}
                    </Box>
                  </>
                )}
              </NotificationWrapper>
            );
          })}
        </Box>
      )}
    </Box>
  );
};

export default NotificationsPage;

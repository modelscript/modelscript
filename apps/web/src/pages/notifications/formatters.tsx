// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertIcon,
  BookmarkFillIcon,
  CreditCardIcon,
  HeartFillIcon,
  MentionIcon,
  PackageIcon,
  PersonIcon,
  QuoteIcon,
  ReplyIcon,
  RocketIcon,
  ShieldIcon,
  SyncIcon,
} from "@primer/octicons-react";
import { Text } from "@primer/react";
import React from "react";
import { Link } from "react-router-dom";
import FederatedDomainPill from "../../components/FederatedDomainPill";
import ProfileHoverCard from "../../components/ProfileHoverCard";
import { parseFederatedHandle } from "../../util/federation";
import type { NotificationActor } from "./types";

export { formatRelativeTime } from "../../util/date";

export function formatPostContent(content: string) {
  if (!content) return null;
  const parts = content.split(/((?:^|\s)@[a-zA-Z0-9_.-]+(?:@[a-zA-Z0-9_.-]+)?)/g);
  return parts.map((part, idx) => {
    const match = part.match(/^(\s*)(@[a-zA-Z0-9_.-]+(?:@[a-zA-Z0-9_.-]+)?)$/);
    if (match) {
      const rawHandle = match[2]!.substring(1);
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

export const getIconForType = (type: string) => {
  switch (type) {
    case "bookmark":
      return <BookmarkFillIcon color="var(--color-attention-fg, #d29922)" size={20} />;
    case "like":
      return <HeartFillIcon color="var(--color-danger-fg)" size={22} />;
    case "follow":
    case "follow_request":
    case "follow_accepted":
      return <PersonIcon color="var(--color-accent-fg)" size={22} />;
    case "reply":
      return <ReplyIcon color="var(--color-fg-muted)" size={22} />;
    case "repost":
      return <SyncIcon color="#00ba7c" size={22} />;
    case "quote":
      return <QuoteIcon color="var(--color-accent-fg)" size={22} />;
    case "mention":
      return <MentionIcon color="var(--color-done-fg)" size={22} />;
    case "simulation":
    case "simulation_completed":
    case "cae_completed":
      return <RocketIcon color="var(--color-success-fg)" size={22} />;
    case "simulation_failed":
    case "cae_failed":
      return <AlertIcon color="var(--color-danger-fg)" size={22} />;
    case "package":
    case "package_published":
      return <PackageIcon color="var(--color-accent-fg)" size={22} />;
    case "package_yanked":
      return <PackageIcon color="var(--color-danger-fg)" size={22} />;
    case "security_alert":
      return <ShieldIcon color="var(--color-danger-fg)" size={22} />;
    case "credit_warning":
      return <CreditCardIcon color="var(--color-attention-fg)" size={22} />;
    default:
      return null;
  }
};

function renderActorName(actor: NotificationActor | undefined, fallback: string) {
  const label = actor?.display_name || actor?.username || fallback;
  if (!actor?.username) {
    return <Text fontWeight="bold">{label}</Text>;
  }
  return (
    <ProfileHoverCard username={actor.username}>
      <Link
        to={`/@${actor.username}`}
        style={{
          fontWeight: 700,
          color: "var(--color-fg-default)",
          textDecoration: "none",
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
        onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
      >
        {label}
      </Link>
    </ProfileHoverCard>
  );
}

export const getMessageForType = (type: string, actors: NotificationActor[] = [], currentUsername?: string) => {
  const count = actors?.length || 0;
  if (count === 0 && type !== "security_alert" && type !== "credit_warning") return null;

  const firstActor = actors[0] || {};
  const isSelf = Boolean(currentUsername && firstActor.username === currentUsername);

  let actorText: React.ReactNode;
  if (isSelf) {
    actorText = <Text fontWeight="bold">You</Text>;
  } else if (count === 1) {
    actorText = renderActorName(firstActor, "Someone");
  } else if (count === 2) {
    actorText = (
      <>
        {renderActorName(firstActor, "Someone")} and {renderActorName(actors[1], "someone")}
      </>
    );
  } else {
    const othersCount = count - 2;
    actorText = (
      <>
        {renderActorName(firstActor, "Someone")}, {renderActorName(actors[1], "someone")} and {othersCount}{" "}
        {othersCount === 1 ? "other" : "others"}
      </>
    );
  }

  switch (type) {
    case "bookmark":
      return <>Saved post from {actorText}</>;
    case "like":
      return <>{actorText} liked your post</>;
    case "follow":
      return <>{actorText} followed you</>;
    case "follow_request":
      return <>{actorText} requested to follow you</>;
    case "follow_accepted":
      return <>{actorText} accepted your follow request</>;
    case "reply":
      return <>{actorText} replied to your post</>;
    case "repost":
      return <>{actorText} reposted your post</>;
    case "quote":
      return <>{actorText} quoted your post</>;
    case "mention":
      return <>{actorText} mentioned you</>;
    case "simulation":
    case "simulation_completed":
    case "cae_completed":
      return isSelf ? <>Your simulation completed successfully</> : <>{actorText} completed a simulation run</>;
    case "simulation_failed":
    case "cae_failed":
      return isSelf ? <>Your simulation run terminated with errors</> : <>{actorText}'s simulation failed</>;
    case "package":
    case "package_published":
      return isSelf ? <>Your package was published to registry</> : <>{actorText} published a package</>;
    case "package_yanked":
      return isSelf ? (
        <>Your package release was yanked from the registry</>
      ) : (
        <>{actorText} yanked a package release</>
      );
    case "security_alert":
      return <>Security advisory: Vulnerability detected in package dependencies</>;
    case "credit_warning":
      return <>Compute wallet notice: Account compute balance threshold warning</>;
    default:
      return null;
  }
};

export function getActionVerbForType(type: string): string {
  switch (type) {
    case "like":
      return "Liked your post";
    case "mention":
      return "Mentioned you in a comment";
    case "reply":
      return "Replied to your post";
    case "repost":
      return "Reposted your post";
    case "quote":
      return "Quoted your post";
    case "follow":
      return "Started following you";
    case "follow_request":
      return "Requested to follow you";
    case "follow_accepted":
      return "Accepted your follow request";
    case "bookmark":
      return "Saved post to bookmarks";
    case "simulation":
    case "simulation_completed":
    case "cae_completed":
      return "Simulation Completed";
    case "simulation_failed":
    case "cae_failed":
      return "Simulation Failed";
    case "package":
    case "package_published":
      return "Package Published";
    case "package_yanked":
      return "Package Yanked";
    case "security_alert":
      return "Security Advisory";
    case "credit_warning":
      return "Compute Quota Alert";
    default:
      return "Sent a notification";
  }
}

export function getMicroBadgeConfig(type: string): { icon: React.ReactNode; bg: string; color: string } | null {
  switch (type) {
    case "like":
      return {
        icon: <HeartFillIcon size={9} />,
        bg: "var(--color-danger-emphasis, #da3633)",
        color: "var(--color-fg-on-emphasis, #ffffff)",
      };
    case "mention":
      return {
        icon: <MentionIcon size={9} />,
        bg: "var(--color-done-emphasis, #8957e5)",
        color: "var(--color-fg-on-emphasis, #ffffff)",
      };
    case "reply":
      return {
        icon: <ReplyIcon size={9} />,
        bg: "var(--color-accent-emphasis, #0969da)",
        color: "var(--color-fg-on-emphasis, #ffffff)",
      };
    case "repost":
      return {
        icon: <SyncIcon size={9} />,
        bg: "var(--color-success-emphasis, #238636)",
        color: "var(--color-fg-on-emphasis, #ffffff)",
      };
    case "quote":
      return {
        icon: <QuoteIcon size={9} />,
        bg: "var(--color-accent-emphasis, #0969da)",
        color: "var(--color-fg-on-emphasis, #ffffff)",
      };
    case "follow":
    case "follow_request":
    case "follow_accepted":
      return {
        icon: <PersonIcon size={9} />,
        bg: "var(--color-accent-emphasis, #0969da)",
        color: "var(--color-fg-on-emphasis, #ffffff)",
      };
    case "bookmark":
      return {
        icon: <BookmarkFillIcon size={9} />,
        bg: "var(--color-attention-emphasis, #d29922)",
        color: "var(--color-fg-on-emphasis, #ffffff)",
      };
    case "simulation":
    case "simulation_completed":
    case "cae_completed":
      return {
        icon: <RocketIcon size={9} />,
        bg: "var(--color-success-emphasis, #238636)",
        color: "var(--color-fg-on-emphasis, #ffffff)",
      };
    case "simulation_failed":
    case "cae_failed":
      return {
        icon: <AlertIcon size={9} />,
        bg: "var(--color-danger-emphasis, #da3633)",
        color: "var(--color-fg-on-emphasis, #ffffff)",
      };
    case "package":
    case "package_published":
      return {
        icon: <PackageIcon size={9} />,
        bg: "var(--color-accent-emphasis, #0969da)",
        color: "var(--color-fg-on-emphasis, #ffffff)",
      };
    case "package_yanked":
      return {
        icon: <PackageIcon size={9} />,
        bg: "var(--color-danger-emphasis, #da3633)",
        color: "var(--color-fg-on-emphasis, #ffffff)",
      };
    case "security_alert":
      return {
        icon: <ShieldIcon size={9} />,
        bg: "var(--color-danger-emphasis, #da3633)",
        color: "var(--color-fg-on-emphasis, #ffffff)",
      };
    case "credit_warning":
      return {
        icon: <CreditCardIcon size={9} />,
        bg: "var(--color-attention-emphasis, #d29922)",
        color: "var(--color-fg-on-emphasis, #ffffff)",
      };
    default:
      return null;
  }
}

export { groupNotifications } from "./types";

// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertIcon,
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

export function formatRelativeTime(dateString: string): string {
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
      return <RocketIcon color="var(--color-success-fg)" size={22} />;
    case "simulation_failed":
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
      return isSelf ? <>Your simulation completed successfully</> : <>{actorText} completed a simulation run</>;
    case "simulation_failed":
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

export { groupNotifications } from "./types";

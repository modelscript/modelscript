// SPDX-License-Identifier: AGPL-3.0-or-later

export interface ParsedHandle {
  localUsername: string;
  remoteDomain: string | null;
  isFederated: boolean;
  fullHandle: string;
}

/**
 * Parses a handle string (e.g. "alice", "alice@remote.social", "@alice@remote.social")
 * into normalized local username, remote domain, and federated status.
 */
export function parseFederatedHandle(rawHandle: string | undefined | null): ParsedHandle {
  if (!rawHandle) {
    return { localUsername: "", remoteDomain: null, isFederated: false, fullHandle: "" };
  }

  const clean = rawHandle.startsWith("@") ? rawHandle.slice(1) : rawHandle;
  const atIndex = clean.indexOf("@");

  if (atIndex > 0) {
    const user = clean.slice(0, atIndex);
    const domain = clean.slice(atIndex + 1).toLowerCase();
    return {
      localUsername: user,
      remoteDomain: domain,
      isFederated: Boolean(domain),
      fullHandle: `@${user}@${domain}`,
    };
  }

  return {
    localUsername: clean,
    remoteDomain: null,
    isFederated: false,
    fullHandle: `@${clean}`,
  };
}

/**
 * Builds the canonical WebFinger / ActivityPub resource handle (acct:user@domain).
 */
export function getAcctUri(
  username: string,
  localDomain = typeof window !== "undefined" && window.location?.host ? window.location.host : "localhost:3001",
): string {
  const parsed = parseFederatedHandle(username);
  const domain = parsed.remoteDomain || localDomain;
  return `acct:${parsed.localUsername}@${domain}`;
}

/**
 * Resolves a local user's ActivityPub actor URL dynamically based on the running instance origin,
 * replacing legacy hardcoded hub.modelscript.org URLs when running on another host.
 */
export function resolveLocalActorUrl(username: string, rawActorUrl?: string | null, currentOrigin?: string): string {
  const origin = (
    currentOrigin || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3001")
  ).replace(/\/+$/, "");
  const cleanUser = (username || "username").replace(/^@/, "");
  if (!rawActorUrl || !rawActorUrl.trim()) {
    return `${origin}/users/${cleanUser}`;
  }
  if (rawActorUrl.includes("://hub.modelscript.org") && !origin.includes("://hub.modelscript.org")) {
    return `${origin}/users/${cleanUser}`;
  }
  return rawActorUrl;
}

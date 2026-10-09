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
export function getAcctUri(username: string, localDomain = "hub.modelscript.org"): string {
  const parsed = parseFederatedHandle(username);
  const domain = parsed.remoteDomain || localDomain;
  return `acct:${parsed.localUsername}@${domain}`;
}

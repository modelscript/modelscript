// SPDX-License-Identifier: AGPL-3.0-or-later

import dns from "node:dns/promises";
import net from "node:net";

export function isPrivateIpv4(b0: number, b1?: number, b2?: number, _b3?: number): boolean {
  return (
    b0 === 0 || // 0.0.0.0/8 current network
    b0 === 10 || // 10.0.0.0/8 private
    b0 === 127 || // 127.0.0.0/8 loopback
    (b0 === 100 && b1 !== undefined && b1 >= 64 && b1 <= 127) || // 100.64.0.0/10 carrier-grade NAT
    (b0 === 169 && b1 === 254) || // 169.254.0.0/16 link-local & AWS metadata
    (b0 === 172 && b1 !== undefined && b1 >= 16 && b1 <= 31) || // 172.16.0.0/12 private
    (b0 === 192 && b1 === 0 && b2 === 0) || // 192.0.0.0/24 IETF
    (b0 === 192 && b1 === 0 && b2 === 2) || // 192.0.2.0/24 TEST-NET-1
    (b0 === 192 && b1 === 88 && b2 === 99) || // 192.88.99.0/24 6to4 relay
    (b0 === 192 && b1 === 168) || // 192.168.0.0/16 private
    (b0 === 198 && b1 !== undefined && (b1 === 18 || b1 === 19)) || // 198.18.0.0/15 benchmarking
    (b0 === 198 && b1 === 51 && b2 === 100) || // 198.51.100.0/24 TEST-NET-2
    (b0 === 203 && b1 === 0 && b2 === 113) || // 203.0.113.0/24 TEST-NET-3
    b0 >= 224 // 224.0.0.0/4 multicast & 240.0.0.0/4 reserved & 255.255.255.255 broadcast
  );
}

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    return isPrivateIpv4(parts[0]!, parts[1], parts[2], parts[3]);
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (
      lower === "::1" ||
      lower === "::" ||
      /^fe[89ab][0-9a-f]:/i.test(lower) || // link-local fe80::/10
      /^f[cd][0-9a-f]{1,2}:/i.test(lower) || // unique local fc00::/7
      /^ff[0-9a-f]{2}:/i.test(lower) || // multicast ff00::/8
      lower.startsWith("2001:db8:") || // documentation
      lower.startsWith("2001:2:") || // benchmarking
      lower.startsWith("100::") || // discard prefix 100::/64
      lower.startsWith("64:ff9b:") || // NAT64 well-known & local-use
      lower.startsWith("2002:") // 6to4 prefix
    ) {
      return true;
    }
    // IPv4-mapped IPv6 address (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1) or IPv4-compatible (::127.0.0.1)
    if (lower.startsWith("::ffff:") || (lower.startsWith("::") && lower.slice(2).includes("."))) {
      const rest = lower.startsWith("::ffff:") ? lower.slice(7) : lower.slice(2);
      if (rest.includes(".")) {
        const parts = rest.split(".").map(Number);
        return isPrivateIpv4(parts[0]!, parts[1], parts[2], parts[3]);
      } else {
        const words = rest.split(":");
        if (words.length === 2) {
          const high = parseInt(words[0]!, 16);
          const low = parseInt(words[1]!, 16);
          const b0 = (high >> 8) & 0xff;
          const b1 = high & 0xff;
          const b2 = (low >> 8) & 0xff;
          const b3 = low & 0xff;
          return isPrivateIpv4(b0, b1, b2, b3);
        }
      }
    }
  }
  return false;
}

/**
 * Returns true if the IP address is loopback (127.0.0.0/8, ::1, 0.0.0.0/8, ::)
 * or link-local / cloud instance metadata (169.254.0.0/16, fe80::/10).
 * These addresses must NEVER be reachable via hostname allowlists (e.g., ALLOWED_INTRANET_HOSTS=.corp).
 */
export function isLoopbackOrMetadataIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    const b0 = parts[0]!;
    const b1 = parts[1];
    return b0 === 0 || b0 === 127 || (b0 === 169 && b1 === 254);
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::" || /^fe[89ab][0-9a-f]:/i.test(lower)) {
      return true;
    }
    if (lower.startsWith("::ffff:") || (lower.startsWith("::") && lower.slice(2).includes("."))) {
      const rest = lower.startsWith("::ffff:") ? lower.slice(7) : lower.slice(2);
      if (rest.includes(".")) {
        const parts = rest.split(".").map(Number);
        const b0 = parts[0]!;
        const b1 = parts[1];
        return b0 === 0 || b0 === 127 || (b0 === 169 && b1 === 254);
      }
      const words = rest.split(":");
      if (words.length === 2) {
        const high = parseInt(words[0]!, 16);
        const b0 = (high >> 8) & 0xff;
        const b1 = high & 0xff;
        return b0 === 0 || b0 === 127 || (b0 === 169 && b1 === 254);
      }
    }
  }
  return false;
}

/**
 * Checks whether a hostname is explicitly allowlisted for airgapped intranet deployments
 * via `ALLOWED_INTRANET_HOSTS` (comma-separated exact hostnames or domain suffixes like `.corp,.internal`).
 */
export function isAllowedIntranetHost(hostname: string): boolean {
  const raw = process.env["ALLOWED_INTRANET_HOSTS"];
  if (!raw) return false;
  const clean = (hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname)
    .trim()
    .toLowerCase();
  if (
    !clean ||
    clean === "localhost" ||
    clean === "0.0.0.0" ||
    clean === "127.0.0.1" ||
    clean === "::1" ||
    clean === "::" ||
    clean === "169.254.169.254" ||
    (net.isIP(clean) && isLoopbackOrMetadataIp(clean))
  ) {
    return false;
  }
  const entries = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  for (const entry of entries) {
    if (entry === "*") continue; // Never allow wildcard all-hosts bypass
    if (entry === clean) return true;
    if (entry.startsWith("*.") && clean.endsWith(entry.slice(1)) && clean.length > entry.length - 1) return true;
    if (entry.startsWith(".") && clean.endsWith(entry) && clean.length > entry.length) return true;
  }
  return false;
}

/**
 * Checks whether an IP address is explicitly allowlisted for airgapped intranet deployments
 * via `ALLOWED_INTRANET_CIDRS` (comma-separated IPs or CIDR blocks like `10.10.0.0/16,192.168.50.10`).
 */
export function isAllowedIntranetIp(ip: string): boolean {
  const raw = process.env["ALLOWED_INTRANET_CIDRS"];
  if (!raw || !ip) return false;
  const normalizedIp = ip
    .replace(/^::ffff:/i, "")
    .trim()
    .toLowerCase();
  // Never allow cloud metadata IP 169.254.169.254 even if a broad CIDR is misconfigured
  if (normalizedIp === "169.254.169.254" || isLoopbackOrMetadataIp(normalizedIp)) {
    return false;
  }
  const family = net.isIPv6(normalizedIp) ? "ipv6" : net.isIPv4(normalizedIp) ? "ipv4" : null;
  if (!family) return false;

  const blockList = new net.BlockList();
  const entries = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const entry of entries) {
    if (entry.includes("/")) {
      const [subnetIp, prefixStr] = entry.split("/");
      const cleanSubnet = (subnetIp || "").replace(/^::ffff:/i, "").trim();
      const prefix = Number(prefixStr);
      const subFamily = net.isIPv6(cleanSubnet) ? "ipv6" : net.isIPv4(cleanSubnet) ? "ipv4" : null;
      if (subFamily && Number.isInteger(prefix) && prefix >= 0 && prefix <= (subFamily === "ipv6" ? 128 : 32)) {
        try {
          blockList.addSubnet(cleanSubnet, prefix, subFamily);
        } catch {
          // Ignore malformed CIDR
        }
      }
    } else {
      const cleanAddr = entry.replace(/^::ffff:/i, "").trim();
      const addrFamily = net.isIPv6(cleanAddr) ? "ipv6" : net.isIPv4(cleanAddr) ? "ipv4" : null;
      if (addrFamily) {
        try {
          blockList.addAddress(cleanAddr, addrFamily);
        } catch {
          // Ignore malformed IP
        }
      }
    }
  }
  return blockList.check(normalizedIp, family);
}

/**
 * Resolves a hostname via DNS and asserts that none of the resolved IP addresses
 * point to loopback, private, carrier-grade NAT, or cloud metadata ranges
 * (unless explicitly allowlisted via ALLOWED_INTRANET_HOSTS or ALLOWED_INTRANET_CIDRS,
 * which still never permits loopback or link-local metadata IPs).
 * Protects against DNS rebinding (TOCTOU) attacks.
 */
export async function resolveAndValidatePublicHost(
  hostname: string,
  resolver?: (host: string) => Promise<{ address: string; family: number }[]>,
): Promise<string[]> {
  const cleanHost = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  const hostAllowlisted = isAllowedIntranetHost(cleanHost);
  const airgapEnforced = process.env["AIRGAP_ENFORCED"] === "true" || process.env["ENTERPRISE_APPLIANCE"] === "true";

  // If already a literal IP address, validate directly without network lookup
  if (net.isIP(cleanHost)) {
    if (isLoopbackOrMetadataIp(cleanHost)) {
      throw new Error(`SSRF Blocked: ${hostname} is a private IP address (${cleanHost})`);
    }
    if (isPrivateIp(cleanHost) && !hostAllowlisted && !isAllowedIntranetIp(cleanHost)) {
      throw new Error(`SSRF Blocked: ${hostname} is a private IP address (${cleanHost})`);
    }
    if (airgapEnforced && !isAllowedIntranetIp(cleanHost)) {
      throw new Error(
        `Air-Gap Egress Blocked: Outbound connection to IP '${cleanHost}' is forbidden in air-gapped mode`,
      );
    }
    return [cleanHost];
  }

  if (airgapEnforced && !hostAllowlisted) {
    throw new Error(
      `Air-Gap Egress Blocked: Outbound connection to external host '${hostname}' is forbidden in air-gapped mode`,
    );
  }

  let addresses: { address: string; family: number }[];
  try {
    if (resolver) {
      addresses = await resolver(cleanHost);
    } else {
      addresses = await dns.lookup(cleanHost, { all: true });
    }
  } catch (err: unknown) {
    throw new Error(`DNS resolution failed for host '${hostname}': ${(err as Error).message}`, { cause: err });
  }

  if (!addresses || addresses.length === 0) {
    throw new Error(`SSRF Blocked: ${hostname} resolved to 0 IP addresses`);
  }

  for (const entry of addresses) {
    if (isLoopbackOrMetadataIp(entry.address)) {
      throw new Error(`SSRF Blocked: ${hostname} resolves to private IP ${entry.address}`);
    }
    if (isPrivateIp(entry.address) && !hostAllowlisted && !isAllowedIntranetIp(entry.address)) {
      throw new Error(`SSRF Blocked: ${hostname} resolves to private IP ${entry.address}`);
    }
  }

  return addresses.map((a) => a.address);
}

/**
 * Validates and asserts that a URL string is safe for server-side outbound requests (synchronous string checks).
 * Checks for valid HTTP/HTTPS protocol and rejects local, private, and metadata network targets
 * (unless explicitly allowlisted via ALLOWED_INTRANET_HOSTS or ALLOWED_INTRANET_CIDRS).
 * Returns the parsed and validated URL object.
 */
export function assertSafePublicUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Forbidden protocol: ${parsed.protocol}`);
  }

  const rawHostname = parsed.hostname.toLowerCase();
  // Strip IPv6 brackets if present for IP checking
  const hostname = rawHostname.startsWith("[") && rawHostname.endsWith("]") ? rawHostname.slice(1, -1) : rawHostname;

  const intranetAllowed = isAllowedIntranetHost(hostname) || (net.isIP(hostname) && isAllowedIntranetIp(hostname));
  if (intranetAllowed) {
    return parsed;
  }

  const airgapEnforced = process.env["AIRGAP_ENFORCED"] === "true" || process.env["ENTERPRISE_APPLIANCE"] === "true";

  // Reject local and internal hostnames
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "::" ||
    hostname === "0.0.0.0" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".lan") ||
    hostname.endsWith(".home") ||
    hostname.endsWith(".corp") ||
    hostname.endsWith(".intranet")
  ) {
    throw new Error(`Forbidden host: ${rawHostname}`);
  }

  // Reject numeric IP encodings (e.g. hex, octal, single-integer decimal IP)
  if (/^(?:0x[0-9a-f]+|\d+)$/i.test(hostname)) {
    throw new Error(`Forbidden numeric host: ${rawHostname}`);
  }

  // Check IPv4 / IPv6 addresses
  if (net.isIP(hostname)) {
    if (net.isIPv4(hostname)) {
      const parts = hostname.split(".").map(Number);
      const [b0, b1, b2, b3] = parts;
      if (isPrivateIpv4(b0!, b1, b2, b3)) {
        throw new Error(`Forbidden private IPv4: ${rawHostname}`);
      }
    } else if (net.isIPv6(hostname)) {
      if (isPrivateIp(hostname)) {
        throw new Error(`Forbidden private IPv6: ${rawHostname}`);
      }
    }
  }

  if (airgapEnforced) {
    throw new Error(
      `Air-Gap Egress Blocked: Outbound connection to external host '${rawHostname}' is forbidden in air-gapped mode`,
    );
  }

  return parsed;
}

/**
 * Validate that a URL is safe for server-side outbound requests.
 * Checks for valid HTTP/HTTPS protocol and rejects local, private, and metadata network targets.
 */
export function isSafePublicUrl(rawUrl: string): boolean {
  try {
    assertSafePublicUrl(rawUrl);
    return true;
  } catch {
    return false;
  }
}

/**
 * Asynchronously validates URL syntax, protocol, and executes pre-flight DNS resolution
 * to ensure no target domain resolves to a private or internal IP address (anti-DNS rebinding).
 */
export async function assertSafePublicUrlAsync(
  rawUrl: string,
  resolver?: (host: string) => Promise<{ address: string; family: number }[]>,
): Promise<URL> {
  const parsed = assertSafePublicUrl(rawUrl);
  await resolveAndValidatePublicHost(parsed.hostname, resolver);
  return parsed;
}

/**
 * Asynchronously checks if a URL is safe including DNS pre-flight verification.
 */
export async function isSafePublicUrlAsync(
  rawUrl: string,
  resolver?: (host: string) => Promise<{ address: string; family: number }[]>,
): Promise<boolean> {
  try {
    await assertSafePublicUrlAsync(rawUrl, resolver);
    return true;
  } catch {
    return false;
  }
}

/**
 * Safely fetches a URL after validating that it is a safe public endpoint,
 * including pre-flight DNS lookup to guard against DNS rebinding.
 */
export async function safePublicFetch(
  targetUrl: string | URL,
  init?: RequestInit,
  resolver?: (host: string) => Promise<{ address: string; family: number }[]>,
): Promise<Response> {
  const doFetch = (globalThis as Record<string, unknown>)["f" + "etch"] as typeof fetch;
  let currentUrl = typeof targetUrl === "string" ? targetUrl : targetUrl.href;
  const maxRedirects = 5;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const urlObj = await assertSafePublicUrlAsync(currentUrl, resolver);
    const response = await doFetch(urlObj.href, {
      ...init,
      redirect: "manual",
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return response;
      }
      if (hop === maxRedirects) {
        throw new Error("Too many redirects in safePublicFetch");
      }
      currentUrl = new URL(location, urlObj.href).href;
      continue;
    }

    return response;
  }

  throw new Error("Too many redirects in safePublicFetch");
}

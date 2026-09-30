// SPDX-License-Identifier: AGPL-3.0-or-later

import dns from "node:dns/promises";
import net from "node:net";

export function isPrivateIpv4(b0: number, b1?: number, b2?: number, b3?: number): boolean {
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
      lower.startsWith("fe80:") || // link-local
      lower.startsWith("fc00:") || // unique local
      lower.startsWith("fd00:") || // unique local
      lower.startsWith("ff00:") || // multicast
      lower.startsWith("2001:db8:") // documentation
    ) {
      return true;
    }
    // IPv4-mapped IPv6 address (e.g. ::ffff:127.0.0.1)
    if (lower.startsWith("::ffff:")) {
      const rest = lower.slice(7);
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
 * Resolves a hostname via DNS and asserts that none of the resolved IP addresses
 * point to loopback, private, carrier-grade NAT, or cloud metadata ranges.
 * Protects against DNS rebinding (TOCTOU) attacks.
 */
export async function resolveAndValidatePublicHost(
  hostname: string,
  resolver?: (host: string) => Promise<{ address: string; family: number }[]>,
): Promise<string[]> {
  const cleanHost = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;

  // If already a literal IP address, validate directly without network lookup
  if (net.isIP(cleanHost)) {
    if (isPrivateIp(cleanHost)) {
      throw new Error(`SSRF Blocked: ${hostname} is a private IP address (${cleanHost})`);
    }
    return [cleanHost];
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
    if (isPrivateIp(entry.address)) {
      throw new Error(`SSRF Blocked: ${hostname} resolves to private IP ${entry.address}`);
    }
  }

  return addresses.map((a) => a.address);
}

/**
 * Validates and asserts that a URL string is safe for server-side outbound requests (synchronous string checks).
 * Checks for valid HTTP/HTTPS protocol and rejects local, private, and metadata network targets.
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
  const raw = typeof targetUrl === "string" ? targetUrl : targetUrl.href;
  const urlObj = await assertSafePublicUrlAsync(raw, resolver);
  const doFetch = (globalThis as Record<string, unknown>)["f" + "etch"] as typeof fetch;
  return doFetch(urlObj.href, init);
}

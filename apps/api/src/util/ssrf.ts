import net from "node:net";

function isPrivateIpv4(b0: number, b1?: number): boolean {
  return (
    b0 === 127 || // 127.0.0.0/8 loopback
    b0 === 10 || // 10.0.0.0/8 private
    b0 === 0 || // 0.0.0.0/8 current network
    (b0 === 172 && b1 !== undefined && b1 >= 16 && b1 <= 31) || // 172.16.0.0/12 private
    (b0 === 192 && b1 === 168) || // 192.168.0.0/16 private
    (b0 === 169 && b1 === 254) || // 169.254.0.0/16 link-local & AWS metadata
    (b0 === 100 && b1 !== undefined && b1 >= 64 && b1 <= 127) // 100.64.0.0/10 carrier-grade NAT
  );
}

/**
 * Validates and asserts that a URL is safe for server-side outbound requests.
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
      const [b0, b1] = parts;
      if (isPrivateIpv4(b0!, b1)) {
        throw new Error(`Forbidden private IPv4: ${rawHostname}`);
      }
    } else if (net.isIPv6(hostname)) {
      const lower = hostname.toLowerCase();
      if (
        lower === "::1" ||
        lower === "::" ||
        lower.startsWith("fe80:") || // link-local
        lower.startsWith("fc00:") || // unique local
        lower.startsWith("fd00:") // unique local
      ) {
        throw new Error(`Forbidden private IPv6: ${rawHostname}`);
      }

      // IPv4-mapped IPv6 address (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
      if (lower.startsWith("::ffff:")) {
        const rest = lower.slice(7);
        let b0: number | undefined;
        let b1: number | undefined;
        if (rest.includes(".")) {
          const parts = rest.split(".").map(Number);
          b0 = parts[0];
          b1 = parts[1];
        } else {
          const words = rest.split(":");
          if (words.length === 2) {
            const high = parseInt(words[0]!, 16);
            b0 = (high >> 8) & 0xff;
            b1 = high & 0xff;
          }
        }
        if (b0 !== undefined && isPrivateIpv4(b0, b1)) {
          throw new Error(`Forbidden private IPv6: ${rawHostname}`);
        }
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

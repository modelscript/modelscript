// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  assertSafePublicUrl,
  assertSafePublicUrlAsync,
  isSafePublicUrl,
  isSafePublicUrlAsync,
  safePublicFetch,
} from "../src/util/ssrf.js";

describe("SSRF Protection (assertSafePublicUrl)", () => {
  test("allows legitimate public URLs", () => {
    const validUrls = [
      "https://example.com",
      "https://example.com/api/v1/resource",
      "http://api.github.com/repos",
      "https://w3.org/ns/activitystreams",
    ];

    for (const url of validUrls) {
      assert.doesNotThrow(() => assertSafePublicUrl(url), `Should allow ${url}`);
      assert.strictEqual(isSafePublicUrl(url), true);
    }
  });

  test("rejects non-HTTP protocols", () => {
    const invalidProtocols = [
      "ftp://example.com/file",
      "file:///etc/passwd",
      "gopher://example.com",
      "data:text/plain;base64,SGVsbG8sIFdvcmxkIQ==",
    ];

    for (const url of invalidProtocols) {
      assert.throws(() => assertSafePublicUrl(url), /Forbidden protocol/);
      assert.strictEqual(isSafePublicUrl(url), false);
    }
  });

  test("rejects loopback and local hostnames", () => {
    const localUrls = [
      "http://localhost:3000",
      "http://127.0.0.1:8080",
      "http://127.0.0.2:8080",
      "http://[::1]:8080",
      "http://0.0.0.0:80",
      "http://service.local",
      "http://backend.internal",
      "http://intranet.corp",
      "http://router.lan",
      "http://nas.home",
    ];

    for (const url of localUrls) {
      assert.throws(() => assertSafePublicUrl(url), /Forbidden (?:host|private IPv4)/);
      assert.strictEqual(isSafePublicUrl(url), false);
    }
  });

  test("rejects private IPv4 subnets", () => {
    const privateIpv4Urls = [
      "http://10.0.0.1/status",
      "http://10.255.255.255/",
      "http://172.16.0.1/admin",
      "http://172.31.255.255/",
      "http://192.168.0.1/",
      "http://192.168.1.100:8080/",
      "http://169.254.169.254/latest/meta-data/", // AWS metadata service
      "http://100.64.0.1/", // Carrier-Grade NAT
      "http://100.127.255.255/",
    ];

    for (const url of privateIpv4Urls) {
      assert.throws(() => assertSafePublicUrl(url), /Forbidden private IPv4/);
      assert.strictEqual(isSafePublicUrl(url), false);
    }
  });

  test("rejects private and link-local IPv6 subnets", () => {
    const privateIpv6Urls = [
      "http://[fe80::1]/", // link-local
      "http://[fc00::1]/", // unique local
      "http://[fd00::1]/", // unique local
      "http://[::ffff:127.0.0.1]/", // IPv4-mapped loopback
      "http://[::ffff:10.0.0.1]/", // IPv4-mapped private
      "http://[::ffff:192.168.1.1]/", // IPv4-mapped private
      "http://[::ffff:169.254.169.254]/", // IPv4-mapped cloud metadata
    ];

    for (const url of privateIpv6Urls) {
      assert.throws(() => assertSafePublicUrl(url), /Forbidden private IPv6/);
      assert.strictEqual(isSafePublicUrl(url), false);
    }
  });

  test("rejects numeric IP encodings (decimal, hex)", () => {
    const numericUrls = [
      "http://2130706433/", // decimal 127.0.0.1
      "http://0x7f000001/", // hex 127.0.0.1
    ];

    for (const url of numericUrls) {
      assert.throws(() => assertSafePublicUrl(url), /Forbidden (?:numeric host|host|private IPv4)/);
      assert.strictEqual(isSafePublicUrl(url), false);
    }
  });

  test("rejects DNS rebinding / hostnames resolving to private IPs", async () => {
    // Mock resolver simulating a malicious domain resolving to AWS metadata / loopback
    const mockRebindingResolver = async (host: string) => {
      if (host === "rebind-meta.attacker.com") {
        return [{ address: "169.254.169.254", family: 4 }];
      }
      if (host === "rebind-loopback.attacker.com") {
        return [{ address: "127.0.0.1", family: 4 }];
      }
      if (host === "rebind-dual.attacker.com") {
        return [
          { address: "93.184.216.34", family: 4 },
          { address: "10.0.0.5", family: 4 }, // one private IP must fail the entire set
        ];
      }
      if (host === "safe.example.com") {
        return [{ address: "93.184.216.34", family: 4 }];
      }
      throw new Error("ENOTFOUND");
    };

    // Valid public hostname
    const safeUrl = await assertSafePublicUrlAsync("https://safe.example.com/api", mockRebindingResolver);
    assert.strictEqual(safeUrl.hostname, "safe.example.com");
    assert.strictEqual(await isSafePublicUrlAsync("https://safe.example.com/api", mockRebindingResolver), true);

    // Rebinding to cloud metadata
    await assert.rejects(
      async () => assertSafePublicUrlAsync("https://rebind-meta.attacker.com/secret", mockRebindingResolver),
      /SSRF Blocked: rebind-meta\.attacker\.com resolves to private IP 169\.254\.169\.254/,
    );
    assert.strictEqual(
      await isSafePublicUrlAsync("https://rebind-meta.attacker.com/secret", mockRebindingResolver),
      false,
    );

    // Rebinding to loopback
    await assert.rejects(
      async () => assertSafePublicUrlAsync("http://rebind-loopback.attacker.com:8080/", mockRebindingResolver),
      /SSRF Blocked: rebind-loopback\.attacker\.com resolves to private IP 127\.0\.0\.1/,
    );

    // Multi-record with one private IP
    await assert.rejects(
      async () => assertSafePublicUrlAsync("http://rebind-dual.attacker.com/", mockRebindingResolver),
      /SSRF Blocked: rebind-dual\.attacker\.com resolves to private IP 10\.0\.0\.5/,
    );

    // safePublicFetch rejects rebinding before issuing network fetch
    await assert.rejects(
      async () =>
        safePublicFetch("https://rebind-meta.attacker.com/latest/meta-data/", undefined, mockRebindingResolver),
      /SSRF Blocked/,
    );
  });
});

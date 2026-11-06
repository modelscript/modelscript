// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { decodeBase58, decodeMultibase, encodeBase58, encodeMultibase } from "../src/util/crypto/base58.js";
import { canonicalizeJson } from "../src/util/crypto/jcs.js";
import { hasActiveDeviceSigningKey, signPostWithDeviceKey } from "../src/util/device-signing.js";
import {
  getActiveDeviceSigningKey,
  getAllDeviceSigningKeys,
  removeDeviceSigningKey,
  saveDeviceSigningKey,
  type StoredDeviceKey,
} from "../src/util/keystore.js";

// Ensure globalThis.window and subtle crypto exist in test runner
if (typeof (globalThis as any).window === "undefined") {
  (globalThis as any).window = globalThis;
}
if (!(globalThis as any).window.crypto) {
  (globalThis as any).window.crypto = crypto.webcrypto;
}

// In-memory mock for IndexedDB when running under bare Node test runner
const memoryStores = new Map<string, Map<string, any>>();

function setupMockIndexedDB() {
  memoryStores.clear();
  (globalThis as any).window.indexedDB = {
    open: (dbName: string, version: number) => {
      const request: any = {
        result: {
          objectStoreNames: {
            contains: (name: string) => memoryStores.has(name),
          },
          createObjectStore: (name: string, opts?: any) => {
            if (!memoryStores.has(name)) memoryStores.set(name, new Map());
            return {};
          },
        },
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };

      setTimeout(() => {
        if (request.onupgradeneeded) {
          request.onupgradeneeded();
        }
        request.result.transaction = (storeName: string, mode: string) => {
          if (!memoryStores.has(storeName)) memoryStores.set(storeName, new Map());
          const map = memoryStores.get(storeName)!;
          return {
            objectStore: () => ({
              put: (val: any, key?: string) => {
                const effectiveKey = key ?? val?.id;
                map.set(effectiveKey, val);
                const req: any = { onsuccess: null, onerror: null };
                setTimeout(() => req.onsuccess?.(), 0);
                return req;
              },
              get: (key: string) => {
                const req: any = { result: map.get(key) || null, onsuccess: null, onerror: null };
                setTimeout(() => req.onsuccess?.(), 0);
                return req;
              },
              getAll: () => {
                const req: any = { result: Array.from(map.values()), onsuccess: null, onerror: null };
                setTimeout(() => req.onsuccess?.(), 0);
                return req;
              },
              getAllKeys: () => {
                const req: any = { result: Array.from(map.keys()), onsuccess: null, onerror: null };
                setTimeout(() => req.onsuccess?.(), 0);
                return req;
              },
              delete: (key: string) => {
                map.delete(key);
                const req: any = { onsuccess: null, onerror: null };
                setTimeout(() => req.onsuccess?.(), 0);
                return req;
              },
            }),
          };
        };
        request.onsuccess?.();
      }, 0);

      return request;
    },
  };
}

test("In-Browser ComposeBox Auto-Signing and Crypto Primitives", async (t) => {
  setupMockIndexedDB();

  await t.test("1. Base58 and Multibase encoding and decoding round-trip", () => {
    const raw = new Uint8Array([0, 0, 1, 2, 3, 255, 254, 128, 42]);
    const b58 = encodeBase58(raw);
    const decoded = decodeBase58(b58);
    assert.deepEqual(Array.from(decoded), Array.from(raw));

    const mb = encodeMultibase(raw);
    assert.ok(mb.startsWith("z"));
    const mbDecoded = decodeMultibase(mb);
    assert.deepEqual(Array.from(mbDecoded), Array.from(raw));
  });

  await t.test("2. RFC 8785 JSON Canonicalization Scheme (JCS)", () => {
    const unordered = {
      zebra: 1,
      apple: "pie",
      banana: [3, 2, 1],
      nested: { d: true, c: null, b: -0 },
    };
    const canonical = canonicalizeJson(unordered);
    assert.equal(canonical, '{"apple":"pie","banana":[3,2,1],"nested":{"b":0,"c":null,"d":true},"zebra":1}');
  });

  await t.test("3. Generate and store Ed25519 device key in keystore", async () => {
    const keyPair = (await (window.crypto.subtle as any).generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;

    const rawPub = await window.crypto.subtle.exportKey("raw", keyPair.publicKey);
    const rawPubBytes = new Uint8Array(rawPub);

    const multicodec = new Uint8Array(34);
    multicodec[0] = 0xed;
    multicodec[1] = 0x01;
    multicodec.set(rawPubBytes, 2);
    const multibase = encodeMultibase(multicodec);

    const storedKey: StoredDeviceKey = {
      id: "1",
      privateKey: keyPair.privateKey,
      publicKeyOpenssh: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5... browser-device@localhost",
      publicKeyMultibase: multibase,
      fingerprintSha256: "SHA256:testfingerprint1234567890abcdef",
      label: "My Laptop Browser",
      createdAt: new Date().toISOString(),
      trustLevel: "web_browser",
      isActive: true,
    };

    await saveDeviceSigningKey(storedKey);

    const hasKey = await hasActiveDeviceSigningKey();
    assert.equal(hasKey, true);

    const active = await getActiveDeviceSigningKey();
    assert.ok(active);
    assert.equal(active.id, "1");
    assert.equal(active.label, "My Laptop Browser");
    assert.equal(active.publicKeyMultibase, multibase);

    const all = await getAllDeviceSigningKeys();
    assert.equal(all.length, 1);
  });

  await t.test("4. signPostWithDeviceKey produces valid W3C Data Integrity proof", async () => {
    const postText = "Hello from ModelScript ComposeBox with automatic WebCrypto cryptographic signing! #verified";
    const signResult = await signPostWithDeviceKey(postText);

    assert.ok(signResult, "signResult should not be null");
    assert.equal(signResult.proof.type, "DataIntegrityProof");
    assert.equal(signResult.proof.cryptosuite, "eddsa-jcs-2022");
    assert.equal(signResult.proof.proofPurpose, "assertionMethod");
    assert.ok(signResult.proof.proofValue.startsWith("z"));
    assert.equal(signResult.payload["content"], postText);
    assert.equal(signResult.keyId, "1");
    assert.equal(signResult.fingerprintSha256, "SHA256:testfingerprint1234567890abcdef");

    // Cryptographically verify the produced signature using Node's crypto
    const active = await getActiveDeviceSigningKey();
    assert.ok(active);
    const rawPubWithHeader = decodeMultibase(active.publicKeyMultibase);
    const rawPub32 = rawPubWithHeader.subarray(2);

    const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
    const spki = Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(rawPub32)]);
    const pubKeyObj = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });

    const canonicalPayload = canonicalizeJson(signResult.payload);
    const payloadHash = crypto.createHash("sha256").update(canonicalPayload, "utf8").digest();

    const proofConfig = {
      type: signResult.proof.type,
      cryptosuite: signResult.proof.cryptosuite,
      created: signResult.proof.created,
      verificationMethod: signResult.proof.verificationMethod,
      proofPurpose: signResult.proof.proofPurpose,
    };
    const canonicalConfig = canonicalizeJson(proofConfig);
    const configHash = crypto.createHash("sha256").update(canonicalConfig, "utf8").digest();

    const signingData = Buffer.concat([configHash, payloadHash]);
    const sigBytes = decodeMultibase(signResult.proof.proofValue);

    const isValid = crypto.verify(null, signingData, pubKeyObj, sigBytes);
    assert.equal(isValid, true, "Signature should cryptographically verify");
  });

  await t.test("5. removeDeviceSigningKey clears active status", async () => {
    await removeDeviceSigningKey("SHA256:testfingerprint1234567890abcdef");
    const hasKey = await hasActiveDeviceSigningKey();
    assert.equal(hasKey, false);

    const active = await getActiveDeviceSigningKey();
    assert.equal(active, null);
  });
});

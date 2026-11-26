// SPDX-License-Identifier: AGPL-3.0-or-later

import AdmZip from "adm-zip";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import test, { after, before, describe } from "node:test";
import { Install, verifyDownloadedPackageSignature } from "../src/commands/install.js";
import { generateEd25519KeyPair, signPackageContentHash } from "../src/util/signing.js";

describe("CLI Ed25519 package signature verification on install", () => {
  const zip = new AdmZip();
  zip.addFile("package.mo", Buffer.from("package SignedPkg\nend SignedPkg;\n"));
  const zipBuffer = zip.toBuffer();
  const sha256Hex = crypto.createHash("sha256").update(zipBuffer).digest("hex");
  const contentHash = `sha256:${sha256Hex}`;

  test("verifies valid Ed25519 signature over sha256:<hex> with OpenSSH, PEM, and hex public keys", () => {
    const { privateKeyPem, publicKeyOpenSsh } = generateEd25519KeyPair("test@modelscript");
    const { signature, publicKeySpki } = signPackageContentHash(contentHash, privateKeyPem);
    assert.ok(publicKeySpki, "SPKI PEM public key should be derived");

    // 1. OpenSSH public key
    const resSsh = verifyDownloadedPackageSignature({
      buffer: zipBuffer,
      contentHash,
      signature,
      publicKey: publicKeyOpenSsh,
      packageName: "SignedPkg",
      packageVersion: "1.0.0",
    });
    assert.strictEqual(resSsh.valid, true);

    // 2. Escaped single-line PEM SPKI (as transported in HTTP header)
    const escapedPem = publicKeySpki.replace(/\r?\n/g, "\\n");
    const resPem = verifyDownloadedPackageSignature({
      buffer: zipBuffer,
      contentHash,
      signature,
      publicKey: escapedPem,
      packageName: "SignedPkg",
      packageVersion: "1.0.0",
    });
    assert.strictEqual(resPem.valid, true);

    // 3. Raw 32-byte hex public key
    const pubDer = crypto.createPublicKey(publicKeySpki).export({ format: "der", type: "spki" }) as Buffer;
    const rawHex = pubDer.subarray(pubDer.length - 32).toString("hex");
    const resHex = verifyDownloadedPackageSignature({
      buffer: zipBuffer,
      contentHash,
      signature,
      publicKey: rawHex,
      packageName: "SignedPkg",
      packageVersion: "1.0.0",
    });
    assert.strictEqual(resHex.valid, true);
  });

  test("verifies Ed25519 signature signed directly over raw zip buffer", () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
    const sig = crypto.sign(null, zipBuffer, privateKey).toString("base64");
    const pubPem = (publicKey.export({ format: "pem", type: "spki" }) as string).replace(/\r?\n/g, "\\n");

    const res = verifyDownloadedPackageSignature({
      buffer: zipBuffer,
      contentHash,
      signature: sig,
      publicKey: pubPem,
    });
    assert.strictEqual(res.valid, true);
  });

  test("rejects invalid signature, tampered buffer, or mismatched public key", () => {
    const kp1 = generateEd25519KeyPair("signer-1");
    const kp2 = generateEd25519KeyPair("signer-2");
    const { signature } = signPackageContentHash(contentHash, kp1.privateKeyPem);

    // Wrong public key
    const wrongKey = verifyDownloadedPackageSignature({
      buffer: zipBuffer,
      contentHash,
      signature,
      publicKey: kp2.publicKeyOpenSsh,
    });
    assert.strictEqual(wrongKey.valid, false);

    // Tampered buffer / digest
    const tamperedBuf = Buffer.concat([zipBuffer, Buffer.from("tampered")]);
    const tamperedHash = `sha256:${crypto.createHash("sha256").update(tamperedBuf).digest("hex")}`;
    const tampered = verifyDownloadedPackageSignature({
      buffer: tamperedBuf,
      contentHash: tamperedHash,
      signature,
      publicKey: kp1.publicKeyOpenSsh,
    });
    assert.strictEqual(tampered.valid, false);

    // Malformed signature
    const malformed = verifyDownloadedPackageSignature({
      buffer: zipBuffer,
      contentHash,
      signature: "not-a-valid-ed25519-signature",
      publicKey: kp1.publicKeyOpenSsh,
    });
    assert.strictEqual(malformed.valid, false);
  });

  describe("msx install end-to-end header verification", () => {
    let server: http.Server;
    let serverUrl: string;
    const testDir = path.join(process.cwd(), "apps/cli/tests/.tmp-install-sig-test");
    const kp = generateEd25519KeyPair("e2e@modelscript");
    const { signature: validSig } = signPackageContentHash(contentHash, kp.privateKeyPem);
    const badSig = Buffer.alloc(64, 0xaa).toString("base64");

    before(async () => {
      if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
      mkdirSync(testDir, { recursive: true });

      server = http.createServer((req, res) => {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        const pathname = decodeURIComponent(url.pathname);

        if (pathname === "/api/v1/libraries/SignedValidPkg") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ name: "SignedValidPkg", versions: [{ version: "1.0.0" }] }));
          return;
        }
        if (pathname === "/api/v1/libraries/SignedValidPkg/1.0.0/download") {
          res.writeHead(200, {
            "Content-Type": "application/zip",
            "x-content-sha256": contentHash,
            "x-package-signature": validSig,
            "x-package-public-key": kp.publicKeyOpenSsh,
          });
          res.end(zipBuffer);
          return;
        }

        if (pathname === "/api/v1/libraries/SignedBadPkg") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ name: "SignedBadPkg", versions: [{ version: "1.0.0" }] }));
          return;
        }
        if (pathname === "/api/v1/libraries/SignedBadPkg/1.0.0/download") {
          res.writeHead(200, {
            "Content-Type": "application/zip",
            "x-content-sha256": contentHash,
            "x-package-signature": badSig,
            "x-package-public-key": kp.publicKeyOpenSsh,
          });
          res.end(zipBuffer);
          return;
        }

        res.writeHead(404);
        res.end("Not Found");
      });

      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          const addr = server.address() as { port: number };
          serverUrl = `http://127.0.0.1:${addr.port}`;
          resolve();
        });
      });
    });

    after(async () => {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    });

    test("logs ✓ Verified Ed25519 signature on valid headers and aborts on invalid signature", async () => {
      const prevUrl = process.env["MODELSCRIPT_API_URL"];
      const prevStore = process.env["MODELSCRIPT_STORE_DIR"];
      const originalCwd = process.cwd();
      const isolatedStore = path.join(testDir, ".cas-store");

      process.env["MODELSCRIPT_API_URL"] = serverUrl;
      process.env["MODELSCRIPT_STORE_DIR"] = isolatedStore;
      process.chdir(testDir);

      const logs: string[] = [];
      const errors: string[] = [];
      const origLog = console.log;
      const origErr = console.error;
      const origExit = process.exit;

      console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
      console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "));

      try {
        writeFileSync("modelscript.yaml", `name: sig-test\nversion: "0.1.0"\ndependencies: {}\n`);

        // 1. Valid signature succeeds and logs verification checkmark
        await Install.handler({
          _: ["install"],
          $0: "msx",
          package: "SignedValidPkg@1.0.0",
          save: false,
        });
        assert.ok(
          logs.some((l) => l.includes("✓ Verified Ed25519 signature")),
          `Expected '✓ Verified Ed25519 signature' in logs, got: ${logs.join("\n")}`,
        );

        // 2. Invalid signature aborts with process.exit(1)
        let exitCode: number | undefined;
        (process as unknown as { exit: (code?: number) => never }).exit = ((code?: number) => {
          exitCode = code ?? 0;
          throw new Error(`EXIT_${exitCode}`);
        }) as (code?: number) => never;

        await assert.rejects(async () => {
          await Install.handler({
            _: ["install"],
            $0: "msx",
            package: "SignedBadPkg@1.0.0",
            save: false,
          });
        }, /EXIT_1/);
        assert.strictEqual(exitCode, 1);
        assert.ok(
          errors.some((e) => e.includes("Ed25519 signature verification failed")),
          `Expected signature failure error, got: ${errors.join("\n")}`,
        );
      } finally {
        console.log = origLog;
        console.error = origErr;
        process.exit = origExit;
        process.chdir(originalCwd);
        if (prevUrl === undefined) delete process.env["MODELSCRIPT_API_URL"];
        else process.env["MODELSCRIPT_API_URL"] = prevUrl;
        if (prevStore === undefined) delete process.env["MODELSCRIPT_STORE_DIR"];
        else process.env["MODELSCRIPT_STORE_DIR"] = prevStore;
      }
    });
  });
});

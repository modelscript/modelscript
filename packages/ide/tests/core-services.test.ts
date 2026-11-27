// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser";
import { HUB_GALLERY_COMPONENTS } from "../src/component-hub-catalog.js";
import { renderOpenModelHubHtml } from "../src/open-model-hub.js";
import { CURATED_LIBRARIES, escapeHtml, renderPackageHubHtml, sanitizeHubSvg } from "../src/registry-tree-provider.js";
import { HostBridgeService, isTrustedHostOrigin } from "../src/services/host-bridge-service.js";
import {
  decodeBase64ToArray,
  MemoryFileSystemProvider,
  ModelicaFileSystemProvider,
} from "../src/services/virtual-fs-service.js";

function assertStrictCspAndNonces(html: string, label: string): void {
  assert.ok(
    html.includes('http-equiv="Content-Security-Policy"'),
    `${label}: must include Content-Security-Policy meta tag`,
  );
  assert.ok(html.includes("default-src 'none'"), `${label}: CSP must include default-src 'none'`);
  assert.ok(html.includes("base-uri 'none'"), `${label}: CSP must include base-uri 'none'`);
  assert.ok(html.includes("form-action 'none'"), `${label}: CSP must include form-action 'none'`);

  const cspMatch = html.match(/script-src\s+'nonce-([A-Za-z0-9]+)'/);
  assert.ok(cspMatch && cspMatch[1], `${label}: CSP must include script-src 'nonce-...'`);
  const nonce = cspMatch[1];

  const scriptTags = html.match(/<script\b[^>]*>/gi) ?? [];
  assert.ok(scriptTags.length >= 1, `${label}: expected at least one <script> tag`);
  for (const tag of scriptTags) {
    assert.ok(tag.includes(`nonce="${nonce}"`), `${label}: <script> tag must carry matching nonce`);
  }

  const htmlWithoutScripts = html.replace(/<script\b[\s\S]*?<\/script>/gi, "");
  assert.equal(
    /<[^>]+?\son[a-z]+\s*=/i.test(htmlWithoutScripts),
    false,
    `${label}: HTML markup must not contain inline on* event handlers`,
  );
}

describe("Core IDE Services — VirtualFileSystemService", () => {
  it("decodes standard, padded, and whitespace-containing base64 strings", () => {
    const decoded = new TextDecoder().decode(decodeBase64ToArray("SGVsbG8sIE1vZGVsU2NyaXB0IQ=="));
    assert.equal(decoded, "Hello, ModelScript!");

    const paddedSingle = new TextDecoder().decode(decodeBase64ToArray("bW9kZWw="));
    assert.equal(paddedSingle, "model");

    const withNewlines = new TextDecoder().decode(decodeBase64ToArray("YWJj\nZGVm"));
    assert.equal(withNewlines, "abcdef");
  });

  it("supports CRUD, directory listing, batch writes, rename, delete, and clearDirectory in MemoryFileSystemProvider", () => {
    const memFs = new MemoryFileSystemProvider();
    const events: vscode.FileChangeEvent[] = [];
    const sub = memFs.onDidChangeFile((ev) => events.push(...ev));

    try {
      const rootUri = vscode.Uri.from({ scheme: "memfs", path: "/proj" });
      const fileA = vscode.Uri.from({ scheme: "memfs", path: "/proj/sub/Circuit.mo" });
      const fileB = vscode.Uri.from({ scheme: "memfs", path: "/proj/README.md" });
      const renamedB = vscode.Uri.from({ scheme: "memfs", path: "/proj/NOTES.md" });

      memFs.createDirectory(rootUri);
      assert.equal(memFs.stat(rootUri).type, vscode.FileType.Directory);

      const contentA = new TextEncoder().encode("model Circuit end Circuit;");
      memFs.writeFile(fileA, contentA);
      assert.equal(memFs.stat(fileA).type, vscode.FileType.File);
      assert.equal(memFs.stat(fileA).size, contentA.length);
      assert.deepEqual(memFs.readFile(fileA), contentA);
      assert.equal(events[0]?.type, vscode.FileChangeType.Created);

      // Overwriting fires Changed
      const updatedA = new TextEncoder().encode("model Circuit Real x; end Circuit;");
      memFs.writeFile(fileA, updatedA);
      assert.equal(events[1]?.type, vscode.FileChangeType.Changed);

      // Batch write + directory listing
      memFs.writeFiles([[fileB, new TextEncoder().encode("# Project")]]);
      const rootEntries = memFs.readDirectory(rootUri);
      const entryMap = new Map(rootEntries);
      assert.equal(entryMap.get("sub"), vscode.FileType.Directory);
      assert.equal(entryMap.get("README.md"), vscode.FileType.File);

      // Rename + delete
      memFs.rename(fileB, renamedB);
      assert.throws(() => memFs.stat(fileB));
      assert.equal(memFs.stat(renamedB).type, vscode.FileType.File);

      memFs.delete(renamedB);
      assert.throws(() => memFs.stat(renamedB));

      // clearDirectory removes nested files under rootUri
      memFs.clearDirectory(rootUri);
      assert.throws(() => memFs.stat(fileA));
      assert.deepEqual(memFs.readDirectory(rootUri), []);
    } finally {
      sub.dispose();
    }
  });

  it("lazily fetches and caches registered remote files in MemoryFileSystemProvider", async () => {
    const memFs = new MemoryFileSystemProvider();
    const rootUri = vscode.Uri.from({ scheme: "memfs", path: "/remote-pkg" });
    const origFetch = globalThis.fetch;
    let fetchCount = 0;

    globalThis.fetch = (async () => {
      fetchCount++;
      return new Response("model RemoteDemo end RemoteDemo;", { status: 200 });
    }) as typeof fetch;

    try {
      memFs.registerRemoteFiles(rootUri, [
        { path: "Examples/RemoteDemo.mo", url: "https://example.invalid/RemoteDemo.mo", size: 32 },
      ]);

      const targetUri = vscode.Uri.from({ scheme: "memfs", path: "/remote-pkg/Examples/RemoteDemo.mo" });
      assert.equal(memFs.stat(targetUri).size, 32);

      const first = await memFs.readFile(targetUri);
      assert.equal(new TextDecoder().decode(first), "model RemoteDemo end RemoteDemo;");
      assert.equal(fetchCount, 1);

      // Second read must hit in-memory cache without another fetch
      const second = await memFs.readFile(targetUri);
      assert.equal(new TextDecoder().decode(second), "model RemoteDemo end RemoteDemo;");
      assert.equal(fetchCount, 1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("enforces read-only semantics and caches LSP virtual files in ModelicaFileSystemProvider", async () => {
    let requestCount = 0;
    const mockClient = {
      sendRequest: async (method: string, params: { uri: string }) => {
        requestCount++;
        if (method === "modelscript/getVirtualFile" && params.uri.endsWith("Resistor.mo")) {
          return { exists: true, content: "model Resistor end Resistor;" };
        }
        if (method === "modelscript/getVirtualFile" && params.uri.endsWith("binary.bin")) {
          return { exists: true, encoding: "base64", content: "AQID" };
        }
        if (method === "modelscript/readVirtualDirectory") {
          return [
            { name: "Basic", isDirectory: true },
            { name: "package.mo", isDirectory: false },
          ];
        }
        return { exists: false };
      },
    } as unknown as LanguageClient;

    const provider = new ModelicaFileSystemProvider(() => mockClient);
    const resistorUri = vscode.Uri.from({ scheme: "modelica", path: "/Modelica/Resistor.mo" });
    const binUri = vscode.Uri.from({ scheme: "modelica", path: "/Modelica/binary.bin" });

    // Read-only mutations must throw
    assert.throws(() => provider.createDirectory());
    assert.throws(() => provider.writeFile());
    assert.throws(() => provider.delete());
    assert.throws(() => provider.rename());

    const bytes = await provider.readFile(resistorUri);
    assert.equal(new TextDecoder().decode(bytes), "model Resistor end Resistor;");
    const stat = await provider.stat(resistorUri);
    assert.equal(stat.size, bytes.length);
    // stat should reuse cached file from readFile
    assert.equal(requestCount, 1);

    const binBytes = await provider.readFile(binUri);
    assert.deepEqual(Array.from(binBytes), [1, 2, 3]);

    const dir = await provider.readDirectory(vscode.Uri.from({ scheme: "modelica", path: "/Modelica" }));
    assert.deepEqual(dir, [
      ["Basic", vscode.FileType.Directory],
      ["package.mo", vscode.FileType.File],
    ]);

    // Missing client throws Unavailable
    const disconnected = new ModelicaFileSystemProvider(() => undefined);
    await assert.rejects(() => disconnected.readFile(resistorUri));
  });
});

describe("Core IDE Services — HostBridgeService", () => {
  it("validates trusted host origins strictly", () => {
    assert.equal(isTrustedHostOrigin("http://localhost:3000"), true);
    assert.equal(isTrustedHostOrigin("https://127.0.0.1:8443"), true);
    assert.equal(isTrustedHostOrigin("http://[::1]:5173"), true);
    assert.equal(isTrustedHostOrigin("https://modelscript.org"), true);
    assert.equal(isTrustedHostOrigin("https://ide.modelscript.org"), true);
    assert.equal(isTrustedHostOrigin("https://ansatz.social"), true);
    assert.equal(isTrustedHostOrigin("https://app.ansatz.social"), true);

    assert.equal(isTrustedHostOrigin("http://modelscript.org"), false);
    assert.equal(isTrustedHostOrigin("https://evil-modelscript.org"), false);
    assert.equal(isTrustedHostOrigin("https://attacker.example"), false);
    assert.equal(isTrustedHostOrigin("null"), false);
    assert.equal(isTrustedHostOrigin(""), false);
    assert.equal(isTrustedHostOrigin("not-a-url"), false);
  });

  it("mounts artifacts into memFs without duplicate re-mount and collects workspace snapshots", async () => {
    const memFs = new MemoryFileSystemProvider();
    const rootUri = vscode.Uri.from({ scheme: "memfs", path: "/artifact-42" });
    const mockContext = { subscriptions: [] } as unknown as vscode.ExtensionContext;

    const bridge = new HostBridgeService(mockContext, memFs, rootUri, () => undefined);
    try {
      await bridge.handleMountArtifact({
        artifactId: 42,
        title: "RLC Circuit",
        viewType: "modelica-code",
        files: {
          "RLC.mo": "model RLC\n  Real v;\nequation\n  v = 1.0;\nend RLC;\n",
          "README.md": "# RLC Circuit",
        },
        primaryFile: "RLC.mo",
      });

      assert.equal(bridge.getWorkspaceTitle(), "RLC Circuit");

      const snapshot = bridge.collectWorkspaceSnapshot();
      assert.equal(snapshot.title, "RLC Circuit");
      assert.equal(snapshot.primaryFile, "RLC.mo");
      assert.equal(snapshot.dialect, "modelica");
      assert.equal(snapshot.viewType, "modelica-code");
      assert.equal(snapshot.isMultiFile, true);
      assert.equal(snapshot.forkedFromArtifactId, 42);
      assert.ok(snapshot.files["RLC.mo"]?.includes("model RLC"));
      assert.ok(snapshot.files["README.md"]?.includes("# RLC Circuit"));

      // Re-mounting the same artifact key with different content is a no-op
      await bridge.handleMountArtifact({
        artifactId: 42,
        title: "Overwritten",
        viewType: "modelica-code",
        files: { "RLC.mo": "model Overwritten end Overwritten;" },
        primaryFile: "RLC.mo",
      });
      const snapshotAfter = bridge.collectWorkspaceSnapshot();
      assert.ok(snapshotAfter.files["RLC.mo"]?.includes("model RLC"));
    } finally {
      bridge.dispose();
    }
  });
});

describe("Webview Security — registry-tree-provider & open-model-hub", () => {
  it("sanitizes untrusted SVGs by stripping scripts, active tags, event handlers, unsafe hrefs, and outer HTML", () => {
    const hostile =
      '<img src=x onerror="alert(1)"><svg viewBox="0 0 80 80" onload="evil()">' +
      "<script>alert(1)</script>" +
      "<foreignObject><div>xss</div></foreignObject>" +
      '<iframe src="https://evil.example"></iframe>' +
      "<style>body{display:none}</style>" +
      '<animate attributeName="href" to="javascript:alert(1)"/>' +
      '<a xlink:href="javascript:alert(1)"><rect width="20" height="20" onclick="bad()"/></a>' +
      '<a href="data:text/html,<script>alert(1)</script>"><circle cx="10" cy="10" r="5"/></a>' +
      '<use href="#valid-icon"/>' +
      "</svg><script>trailing()</script>";

    const cleaned = sanitizeHubSvg(hostile);
    assert.ok(cleaned, "Expected valid <svg> wrapper to survive sanitization");
    assert.ok(cleaned.startsWith("<svg"), "Must strip leading HTML before <svg>");
    assert.ok(cleaned.endsWith("</svg>"), "Must strip trailing HTML after </svg>");
    assert.ok(cleaned.includes("<rect"), "Should retain safe SVG geometry");
    assert.ok(cleaned.includes('href="#valid-icon"'), "Should retain internal fragment hrefs");
    assert.equal(/<script/i.test(cleaned), false);
    assert.equal(/foreignObject/i.test(cleaned), false);
    assert.equal(/<iframe/i.test(cleaned), false);
    assert.equal(/<style/i.test(cleaned), false);
    assert.equal(/<animate/i.test(cleaned), false);
    assert.equal(/\bon[a-z]+\s*=/i.test(cleaned), false);
    assert.equal(/javascript:/i.test(cleaned), false);
    assert.equal(/data:text\/html/i.test(cleaned), false);

    assert.equal(sanitizeHubSvg("<div>not an svg</div>"), undefined);
    assert.equal(sanitizeHubSvg(null), undefined);
  });

  it("escapes all HTML special characters including single quotes in escapeHtml", () => {
    assert.equal(
      escapeHtml(`<script>alert("x" & 'y')</script>`),
      "&lt;script&gt;alert(&quot;x&quot; &amp; &#39;y&#39;)&lt;/script&gt;",
    );
  });

  it("enforces strict CSP, nonces, and safe JSON/HTML serialization in renderPackageHubHtml", () => {
    const hostilePackages = [
      ...CURATED_LIBRARIES,
      {
        name: "EvilPkg",
        latestVersion: "1.0.0",
        description: '</script><img src=x onerror="alert(1)">',
        readme: "Test 'single' & \"double\" <tags>",
      },
    ];
    const html = renderPackageHubHtml(
      hostilePackages,
      HUB_GALLERY_COMPONENTS,
      { Modelica: "4.1.0" },
      "</script><script>alert(1)</script>",
      "vscode-webview://unit-test",
    );

    assertStrictCspAndNonces(html, "renderPackageHubHtml");
    assert.ok(html.includes("vscode-webview://unit-test"), "CSP should include provided cspSource");
    assert.equal(
      html.includes('</script><img src=x onerror="alert(1)">'),
      false,
      "Serialized JSON must escape </script> to prevent script tag breakout",
    );
    assert.ok(html.includes("function sanitizeSvg("), "Webview script should include client-side SVG sanitizer");
  });

  it("enforces strict CSP, nonces, and safe initialMode handling in renderOpenModelHubHtml", () => {
    const html = renderOpenModelHubHtml({
      nonce: "nonce123456",
      cspSource: "vscode-webview://unit-test",
      initialMode: 'gallery"</script><script>alert(1)</script>' as unknown as "gallery",
    });

    assertStrictCspAndNonces(html, "renderOpenModelHubHtml");
    assert.ok(html.includes('mode: "gallery"'), "Invalid initialMode must fall back to gallery");
    assert.equal(html.includes("alert(1)"), false, "Hostile initialMode must not be interpolated");
    assert.ok(html.includes("function sanitizeSvg("), "Webview script should include client-side SVG sanitizer");
  });
});

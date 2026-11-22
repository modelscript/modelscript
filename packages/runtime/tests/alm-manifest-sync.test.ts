// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  extractDirtyArtifactEdits,
  globalAlmConnectorRegistry,
  ingestAlmIntoDigitalThread,
  ingestAlmIntoOslcGateway,
  inspectRemoteDrift,
  lintAlmWorkspace,
  pullRemotePackage,
  pushRemotePackage,
  type AlmVerificationRun,
} from "../src/interop/alm/index.js";
import { OslcGateway } from "../src/interop/oslc_gateway.js";
import { DigitalThreadHypergraph } from "../src/interop/thread_hypergraph.js";
import { globalLibraryRegistry } from "../src/workspace/library-manifest.js";
import {
  isRemoteDependency,
  MANIFEST_FILENAME,
  normalizeRemoteDependency,
  parseModelScriptYaml,
  parseProtocolUri,
  removeManifestDependency,
  resolveRemoteTemplates,
  upsertManifestDependency,
} from "../src/workspace/manifest.js";

describe("modelscript.yaml manifest & protocol URI parser", () => {
  it("parses strict YAML 1.2 manifests and preserves comments on upsert/remove", () => {
    const initialYaml = [
      "# EV Battery Digital Twin Manifest",
      "name: ev-battery-pack",
      "version: 1.2.0",
      "dependencies:",
      "  # Frozen Q4 baseline",
      '  "@reqs/safety": oslc+https://elm.corp.com/rm/modules/MOD-42?config=Rel-2.0',
      "",
    ].join("\n");

    const parsed = parseModelScriptYaml(initialYaml);
    assert.equal(parsed.name, "ev-battery-pack");
    assert.equal(parsed.version, "1.2.0");
    assert.equal(isRemoteDependency(parsed.dependencies!["@reqs/safety"]!), true);

    const updated = upsertManifestDependency(initialYaml, "@issues/jira", {
      source: "jira+https://corp.atlassian.net",
      query: "project = EV",
      push: ["defects-on-fail", "links"],
    });
    assert.ok(updated.includes("# EV Battery Digital Twin Manifest"));
    assert.ok(updated.includes("# Frozen Q4 baseline"));
    assert.ok(updated.includes("@issues/jira"));

    const afterRemove = removeManifestDependency(updated, "@issues/jira");
    assert.equal(afterRemove.removed, true);
    assert.ok(afterRemove.content.includes("# Frozen Q4 baseline"));
    assert.ok(!afterRemove.content.includes("@issues/jira"));
  });

  it("rejects unquoted numeric versions and resolves ${git.branch} templates", () => {
    assert.throws(() => parseModelScriptYaml("name: bad\nversion: 1.0\n"), /'version' must be a string/);

    const uri = parseProtocolUri("codebeamer+https://cb.corp.com/api/v3/trackers/1042?baseline=B1");
    assert.ok(uri);
    assert.equal(uri.protocol, "codebeamer");
    assert.equal(uri.host, "cb.corp.com");
    assert.equal(uri.params["baseline"], "B1");

    const resolved = resolveRemoteTemplates("branch:${git.branch}", { gitBranch: "feat/thermal" });
    assert.equal(resolved, "branch:feat/thermal");
  });
});

describe("ALM Protocol Connectors (DOORS Next / OSLC, Jira, Codebeamer, Jama, Polarion)", () => {
  let server: http.Server;
  let baseUrl: string;
  let lastHeaders: Record<string, string | string[] | undefined> = {};
  const pushedPayloads: Array<{ path: string; body: unknown }> = [];
  let oslcRevision = 1;

  before(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      lastHeaders = req.headers;

      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const rawBody = Buffer.concat(chunks).toString("utf-8");
        if (req.method === "POST" || req.method === "PUT") {
          pushedPayloads.push({
            path: url.pathname,
            body: rawBody ? JSON.parse(rawBody) : null,
          });
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: "CREATED-1", key: "EV-999" }));
          return;
        }

        // OSLC / IBM DOORS Next
        if (url.pathname === "/rm/modules/MOD-42") {
          const isDelta = url.searchParams.has("trs.since");
          res.writeHead(200, { "Content-Type": "application/ld+json" });
          res.end(
            JSON.stringify({
              "oslc_config:configuration": req.headers["oslc-configuration-context"] ?? "Rel-2.0",
              "trs:cursor": `trs:ev-${oslcRevision}`,
              isDelta,
              "rdfs:member": [
                {
                  "@id": `${baseUrl}/rm/resources/REQ-042`,
                  "dcterms:identifier": "REQ-042",
                  "dcterms:title": "Cell Overtemperature Cutoff",
                  "dcterms:description":
                    oslcRevision === 1
                      ? "Battery shall disconnect above 60 C."
                      : "Battery shall disconnect above 55 C.",
                  "oslc_rm:status": "Approved",
                  etag: `"v${oslcRevision}"`,
                },
              ],
            }),
          );
          return;
        }

        // Jira Cloud v3
        if (url.pathname === "/rest/api/3/search") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              issues: [
                {
                  key: "EV-1420",
                  self: `${baseUrl}/rest/api/3/issue/EV-1420`,
                  fields: {
                    summary: "Thermal runaway margin regression",
                    description: {
                      type: "doc",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "Check cooling loop." }] }],
                    },
                    status: { name: "In Progress" },
                    priority: { name: "High" },
                    issuetype: { name: "Bug" },
                    updated: "2026-11-20T12:00:00Z",
                  },
                },
              ],
            }),
          );
          return;
        }

        // PTC Codebeamer v3
        if (url.pathname === "/api/v3/trackers/1042/items") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              items: [
                {
                  id: 501,
                  name: "BMS Contactor Weld Detection",
                  description: "Detect welded contactor within 50ms.",
                  status: { name: "Approved" },
                  version: 7,
                  modifiedAt: "2026-11-20T10:00:00Z",
                },
              ],
            }),
          );
          return;
        }

        // Jama Connect v1
        if (url.pathname === "/rest/v1/projects/84/items") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              data: [
                {
                  id: 9001,
                  documentKey: "SYS-REQ-12",
                  version: 3,
                  modifiedDate: "2026-11-19T08:00:00Z",
                  fields: {
                    name: "Pack Isolation Resistance",
                    description: "Isolation resistance >= 500 Ohm/V.",
                    status: "Approved",
                  },
                },
              ],
            }),
          );
          return;
        }

        // Siemens Polarion v1
        if (url.pathname === "/polarion/rest/v1/projects/EV/workitems") {
          res.writeHead(200, { "Content-Type": "application/vnd.api+json" });
          res.end(
            JSON.stringify({
              meta: { revision: "48219" },
              data: [
                {
                  id: "EV/POL-101",
                  attributes: {
                    title: "Charging Interlock",
                    description: { value: "Prevent drive while HV charger connected." },
                    status: "approved",
                    outlineOrder: 2,
                    outlineNumber: "1.2",
                    revision: "48219",
                  },
                },
                {
                  id: "EV/POL-100",
                  attributes: {
                    title: "System Scope",
                    description: { value: "Top-level EV pack scope." },
                    status: "approved",
                    outlineOrder: 1,
                    outlineNumber: "1.1",
                    revision: "48210",
                  },
                },
              ],
            }),
          );
          return;
        }

        res.writeHead(404);
        res.end("Not found");
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("syncs OSLC / DOORS Next with config context, detects 3-way conflicts, and pushes verification runs", async () => {
    const connector = globalAlmConnectorRegistry.get("oslc")!;
    assert.ok(connector);
    assert.equal(globalAlmConnectorRegistry.get("doors"), connector);

    const spec = {
      ...normalizeRemoteDependency({
        source: `oslc+${baseUrl}/rm/modules/MOD-42`,
        baseline: "Rel-2.0",
        push: ["verification", "links"] as Array<"verification" | "links">,
      })!,
      packageName: "@reqs/battery-safety",
    };

    const pull1 = await pullRemotePackage(connector, spec, { token: "test-token" });
    assert.equal(lastHeaders["oslc-configuration-context"], "Rel-2.0");
    assert.equal(pull1.artifacts.length, 1);
    assert.equal(pull1.artifacts[0]!.externalId, "REQ-042");
    assert.ok(pull1.snapshot.files[0]!.content.includes("requirement def <'REQ-042'> REQ_042"));
    assert.equal(pull1.remoteState.cursor, "trs:ev-1");

    // Ingest into OslcGateway and DigitalThreadHypergraph
    const gw = new OslcGateway();
    ingestAlmIntoOslcGateway(gw, pull1.artifacts);
    const jsonLd = gw.exportJsonLd("rm") as Record<string, unknown>;
    assert.ok(JSON.stringify(jsonLd).includes("REQ-042"));

    const hg = new DigitalThreadHypergraph();
    assert.equal(ingestAlmIntoDigitalThread(hg, spec.packageName, pull1.artifacts), 1);

    // Simulate both local hand-edit and remote update -> 3-way conflict!
    oslcRevision = 2;
    const locallyEdited = pull1.snapshot.files[0]!.content.replace("60 C", "58 C");
    const drift = await inspectRemoteDrift(connector, spec, { token: "test-token" }, pull1.remoteState, locallyEdited);
    assert.equal(drift.inSync, false);
    assert.equal(drift.conflicts.length, 1);
    assert.equal(drift.conflicts[0]!.reason, "both-modified");

    await assert.rejects(
      () =>
        pullRemotePackage(connector, spec, { token: "test-token" }, pull1.remoteState, {
          conflictStrategy: "fail",
          existingLocalContent: locallyEdited,
          previousArtifacts: pull1.artifacts,
        }),
      /3-way sync conflict/,
    );

    const resolved = await pullRemotePackage(connector, spec, { token: "test-token" }, pull1.remoteState, {
      conflictStrategy: "theirs",
      existingLocalContent: locallyEdited,
      previousArtifacts: pull1.artifacts,
    });
    assert.ok(resolved.snapshot.files[0]!.content.includes("55 C"));

    // Push verification run
    const run: AlmVerificationRun = {
      runId: "ci-42",
      title: "Thermal Cutoff Verification",
      status: "Passed",
      commitSha: "abc1234",
      daeHash: "sha256:deadbeef",
      verifiesIds: ["REQ-042"],
      metrics: { maxTempC: 54.2 },
      timestamp: "2026-11-21T09:00:00Z",
    };
    const pushRes = await pushRemotePackage(connector, spec, { token: "test-token" }, { verificationRuns: [run] });
    assert.equal(pushRes.verification?.pushed, 1);
  });

  it("syncs Jira, Codebeamer, Jama, and Polarion connectors and enforces push guardrails", async () => {
    // 1. Jira pull + defects-on-fail push
    const jiraConnector = globalAlmConnectorRegistry.get("jira")!;
    const jiraSpec = {
      ...normalizeRemoteDependency({
        source: `jira+${baseUrl}`,
        query: "project = EV",
        push: ["defects-on-fail"] as Array<"defects-on-fail">,
      })!,
      packageName: "@issues/jira-ev",
    };
    const jiraPull = await pullRemotePackage(jiraConnector, jiraSpec, { username: "eng@corp.com", password: "tok" });
    assert.equal(jiraPull.artifacts[0]!.externalId, "EV-1420");
    assert.equal(jiraPull.artifacts[0]!.kind, "change_request");
    assert.ok(jiraPull.snapshot.files[0]!.content.includes("concern def <'EV-1420'> EV_1420"));

    // Guardrail: links push must be rejected since only defects-on-fail is allowed
    await assert.rejects(
      () =>
        pushRemotePackage(
          jiraConnector,
          jiraSpec,
          {},
          {
            links: [{ sourceId: "BatteryPack", targetId: "EV-1420", relation: "tracks" }],
          },
        ),
      /Outbound link push is disabled/,
    );

    const jiraFailPush = await pushRemotePackage(
      jiraConnector,
      jiraSpec,
      {},
      {
        verificationRuns: [
          {
            runId: "ci-fail-1",
            title: "Cooling Margin Check",
            status: "Failed",
            verifiesIds: ["EV-1420"],
            metrics: {},
            timestamp: "2026-11-21T09:05:00Z",
          },
        ],
      },
    );
    assert.equal(jiraFailPush.verification?.pushed, 1);
    assert.equal(jiraFailPush.verification?.createdIds?.["ci-fail-1"], "EV-999");

    // 2. Codebeamer v3
    const cbConnector = globalAlmConnectorRegistry.get("codebeamer")!;
    const cbSpec = {
      ...normalizeRemoteDependency({
        source: `codebeamer+${baseUrl}/api/v3/trackers/1042`,
        workingSet: "branch:feat/thermal",
        push: ["verification"] as Array<"verification">,
      })!,
      packageName: "@reqs/cb-bms",
    };
    const cbPull = await pullRemotePackage(cbConnector, cbSpec, { token: "cb-tok" });
    assert.equal(cbPull.artifacts[0]!.externalId, "CB-501");
    assert.equal(cbPull.remoteState.workingSet, "branch:feat/thermal");

    // 3. Jama Connect v1
    const jamaConnector = globalAlmConnectorRegistry.get("jama")!;
    const jamaSpec = {
      ...normalizeRemoteDependency(`jama+${baseUrl}/rest/v1/projects/84/items`)!,
      packageName: "@reqs/thermal-jama",
    };
    const jamaPull = await pullRemotePackage(jamaConnector, jamaSpec, { token: "jama-tok" });
    assert.equal(jamaPull.artifacts[0]!.externalId, "SYS-REQ-12");

    // 4. Siemens Polarion v1 (preserves LiveDoc outlineOrder: POL-100 before POL-101)
    const polConnector = globalAlmConnectorRegistry.get("polarion")!;
    const polSpec = {
      ...normalizeRemoteDependency(`polarion+${baseUrl}/polarion/rest/v1/projects/EV/workitems?rev=48219`)!,
      packageName: "@reqs/polarion-sys",
    };
    const polPull = await pullRemotePackage(polConnector, polSpec, { token: "pol-tok" });
    assert.equal(polPull.remoteState.cursor, "48219");
    const sysmlText = polPull.snapshot.files[0]!.content;
    assert.ok(sysmlText.indexOf("POL-100") < sysmlText.indexOf("POL-101"));
  });

  it("loads a library bundle from .modelscript/packages/<pkg>/modelscript.yaml without package.json", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msx-lib-yaml-"));
    try {
      const pkgDir = path.join(tmpDir, ".modelscript", "packages", "@acme", "pumps");
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(
        path.join(pkgDir, MANIFEST_FILENAME),
        [
          'name: "@acme/pumps"',
          'version: "1.0.0"',
          "library:",
          "  category: library",
          "  language: modelica",
          "  symbols: ./symbols.json",
          "",
        ].join("\n"),
        "utf-8",
      );
      fs.writeFileSync(
        path.join(pkgDir, "symbols.json"),
        JSON.stringify([{ name: "CentrifugalPump", qualifiedName: "Acme.Pumps.CentrifugalPump", kind: "model" }]),
        "utf-8",
      );

      const loaded = await globalLibraryRegistry.loadLibraryFromDir(pkgDir);
      assert.ok(loaded);
      assert.equal(loaded.packageName, "@acme/pumps");
      assert.equal(loaded.symbols.length, 1);
      globalLibraryRegistry.unregisterPackage("@acme/pumps");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("lints ALM workspace policies (ALM001–ALM004) and extracts dirty local artifact edits", async () => {
    const manifest = parseModelScriptYaml(
      [
        "name: ev-pack",
        'version: "1.0.0"',
        "dependencies:",
        '  "@reqs/doors": oslc+https://elm.corp.com/rm/modules/MOD-1',
        "",
      ].join("\n"),
    );

    const diagnostics = lintAlmWorkspace({
      manifest,
      gitBranch: "main",
      artifactsByPackage: {
        "@reqs/doors": [
          {
            externalId: "REQ-1",
            kind: "requirement",
            uri: "https://elm.corp.com/rm/REQ-1",
            title: "Deprecated Spec",
            text: "Old requirement",
            status: "Deprecated",
            attributes: {},
          },
          {
            externalId: "REQ-2",
            kind: "requirement",
            uri: "https://elm.corp.com/rm/REQ-2",
            title: "ASIL-D Cutoff",
            text: "Must cut off within 10ms.",
            status: "Approved",
            priority: "ASIL-D",
            attributes: {},
          },
        ],
      },
      referencedIdsByPackage: {
        "@reqs/doors": ["REQ-1", "REQ-MISSING"],
      },
      links: [],
    });

    const codes = diagnostics.map((d) => d.code).sort();
    assert.deepEqual(codes, ["ALM001", "ALM002", "ALM003", "ALM004"]);

    // Verify bidirectional dirty edit extraction
    const connector = globalAlmConnectorRegistry.get("oslc")!;
    const spec = {
      ...normalizeRemoteDependency({
        source: `oslc+${baseUrl}/rm/modules/MOD-42`,
        baseline: "Rel-2.0",
        push: ["artifacts"] as Array<"artifacts">,
      })!,
      packageName: "@reqs/battery-safety",
    };
    const pulled = await pullRemotePackage(connector, spec, { token: "t" });
    const editedContent = pulled.snapshot.files[0]!.content.replace("Approved", "In Review");
    const edits = await extractDirtyArtifactEdits(editedContent, pulled.remoteState);
    assert.equal(edits.length, 1);
    assert.equal(edits[0]!.externalId, "REQ-042");
    assert.equal(edits[0]!.status, "In Review");
  });
});

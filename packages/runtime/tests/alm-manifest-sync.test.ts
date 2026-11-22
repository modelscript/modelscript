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

describe("Extended ALM/PLM & RESTful Connectors (Azure DevOps, TestRail, Windchill, Teamcenter, Aras, Generic REST)", () => {
  let server: http.Server;
  let baseUrl: string;
  const requests: Array<{ method: string; path: string; body: unknown }> = [];

  before(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const rawBody = Buffer.concat(chunks).toString("utf-8");
        let parsedBody: unknown = null;
        if (rawBody) {
          try {
            parsedBody = JSON.parse(rawBody);
          } catch {
            parsedBody = rawBody;
          }
        }
        requests.push({ method: req.method || "GET", path: `${url.pathname}${url.search}`, body: parsedBody });

        // Azure DevOps
        if (url.pathname.endsWith("/_apis/projects")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ count: 2, value: [] }));
          return;
        }
        if (url.pathname.endsWith("/_apis/wit/wiql")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ workItems: [{ id: 101 }] }));
          return;
        }
        if (url.pathname.endsWith("/_apis/wit/workitems") && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              value: [
                {
                  id: 101,
                  rev: 3,
                  url: `${baseUrl}/org/proj/_apis/wit/workItems/101`,
                  fields: {
                    "System.WorkItemType": "Requirement",
                    "System.Title": "Inverter Efficiency >= 96%",
                    "System.Description": "<p>Under nominal load.</p>",
                    "System.State": "Active",
                    "Microsoft.VSTS.Common.Priority": 1,
                    "System.ChangedDate": "2026-11-21T10:00:00Z",
                  },
                  relations: [
                    {
                      rel: "System.LinkTypes.Hierarchy-Reverse",
                      url: `${baseUrl}/org/proj/_apis/wit/workItems/100`,
                    },
                  ],
                },
              ],
            }),
          );
          return;
        }

        // TestRail
        if (req.url?.includes("/api/v2/get_project/")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: 7, name: "Powertrain V&V" }));
          return;
        }
        if (req.url?.includes("/api/v2/get_cases/")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              cases: [
                {
                  id: 501,
                  title: "Thermal Cutoff HIL Test",
                  custom_preconds: "Pre-heat pack to 55 C",
                  priority_id: 2,
                  section_id: 12,
                  suite_id: 3,
                  refs: "REQ-042, REQ-043",
                  updated_on: 1795200000,
                },
              ],
            }),
          );
          return;
        }
        if (req.url?.includes("/api/v2/add_run/")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: 9001 }));
          return;
        }

        // PTC Windchill OData
        if (url.pathname.endsWith("/$metadata")) {
          res.writeHead(200, { "Content-Type": "application/xml" });
          res.end('<edmx:Edmx Version="4.0"/>');
          return;
        }
        if (url.pathname === "/Windchill/servlet/odata/ProdMgmt/Parts" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              value: [
                {
                  ID: "OR:wt.part.WTPart:1001",
                  Number: "BAT-PACK-001",
                  Name: "EV Battery Pack Assembly",
                  Description: "800V liquid-cooled pack",
                  Version: "B.2",
                  State: { Display: "Released" },
                  LastModified: "2026-11-21T08:00:00Z",
                  Uses: [{ ChildNumber: "CELL-MOD-01", Quantity: 12 }],
                },
              ],
            }),
          );
          return;
        }

        // Siemens Teamcenter
        if (url.pathname === "/tc/api/v1/info") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ version: "2406" }));
          return;
        }
        if (url.pathname === "/tc/api/v1/items" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              items: [
                {
                  uid: "TC-UID-1",
                  item_id: "INV-200",
                  item_revision_id: "C",
                  object_name: "SiC Traction Inverter",
                  object_desc: "3-phase 250kW inverter",
                  release_status: "Released",
                  last_mod_date: "2026-11-21T09:00:00Z",
                  bom_children: [{ item_id: "IGBT-MOD-1" }],
                },
              ],
            }),
          );
          return;
        }

        // Aras Innovator OData
        if (url.pathname === "/Server/Odata/Part" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              value: [
                {
                  id: "ARAS-1",
                  item_number: "PUMP-01",
                  name: "Coolant Pump",
                  description: "24V brushless coolant pump",
                  state: "Released",
                  major_rev: "A",
                  generation: 2,
                  modified_on: "2026-11-21T07:00:00Z",
                  "Part BOM": [{ related_id: { item_number: "IMP-01" } }],
                },
              ],
            }),
          );
          return;
        }

        // Generic RESTful Repository
        if (url.pathname === "/custom/api/items" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              data: {
                records: [
                  {
                    meta: { key: "ONSHAPE-ASM-1", updated: "2026-11-21T11:00:00Z" },
                    summary: "Chassis Subframe CAD",
                    notes: "Mass = 14.2 kg",
                    lifecycle: "Approved",
                    href: "https://cad.onshape.com/documents/1",
                  },
                ],
              },
            }),
          );
          return;
        }

        // Default write handler (POST/PATCH/PUT)
        if (req.method === "POST" || req.method === "PATCH" || req.method === "PUT") {
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: "OK-1", ID: "OK-1", uid: "OK-1" }));
          return;
        }

        res.writeHead(404);
        res.end("Not found");
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const sampleRun: AlmVerificationRun = {
    runId: "RUN-100",
    title: "Thermal Cutoff Verification",
    status: "Passed",
    commitSha: "abc1234",
    daeHash: "sha256:deadbeef",
    verifiesIds: ["C501", "REQ-042"],
    metrics: { rmse: 0.0012 },
    durationMs: 2500,
    timestamp: "2026-11-21T12:00:00Z",
  };

  it("registers all extended protocols and aliases on globalAlmConnectorRegistry", () => {
    const protocols = globalAlmConnectorRegistry.listProtocols();
    for (const p of ["azdo", "testrail", "windchill", "teamcenter", "aras", "rest"]) {
      assert.ok(protocols.includes(p), `Missing protocol '${p}'`);
    }
    assert.equal(globalAlmConnectorRegistry.get("azure-devops")?.protocol, "azdo");
    assert.equal(globalAlmConnectorRegistry.get("tc")?.protocol, "teamcenter");
    assert.equal(globalAlmConnectorRegistry.get("openapi")?.protocol, "rest");
  });

  it("pulls and pushes via Azure DevOps connector", async () => {
    const conn = globalAlmConnectorRegistry.get("azdo")!;
    const spec = {
      ...normalizeRemoteDependency({
        source: `azdo+${baseUrl}/org/proj`,
        push: ["links", "verification"] as Array<"links" | "verification">,
      })!,
      packageName: "@alm/azdo",
    };
    const caps = await conn.discover(spec, { token: "pat" });
    assert.equal(caps.protocol, "azdo");
    const pulled = await pullRemotePackage(conn, spec, { token: "pat" });
    assert.equal(pulled.addedIds.length, 1);
    assert.equal(pulled.addedIds[0], "WI-101");
    assert.ok(pulled.snapshot.files[0]!.content.includes("Inverter Efficiency >= 96%"));
    const pushed = await pushRemotePackage(
      conn,
      spec,
      { token: "pat" },
      {
        links: [{ sourceId: "Model.Inverter", targetId: "WI-101", relation: "satisfies" }],
        verificationRuns: [sampleRun],
      },
    );
    assert.equal(pushed.links?.pushed, 1);
    assert.equal(pushed.verification?.pushed, 1);
  });

  it("pulls test cases and pushes verification runs via TestRail connector", async () => {
    const conn = globalAlmConnectorRegistry.get("testrail")!;
    const spec = {
      ...normalizeRemoteDependency({
        source: `testrail+${baseUrl}/projects/7?suiteId=3`,
        push: ["links", "verification"] as Array<"links" | "verification">,
      })!,
      packageName: "@qa/testrail",
    };
    const caps = await conn.discover(spec, { username: "qa@corp.com", password: "key" });
    assert.ok(caps.serverName?.includes("Powertrain V&V"));
    const delta = await conn.fetchDelta(spec, { username: "qa@corp.com", password: "key" });
    assert.equal(delta.upserted.length, 1);
    assert.equal(delta.upserted[0]!.externalId, "C501");
    assert.equal(delta.links.length, 2);
    const runRes = await conn.pushVerificationRuns(spec, { username: "qa@corp.com", password: "key" }, [sampleRun]);
    assert.equal(runRes.pushed, 1);
    assert.equal(runRes.createdIds?.["RUN-100"], "9001");
  });

  it("pulls eBOM parts and links via PTC Windchill, Siemens Teamcenter, and Aras Innovator connectors", async () => {
    // Windchill
    const wc = globalAlmConnectorRegistry.get("windchill")!;
    const wcSpec = {
      ...normalizeRemoteDependency(`windchill+${baseUrl}/Windchill/servlet/odata/ProdMgmt`)!,
      packageName: "@plm/windchill",
    };
    const wcDelta = await wc.fetchDelta(wcSpec, { token: "t" });
    assert.equal(wcDelta.upserted[0]!.externalId, "BAT-PACK-001");
    assert.equal(wcDelta.links[0]!.targetId, "CELL-MOD-01");

    // Teamcenter
    const tc = globalAlmConnectorRegistry.get("teamcenter")!;
    const tcSpec = {
      ...normalizeRemoteDependency(`teamcenter+${baseUrl}/tc/api/v1`)!,
      packageName: "@plm/teamcenter",
    };
    const tcCaps = await tc.discover(tcSpec, { token: "t" });
    assert.equal(tcCaps.serverVersion, "2406");
    const tcDelta = await tc.fetchDelta(tcSpec, { token: "t" });
    assert.equal(tcDelta.upserted[0]!.externalId, "INV-200");
    assert.equal(tcDelta.links[0]!.targetId, "IGBT-MOD-1");

    // Aras Innovator
    const aras = globalAlmConnectorRegistry.get("aras")!;
    const arasSpec = {
      ...normalizeRemoteDependency(`aras+${baseUrl}/Server/Odata?itemType=Part`)!,
      packageName: "@plm/aras",
    };
    const arasDelta = await aras.fetchDelta(arasSpec, { token: "t" });
    assert.equal(arasDelta.upserted[0]!.externalId, "PUMP-01");
    assert.equal(arasDelta.links[0]!.targetId, "IMP-01");
  });

  it("maps arbitrary JSON endpoints via Generic RESTful Repository connector", async () => {
    const rest = globalAlmConnectorRegistry.get("rest")!;
    const spec = {
      ...normalizeRemoteDependency({
        source: `rest+${baseUrl}/custom/api/items`,
        push: ["links", "verification"] as Array<"links" | "verification">,
        options: {
          itemsPath: "data.records",
          idField: "meta.key",
          titleField: "summary",
          textField: "notes",
          statusField: "lifecycle",
          updatedField: "meta.updated",
          webUrlField: "href",
          kind: "document_section",
          pushLinksUrl: "/custom/api/links",
          pushRunsUrl: "/custom/api/runs",
        },
      })!,
      packageName: "@cad/onshape",
    };
    const delta = await rest.fetchDelta(spec, { token: "t" });
    assert.equal(delta.upserted.length, 1);
    assert.equal(delta.upserted[0]!.externalId, "ONSHAPE-ASM-1");
    assert.equal(delta.upserted[0]!.title, "Chassis Subframe CAD");
    assert.equal(delta.upserted[0]!.webUrl, "https://cad.onshape.com/documents/1");
    const pushed = await pushRemotePackage(
      rest,
      spec,
      { token: "t" },
      {
        links: [{ sourceId: "Model.Chassis", targetId: "ONSHAPE-ASM-1", relation: "satisfies" }],
        verificationRuns: [sampleRun],
      },
    );
    assert.equal(pushed.links?.pushed, 1);
    assert.equal(pushed.verification?.pushed, 1);
  });
});

describe("Wave-2 DevOps, Test, Cloud CAD & Artifact Connectors (GitHub, GitLab, Confluence, Xray, Onshape, Artifactory)", () => {
  let server: http.Server;
  let baseUrl: string;

  before(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        // GitHub
        if (url.pathname === "/repos/acme/ev-pack" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ full_name: "acme/ev-pack" }));
          return;
        }
        if (url.pathname === "/repos/acme/ev-pack/issues" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify([
              {
                number: 42,
                title: "Add thermal cutoff guard",
                body: "Enforce 60C limit",
                state: "open",
                html_url: "https://github.com/acme/ev-pack/issues/42",
                updated_at: "2026-11-21T10:00:00Z",
                labels: [{ name: "requirement" }],
              },
            ]),
          );
          return;
        }

        // GitLab
        if (url.pathname === "/api/v4/projects/99" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ path_with_namespace: "acme/inverter" }));
          return;
        }
        if (url.pathname === "/api/v4/projects/99/issues" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify([
              {
                iid: 15,
                title: "PWM deadtime tuning",
                description: "Adjust deadtime to 1.2us",
                state: "opened",
                web_url: "https://gitlab.corp.com/acme/inverter/-/issues/15",
                updated_at: "2026-11-21T10:30:00Z",
                labels: ["control"],
              },
            ]),
          );
          return;
        }

        // Confluence
        if (url.pathname === "/wiki/rest/api/content/search" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              results: [
                {
                  id: "8801",
                  title: "Battery Architecture Spec",
                  status: "current",
                  version: { number: 4, when: "2026-11-21T09:00:00Z" },
                  body: { storage: { value: "<p>800V pack architecture.</p>" } },
                  space: { key: "ENG" },
                  _links: { webui: "/wiki/spaces/ENG/pages/8801" },
                },
              ],
            }),
          );
          return;
        }

        // Xray
        if (url.pathname === "/api/v2/tests" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              tests: [
                {
                  key: "XRAY-10",
                  summary: "Overcurrent trip simulation",
                  description: "Verify trip < 5ms",
                  status: "Active",
                  updated: "2026-11-21T11:00:00Z",
                  requirements: ["REQ-042"],
                },
              ],
            }),
          );
          return;
        }

        // Onshape
        if (url.pathname === "/api/v6/assemblies/d/doc123/w/ws456/e/el789/bom" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              rows: [
                {
                  rowId: "r1",
                  itemSource: { partId: "JHD" },
                  headerIdToValue: {
                    partNumber: "CHS-001",
                    name: "Battery Enclosure Lid",
                    revision: "B",
                    state: "RELEASED",
                    quantity: 1,
                    material: "6061-T6 Aluminum",
                  },
                },
              ],
            }),
          );
          return;
        }

        // Artifactory
        if (url.pathname === "/artifactory/api/system/version" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ version: "7.84.10" }));
          return;
        }
        if (url.pathname === "/artifactory/api/storage/fmu-releases/ev" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              files: [
                {
                  uri: "/battery_v2.fmu",
                  size: 204800,
                  lastModified: "2026-11-21T08:00:00Z",
                  sha2: "abcdef1234567890",
                  folder: false,
                },
              ],
            }),
          );
          return;
        }

        if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: "CREATED-1", key: "XRAY-EXEC-1", number: 43, iid: 16 }));
          return;
        }

        res.writeHead(404);
        res.end("Not found");
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const run: AlmVerificationRun = {
    runId: "RUN-200",
    title: "Overcurrent Trip Check",
    status: "Passed",
    commitSha: "def5678",
    daeHash: "sha256:cafe",
    verifiesIds: ["XRAY-10"],
    metrics: { tripMs: 3.1 },
    timestamp: "2026-11-21T12:00:00Z",
  };

  it("registers all wave-2 protocols and aliases", () => {
    for (const p of ["github", "gitlab", "confluence", "xray", "onshape", "artifactory"]) {
      assert.ok(globalAlmConnectorRegistry.has(p), `Missing protocol '${p}'`);
    }
    assert.equal(globalAlmConnectorRegistry.get("gh")?.protocol, "github");
    assert.equal(globalAlmConnectorRegistry.get("gl")?.protocol, "gitlab");
    assert.equal(globalAlmConnectorRegistry.get("jfrog")?.protocol, "artifactory");
  });

  it("syncs GitHub, GitLab, Confluence, Xray, Onshape, and Artifactory", async () => {
    // GitHub
    const gh = globalAlmConnectorRegistry.get("github")!;
    const ghSpec = { ...normalizeRemoteDependency(`github+${baseUrl}/repos/acme/ev-pack`)!, packageName: "@gh/ev" };
    const ghDelta = await gh.fetchDelta(ghSpec, { token: "t" });
    assert.equal(ghDelta.upserted[0]!.externalId, "GH-42");
    assert.equal(ghDelta.upserted[0]!.kind, "requirement");
    assert.equal(
      (await gh.pushLinks(ghSpec, { token: "t" }, [{ sourceId: "Pack", targetId: "GH-42", relation: "satisfies" }]))
        .pushed,
      1,
    );

    // GitLab
    const gl = globalAlmConnectorRegistry.get("gitlab")!;
    const glSpec = { ...normalizeRemoteDependency(`gitlab+${baseUrl}/api/v4/projects/99`)!, packageName: "@gl/inv" };
    const glDelta = await gl.fetchDelta(glSpec, { token: "t" });
    assert.equal(glDelta.upserted[0]!.externalId, "GL-15");

    // Confluence
    const conf = globalAlmConnectorRegistry.get("confluence")!;
    const confSpec = {
      ...normalizeRemoteDependency(`confluence+${baseUrl}/wiki?spaceKey=ENG`)!,
      packageName: "@docs/eng",
    };
    const confDelta = await conf.fetchDelta(confSpec, { token: "t" });
    assert.equal(confDelta.upserted[0]!.externalId, "CONF-8801");
    assert.equal(confDelta.upserted[0]!.text, "800V pack architecture.");

    // Xray
    const xray = globalAlmConnectorRegistry.get("xray")!;
    const xraySpec = {
      ...normalizeRemoteDependency({
        source: `xray+${baseUrl}/api/v2`,
        push: ["verification"] as Array<"verification">,
      })!,
      packageName: "@qa/xray",
    };
    const xrayDelta = await xray.fetchDelta(xraySpec, { token: "t" });
    assert.equal(xrayDelta.upserted[0]!.externalId, "XRAY-10");
    assert.equal(xrayDelta.links[0]!.targetId, "REQ-042");
    const xrayPush = await xray.pushVerificationRuns(xraySpec, { token: "t" }, [run]);
    assert.equal(xrayPush.pushed, 1);
    assert.equal(xrayPush.createdIds?.["RUN-200"], "XRAY-EXEC-1");

    // Onshape
    const onshape = globalAlmConnectorRegistry.get("onshape")!;
    const onshapeSpec = {
      ...normalizeRemoteDependency(`onshape+${baseUrl}/documents/doc123/w/ws456/e/el789`)!,
      packageName: "@cad/enclosure",
    };
    const onshapeDelta = await onshape.fetchDelta(onshapeSpec, { token: "t" });
    assert.equal(onshapeDelta.upserted[0]!.externalId, "CHS-001");
    assert.equal(onshapeDelta.upserted[0]!.attributes["material"], "6061-T6 Aluminum");

    // Artifactory
    const art = globalAlmConnectorRegistry.get("artifactory")!;
    const artSpec = {
      ...normalizeRemoteDependency(`artifactory+${baseUrl}/artifactory/fmu-releases/ev`)!,
      packageName: "@bin/fmus",
    };
    const artCaps = await art.discover(artSpec, { token: "t" });
    assert.equal(artCaps.serverVersion, "7.84.10");
    const artDelta = await art.fetchDelta(artSpec, { token: "t" });
    assert.equal(artDelta.upserted[0]!.externalId, "fmu-releases/ev/battery_v2.fmu");
    assert.equal(artDelta.upserted[0]!.attributes["sha256"], "abcdef1234567890");
    const artPush = await art.pushVerificationRuns(artSpec, { token: "t" }, [
      { ...run, verifiesIds: ["fmu-releases/ev/battery_v2.fmu"] },
    ]);
    assert.equal(artPush.pushed, 1);
  });
});

describe("Wave-3 Bitbucket, Airflow, GENESYS, Teamwork Cloud & Zuken ECAD Connectors", () => {
  let server: http.Server;
  let baseUrl: string;

  before(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        // Bitbucket Data Center
        if (url.pathname === "/rest/api/1.0/projects/ENG/repos/bms/pull-requests" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              values: [
                {
                  id: 77,
                  title: "Fix SOC estimator drift",
                  description: "Updated EKF covariance",
                  state: "OPEN",
                  updatedDate: 1795200000000,
                },
              ],
            }),
          );
          return;
        }

        // Apache Airflow
        if (url.pathname === "/api/v1/version" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ version: "2.10.2" }));
          return;
        }
        if (url.pathname === "/api/v1/dags" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              dags: [
                {
                  dag_id: "thermal_monte_carlo",
                  dag_display_name: "Thermal Monte Carlo Sweep",
                  description: "Nightly HIL/SIL batch sweep",
                  is_paused: false,
                },
              ],
            }),
          );
          return;
        }

        // Vitech GENESYS
        if (url.pathname === "/api/v1/projects/EV-SYS/entities" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              entities: [
                {
                  id: "G-1",
                  number: "R.1.2",
                  class: "Requirement",
                  name: "Isolation Resistance",
                  description: ">= 500 Ohm/V",
                  status: "Approved",
                  modifiedAt: "2026-11-21T09:00:00Z",
                  relationships: [{ targetId: "COMP-BMS", relation: "satisfiedBy" }],
                },
              ],
            }),
          );
          return;
        }

        // Teamwork Cloud
        if (url.pathname === "/osmc/resources/res-42/revisions/latest/elements" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              revision: 18,
              elements: [
                {
                  elementId: "TWC-BLK-1",
                  name: "BatteryManagementSystem",
                  stereotype: "Block",
                  documentation: "Top-level BMS controller",
                  relationships: [{ targetId: "REQ-042", type: "Satisfy" }],
                },
              ],
            }),
          );
          return;
        }

        // Zuken DS-CR / DS-E3
        if (url.pathname === "/api/v1/designs" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              designs: [
                {
                  partNumber: "WH-HV-001",
                  name: "High-Voltage Pack Harness",
                  revision: "B",
                  state: "Released",
                  modifiedAt: "2026-11-21T10:00:00Z",
                  components: [{ partNumber: "CONN-HV-2P" }],
                },
              ],
            }),
          );
          return;
        }

        if (req.method === "POST" || req.method === "PUT") {
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: "OK-3", dag_run_id: "modelscript_RUN-300" }));
          return;
        }

        res.writeHead(404);
        res.end("Not found");
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("registers and syncs Bitbucket, Airflow, GENESYS, Teamwork Cloud, and Zuken DS-E3", async () => {
    for (const p of ["bitbucket", "airflow", "genesys", "twc", "zuken"]) {
      assert.ok(globalAlmConnectorRegistry.has(p), `Missing protocol '${p}'`);
    }
    assert.equal(globalAlmConnectorRegistry.get("bb")?.protocol, "bitbucket");
    assert.equal(globalAlmConnectorRegistry.get("vitech")?.protocol, "genesys");
    assert.equal(globalAlmConnectorRegistry.get("teamwork-cloud")?.protocol, "twc");
    assert.equal(globalAlmConnectorRegistry.get("ds-e3")?.protocol, "zuken");

    // Bitbucket
    const bb = globalAlmConnectorRegistry.get("bitbucket")!;
    const bbSpec = { ...normalizeRemoteDependency(`bitbucket+${baseUrl}/ENG/bms`)!, packageName: "@bb/bms" };
    const bbDelta = await bb.fetchDelta(bbSpec, { token: "t" });
    assert.equal(bbDelta.upserted[0]!.externalId, "BB-PR-77");
    const bbRun = await bb.pushVerificationRuns(bbSpec, { token: "t" }, [
      {
        runId: "RUN-300",
        title: "EKF Check",
        status: "Passed",
        commitSha: "abc999",
        verifiesIds: ["BB-PR-77"],
        metrics: {},
        timestamp: "2026-11-21T12:00:00Z",
      },
    ]);
    assert.equal(bbRun.pushed, 1);

    // Airflow
    const af = globalAlmConnectorRegistry.get("airflow")!;
    const afSpec = {
      ...normalizeRemoteDependency(`airflow+${baseUrl}/api/v1?dagId=thermal_monte_carlo`)!,
      packageName: "@pipe/airflow",
    };
    const afCaps = await af.discover(afSpec, { token: "t" });
    assert.equal(afCaps.serverVersion, "2.10.2");
    const afDelta = await af.fetchDelta(afSpec, { token: "t" });
    assert.equal(afDelta.upserted[0]!.externalId, "thermal_monte_carlo");
    const afTrigger = await af.pushVerificationRuns(afSpec, { token: "t" }, [
      {
        runId: "RUN-300",
        title: "Trigger Sweep",
        status: "Passed",
        verifiesIds: [],
        metrics: { maxTempC: 54.2 },
        timestamp: "2026-11-21T12:00:00Z",
      },
    ]);
    assert.equal(afTrigger.pushed, 1);
    assert.equal(afTrigger.createdIds?.["RUN-300"], "modelscript_RUN-300");

    // GENESYS
    const gen = globalAlmConnectorRegistry.get("genesys")!;
    const genSpec = {
      ...normalizeRemoteDependency(`genesys+${baseUrl}/projects/EV-SYS`)!,
      packageName: "@mbse/genesys",
    };
    const genDelta = await gen.fetchDelta(genSpec, { token: "t" });
    assert.equal(genDelta.upserted[0]!.externalId, "R.1.2");
    assert.equal(genDelta.links[0]!.relation, "satisfies");

    // Teamwork Cloud
    const twc = globalAlmConnectorRegistry.get("twc")!;
    const twcSpec = {
      ...normalizeRemoteDependency(`twc+${baseUrl}/osmc/resources/res-42`)!,
      packageName: "@mbse/twc",
    };
    const twcDelta = await twc.fetchDelta(twcSpec, { token: "t" });
    assert.equal(twcDelta.upserted[0]!.externalId, "TWC-BLK-1");
    assert.equal(twcDelta.snapshotVersion, "twc@r18");

    // Zuken DS-E3
    const zuken = globalAlmConnectorRegistry.get("ds-e3")!;
    const zukenSpec = {
      ...normalizeRemoteDependency(`ds-e3+${baseUrl}/api/v1`)!,
      packageName: "@ecad/harness",
    };
    const zukenDelta = await zuken.fetchDelta(zukenSpec, { token: "t" });
    assert.equal(zukenDelta.upserted[0]!.externalId, "WH-HV-001");
    assert.equal(zukenDelta.upserted[0]!.attributes["ecadTool"], "DS-E3");
    assert.equal(zukenDelta.links[0]!.targetId, "CONN-HV-2P");
  });
});

describe("Wave-4 SQL, Excel, Rhapsody & Bidirectional Upsert Connectors", () => {
  let server: http.Server;
  let baseUrl: string;

  before(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        if (url.pathname === "/sql/requirements" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify([
              {
                id: "SQL-1",
                title: "Max Bus Voltage",
                description: "<= 850 V",
                status: "Approved",
                updated_at: "2026-11-21T10:00:00Z",
              },
            ]),
          );
          return;
        }
        if (url.pathname === "/excel/usedRange" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              values: [
                ["ID", "Title", "Text", "Status"],
                ["XLS-1", "Pack Mass Budget", "Total mass <= 420 kg", "Approved"],
              ],
            }),
          );
          return;
        }
        if (url.pathname === "/am/oslc/query" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/ld+json" });
          res.end(
            JSON.stringify({
              "rdfs:member": [
                {
                  "@id": `${baseUrl}/am/res/RHP-1`,
                  "dcterms:identifier": "RHP-1",
                  "dcterms:title": "ThermalControllerBlock",
                  "dcterms:description": "Rhapsody SysML controller block",
                  "oslc_am:resourceType": "Block",
                  "oslc_rm:satisfies": ["REQ-042"],
                },
              ],
            }),
          );
          return;
        }
        if (req.method === "PATCH" || req.method === "PUT" || req.method === "POST") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        res.writeHead(404);
        res.end("Not found");
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("syncs SQL, Excel, and Rhapsody RMM and supports bidirectional upsertArtifacts", async () => {
    assert.equal(globalAlmConnectorRegistry.listProtocols().length, 25);

    const sql = globalAlmConnectorRegistry.get("sql")!;
    const sqlSpec = { ...normalizeRemoteDependency(`sql+${baseUrl}/sql/requirements`)!, packageName: "@db/reqs" };
    const sqlDelta = await sql.fetchDelta(sqlSpec, { token: "t" });
    assert.equal(sqlDelta.upserted[0]!.externalId, "SQL-1");
    assert.equal(
      (await sql.upsertArtifacts!(sqlSpec, { token: "t" }, [{ externalId: "SQL-1", status: "Released" }])).pushed,
      1,
    );

    const excel = globalAlmConnectorRegistry.get("excel")!;
    const excelSpec = { ...normalizeRemoteDependency(`excel+${baseUrl}/excel/usedRange`)!, packageName: "@xls/mass" };
    const excelDelta = await excel.fetchDelta(excelSpec, { token: "t" });
    assert.equal(excelDelta.upserted[0]!.externalId, "XLS-1");
    assert.equal(
      (await excel.upsertArtifacts!(excelSpec, { token: "t" }, [{ externalId: "XLS-1", title: "Updated Mass" }]))
        .pushed,
      1,
    );

    const rhp = globalAlmConnectorRegistry.get("rhapsody")!;
    const rhpSpec = { ...normalizeRemoteDependency(`rhapsody+${baseUrl}/am/oslc/query`)!, packageName: "@mbse/rhp" };
    const rhpDelta = await rhp.fetchDelta(rhpSpec, { token: "t" });
    assert.equal(rhpDelta.upserted[0]!.externalId, "RHP-1");
    assert.equal(rhpDelta.links[0]!.targetId, "REQ-042");

    // Verify bidirectional upsertArtifacts on Windchill & Azure DevOps
    const wc = globalAlmConnectorRegistry.get("windchill")!;
    const wcSpec = {
      ...normalizeRemoteDependency(`windchill+${baseUrl}/Windchill/servlet/odata/ProdMgmt`)!,
      packageName: "@plm/wc",
    };
    assert.equal(
      (await wc.upsertArtifacts!(wcSpec, { token: "t" }, [{ externalId: "BAT-1", title: "Pack Rev C" }])).pushed,
      1,
    );
  });
});

describe("SOTA Hardening: Pagination, CSRF/HMAC/JWT Auth, If-Match, Tombstones, Teamcenter SOA & Xray GraphQL", () => {
  let server: http.Server;
  let baseUrl: string;
  const seenHeaders: Record<string, Record<string, string | string[] | undefined>> = {};

  before(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      seenHeaders[`${req.method} ${url.pathname}`] = req.headers;
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        // Windchill CSRF + multi-page @odata.nextLink + @odata.removed tombstone
        if (url.pathname === "/Windchill/servlet/odata/PTC/GetCSRFToken()") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ NonceKey: "CSRF_NONCE", NonceValue: "nonce-xyz-123" }));
          return;
        }
        if (url.pathname === "/Windchill/servlet/odata/ProdMgmt/Parts" && req.method === "GET") {
          const isPage2 = url.searchParams.get("page") === "2";
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify(
              isPage2
                ? {
                    value: [
                      { Number: "P-2", Name: "Busbar", Version: "A.1" },
                      { Number: "P-OLD", "@odata.removed": { reason: "deleted" } },
                    ],
                  }
                : {
                    value: [{ Number: "P-1", Name: "Cell", Version: "A.1", "@odata.etag": '"etag-p1"' }],
                    "@odata.nextLink": `/Windchill/servlet/odata/ProdMgmt/Parts?page=2`,
                  },
            ),
          );
          return;
        }

        // GitHub multi-page Link: rel="next"
        if (url.pathname === "/repos/acme/multi/issues" && req.method === "GET") {
          const page = url.searchParams.get("page") ?? "1";
          if (page === "1") {
            res.writeHead(200, {
              "Content-Type": "application/json",
              Link: `<${baseUrl}/repos/acme/multi/issues?page=2>; rel="next"`,
            });
            res.end(JSON.stringify([{ number: 1, title: "Issue 1", state: "open" }]));
          } else {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify([{ number: 2, title: "Issue 2", state: "open" }]));
          }
          return;
        }

        // Onshape HMAC verification
        if (url.pathname === "/api/v6/documents/docHMAC") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ name: "HMAC Verified Doc" }));
          return;
        }

        // Teamcenter native SOA login + performSearchViewModel4
        if (url.pathname === "/tc/RestServices/Core-2006-03-Session/login") {
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Set-Cookie": "JSESSIONID=TC-SESS-99; Path=/",
          });
          res.end(JSON.stringify({}));
          return;
        }
        if (url.pathname === "/tc/RestServices/Query-2014-11-Finder/performSearchViewModel4") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              ServiceData: {
                modelObjects: {
                  "UID-SOA-1": {
                    type: "ItemRevision",
                    props: {
                      item_id: { dbValues: ["SOA-PART-1"] },
                      item_revision_id: { dbValues: ["B"] },
                      object_name: { uiValues: ["SOA Rotor Assembly"] },
                    },
                  },
                },
              },
            }),
          );
          return;
        }

        // Xray Cloud JWT exchange + GraphQL
        if (url.pathname === "/api/v2/authenticate") {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end('"eyJhbGciOiJIUzI1NiJ9.mock.jwt"');
          return;
        }
        if (url.pathname === "/api/v2/graphql") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              data: {
                getTests: {
                  total: 1,
                  results: [
                    {
                      issueId: "1001",
                      jira: { key: "XRAY-GQL-1", summary: "GraphQL Thermal Test", status: { name: "Active" } },
                      testType: { name: "Automated" },
                    },
                  ],
                },
              },
            }),
          );
          return;
        }

        // OSLC trs:Deletion tombstone
        if (url.pathname === "/rm/trs-del") {
          res.writeHead(200, { "Content-Type": "application/ld+json" });
          res.end(
            JSON.stringify({
              "rdfs:member": [{ "@type": "trs:Deletion", "dcterms:identifier": "REQ-DELETED-9" }],
            }),
          );
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("verifies Windchill pagination/CSRF/If-Match/tombstones, GitHub Link pagination, Onshape HMAC, Teamcenter SOA, Xray GraphQL, and OSLC deletions", async () => {
    // 1. Windchill multi-page + tombstone + CSRF + If-Match
    const wc = globalAlmConnectorRegistry.get("windchill")!;
    const wcSpec = {
      ...normalizeRemoteDependency(`windchill+${baseUrl}/Windchill/servlet/odata/ProdMgmt`)!,
      packageName: "@plm/wc",
    };
    const wcDelta = await wc.fetchDelta(wcSpec, { token: "t" });
    assert.deepEqual(
      wcDelta.upserted.map((a) => a.externalId),
      ["P-1", "P-2"],
    );
    assert.deepEqual(wcDelta.deletedIds, ["P-OLD"]);
    await wc.upsertArtifacts!(wcSpec, { token: "t" }, [
      { externalId: "P-1", title: "Cell v2", expectedEtag: '"etag-p1"' },
    ]);
    const wcPatchHeaders = seenHeaders["PATCH /Windchill/servlet/odata/ProdMgmt/Parts('P-1')"];
    assert.equal(wcPatchHeaders?.["csrf_nonce"], "nonce-xyz-123");
    assert.equal(wcPatchHeaders?.["if-match"], '"etag-p1"');

    // 2. GitHub multi-page Link header
    const gh = globalAlmConnectorRegistry.get("github")!;
    const ghSpec = { ...normalizeRemoteDependency(`github+${baseUrl}/repos/acme/multi`)!, packageName: "@gh/multi" };
    const ghDelta = await gh.fetchDelta(ghSpec, { token: "t" });
    assert.deepEqual(
      ghDelta.upserted.map((a) => a.externalId),
      ["GH-1", "GH-2"],
    );

    // 3. Onshape HMAC-SHA256 request signing
    const onshape = globalAlmConnectorRegistry.get("onshape")!;
    const onSpec = {
      ...normalizeRemoteDependency(`onshape+${baseUrl}/documents/docHMAC/w/w1/e/e1`)!,
      packageName: "@cad/on",
    };
    const onCaps = await onshape.discover(onSpec, { username: "AK123", password: "SK456" });
    assert.ok(onCaps.serverName?.includes("HMAC Verified Doc"));
    const onHeaders = seenHeaders["GET /api/v6/documents/docHMAC"];
    assert.ok(String(onHeaders?.["authorization"] ?? "").startsWith("On AK123:HmacSHA256:"));
    assert.ok(Boolean(onHeaders?.["on-nonce"]));

    // 4. Native Teamcenter SOA JSON
    const tc = globalAlmConnectorRegistry.get("teamcenter")!;
    const tcSpec = {
      ...normalizeRemoteDependency(`teamcenter+${baseUrl}/tc/RestServices`)!,
      packageName: "@plm/tc-soa",
    };
    const tcDelta = await tc.fetchDelta(tcSpec, { username: "infodba", password: "pw" });
    assert.equal(tcDelta.upserted[0]!.externalId, "SOA-PART-1");
    assert.equal(tcDelta.upserted[0]!.title, "SOA Rotor Assembly");
    assert.equal(
      seenHeaders["POST /tc/RestServices/Query-2014-11-Finder/performSearchViewModel4"]?.["cookie"],
      "JSESSIONID=TC-SESS-99",
    );

    // 5. Xray Cloud JWT exchange + GraphQL
    const xray = globalAlmConnectorRegistry.get("xray")!;
    const xraySpec = {
      ...normalizeRemoteDependency({ source: `xray+${baseUrl}/api/v2`, options: { mode: "graphql" } })!,
      packageName: "@qa/xray-gql",
    };
    const xrayDelta = await xray.fetchDelta(xraySpec, { username: "cid", password: "csec" });
    assert.equal(xrayDelta.upserted[0]!.externalId, "XRAY-GQL-1");
    assert.equal(seenHeaders["POST /api/v2/graphql"]?.["authorization"], "Bearer eyJhbGciOiJIUzI1NiJ9.mock.jwt");

    // 6. OSLC trs:Deletion tombstone
    const oslc = globalAlmConnectorRegistry.get("oslc")!;
    const oslcSpec = { ...normalizeRemoteDependency(`oslc+${baseUrl}/rm/trs-del`)!, packageName: "@rm/oslc" };
    const oslcDelta = await oslc.fetchDelta(oslcSpec, { token: "t" });
    assert.deepEqual(oslcDelta.deletedIds, ["REQ-DELETED-9"]);
  });
});

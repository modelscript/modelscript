// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parseStudioGitTarget } from "../src/pages/workspace/utils.js";
import "./test-setup.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Studio Landing Page UI/UX & Git Target Resolution", () => {
  const idePagePath = path.resolve(__dirname, "../src/pages/IdeWorkspacePage.tsx");
  const content = fs.readFileSync(idePagePath, "utf-8");

  it("uses 'Studio' in page header and title", () => {
    assert.ok(
      content.includes(
        '<Heading as="h1" style={{ fontSize: "18px", fontWeight: 700, margin: 0 }}>\n              Studio\n            </Heading>',
      ),
      "IdeWorkspacePage must use 'Studio' as header title",
    );
    assert.ok(
      !content.includes("{brandName} IDE") &&
        !content.includes("Ansatz IDE") &&
        !content.includes("ModelScript Studio"),
      "IdeWorkspacePage must not contain legacy IDE or ModelScript Studio header",
    );
    assert.ok(
      content.includes('`${displayTitle} — Studio` : "Studio"'),
      "IdeWorkspacePage must format page title with Studio suffix",
    );
  });

  it("removes all starter workspaces catalog and chips row", () => {
    assert.ok(!content.includes("WORKSPACE_CATALOG"), "IdeWorkspacePage must not declare static WORKSPACE_CATALOG");
    assert.ok(!content.includes("CategoryPills"), "IdeWorkspacePage must remove CategoryPills chips row");
    assert.ok(
      !content.includes("Starter Workspaces &amp; Digital Threads"),
      "IdeWorkspacePage must not render Starter Workspaces & Digital Threads section",
    );
  });

  it("omits the redundant Ansatz Morsel tile to keep Studio focused on multi-file workspaces", () => {
    assert.ok(
      !content.includes('data-testid="studio-morsel-tile"') && !content.includes('data-testid="studio-sketch-tile"'),
      "IdeWorkspacePage must not duplicate Morsel as a workspace tile",
    );
  });

  it("renders 'New Blank Workspace' as a clickable card tile without a redundant bottom button", () => {
    assert.ok(content.includes("Start a Workspace"), "IdeWorkspacePage must render 'Start a Workspace' section");
    assert.ok(content.includes("ActionTilesGrid"), "IdeWorkspacePage must render ActionTilesGrid");
    assert.ok(content.includes("New Blank Workspace"), "IdeWorkspacePage must render New Blank Workspace tile");
    assert.ok(
      content.includes("/vscode/workbench#memfs:empty"),
      "New Blank Workspace must launch /vscode/workbench#memfs:empty",
    );
    assert.ok(
      !content.includes("Launch Blank Workspace"),
      "IdeWorkspacePage must remove redundant 'Launch Blank Workspace' button",
    );
    assert.ok(
      content.includes('style={{ cursor: "pointer" }}'),
      "New Blank Workspace tile must be directly clickable with cursor: pointer",
    );
  });

  it("eliminates hover layout shift bug by removing transform translateY", () => {
    assert.ok(
      !content.includes("transform: translateY"),
      "ActionTile must not use transform: translateY(-1px) which shifts card positions on hover",
    );
  });

  it("renders 'Open Git Repository' tile with provider dropdown, owner/project path inputs, and solid open button", () => {
    assert.ok(content.includes("Open Git Repository"), "IdeWorkspacePage must render Open Git Repository tile");
    assert.ok(
      content.includes("ProviderSelect"),
      "IdeWorkspacePage must render ProviderSelect dropdown for GitHub/GitLab selection",
    );
    assert.ok(
      content.includes("RepoPathInputWrapper"),
      "IdeWorkspacePage must render RepoPathInputWrapper for owner/scope and project/repo inputs",
    );
    assert.ok(
      content.includes("PathSegmentInput"),
      "IdeWorkspacePage must render PathSegmentInput for owner and project inputs",
    );
    assert.ok(content.includes("BranchInputWrapper"), "IdeWorkspacePage must render BranchInputWrapper for ref input");
    assert.ok(
      content.includes("PrimaryOpenButton"),
      "IdeWorkspacePage must render PrimaryOpenButton with solid high-contrast styling",
    );
    assert.ok(!content.includes("Modelica Standard Library"), "IdeWorkspacePage must remove the legacy Try: chips row");
    assert.ok(
      content.includes("flex-wrap: nowrap;"),
      "GitRowContainer must specify flex-wrap: nowrap to prevent wrapping to next line",
    );
  });

  describe("parseStudioGitTarget parser", () => {
    it("parses full GitHub URLs with or without .git extension", () => {
      const res1 = parseStudioGitTarget("https://github.com/modelica/ModelicaStandardLibrary");
      assert.equal(res1.provider, "github");
      assert.equal(res1.owner, "modelica");
      assert.equal(res1.repo, "ModelicaStandardLibrary");
      assert.equal(res1.ref, "main");
      assert.equal(res1.workbenchUrl, "/vscode/workbench#modelica/ModelicaStandardLibrary@main");
      assert.equal(res1.repoPageUrl, "/repos/github/modelica/ModelicaStandardLibrary");

      const res2 = parseStudioGitTarget("https://github.com/modelica/ModelicaStandardLibrary.git");
      assert.equal(res2.repo, "ModelicaStandardLibrary");
      assert.equal(res2.ref, "main");
    });

    it("parses GitLab URLs including tree branch paths", () => {
      const res1 = parseStudioGitTarget("https://gitlab.com/libeigen/eigen");
      assert.equal(res1.provider, "gitlab");
      assert.equal(res1.owner, "libeigen");
      assert.equal(res1.repo, "eigen");
      assert.equal(res1.ref, "main");
      assert.equal(res1.workbenchUrl, "/vscode/workbench#libeigen/eigen@main");
      assert.equal(res1.repoPageUrl, "/repos/gitlab/libeigen/eigen");

      const res2 = parseStudioGitTarget("https://gitlab.com/libeigen/eigen/-/tree/3.4");
      assert.equal(res2.provider, "gitlab");
      assert.equal(res2.owner, "libeigen");
      assert.equal(res2.repo, "eigen");
      assert.equal(res2.ref, "3.4");
      assert.equal(res2.workbenchUrl, "/vscode/workbench#libeigen/eigen@3.4");
    });

    it("parses shorthand owner/repo and owner/repo@branch", () => {
      const res1 = parseStudioGitTarget("Systems-Modeling/SysML-v2-Release");
      assert.equal(res1.provider, "github");
      assert.equal(res1.owner, "Systems-Modeling");
      assert.equal(res1.repo, "SysML-v2-Release");
      assert.equal(res1.ref, "main");
      assert.equal(res1.workbenchUrl, "/vscode/workbench#Systems-Modeling/SysML-v2-Release@main");

      const res2 = parseStudioGitTarget("Systems-Modeling/SysML-v2-Release@v2026.03");
      assert.equal(res2.ref, "v2026.03");
      assert.equal(res2.workbenchUrl, "/vscode/workbench#Systems-Modeling/SysML-v2-Release@v2026.03");
    });

    it("respects branch override argument when provided", () => {
      const res = parseStudioGitTarget("https://github.com/su2code/su2", "develop");
      assert.equal(res.owner, "su2code");
      assert.equal(res.repo, "su2");
      assert.equal(res.ref, "develop");
      assert.equal(res.workbenchUrl, "/vscode/workbench#su2code/su2@develop");
    });

    it("respects provider override argument for owner/repo shorthand", () => {
      const res = parseStudioGitTarget("libeigen/eigen", "3.4", "gitlab");
      assert.equal(res.provider, "gitlab");
      assert.equal(res.owner, "libeigen");
      assert.equal(res.repo, "eigen");
      assert.equal(res.ref, "3.4");
      assert.equal(res.workbenchUrl, "/vscode/workbench#libeigen/eigen@3.4");
      assert.equal(res.repoPageUrl, "/repos/gitlab/libeigen/eigen");
    });

    it("throws a descriptive error on empty or invalid inputs", () => {
      assert.throws(() => parseStudioGitTarget(""), /Please enter a GitHub or GitLab repository URL/);
      assert.throws(() => parseStudioGitTarget("   "), /Please enter a GitHub or GitLab repository URL/);
      assert.throws(
        () => parseStudioGitTarget("https://unsupported-host.com/foo/bar"),
        /Supported providers are GitHub/,
      );
      assert.throws(() => parseStudioGitTarget("single-segment"), /Invalid repository URL/);
    });
  });
});

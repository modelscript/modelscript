// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  addGitlabIssueComment,
  createGitlabIssue,
  createGitlabMergeRequest,
  getAllRepoFilePaths,
  getGitlabBranches,
  getGitlabFileRaw,
  getGitlabIssues,
  getGitlabMergeRequests,
  getGitlabPipelineJobs,
  getGitlabPipelines,
  getGitlabProject,
  getGitlabTags,
  getGitlabTree,
  saveRepositoryFile,
  triggerGitlabPipeline,
  updateGitlabIssueState,
  updateGitlabMergeRequestState,
} from "../src/api/vcs.js";
import {
  canOpenFileInPlayground,
  formatBytes,
  getDialectForFileName,
  getFileDomainBadge,
  getFollowedReposMap,
  getLanguageFromFileName,
  getRelativeTime,
  isRepoStarred,
  normalizeWebhookEvents,
  parseRepositoryInput,
  setRepoStarred,
} from "../src/pages/workspace/utils.js";

describe("Repository Workspace UX & VCS Integration Suite", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() {
        return store.size;
      },
    };
  });

  describe("Repository Input Parser & Webhook Event Normalization", () => {
    it("parses GitHub, GitLab, ModelScript Git URLs, and owner/repo shorthand", () => {
      assert.deepEqual(parseRepositoryInput("https://github.com/modelica/ModelicaStandardLibrary.git"), {
        provider: "github",
        repo_full_name: "modelica/ModelicaStandardLibrary",
      });
      assert.deepEqual(parseRepositoryInput("gitlab.com/libeigen/eigen"), {
        provider: "gitlab",
        repo_full_name: "libeigen/eigen",
      });
      assert.deepEqual(parseRepositoryInput("https://modelscript.org/git/alice/ThermalActuator.git"), {
        provider: "local",
        repo_full_name: "alice/ThermalActuator",
      });
      assert.deepEqual(parseRepositoryInput("Systems-Modeling/SysML-v2-Release", "github"), {
        provider: "github",
        repo_full_name: "Systems-Modeling/SysML-v2-Release",
      });
    });

    it("normalizes webhook events from SQLite JSON strings, arrays, and CSV strings", () => {
      assert.deepEqual(normalizeWebhookEvents('["push","release","simulation"]'), ["push", "release", "simulation"]);
      assert.deepEqual(normalizeWebhookEvents(["push", "merge_request"]), ["push", "merge_request"]);
      assert.deepEqual(normalizeWebhookEvents("push, tag_push , release"), ["push", "tag_push", "release"]);
    });
  });

  describe("Engineering File Utilities & Engagement Sync", () => {
    it("recognizes engineering file dialects, languages, and domain badges", () => {
      assert.equal(getLanguageFromFileName("ChuaCircuit.mo"), "modelica");
      assert.equal(getDialectForFileName("ChuaCircuit.mo"), "modelica");
      assert.equal(canOpenFileInPlayground("ChuaCircuit.mo"), true);
      assert.equal(getFileDomainBadge("ChuaCircuit.mo")?.label, "Modelica");

      assert.equal(getDialectForFileName("VehicleArchitecture.sysml"), "sysml2");
      assert.equal(canOpenFileInPlayground("VehicleArchitecture.sysml"), true);
      assert.equal(getFileDomainBadge("VehicleArchitecture.sysml")?.label, "SysML v2");

      assert.equal(canOpenFileInPlayground("LICENSE"), false);
      assert.equal(formatBytes(2048), "2.00 KB");
      assert.equal(getRelativeTime(new Date().toISOString()), "just now");
    });

    it("synchronizes Star / Follow state across RepositoryListPage and WorkspaceHeader keys", () => {
      const repoKey = "modelica/ModelicaStandardLibrary";
      assert.equal(isRepoStarred(repoKey), false);

      setRepoStarred(repoKey, true);
      assert.equal(isRepoStarred(repoKey), true);
      assert.equal(getFollowedReposMap()[repoKey], true);

      setRepoStarred(repoKey, false);
      assert.equal(isRepoStarred(repoKey), false);
      assert.equal(Boolean(getFollowedReposMap()[repoKey]), false);
    });
  });

  describe("Offline-Resilient Flagship Catalog & Full Lifecycle Operations", () => {
    it("resolves project metadata, multi-file trees, branches, tags, and raw files for flagship repos", async () => {
      const msl = await getGitlabProject("modelica/ModelicaStandardLibrary", "local");
      assert.equal(msl.path_with_namespace, "modelica/ModelicaStandardLibrary");
      assert.ok((msl.star_count ?? 0) > 100);
      assert.ok(Array.isArray(msl.languages_breakdown) && msl.languages_breakdown.length > 0);

      const rootTree = await getGitlabTree("modelica/ModelicaStandardLibrary", "main", "", "local");
      assert.ok(rootTree.some((n) => n.name === "Modelica" && n.type === "tree"));

      const allFiles = await getAllRepoFilePaths("modelica/ModelicaStandardLibrary", "main", "local");
      assert.ok(allFiles.some((f) => f.path.endsWith("ChuaCircuit.mo")));

      const branches = await getGitlabBranches("modelica/ModelicaStandardLibrary", "local");
      assert.ok(branches.length >= 2);

      const tags = await getGitlabTags("modelica/ModelicaStandardLibrary", "local");
      assert.ok(tags.length >= 2);
    });

    it("supports inline file creation and editing in repository workspace", async () => {
      await saveRepositoryFile(
        "modelica/ModelicaStandardLibrary",
        "Modelica/Blocks/NewController.mo",
        "model NewController\n  Real x;\nend NewController;\n",
        "Add NewController model",
        "main",
        "local",
      );

      const content = await getGitlabFileRaw(
        "modelica/ModelicaStandardLibrary",
        "Modelica/Blocks/NewController.mo",
        "main",
        "local",
      );
      assert.ok(content.includes("model NewController"));
    });

    it("supports creating, commenting on, and closing/reopening issues across providers", async () => {
      const created = await createGitlabIssue(
        "modelica/ModelicaStandardLibrary",
        "Verify homotopy initialization in thermal network",
        "Check solver convergence with tolerance 1e-6.",
        "local",
        ["dae-solver", "enhancement"],
      );
      assert.equal(created.state, "opened");
      assert.deepEqual(created.labels, ["dae-solver", "enhancement"]);

      const comment = await addGitlabIssueComment(
        "modelica/ModelicaStandardLibrary",
        created.iid,
        "Confirmed balanced 1:1 DAE system.",
        "alice",
      );
      assert.equal(comment.author, "alice");

      const closed = await updateGitlabIssueState("modelica/ModelicaStandardLibrary", created.iid, "closed", "local");
      assert.equal(closed?.state, "closed");

      const list = await getGitlabIssues("modelica/ModelicaStandardLibrary", "local");
      assert.ok(list.some((i) => i.iid === created.iid && i.state === "closed"));
    });

    it("supports creating and merging pull requests and triggering CI pipelines", async () => {
      const mr = await createGitlabMergeRequest(
        "modelica/ModelicaStandardLibrary",
        {
          title: "Add smooth zero-crossing to ChuaDiode",
          description: "Improves adaptive step-size stability.",
          source_branch: "fix/chua-diode",
          target_branch: "main",
        },
        "local",
      );
      assert.equal(mr.state, "opened");

      const merged = await updateGitlabMergeRequestState("modelica/ModelicaStandardLibrary", mr.iid, "merged", "local");
      assert.equal(merged?.state, "merged");

      const mrList = await getGitlabMergeRequests("modelica/ModelicaStandardLibrary", "local");
      assert.ok(mrList.some((m) => m.iid === mr.iid && m.state === "merged"));

      const pipeline = await triggerGitlabPipeline(
        "modelica/ModelicaStandardLibrary",
        "main",
        "DAE Structural Balance & Unit Check",
        "local",
      );
      assert.equal(pipeline.status, "success");

      const pipelines = await getGitlabPipelines("modelica/ModelicaStandardLibrary", "main", "local");
      assert.ok(pipelines.some((p) => p.id === pipeline.id));

      const jobs = await getGitlabPipelineJobs("modelica/ModelicaStandardLibrary", pipeline.id, "local");
      assert.ok(jobs.length >= 2);
      assert.ok(jobs[0]?.log_output?.includes("100% passed"));
    });
  });
});

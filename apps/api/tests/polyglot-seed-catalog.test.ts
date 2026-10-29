// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { LibraryDatabase } from "../src/database.js";
import {
  ALL_44_LANGUAGE_SEED_POSTS,
  SEED_PERSONAS,
  seedPolyglotSocialData,
  seedPolyglotUsers,
} from "../src/seed/index.js";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, "../../..");

describe("Polyglot 44-Language Social Seed Catalog", () => {
  let tmpDir: string;
  let db: LibraryDatabase;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msx-polyglot-seed-"));
    db = new LibraryDatabase(path.join(tmpDir, "test.db"));
  });

  after(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("covers all 44 languages in languages/* with 1-to-1 fidelity", () => {
    const languagesDir = path.join(REPO_ROOT, "languages");
    const diskLanguages = fs
      .readdirSync(languagesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();

    assert.equal(diskLanguages.length, 44);
    assert.equal(ALL_44_LANGUAGE_SEED_POSTS.length, 44);

    const catalogLanguages = ALL_44_LANGUAGE_SEED_POSTS.map((p) => (p.language ?? p.languageId ?? "").trim()).sort();
    assert.deepEqual(catalogLanguages, diskLanguages);

    const titles = new Set<string>();
    for (const spec of ALL_44_LANGUAGE_SEED_POSTS) {
      assert.ok(spec.title.trim().length > 10, `Title too short for ${spec.language ?? spec.languageId}`);
      assert.equal(titles.has(spec.title), false, `Duplicate title: ${spec.title}`);
      titles.add(spec.title);
      assert.ok(spec.code.trim().length > 50, `Code too short for ${spec.title}`);
      assert.ok(spec.postContent.trim().length > 40, `Post content too short for ${spec.title}`);
      assert.ok(spec.comments.length >= 1, `Expected >= 1 comment for ${spec.title}`);
      assert.ok(spec.likedBy.length >= 3, `Expected >= 3 likes for ${spec.title}`);
    }
  });

  it("seeds 20 personas, 44 language artifacts + 1 fork, comments, likes, and is idempotent", async () => {
    const uploadDir = path.join(tmpDir, "uploads");
    const summary1 = await seedPolyglotSocialData(db, { uploadDir });

    assert.equal(summary1.usersSeeded, SEED_PERSONAS.length);
    assert.equal(summary1.artifactsCreated, 45); // 44 languages + 1 forked Modelica post
    assert.equal(summary1.postsCreated, 45);
    assert.ok(summary1.commentsCreated >= 100, `Expected >= 100 comments+replies, got ${summary1.commentsCreated}`);

    const codeOnlyViewTypes = new Set([
      "fortran",
      "c",
      "plcopen",
      "verilog-a",
      "scad",
      "csg",
      "ccsds",
      "energyplus",
      "reqif",
      "autosar",
      "cfd-config",
    ]);

    // Verify every diagram-capable artifact view has a generated SVG thumbnail
    for (const spec of ALL_44_LANGUAGE_SEED_POSTS) {
      const row = db.getArtifactViewByTitle(spec.title);
      assert.ok(row, `Missing artifact view for ${spec.title}`);
      const fullView = db.getArtifactView(row.id);
      assert.ok(fullView, `Missing full artifact view for id ${row.id}`);
      const cfg = JSON.parse(fullView.view_config) as Record<string, unknown>;
      if (codeOnlyViewTypes.has(spec.viewType)) {
        assert.equal(typeof cfg["code"], "string", `Expected code string for ${spec.title}`);
      } else {
        assert.equal(typeof cfg["svg"], "string", `Expected SVG string for ${spec.title}`);
        assert.ok((cfg["svg"] as string).includes("<svg"), `Expected <svg tag for ${spec.title}`);
        assert.equal(typeof cfg["thumbnailUrl"], "string", `Expected thumbnailUrl for ${spec.title}`);
      }
    }

    // Second invocation must be a no-op (idempotent)
    const summary2 = await seedPolyglotSocialData(db, { uploadDir });
    assert.equal(summary2.artifactsCreated, 0);
    assert.equal(summary2.postsCreated, 0);
    assert.equal(summary2.commentsCreated, 0);
  });

  it("seeds real GitHub and GitLab repositories with avatars and default branches", () => {
    seedPolyglotUsers(db);
    const popularRepos = db.getPopularRepos(20);
    assert.ok(popularRepos.length >= 9, `Expected >= 9 seeded repositories, got ${popularRepos.length}`);
    const providers = new Set(popularRepos.map((r) => r.provider));
    assert.ok(providers.has("github"), "Expected GitHub repositories in seed");
    assert.ok(providers.has("gitlab"), "Expected GitLab repositories in seed");

    const omarUser = db.getUserByUsername("omar");
    assert.ok(omarUser);
    const omarRepos = db.getLinkedRepos(omarUser.id);
    assert.equal(omarRepos.length, 3);
    assert.ok(
      omarRepos.some(
        (r) => r.provider === "github" && r.namespace === "modelica" && r.project === "ModelicaStandardLibrary",
      ),
    );
    assert.ok(omarRepos.some((r) => r.provider === "gitlab" && r.namespace === "libeigen" && r.project === "eigen"));
    for (const r of omarRepos) {
      assert.ok(r.avatar_url, `Expected avatar_url to be populated for ${r.namespace}/${r.project}`);
      assert.ok(r.default_branch, `Expected default_branch to be populated for ${r.namespace}/${r.project}`);
    }
  });

  it("assigns the ModelScript logo to omar, realistic portraits to all 19 other personas, and realistic banners to all 20 personas", () => {
    const webPublicDir = path.join(REPO_ROOT, "apps/web/public");
    for (const p of SEED_PERSONAS) {
      if (p.username === "omar") {
        assert.equal(p.avatarSvg, "/ms-logo.png");
        assert.ok(fs.existsSync(path.join(webPublicDir, "ms-logo.png")));
      } else {
        assert.equal(p.avatarSvg, `/avatars/${p.username}.png`);
        const avatarFile = path.join(webPublicDir, "avatars", `${p.username}.png`);
        assert.ok(fs.existsSync(avatarFile), `Missing avatar file for ${p.username} at ${avatarFile}`);
        assert.ok(fs.statSync(avatarFile).size > 50_000, `Expected realistic portrait image for ${p.username}`);
      }
      assert.equal(p.bannerSvg, `/banners/${p.username}.png`);
      const bannerFile = path.join(webPublicDir, "banners", `${p.username}.png`);
      assert.ok(fs.existsSync(bannerFile), `Missing banner file for ${p.username} at ${bannerFile}`);
      assert.ok(fs.statSync(bannerFile).size > 50_000, `Expected realistic banner image for ${p.username}`);
    }
  });
});

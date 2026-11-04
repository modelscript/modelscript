// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { CitationModal } from "../src/components/citations/CitationModal.js";
import { CiteButton } from "../src/components/citations/CiteButton.js";
import { buildInsertedCitationSnippet } from "../src/components/compose/ComposeCitationPickerModal.js";
import { ComposeToolbar } from "../src/components/compose/ComposeToolbar.js";
import { renderPostMarkdownHtml } from "../src/components/post/PostMarkdownContent.js";
import {
  buildCitationFromArtifact,
  buildCitationFromPackage,
  buildCitationFromPost,
  buildCitationFromRepo,
  buildCitationFromScholarlyWork,
  buildSourcePageUrl,
  exportCitation,
  formatCitation,
  normalizeCitationUrn,
  transformTextualCitationsToMarkdownLinks,
} from "../src/util/citations.js";

test("Universal Citations, OpenAlex Scholarly Reference Manager & Source URN Resolution", async (t) => {
  await t.test("normalizes citation URNs across OpenAlex, DOI, ArXiv, PMID, ISBN, and Ansatz entities", () => {
    assert.equal(normalizeCitationUrn("W2108598243"), "urn:openalex:W2108598243");
    assert.equal(normalizeCitationUrn("https://openalex.org/W2108598243"), "urn:openalex:W2108598243");
    assert.equal(normalizeCitationUrn("10.1137/0909014"), "urn:doi:10.1137/0909014");
    assert.equal(normalizeCitationUrn("https://doi.org/10.1137/0909014"), "urn:doi:10.1137/0909014");
    assert.equal(normalizeCitationUrn("arxiv:1706.03762"), "urn:arxiv:1706.03762");
    assert.equal(normalizeCitationUrn("urn:ansatz:package:Modelica@4.1.0"), "urn:ansatz:package:Modelica@4.1.0");
    assert.equal(buildSourcePageUrl("10.1137/0909014"), "/sources/urn%3Adoi%3A10.1137%2F0909014");
    assert.equal(buildSourcePageUrl("urn:ansatz:post:42"), "/posts/42");
    assert.equal(buildSourcePageUrl("urn:ansatz:post:2117862858644525056"), "/posts/2117862858644525056");
  });

  await t.test(
    "formats citations and machine-readable exports for posts, packages, artifacts, repos, and papers",
    () => {
      const postMeta = buildCitationFromPost({
        id: "2117862858644525056",
        content: "Consistent initialization of differential-algebraic systems with Pantelides algorithm.",
        author_username: "pantelides",
        author_display_name: "Constantinos C. Pantelides",
        created_at: "2026-03-15T12:00:00Z",
      });
      assert.equal(postMeta.urn, "urn:ansatz:post:2117862858644525056");
      assert.equal(postMeta.url, "/pantelides/status/2117862858644525056");
      assert.equal(postMeta.sourcePageUrl, "/pantelides/status/2117862858644525056");
      assert.ok(formatCitation(postMeta, "apa").includes("Pantelides"));
      assert.ok(formatCitation(postMeta, "mla").includes("Consistent initialization"));
      assert.ok(formatCitation(postMeta, "ieee").includes("[1]"));
      assert.ok(exportCitation(postMeta, "bibtex").includes("@misc{"));
      assert.ok(exportCitation(postMeta, "ris").includes("TY  - "));
      assert.ok(exportCitation(postMeta, "csl-json").includes('"id": "urn:ansatz:post:2117862858644525056"'));
      assert.ok(exportCitation(postMeta, "cff").includes("cff-version: 1.2.0"));
      assert.ok(exportCitation(postMeta, "enw").includes("%0 "));

      const pkgMeta = buildCitationFromPackage({
        name: "Modelica",
        version: "4.1.0",
        description: "Modelica Standard Library",
        author: "Modelica Association",
      });
      assert.equal(pkgMeta.urn, "urn:ansatz:package:Modelica@4.1.0");
      assert.ok(exportCitation(pkgMeta, "bibtex").includes("@software{"));

      const artMeta = buildCitationFromArtifact({
        id: 108,
        title: "Chua Circuit Chaos Simulation",
        type: "simulation",
        authorName: "Leon Chua",
      });
      assert.equal(artMeta.urn, "urn:ansatz:artifact:108");
      assert.ok(formatCitation(artMeta, "apa").includes("Chua"));

      const repoMeta = buildCitationFromRepo({
        provider: "local",
        namespace: "control",
        project: "lqr-flight-controller",
        description: "LQR flight controller in ModelScript",
      });
      assert.equal(repoMeta.urn, "urn:ansatz:repo:local/control/lqr-flight-controller");

      const workMeta = buildCitationFromScholarlyWork({
        urn: "urn:openalex:W2108598243",
        openalexId: "W2108598243",
        doi: "10.1137/0909014",
        title: "The Consistent Initialization of Differential-Algebraic Systems",
        authors: [{ name: "Constantinos C. Pantelides" }],
        publicationYear: 1988,
        venue: "SIAM Journal on Scientific and Statistical Computing",
        volume: "9",
        issue: "2",
        pages: "213-231",
      });
      assert.ok(formatCitation(workMeta, "apa").includes("1988"));
      assert.ok(exportCitation(workMeta, "bibtex").includes("10.1137/0909014"));
    },
  );

  await t.test(
    "transforms textual citations ([@urn:...], [@doi:...], [@arxiv:...], \\cite{...}, bare urn:...) into /sources/* links while preserving code blocks",
    () => {
      const input = [
        "See Pantelides [@urn:openalex:W2108598243] and DASSL [@doi:10.1137/0909014].",
        "Also compare Transformer [@arxiv:1706.03762] and LaTeX style \\cite{urn:openalex:W2045613891}.",
        "Bare URN reference: urn:ansatz:package:Modelica@4.1.0 in prose.",
        "Inline code `[@urn:openalex:W2108598243]` and fenced block:",
        "```modelica",
        "// Do not convert [@doi:10.1137/0909014] inside code",
        "model Test end Test;",
        "```",
      ].join("\n");

      const transformed = transformTextualCitationsToMarkdownLinks(input);
      assert.ok(transformed.includes("(/sources/urn%3Aopenalex%3AW2108598243)"));
      assert.ok(transformed.includes("(/sources/urn%3Adoi%3A10.1137%2F0909014)"));
      assert.ok(transformed.includes("(/sources/urn%3Aarxiv%3A1706.03762)"));
      assert.ok(transformed.includes("(/sources/urn%3Aopenalex%3AW2045613891)"));
      assert.ok(transformed.includes("(/sources/urn%3Aansatz%3Apackage%3AModelica%404.1.0)"));
      assert.ok(transformed.includes("`[@urn:openalex:W2108598243]`"), "Inline code must not be modified");
      assert.ok(
        transformed.includes("// Do not convert [@doi:10.1137/0909014] inside code"),
        "Fenced code block must not be modified",
      );

      const renderedHtml = renderPostMarkdownHtml(input);
      assert.ok(
        renderedHtml.includes('href="/sources/urn%3Aopenalex%3AW2108598243" class="msx-citation-pill"'),
        "PostMarkdownContent must render converted citations as .msx-citation-pill links to /sources/*",
      );
    },
  );

  await t.test("renders CiteButton, CitationModal, ComposeToolbar citation trigger, and snippet builder", async () => {
    const pkgCitation = buildCitationFromPackage({
      name: "Modelica",
      version: "4.1.0",
      description: "Modelica Standard Library",
    });

    const btnHtml = renderToStaticMarkup(
      React.createElement(MemoryRouter, null, React.createElement(CiteButton, { metadata: pkgCitation })),
    );
    assert.ok(btnHtml.includes("Cite"));

    const modalHtml = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(CitationModal, {
          isOpen: true,
          onClose: () => {},
          metadata: pkgCitation,
        }),
      ),
    );
    assert.ok(modalHtml.includes("Cite this Software Package"));
    assert.ok(modalHtml.includes("urn:ansatz:package:Modelica@4.1.0"));
    assert.ok(modalHtml.includes("BibTeX"));
    assert.ok(modalHtml.includes("Open Source Page"));
    assert.ok(modalHtml.includes("Save to References"));

    const postCitation = buildCitationFromPost({
      id: 263,
      content: "Engineering design note on DAE algorithms.",
      author_username: "ada",
      author_display_name: "Ada Lovelace",
    });
    const postModalHtml = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(CitationModal, {
          isOpen: true,
          onClose: () => {},
          target: postCitation,
        }),
      ),
    );
    assert.ok(postModalHtml.includes("View Post"));
    assert.ok(postModalHtml.includes("/ada/status/263"));
    assert.ok(!postModalHtml.includes("Save to References"));

    const snippetUrn = buildInsertedCitationSnippet(
      {
        urn: "urn:openalex:W2108598243",
        title: "The Consistent Initialization of Differential-Algebraic Systems",
        authors: [{ name: "Constantinos C. Pantelides" }],
        publicationYear: 1988,
        doi: "10.1137/0909014",
      },
      "urn-tag",
    );
    assert.equal(snippetUrn, "[@urn:openalex:W2108598243]");

    const snippetMd = buildInsertedCitationSnippet(
      {
        urn: "urn:openalex:W2108598243",
        title: "The Consistent Initialization of Differential-Algebraic Systems",
        authors: [{ name: "Constantinos C. Pantelides" }],
        publicationYear: 1988,
        doi: "10.1137/0909014",
      },
      "markdown-link",
    );
    assert.equal(snippetMd, "[Pantelides (1988)](/sources/urn%3Aopenalex%3AW2108598243)");

    const toolbarHtml = renderToStaticMarkup(
      React.createElement(ComposeToolbar, {
        isNotebookMode: false,
        content: "",
        setContent: () => {},
        setShowMorselModal: () => {},
        setShowPackageRepoPicker: () => {},
        setShowCodeSnippetModal: () => {},
        setShowHpcPicker: () => {},
        setShowCitationPicker: () => {},
        hasHpc: false,
        fileInputRef: { current: null },
        handleFileUpload: () => {},
        uploadingFile: false,
        showContentWarning: false,
        setShowContentWarning: () => {},
        showEmojiPicker: false,
        setShowEmojiPicker: () => {},
        handleSubmit: () => {},
        submitting: false,
        artifactId: null,
        hasNotebookContent: false,
      }),
    );
    // Hidden by default when references feature flag is false
    assert.ok(!toolbarHtml.includes('data-testid="composer-insert-citation-btn"'));

    const { FeatureFlagContext, DEFAULT_FRONTEND_FLAGS } = await import("../src/FeatureFlagContext.js");
    const enabledToolbarHtml = renderToStaticMarkup(
      React.createElement(
        FeatureFlagContext.Provider,
        {
          value: {
            flags: { ...DEFAULT_FRONTEND_FLAGS, references: true },
            overrides: {},
            isLoading: false,
            refreshFlags: async () => {},
            isEnabled: (k: string) => k === "references",
            setFlagOverride: () => {},
            resetAllOverrides: () => {},
          },
        },
        React.createElement(ComposeToolbar, {
          isNotebookMode: false,
          content: "",
          setContent: () => {},
          setShowMorselModal: () => {},
          setShowPackageRepoPicker: () => {},
          setShowCodeSnippetModal: () => {},
          setShowHpcPicker: () => {},
          setShowCitationPicker: () => {},
          hasHpc: false,
          fileInputRef: { current: null },
          handleFileUpload: () => {},
          uploadingFile: false,
          showContentWarning: false,
          setShowContentWarning: () => {},
          showEmojiPicker: false,
          setShowEmojiPicker: () => {},
          handleSubmit: () => {},
          submitting: false,
          artifactId: null,
          hasNotebookContent: false,
        }),
      ),
    );
    assert.ok(enabledToolbarHtml.includes('data-testid="composer-insert-citation-btn"'));
  });

  await t.test("registers /references, /sources/*, and /admin/openalex S3 Partition Manager routes", async () => {
    const appSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../src/App.tsx"), "utf-8");
    assert.ok(appSrc.includes('path="/references"'));
    assert.ok(appSrc.includes('path="/sources/:identifier"'));
    assert.ok(appSrc.includes('path="/sources/*"'));

    const sidebarSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../src/components/Sidebar.tsx"), "utf-8");
    assert.ok(sidebarSrc.includes('to: "/references"'));

    const adminSidebarSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/pages/admin/components/AdminMenuSidebar.tsx"),
      "utf-8",
    );
    assert.ok(adminSidebarSrc.includes('onSelectTab("openalex")'));
    assert.ok(adminSidebarSrc.includes("OpenAlex S3 Catalog"));

    const adminPageSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../src/pages/AdminPage.tsx"), "utf-8");
    assert.ok(adminPageSrc.includes('activeTab === "openalex"'));
    assert.ok(adminPageSrc.includes("<AdminOpenAlexTab />"));

    const { AdminOpenAlexTab } = await import("../src/pages/admin/tabs/AdminOpenAlexTab.js");
    const openAlexAdminHtml = renderToStaticMarkup(React.createElement(AdminOpenAlexTab));
    assert.ok(openAlexAdminHtml.includes("OpenAlex S3 Partition Manager"));
    assert.ok(openAlexAdminHtml.includes("Sync S3 Bucket Manifest"));
    assert.ok(openAlexAdminHtml.includes("Rebuild &amp; Optimize FTS5"));

    const { ReferencesPage } = await import("../src/pages/ReferencesPage.js");
    const { FeatureFlagContext, DEFAULT_FRONTEND_FLAGS } = await import("../src/FeatureFlagContext.js");
    const refsHtml = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/references?tab=browse"] },
        React.createElement(
          FeatureFlagContext.Provider,
          {
            value: {
              flags: { ...DEFAULT_FRONTEND_FLAGS, references: true },
              overrides: {},
              isLoading: false,
              refreshFlags: async () => {},
              isEnabled: (k: string) => k === "references",
              setFlagOverride: () => {},
              resetAllOverrides: () => {},
            },
          },
          React.createElement(ReferencesPage),
        ),
      ),
    );
    assert.ok(refsHtml.includes('data-testid="references-quick-resolve-form"'));
    assert.ok(refsHtml.includes('data-testid="references-tab-browse"'));
    assert.ok(refsHtml.includes("Browse by Topic, Author &amp; Venue"));
    assert.ok(refsHtml.includes('data-testid="references-browse-directory"'));
  });
});

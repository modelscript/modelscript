// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_FRONTEND_FLAGS } from "../src/FeatureFlagContext.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("References and Repositories Feature Flags Gating", () => {
  it("verifies git_repositories, repositories, references, and scientific_references are disabled by default in DEFAULT_FRONTEND_FLAGS", () => {
    assert.strictEqual(DEFAULT_FRONTEND_FLAGS.git_repositories, false, "git_repositories must be false by default");
    assert.strictEqual(DEFAULT_FRONTEND_FLAGS.repositories, false, "repositories alias must be false by default");
    assert.strictEqual(DEFAULT_FRONTEND_FLAGS.references, false, "references must be false by default");
    assert.strictEqual(
      DEFAULT_FRONTEND_FLAGS.scientific_references,
      false,
      "scientific_references alias must be false by default",
    );
  });

  it("verifies Sidebar.tsx conditionally renders Repositories and References links based on feature flags", () => {
    const sidebarPath = path.resolve(__dirname, "../src/components/Sidebar.tsx");
    const content = fs.readFileSync(sidebarPath, "utf-8");

    assert.ok(
      content.includes('useFeatureFlag("git_repositories")') || content.includes('useFeatureFlag(["git_repositories"'),
      "Sidebar.tsx must check hasRepos using git_repositories flag",
    );
    assert.ok(
      content.includes('useFeatureFlag("references")') || content.includes('useFeatureFlag(["references"'),
      "Sidebar.tsx must check hasReferences using references flag",
    );
    assert.ok(
      content.includes("if (hasRepos)") &&
        content.includes('registryLinks.push({ to: "/repos", icon: RepoIcon, label: "Repositories" });'),
      "Sidebar.tsx must only push /repos to registryLinks when hasRepos is true",
    );
    assert.ok(
      content.includes("if (hasReferences)") &&
        content.includes('registryLinks.push({ to: "/references", icon: BookIcon, label: "References" });'),
      "Sidebar.tsx must only push /references to registryLinks when hasReferences is true",
    );
  });

  it("verifies AppShell.tsx conditionally renders Repositories and References links in MoreSheet based on feature flags", () => {
    const appShellPath = path.resolve(__dirname, "../src/components/AppShell.tsx");
    const content = fs.readFileSync(appShellPath, "utf-8");

    assert.ok(
      content.includes('useFeatureFlag(["git_repositories", "repositories"])') ||
        content.includes('useFeatureFlag("git_repositories")'),
      "AppShell.tsx must evaluate hasRepos flag",
    );
    assert.ok(
      content.includes('useFeatureFlag(["references", "scientific_references"])') ||
        content.includes('useFeatureFlag("references")'),
      "AppShell.tsx must evaluate hasReferences flag",
    );
    assert.ok(
      content.includes('{hasRepos && (\n                    <Link to="/repos"'),
      "AppShell.tsx must gate /repos link in MoreSheet behind hasRepos",
    );
    assert.ok(
      content.includes('{hasReferences && (\n                    <Link to="/references"'),
      "AppShell.tsx must gate /references link in MoreSheet behind hasReferences",
    );
  });

  it("verifies App.tsx routes /repos*, /references, and /sources* conditionally and gates 'g r' keyboard shortcut", () => {
    const appPath = path.resolve(__dirname, "../src/App.tsx");
    const content = fs.readFileSync(appPath, "utf-8");

    assert.ok(
      content.includes('useFeatureFlag(["git_repositories", "repositories"])') ||
        content.includes('useFeatureFlag("git_repositories")'),
      "App.tsx must evaluate hasRepos flag",
    );
    assert.ok(
      content.includes('useFeatureFlag(["references", "scientific_references"])') ||
        content.includes('useFeatureFlag("references")'),
      "App.tsx must evaluate hasReferences flag",
    );
    assert.ok(
      content.includes('path="/repos"') && content.includes("hasRepos ? <RepositoryListPage /> : <Navigate to="),
      "App.tsx must redirect /repos when hasRepos is false",
    );
    assert.ok(
      content.includes('path="/references"') && content.includes("hasReferences ? <ReferencesPage /> : <Navigate to="),
      "App.tsx must redirect /references when hasReferences is false",
    );
    assert.ok(
      content.includes('path="/sources/:identifier"') &&
        content.includes("hasReferences ? <SourceDetailPage /> : <Navigate to="),
      "App.tsx must redirect /sources/:identifier when hasReferences is false",
    );
    assert.ok(
      content.includes(
        'if (hasRepos) {\n            e.preventDefault();\n            navWithScroll("/repos");\n          }',
      ),
      "App.tsx must only trigger 'g r' navigation when hasRepos is true",
    );
  });

  it("verifies KeyboardShortcutsModal.tsx filters out 'g r' shortcut when hasRepos is false", () => {
    const modalPath = path.resolve(__dirname, "../src/components/KeyboardShortcutsModal.tsx");
    const content = fs.readFileSync(modalPath, "utf-8");

    assert.ok(
      content.includes('useFeatureFlag(["git_repositories", "repositories"])') ||
        content.includes('useFeatureFlag("git_repositories")'),
      "KeyboardShortcutsModal.tsx must evaluate hasRepos",
    );
    assert.ok(
      content.includes('!item.keys.includes("r")'),
      "KeyboardShortcutsModal.tsx must filter out 'r' shortcut when hasRepos is disabled",
    );
  });

  it("verifies RightPanel.tsx gates PopularReposCard and suppresses fetching when hasRepos is false", () => {
    const rightPanelPath = path.resolve(__dirname, "../src/components/RightPanel.tsx");
    const content = fs.readFileSync(rightPanelPath, "utf-8");

    assert.ok(
      content.includes('useFeatureFlag(["git_repositories", "repositories"])') ||
        content.includes('useFeatureFlag("git_repositories")'),
      "RightPanel.tsx must evaluate hasRepos",
    );
    assert.ok(
      content.includes("if (!hasRepos) return;"),
      "RightPanel.tsx must return early in fetchPopularRepos when hasRepos is false",
    );
  });

  it("verifies PackageRepoPickerModal.tsx gates repositories tab behind hasRepos", () => {
    const pickerPath = path.resolve(__dirname, "../src/components/PackageRepoPickerModal.tsx");
    const content = fs.readFileSync(pickerPath, "utf-8");

    assert.ok(
      content.includes('useFeatureFlag(["git_repositories", "repositories"])') ||
        content.includes('useFeatureFlag("git_repositories")'),
      "PackageRepoPickerModal.tsx must evaluate hasRepos",
    );
    assert.ok(
      content.includes('const effectiveTab = hasRepos ? activeTab : "packages";'),
      "PackageRepoPickerModal.tsx must fall back to packages tab when hasRepos is false",
    );
    assert.ok(
      content.includes("{hasRepos && (\n          <TabContainer>"),
      "PackageRepoPickerModal.tsx must hide TabContainer when hasRepos is false",
    );
  });

  it("verifies ComposeBox.tsx and ComposeToolbar.tsx gate citation picker triggers behind hasReferences", () => {
    const composeBoxPath = path.resolve(__dirname, "../src/components/ComposeBox.tsx");
    const composeBoxContent = fs.readFileSync(composeBoxPath, "utf-8");

    assert.ok(
      composeBoxContent.includes('useFeatureFlag(["references", "scientific_references"])') ||
        composeBoxContent.includes('useFeatureFlag("references")'),
      "ComposeBox.tsx must evaluate hasReferences",
    );
    assert.ok(
      composeBoxContent.includes(
        '{hasReferences && (\n            <NotionGhostButton\n              type="button"\n              onClick={() => setShowCitationPicker(true)}',
      ),
      "ComposeBox.tsx must gate notebook Cite button behind hasReferences",
    );

    const composeToolbarPath = path.resolve(__dirname, "../src/components/compose/ComposeToolbar.tsx");
    const composeToolbarContent = fs.readFileSync(composeToolbarPath, "utf-8");

    assert.ok(
      composeToolbarContent.includes('useFeatureFlag(["references", "scientific_references"])') ||
        composeToolbarContent.includes('useFeatureFlag("references")'),
      "ComposeToolbar.tsx must evaluate hasReferences",
    );
    assert.ok(
      composeToolbarContent.includes(
        '{hasReferences && (\n            <ActionIconButton\n              type="button"\n              onClick={() => setShowCitationPicker?.(true)}',
      ),
      "ComposeToolbar.tsx must gate citation button behind hasReferences",
    );
  });

  it("verifies RepositoryListPage.tsx and ReferencesPage.tsx redirect when feature flags are disabled", () => {
    const repoListPath = path.resolve(__dirname, "../src/pages/RepositoryListPage.tsx");
    const repoListContent = fs.readFileSync(repoListPath, "utf-8");

    assert.ok(
      repoListContent.includes('useFeatureFlag(["git_repositories", "repositories"])') ||
        repoListContent.includes('useFeatureFlag("git_repositories")'),
      "RepositoryListPage.tsx must evaluate hasRepos",
    );
    assert.ok(
      repoListContent.includes('if (!hasRepos) {\n    return <Navigate to="/packages" replace />;\n  }'),
      "RepositoryListPage.tsx must redirect to /packages when hasRepos is false",
    );

    const referencesPagePath = path.resolve(__dirname, "../src/pages/ReferencesPage.tsx");
    const referencesPageContent = fs.readFileSync(referencesPagePath, "utf-8");

    assert.ok(
      referencesPageContent.includes('useFeatureFlag(["references", "scientific_references"])') ||
        referencesPageContent.includes('useFeatureFlag("references")'),
      "ReferencesPage.tsx must evaluate hasReferences",
    );
    assert.ok(
      referencesPageContent.includes('if (!hasReferences) {\n    return <Navigate to="/packages" replace />;\n  }'),
      "ReferencesPage.tsx must redirect to /packages when hasReferences is false",
    );
  });

  it("verifies CommandPalette.tsx gates repositories and references navigation and completions", () => {
    const cmdPalettePath = path.resolve(__dirname, "../src/components/CommandPalette.tsx");
    const content = fs.readFileSync(cmdPalettePath, "utf-8");

    assert.ok(
      content.includes('useFeatureFlag("git_repositories")') || content.includes('useFeatureFlag(["git_repositories"'),
      "CommandPalette.tsx must evaluate hasRepos",
    );
    assert.ok(
      content.includes('useFeatureFlag("references")') || content.includes('useFeatureFlag(["references"'),
      "CommandPalette.tsx must evaluate hasReferences",
    );
    assert.ok(
      content.includes('hasRepos\n        ? [\n            {\n              id: "nav-repos"'),
      "CommandPalette.tsx must gate nav-repos behind hasRepos",
    );
    assert.ok(
      content.includes('hasReferences\n        ? [\n            {\n              id: "nav-references"'),
      "CommandPalette.tsx must gate nav-references behind hasReferences",
    );
    assert.ok(
      content.includes("const repoItems: CommandItem[] = hasRepos"),
      "CommandPalette.tsx must conditionally produce repoItems only when hasRepos is true",
    );
  });

  it("verifies LogoutPage.tsx gates the repositories footer link", () => {
    const logoutPath = path.resolve(__dirname, "../src/pages/LogoutPage.tsx");
    const content = fs.readFileSync(logoutPath, "utf-8");

    assert.ok(
      content.includes('useFeatureFlag("git_repositories")') || content.includes('useFeatureFlag(["git_repositories"'),
      "LogoutPage.tsx must evaluate hasRepos",
    );
    assert.ok(
      content.includes('{hasRepos && (\n          <>\n            <span>·</span>\n            <Link to="/repos"'),
      "LogoutPage.tsx must gate /repos footer link behind hasRepos",
    );
  });

  it("verifies IdeWorkspacePage.tsx and ProfilePage.tsx gate repositories UI and tab", () => {
    const idePath = path.resolve(__dirname, "../src/pages/IdeWorkspacePage.tsx");
    const ideContent = fs.readFileSync(idePath, "utf-8");

    assert.ok(
      ideContent.includes('useFeatureFlag(["git_repositories", "repositories"])') ||
        ideContent.includes('useFeatureFlag("git_repositories")'),
      "IdeWorkspacePage.tsx must evaluate hasRepos",
    );
    assert.ok(
      ideContent.includes(
        '{hasRepos && (\n        <>\n          <Box\n            px={3}\n            pt={3}\n            pb={2}\n            borderTop="1px solid var(--color-border)"',
      ),
      "IdeWorkspacePage.tsx must gate Git Repositories section behind hasRepos",
    );

    const profilePath = path.resolve(__dirname, "../src/pages/ProfilePage.tsx");
    const profileContent = fs.readFileSync(profilePath, "utf-8");

    assert.ok(
      profileContent.includes('useFeatureFlag(["git_repositories", "repositories"])') ||
        profileContent.includes('useFeatureFlag("git_repositories")'),
      "ProfilePage.tsx must evaluate hasRepos",
    );
    assert.ok(
      profileContent.includes('...(hasRepos ? ["Repos"] : [])'),
      "ProfilePage.tsx must gate Repos tab behind hasRepos",
    );
    assert.ok(
      profileContent.includes('{activeTab === "Repos" && hasRepos ? ('),
      "ProfilePage.tsx must gate Repos tab content behind hasRepos",
    );
  });

  it("verifies DevFlagsModal.tsx registers metadata for git_repositories, repositories, references, and scientific_references", () => {
    const devFlagsPath = path.resolve(__dirname, "../src/components/DevFlagsModal.tsx");
    const content = fs.readFileSync(devFlagsPath, "utf-8");

    assert.ok(content.includes("git_repositories: {"), "DevFlagsModal must define git_repositories metadata");
    assert.ok(content.includes("repositories: {"), "DevFlagsModal must define repositories metadata");
    assert.ok(content.includes("references: {"), "DevFlagsModal must define references metadata");
    assert.ok(content.includes("scientific_references: {"), "DevFlagsModal must define scientific_references metadata");
  });
});

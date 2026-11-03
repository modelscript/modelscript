// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CAPABILITIES, type InstanceCapabilities } from "../src/CapabilitiesContext.js";

test("Capabilities-Driven UI Registry & Feature Gates", async (t) => {
  await t.test("defaults cloud HPC, solvers, MQTT, and Historian to disabled", () => {
    assert.equal(DEFAULT_CAPABILITIES.cloudSolvers, false);
    assert.equal(DEFAULT_CAPABILITIES.caeCompute, false);
    assert.equal(DEFAULT_CAPABILITIES.cosimMqtt, false);
    assert.equal(DEFAULT_CAPABILITIES.timescaleHistorian, false);
  });

  await t.test("evaluates capability flags accurately across tiers", () => {
    const tier2Corporate: InstanceCapabilities = {
      userInvites: false,
      waitlist: false,
      onboardingWizard: false,
      academicFastTrack: false,
      activityPubFederation: false,
      cloudSolvers: false,
      offlineSandbox: true,
      airgapEnforced: true,
      billing: false,
      caeCompute: false,
      cosimMqtt: false,
      timescaleHistorian: false,
      botAccounts: false,
    };

    const hasCap = (key: keyof InstanceCapabilities) => Boolean(tier2Corporate[key]);

    // Golden tickets & Invites should be completely absent in Corporate Enclave
    assert.equal(hasCap("userInvites"), false);
    assert.equal(hasCap("waitlist"), false);
    assert.equal(hasCap("botAccounts"), false);
    assert.equal(hasCap("activityPubFederation"), false);
    assert.equal(hasCap("offlineSandbox"), true);

    const tier3Flagship: InstanceCapabilities = {
      userInvites: true,
      waitlist: true,
      onboardingWizard: true,
      academicFastTrack: true,
      activityPubFederation: true,
      cloudSolvers: false,
      offlineSandbox: true,
      airgapEnforced: false,
      billing: true,
      caeCompute: false,
      cosimMqtt: false,
      timescaleHistorian: false,
      botAccounts: true,
    };

    const hasFlagshipCap = (key: keyof InstanceCapabilities) => Boolean(tier3Flagship[key]);
    assert.equal(hasFlagshipCap("userInvites"), true);
    assert.equal(hasFlagshipCap("waitlist"), true);
    assert.equal(hasFlagshipCap("billing"), true);
    assert.equal(hasFlagshipCap("botAccounts"), true);
    assert.equal(hasFlagshipCap("cloudSolvers"), false);
    assert.equal(hasFlagshipCap("caeCompute"), false);
  });

  await t.test(
    "renders sequential ProductTourOverlay spotlight steps respecting feature flags and FeedQuickstartStudio",
    async () => {
      const React = await import("react");
      const { renderToStaticMarkup } = await import("react-dom/server");
      const { MemoryRouter } = await import("react-router-dom");
      const { PRODUCT_TOUR_STEPS, ProductTourOverlay, getProductTourSteps } =
        await import("../src/components/ProductTourOverlay.js");
      const { FeedQuickstartStudio } = await import("../src/pages/feed/components/FeedQuickstartStudio.js");

      assert.equal(PRODUCT_TOUR_STEPS.length, 5);
      assert.deepEqual(
        PRODUCT_TOUR_STEPS.map((s) => s.id),
        ["timeline", "explore", "registry", "workbenches", "right-panel"],
      );

      // By default (cae_cloud_solver: false, activitypub_federation: false), tour does not mention Federated or Cloud Solvers
      const tourStep1Html = renderToStaticMarkup(
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(ProductTourOverlay, { forceOpen: true, initialStepIndex: 0 }),
        ),
      );

      assert.ok(tourStep1Html.includes("Step 1 of 5"));
      assert.ok(tourStep1Html.includes("Your Engineering Timeline"));
      assert.ok(!tourStep1Html.includes("Federated"));
      assert.ok(tourStep1Html.includes("Skip tour"));
      assert.ok(tourStep1Html.includes("Next"));

      const tourStep5Html = renderToStaticMarkup(
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(ProductTourOverlay, { forceOpen: true, initialStepIndex: 4 }),
        ),
      );

      assert.ok(tourStep5Html.includes("Step 5 of 5"));
      assert.ok(tourStep5Html.includes("Trending Topics &amp; Peers"));
      assert.ok(!tourStep5Html.includes("Cloud Solvers"));
      assert.ok(tourStep5Html.includes("Done"));

      // When cae_cloud_solver is enabled, step 5 mentions Cloud Solvers; when packages & repos are disabled, registry step is omitted
      const customSteps = getProductTourSteps({
        package_browser: false,
        git_repositories: false,
        heavy_vscode_ide: false,
        cae_cloud_solver: true,
        activitypub_federation: true,
      });
      assert.equal(customSteps.length, 4);
      assert.ok(!customSteps.some((s) => s.id === "registry"));
      assert.ok(customSteps.find((s) => s.id === "timeline")?.description.includes("Federated"));
      assert.ok(customSteps.find((s) => s.id === "workbenches")?.title.includes("Playground & Docs"));
      assert.ok(customSteps.find((s) => s.id === "right-panel")?.title.includes("Cloud Solvers"));

      const quickstartHtml = renderToStaticMarkup(
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(FeedQuickstartStudio, {
            followedHandles: {},
            onToggleFollow: () => {},
          }),
        ),
      );
      assert.ok(quickstartHtml.includes("Quickstart Cyber-Physical Studio"));
      assert.ok(quickstartHtml.includes("Bouncing Ball"));
      assert.ok(quickstartHtml.includes("RLC Circuit"));
      assert.ok(quickstartHtml.includes("Lorenz Attractor"));
      assert.ok(quickstartHtml.includes("CubeSat Power Architecture"));
    },
  );

  await t.test(
    "renders ExploreLandingView with fullwidth tabs and respects package_browser / git_repositories flags",
    async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const { DEFAULT_FRONTEND_FLAGS } = await import("../src/FeatureFlagContext.js");

      assert.equal(DEFAULT_FRONTEND_FLAGS.package_browser, true);
      assert.equal(DEFAULT_FRONTEND_FLAGS.git_repositories, true);

      const exploreLandingSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/pages/explore/ExploreLandingView.tsx"),
        "utf-8",
      );
      assert.ok(exploreLandingSrc.includes('{ id: "explore", label: "Explore" }'));
      assert.ok(exploreLandingSrc.includes('{ id: "trending", label: "Trending" }'));
      assert.ok(exploreLandingSrc.includes('hasPackages ? [{ id: "packages" as const, label: "Packages" }] : []'));
      assert.ok(exploreLandingSrc.includes('hasRepos ? [{ id: "repositories" as const, label: "Repositories" }] : []'));
      assert.ok(!exploreLandingSrc.includes("Engineering Workspaces"));
      assert.ok(!exploreLandingSrc.includes("Suggested Posts"));

      const explorePageSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/pages/ExplorePage.tsx"),
        "utf-8",
      );
      assert.ok(explorePageSrc.includes('useFeatureFlag("package_browser")'));
      assert.ok(explorePageSrc.includes('useFeatureFlag("git_repositories")'));

      // Verify Packages and Repositories lists use domain icons and do not repeat package/repo paths
      assert.ok(exploreLandingSrc.includes("<PackageIcon"));
      assert.ok(exploreLandingSrc.includes("<RepoAvatarBadge"));
      assert.ok(!exploreLandingSrc.includes("📦"));
      assert.ok(!exploreLandingSrc.includes("{pkg.name} · v"));

      // Verify unified search tabs and removal of templates
      const { SEARCH_TABS } = await import("../src/pages/explore/constants.js");
      assert.deepEqual(SEARCH_TABS, ["Top", "Latest", "People", "Media", "Packages", "Repositories"]);
      assert.ok(!(SEARCH_TABS as readonly string[]).includes("Templates"));
      assert.ok(!(SEARCH_TABS as readonly string[]).includes("Artifacts"));

      const exploreSearchSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/pages/explore/ExploreSearchResultsView.tsx"),
        "utf-8",
      );
      assert.ok(exploreSearchSrc.includes('activeTab === "Packages"'));
      assert.ok(!exploreSearchSrc.includes('activeTab === "Artifacts"'));
      assert.ok(!exploreSearchSrc.includes('activeTab === "Templates"'));
      assert.ok(exploreSearchSrc.includes('tab === "Packages" && !hasPackages'));

      const { inferPackageDomains, splitScopedPackageName, formatDomainLabel } =
        await import("../src/pages/libraries/constants.js");
      assert.deepEqual(splitScopedPackageName("@examples/drone-chassis"), {
        scope: "@examples",
        baseName: "drone-chassis",
      });
      assert.deepEqual(splitScopedPackageName("Modelica"), {
        scope: null,
        baseName: "Modelica",
      });
      assert.ok(
        inferPackageDomains({
          name: "@modelscript/example-pscad-microgrid",
          description: "PSCAD Electromagnetic Transients (EMT) microgrid workspace",
        }).includes("power"),
      );
      assert.ok(
        inferPackageDomains({
          name: "EPANET-Benchmark-Networks",
          description: "Standard municipal water distribution networks",
        }).includes("hydraulics"),
      );
      assert.ok(
        inferPackageDomains({
          name: "Standard-Robots",
          description: "Standard industrial & collaborative robot kinematic URDF models",
        }).includes("robotics"),
      );
      assert.deepEqual(
        inferPackageDomains({
          name: "SysML",
          domains: ["modelica"],
          description: "The normative OMG Systems Modeling Language (SysML v2) root library package",
        }),
        ["sysml2"],
      );
      assert.equal(formatDomainLabel("power"), "PSCAD / EMT");
      assert.equal(formatDomainLabel("robotics"), "Robotics / URDF");
      assert.equal(formatDomainLabel("hydraulics"), "Hydraulics");
    },
  );

  await t.test("hides composer polish button behind composer_ai_polish flag disabled by default", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { DEFAULT_FRONTEND_FLAGS } = await import("../src/FeatureFlagContext.js");

    // 1. Verify flag is registered and disabled by default
    assert.equal(DEFAULT_FRONTEND_FLAGS.composer_ai_polish, false);
    assert.equal(DEFAULT_FRONTEND_FLAGS.ai_polish, false);

    // 2. Verify ComposeToolbar gates the polish button and presets menu behind isAiPolishFeatureEnabled
    const composeToolbarSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/compose/ComposeToolbar.tsx"),
      "utf-8",
    );
    assert.ok(
      composeToolbarSrc.includes('useFeatureFlag("composer_ai_polish")'),
      "ComposeToolbar must check composer_ai_polish feature flag",
    );
    assert.ok(
      composeToolbarSrc.includes("isAiPolishFeatureEnabled && onAiPolish &&"),
      "ComposeToolbar must gate onAiPolish behind isAiPolishFeatureEnabled",
    );

    // 3. Verify ComposeBox gates the Polish button in header and props
    const composeBoxSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/ComposeBox.tsx"),
      "utf-8",
    );
    assert.ok(
      composeBoxSrc.includes('useFeatureFlag("composer_ai_polish")'),
      "ComposeBox must check composer_ai_polish feature flag",
    );
    assert.ok(
      composeBoxSrc.includes("{hasAiPolish && ("),
      "ComposeBox header Polish button must be gated by hasAiPolish",
    );
    assert.ok(
      composeBoxSrc.includes("onAiPolish={hasAiPolish ?"),
      "ComposeBox onAiPolish prop must be gated by hasAiPolish",
    );
    assert.ok(
      composeBoxSrc.includes("onPolishCell={hasAiPolish ?"),
      "ComposeBox onPolishCell prop must be gated by hasAiPolish",
    );

    // 4. Verify ComposeNotebookCellsEditor gates Polish block action
    const notebookEditorSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/compose/ComposeNotebookCellsEditor.tsx"),
      "utf-8",
    );
    assert.ok(
      notebookEditorSrc.includes('useFeatureFlag("composer_ai_polish")'),
      "ComposeNotebookCellsEditor must check composer_ai_polish feature flag",
    );
    assert.ok(
      notebookEditorSrc.includes("isAiPolishFeatureEnabled"),
      "ComposeNotebookCellsEditor action menu must be gated by isAiPolishFeatureEnabled",
    );

    // 5. Verify DevFlagsModal exposes flag metadata
    const devFlagsModalSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/DevFlagsModal.tsx"),
      "utf-8",
    );
    assert.ok(
      devFlagsModalSrc.includes("composer_ai_polish:"),
      "DevFlagsModal must expose composer_ai_polish metadata",
    );

    // 6. Verify horizontal rule and Article mode button (on the Everyone can reply line) only show when in focus or content has been entered
    const React = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { ComposeToolbar } = await import("../src/components/compose/ComposeToolbar.js");
    const { ComposeVisibilityMenu } = await import("../src/components/compose/ComposeVisibilityMenu.js");

    const baseProps = {
      isNotebookMode: false,
      content: "",
      setContent: () => {},
      handleToggleNotebookMode: () => {},
      setShowMorselModal: () => {},
      setShowPackageRepoPicker: () => {},
      setShowCodeSnippetModal: () => {},
      setShowHpcPicker: () => {},
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
      onAiPolish: () => {},
    };

    const collapsedVisibilityHtml = renderToStaticMarkup(
      React.createElement(ComposeVisibilityMenu, {
        replyVisibility: "everyone",
        setReplyVisibility: () => {},
        showVisibilityMenu: false,
        setShowVisibilityMenu: () => {},
        visible: false,
        isNotebookMode: false,
        handleToggleNotebookMode: () => {},
      }),
    );
    assert.ok(
      collapsedVisibilityHtml.includes('aria-hidden="true"') && collapsedVisibilityHtml.includes("max-height:0px"),
      "Everyone can reply and Article mode row should be collapsed when unfocused and empty",
    );

    const expandedVisibilityHtml = renderToStaticMarkup(
      React.createElement(ComposeVisibilityMenu, {
        replyVisibility: "everyone",
        setReplyVisibility: () => {},
        showVisibilityMenu: false,
        setShowVisibilityMenu: () => {},
        visible: true,
        isNotebookMode: false,
        handleToggleNotebookMode: () => {},
      }),
    );
    assert.ok(
      expandedVisibilityHtml.includes('aria-hidden="false"') &&
        expandedVisibilityHtml.includes("Everyone can reply") &&
        expandedVisibilityHtml.includes("Article mode") &&
        expandedVisibilityHtml.includes("justify-content:space-between"),
      "Everyone can reply and Article mode button should appear on the same line when focused or content entered",
    );

    // Unfocused & empty: no horizontal rule, no Polish button
    const collapsedHtml = renderToStaticMarkup(
      React.createElement(ComposeToolbar, { ...baseProps, isInputFocused: false, content: "" }),
    );
    assert.ok(
      !collapsedHtml.includes("1px solid var(--color-border)"),
      "Horizontal rule should be hidden when unfocused and empty",
    );
    assert.ok(!collapsedHtml.includes("composer-ai-polish-btn"), "Polish button must remain hidden by default");

    // Focused & empty: shows horizontal rule, Polish still hidden behind flag
    const focusedHtml = renderToStaticMarkup(
      React.createElement(ComposeToolbar, { ...baseProps, isInputFocused: true, content: "" }),
    );
    assert.ok(
      focusedHtml.includes("1px solid var(--color-border)"),
      "Horizontal rule should show when input is in focus",
    );
    assert.ok(
      !focusedHtml.includes("composer-ai-polish-btn"),
      "Polish button must remain hidden by default when focused",
    );

    // Unfocused with content entered: shows horizontal rule, Polish still hidden behind flag
    const withContentHtml = renderToStaticMarkup(
      React.createElement(ComposeToolbar, { ...baseProps, isInputFocused: false, content: "Simulating RLC circuit" }),
    );
    assert.ok(
      withContentHtml.includes("1px solid var(--color-border)"),
      "Horizontal rule should show when content has been entered",
    );
    assert.ok(
      !withContentHtml.includes("composer-ai-polish-btn"),
      "Polish button must remain hidden by default when content is entered",
    );
  });

  await t.test("gates Studies & Jobs navigation and tabs when cae_cloud_solver is disabled", async () => {
    const React = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { MemoryRouter } = await import("react-router-dom");
    const { ClassDetailHeader } = await import("../src/pages/class-detail/components/ClassDetailHeader.js");

    const mockCls = {
      name: "Modelica.Electrical.Analog.Basic.Resistor",
      classKind: "model",
      description: "Ideal linear electrical resistor",
      baseClasses: [],
      components: [],
      equations: ["v = i * R"],
      sourceCode: "model Resistor ... end Resistor;",
    };

    // When hasCae is false: Studies & Jobs tab should NOT be rendered
    const disabledHtml = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(ClassDetailHeader, {
          libraryName: "Modelica",
          version: "4.0.0",
          className: "Modelica.Electrical.Analog.Basic.Resistor",
          cls: mockCls as any,
          jobStatus: null,
          activeTab: "overview",
          setActiveTab: () => {},
          equationsCount: 1,
          hasCae: false,
        }),
      ),
    );
    assert.ok(
      !disabledHtml.includes("Studies &amp; Jobs") && !disabledHtml.includes("Studies & Jobs"),
      "Studies tab must be hidden when hasCae is false",
    );

    // When hasCae is true: Studies & Jobs tab should be rendered
    const enabledHtml = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(ClassDetailHeader, {
          libraryName: "Modelica",
          version: "4.0.0",
          className: "Modelica.Electrical.Analog.Basic.Resistor",
          cls: mockCls as any,
          jobStatus: null,
          activeTab: "overview",
          setActiveTab: () => {},
          equationsCount: 1,
          hasCae: true,
        }),
      ),
    );
    assert.ok(
      enabledHtml.includes("Studies &amp; Jobs") || enabledHtml.includes("Studies & Jobs"),
      "Studies tab must appear when hasCae is true",
    );
  });

  await t.test(
    "gates PackageDetailPage tabs (Digital Thread, Artifacts, Compare) and RightSidebar advanced exports behind feature flags by default",
    async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const React = await import("react");
      const { renderToStaticMarkup } = await import("react-dom/server");
      const { MemoryRouter } = await import("react-router-dom");
      const { DEFAULT_FRONTEND_FLAGS, FeatureFlagContext } = await import("../src/FeatureFlagContext.js");
      const { PackageRightSidebar } = await import("../src/pages/package/components/PackageRightSidebar.js");
      const { PackageVersionsTab } = await import("../src/pages/package/tabs/PackageVersionsTab.js");
      const { PackageDependenciesTab } = await import("../src/pages/package/tabs/PackageDependenciesTab.js");

      // 1. Default flags must be disabled
      assert.equal(DEFAULT_FRONTEND_FLAGS.digital_thread_explorer, false);
      assert.equal(DEFAULT_FRONTEND_FLAGS.package_artifacts_tab, false);
      assert.equal(DEFAULT_FRONTEND_FLAGS.package_version_compare, false);
      assert.equal(DEFAULT_FRONTEND_FLAGS.package_advanced_exports, false);

      // 2. PackageDetailPage must gate digital-thread, artifacts, and compare tabs
      const pkgPageSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/pages/PackageDetailPage.tsx"),
        "utf-8",
      );
      assert.ok(pkgPageSrc.includes('useFeatureFlag("digital_thread_explorer")'));
      assert.ok(pkgPageSrc.includes('useFeatureFlag("package_artifacts_tab")'));
      assert.ok(pkgPageSrc.includes('useFeatureFlag("package_version_compare")'));

      // 3. PackageRightSidebar: default hides Asset Shell, Hardware .okh.json, Salsa DB, Data Package, Lockfile
      //    and deduplicates sha256: prefix
      const sidebarDefaultHtml = renderToStaticMarkup(
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(PackageRightSidebar, {
            name: "Modelica",
            version: "4.1.0",
            installCmd: "msx install Modelica",
            contentHash: "sha256:5409cfa1234567890abcdef",
            availableDomains: [
              { id: "all", label: "All", icon: () => null, count: 6448, color: "#06b6d4" },
              { id: "modelica", label: "Modelica", icon: () => null, count: 6440, color: "#eab308" },
              { id: "dataset", label: "Datasets", icon: () => null, count: 8, color: "#3b82f6" },
            ],
            dependents: [],
            collaborators: [],
            canManage: false,
            onOpenManageCollaborators: () => {},
          }),
        ),
      );
      assert.ok(sidebarDefaultHtml.includes("Download Source (.zip)"), "Should show clean Download Source (.zip) CTA");
      assert.ok(!sidebarDefaultHtml.includes("Asset Shell"), "Asset Shell must be hidden by default");
      assert.ok(!sidebarDefaultHtml.includes(".okh.json"), "Hardware .okh.json must be hidden by default");
      assert.ok(!sidebarDefaultHtml.includes("Salsa DB"), "Salsa DB must be hidden by default");
      assert.ok(!sidebarDefaultHtml.includes("sha256:sha256:"), "Must not render duplicate sha256:sha256: prefix");
      assert.ok(sidebarDefaultHtml.includes("sha256:5409cfa12345"), "Must render normalized sha256 digest");

      // 4. PackageVersionsTab: hides Compare by default, shows v-prefixed version and .zip download
      const versionsDefaultHtml = renderToStaticMarkup(
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(PackageVersionsTab, {
            name: "Modelica",
            version: "4.1.0",
            versionList: ["4.1.0", "4.0.0"],
            onCompare: () => {},
          }),
        ),
      );
      assert.ok(versionsDefaultHtml.includes("v4.1.0"), "Must render v-prefixed version badge");
      assert.ok(versionsDefaultHtml.includes(".zip"), "Must render direct .zip download per version");
      assert.ok(!versionsDefaultHtml.includes("Compare"), "Compare button must be hidden by default");

      const versionsCompareEnabledHtml = renderToStaticMarkup(
        React.createElement(
          FeatureFlagContext.Provider,
          {
            value: {
              flags: { ...DEFAULT_FRONTEND_FLAGS, package_version_compare: true },
              overrides: {},
              isLoading: false,
              refreshFlags: async () => {},
              isEnabled: (k: string) => k === "package_version_compare",
              setFlagOverride: () => {},
              resetAllOverrides: () => {},
            },
          },
          React.createElement(
            MemoryRouter,
            null,
            React.createElement(PackageVersionsTab, {
              name: "Modelica",
              version: "4.1.0",
              versionList: ["4.1.0", "4.0.0"],
              onCompare: () => {},
            }),
          ),
        ),
      );
      assert.ok(
        versionsCompareEnabledHtml.includes("Compare"),
        "Compare button must appear when package_version_compare is enabled and multiple versions exist",
      );

      // 5. PackageDependenciesTab: zero-dependency card and populated dependency rows
      const zeroDepsHtml = renderToStaticMarkup(
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(PackageDependenciesTab, {
            name: "Modelica",
            version: "4.1.0",
            dependencies: {},
          }),
        ),
      );
      assert.ok(zeroDepsHtml.includes("Zero Runtime Dependencies"));

      const populatedDepsHtml = renderToStaticMarkup(
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(PackageDependenciesTab, {
            name: "@examples/drone",
            version: "1.0.0",
            dependencies: { Modelica: "^4.0.0" },
          }),
        ),
      );
      assert.ok(populatedDepsHtml.includes("Modelica"));
      assert.ok(populatedDepsHtml.includes("^4.0.0"));
    },
  );

  await t.test(
    "WorldMap uses compact geoNaturalEarth1 projection showing Antarctica without vertical distortion and caps Top Viewer Locations",
    async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const React = await import("react");
      const { renderToStaticMarkup } = await import("react-dom/server");
      const { default: WorldMap, DEFAULT_MAX_TOP_LOCATIONS } = await import("../src/components/WorldMap.js");

      assert.equal(DEFAULT_MAX_TOP_LOCATIONS, 5);

      const worldMapSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../src/components/WorldMap.tsx"), "utf-8");
      assert.ok(
        worldMapSrc.includes('projection="geoNaturalEarth1"'),
        "WorldMap must use geoNaturalEarth1 projection so Antarctica is visible within the SVG viewBox",
      );
      assert.ok(
        worldMapSrc.includes("width={800}") && worldMapSrc.includes("height={340}"),
        "WorldMap ComposableMap must use a compact 800x340 viewBox",
      );

      // Render with 8 countries (including Antarctica) to verify cap at 5 and "+3 other countries" indicator
      const html = renderToStaticMarkup(
        React.createElement(WorldMap, {
          totalViews: 100,
          data: [
            { country: "US", views: 30 },
            { country: "DE", views: 20 },
            { country: "AQ", views: 15 },
            { country: "JP", views: 10 },
            { country: "GB", views: 8 },
            { country: "FR", views: 7 },
            { country: "CA", views: 5 },
            { country: "AU", views: 5 },
          ],
        }),
      );

      assert.ok(html.includes("(8 countries)"), "Header should still report total distinct countries");
      assert.ok(html.includes("United States"), "Top 1 location should be rendered");
      assert.ok(html.includes("Germany"), "Top 2 location should be rendered");
      assert.ok(html.includes("Antarctica"), "Antarctica (AQ) should be resolved and rendered in top 5");
      assert.ok(html.includes("Japan"), "Top 4 location should be rendered");
      assert.ok(html.includes("United Kingdom"), "Top 5 location should be rendered");
      assert.ok(!html.includes("France"), "6th location should be omitted when capped at 5");
      assert.ok(!html.includes("Canada"), "7th location should be omitted when capped at 5");
      assert.ok(!html.includes("Australia"), "8th location should be omitted when capped at 5");
      assert.ok(html.includes("+3 other countries"), "Breakdown header should indicate remaining countries count");

      // Verify full globe including Antarctica fits cleanly inside 800x340 without vertical stretching
      const d3Geo = await import("d3-geo");
      const topojson = await import("topojson-client");
      const topo = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../public/features.json"), "utf-8"));
      const objKey = Object.keys(topo.objects)[0]!;
      const geojson = topojson.feature(topo, topo.objects[objKey]) as unknown as GeoJSON.FeatureCollection;
      const neProj = d3Geo.geoNaturalEarth1().translate([400, 170]).scale(138).center([0, 0]);
      const neBounds = d3Geo.geoPath().projection(neProj).bounds(geojson);
      const topY = neBounds[0][1] * 0.85 + 21.5;
      const botY = neBounds[1][1] * 0.85 + 21.5;
      assert.ok(topY >= 0, `Top bound ${topY} should be >= 0`);
      assert.ok(botY <= 340, `Bottom bound (Antarctica) ${botY} should be <= 340`);
    },
  );
});

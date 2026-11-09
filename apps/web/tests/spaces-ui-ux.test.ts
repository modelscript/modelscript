// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { buildFileTree } from "../src/pages/workspace/utils.js";

describe("Spaces UI/UX Layout & Polish Invariants", () => {
  const appShellPath = path.resolve(import.meta.dirname, "../src/components/AppShell.tsx");
  const spacePagePath = path.resolve(import.meta.dirname, "../src/pages/SpacePage.tsx");
  const spaceChatPath = path.resolve(import.meta.dirname, "../src/pages/SpaceChatPage.tsx");
  const spacesExplorePath = path.resolve(import.meta.dirname, "../src/pages/SpacesExplorePage.tsx");
  const spacePackagesPath = path.resolve(import.meta.dirname, "../src/pages/space/SpacePackagesTab.tsx");
  const spaceChangeControlPath = path.resolve(import.meta.dirname, "../src/pages/space/SpaceChangeControlTab.tsx");
  const spaceIssuesPath = path.resolve(import.meta.dirname, "../src/pages/space/SpaceIssuesTab.tsx");
  const apiSpacesPath = path.resolve(import.meta.dirname, "../src/api/spaces.ts");

  const appShellSrc = fs.readFileSync(appShellPath, "utf-8");
  const spacePageSrc = fs.readFileSync(spacePagePath, "utf-8");
  const spaceChatSrc = fs.readFileSync(spaceChatPath, "utf-8");
  const spacesExploreSrc = fs.readFileSync(spacesExplorePath, "utf-8");
  const spacePackagesSrc = fs.readFileSync(spacePackagesPath, "utf-8");
  const spaceChangeControlSrc = fs.readFileSync(spaceChangeControlPath, "utf-8");
  const spaceIssuesSrc = fs.readFileSync(spaceIssuesPath, "utf-8");
  const apiSpacesSrc = fs.readFileSync(apiSpacesPath, "utf-8");

  it("verifies AppShell defines isSpaceRoute covering /spaces, /chat, /s/, /orgs/, and /@namespace/slug", () => {
    assert.ok(
      appShellSrc.includes("const isSpaceRoute = React.useMemo("),
      "AppShell must compute memoized isSpaceRoute",
    );
    assert.ok(
      appShellSrc.includes(
        'p.startsWith("/spaces") || p.startsWith("/chat") || p.startsWith("/s/") || p.startsWith("/orgs/")',
      ),
      "isSpaceRoute must match core space routes",
    );
    assert.ok(
      appShellSrc.includes('const reserved = new Set(["status", "about", "followers", "following"]);'),
      "isSpaceRoute must ignore reserved user profile subpaths",
    );
  });

  it("verifies AppShell assigns isSpaceRoute to isWideLayout to fill the space of the removed right rail and suppresses showsRightPanel", () => {
    assert.ok(
      appShellSrc.includes("isSpaceRoute") && appShellSrc.includes("isWideLayout"),
      "AppShell must include isSpaceRoute in isWideLayout",
    );
    assert.ok(
      appShellSrc.includes(
        "const showsRightPanel = !isStandaloneRoute && !isWideLayout && !isFullScreenLayout && !isInspectorLayout;",
      ),
      "AppShell must suppress showsRightPanel when isWideLayout is active",
    );
  });

  it("verifies SpacePage implements high-density breadcrumb header and quick action toolbar", () => {
    assert.ok(
      spacePageSrc.includes("git clone @${space.owner_namespace}/${space.slug}.git") ||
        spacePageSrc.includes("git clone @{space.owner_namespace}/{space.slug}.git"),
      "SpacePage must provide quick git clone command",
    );
    assert.ok(
      spacePageSrc.includes("⚡ Dock in Chat Sidenav"),
      "SpacePage must provide direct link to dock space into Chat sidenav",
    );
    assert.ok(
      spacePageSrc.includes("preset.shortLabel") && spacePageSrc.includes("space.visibility"),
      "SpacePage header must render domain blueprint badge and visibility pill",
    );
  });

  it("verifies SpacePage renders 2-column cockpit with contextual Space Inspector", () => {
    assert.ok(spacePageSrc.includes("SpaceCockpitGrid"), "SpacePage must define responsive 2-column SpaceCockpitGrid");
    assert.ok(spacePageSrc.includes("SpaceInspectorPanel"), "SpacePage must render contextual SpaceInspectorPanel");
    assert.ok(spacePageSrc.includes("Space Git Vault"), "SpaceInspectorPanel must render Space Git Vault telemetry");
    assert.ok(
      spacePageSrc.includes("Compliance & Gates"),
      "SpaceInspectorPanel must render automated simulation verification gates",
    );
    assert.ok(
      spacePageSrc.includes("Team & Signatories"),
      "SpaceInspectorPanel must render space team members with role badges",
    );
  });

  it("verifies SpacePage integrates PostMarkdownContent for Living Docs and Split Drawer", () => {
    assert.ok(spacePageSrc.includes("PostMarkdownContent"), "SpacePage must import PostMarkdownContent");
    assert.ok(
      spacePageSrc.includes("<PostMarkdownContent text={activeDoc.content_markdown} isLongForm={true} />"),
      "Living Docs reader must use PostMarkdownContent with isLongForm",
    );
  });

  it("verifies SpaceChatPage and SpacesExplorePage provide multi-column technical layouts", () => {
    assert.ok(
      spaceChatSrc.includes("SpaceTabsNav") && spaceChatSrc.includes("SpaceTabButton"),
      "SpaceChatPage must implement horizontal SpaceTabsNav and SpaceTabButton matching SpacePage tabs",
    );
    assert.ok(spacesExploreSrc.includes("Ansatz Engineering Spaces"), "SpacesExplorePage must render catalog header");
  });

  it("verifies world-class UI/UX polish: no tab scrollbars, concise labels, unified toolbar & clean inspector", () => {
    // 1. Tab bar scrollbar elimination
    assert.ok(
      spacePageSrc.includes("scrollbar-width: none;") && spacePageSrc.includes("&::-webkit-scrollbar"),
      "SpaceTabsNav must suppress native scrollbars",
    );

    // 2. Concise tab labels
    assert.ok(
      spacePageSrc.includes('{ id: "overview", label: "Overview"') &&
        spacePageSrc.includes('id: "issues"') &&
        spacePageSrc.includes('label: "Issues"') &&
        spacePageSrc.includes('{ id: "docs", label: "Docs"') &&
        (spacePageSrc.includes('{ id: "changes", label: "Change Control"') ||
          spacePageSrc.includes('{ id: "changes", label: "Pull Requests"') ||
          spacePageSrc.includes('{ id: "plm", label: "PLM"')),
      "Space tabs must use concise high-signal labels",
    );

    // 3. Consolidated primary + New dropdown toolbar
    assert.ok(
      spacePageSrc.includes("showNewMenu") && spacePageSrc.includes("+ New"),
      "SpacePage must provide a unified + New dropdown toolbar",
    );

    // 4. Redundant quick-jump cards deleted from Overview tab
    assert.ok(
      !spacePageSrc.includes("Quick-Jump Cockpit Cards") && !spacePageSrc.includes("Real-Time Channels"),
      "Overview cockpit must not contain redundant quick-jump cards that duplicate tabs",
    );

    // 5. Unified Inspector Card
    assert.ok(
      spacePageSrc.includes('<SpaceCardPanel style={{ padding: 0, gap: 0, overflow: "hidden" }}>'),
      "SpaceInspectorPanel must unify widgets inside a single cohesive card with dividers",
    );

    // 6. Full-width tab bottom border without double line
    assert.ok(
      spacePageSrc.includes("width: 100%;") &&
        spacePageSrc.includes("border-bottom: 1px solid var(--color-border-default, var(--color-border));"),
      "SpaceTabsNav must extend border-bottom across full container width",
    );
    assert.ok(
      !spacePageSrc.includes('borderBottom: "1px solid var(--color-border-default, var(--color-border))"'),
      "Space header must not define a duplicate borderBottom that causes a double line",
    );

    // 7. Standard tab sizing (height 48px, font 14px, icon 16)
    assert.ok(
      spacePageSrc.includes("height: 48px;") &&
        spacePageSrc.includes("font-size: 14px;") &&
        spacePageSrc.includes("<Icon size={16} />"),
      "SpaceTabButton must use standard 48px height, 14px font, and 16px icon size",
    );
  });

  it("verifies Change Control tab implements high-density Ansatz engineering cockpit with telemetry HUD and theme tokens", () => {
    // 1. SpacePage delegates Tab 4 to SpaceChangeControlTab supporting both 'changes' and 'plm' alias
    assert.ok(
      spacePageSrc.includes("<SpaceChangeControlTab") &&
        spacePageSrc.includes('activeTab === "changes"') &&
        spacePageSrc.includes('activeTab === "plm"'),
      "SpacePage must mount SpaceChangeControlTab supporting both 'changes' and legacy 'plm' tab routes",
    );

    // 2. 2-Column Cockpit & Master-Detail Layout
    assert.ok(
      spaceChangeControlSrc.includes("SpaceCockpitGrid") && spaceChangeControlSrc.includes("MasterDetailGrid"),
      "Change Control tab must adopt the 2-column SpaceCockpitGrid and master-detail layout",
    );

    // 3. Telemetry HUD Counters
    assert.ok(
      spaceChangeControlSrc.includes("Active Proposals") &&
        spaceChangeControlSrc.includes("DAE Simulation Gate") &&
        spaceChangeControlSrc.includes("Ed25519 cryptographic"),
      "Change Control tab must render live telemetry metric HUD with simulation and signature counters",
    );

    // 4. Search and Status Filtering Toolbar
    assert.ok(
      spaceChangeControlSrc.includes("ecoSearchQuery") &&
        spaceChangeControlSrc.includes("ecoStatusFilter") &&
        spaceChangeControlSrc.includes("ecoSeverityFilter"),
      "Change Control tab must provide instant search, status filter pills, and severity dropdown",
    );

    // 5. Digital Thread & Cryptographic Sign-Offs
    assert.ok(
      spaceChangeControlSrc.includes("Cryptographic Sign-Offs (Ed25519 Audit Trail)") &&
        spaceChangeControlSrc.includes("Under Change Control") &&
        spaceChangeControlSrc.includes("PLM Governance"),
      "Change Control tab must render contextual digital thread inspector and cryptographic audit trail",
    );

    // 6. Theme tokens (no hardcoded dark slate backgrounds breaking light theme)
    assert.ok(
      !spaceChangeControlSrc.includes('background: "rgba(15, 23, 42, 0.45)"'),
      "SpaceChangeControlTab must not use hardcoded rgba(15, 23, 42, 0.45) which breaks light mode contrast",
    );

    // 7. World-Class 2-Mode Git-Native PR Experience with Vertically Stacked Cards & Timeline
    assert.ok(
      spaceChangeControlSrc.includes("PrSplitLayout") &&
        spaceChangeControlSrc.includes('viewMode === "list"') &&
        spaceChangeControlSrc.includes('viewMode === "detail"') &&
        spaceChangeControlSrc.includes("All Change Requests") &&
        spaceChangeControlSrc.includes("+ New Change Request") &&
        spaceChangeControlSrc.includes("PrTableRow") &&
        spaceChangeControlSrc.includes("PrSectionCard") &&
        spaceChangeControlSrc.includes("TimelineConnector") &&
        spaceChangeControlSrc.includes("TimelineNode") &&
        spaceChangeControlSrc.includes("handleAddComment") &&
        spaceChangeControlSrc.includes("MergeBox"),
      "Change Control tab must implement 2-mode Git-native PR experience with vertically stacked cards and timeline discussion",
    );
  });

  it("verifies Space Packages tab implements modern package environment matching LibraryListPage & LibraryFilterBar", () => {
    // 1. SpacePage delegates Tab 5 to SpacePackagesTab with packagesCount counter
    assert.ok(
      spacePageSrc.includes("<SpacePackagesTab") &&
        spacePageSrc.includes('activeTab === "repos"') &&
        spacePageSrc.includes('{ id: "repos", label: "Packages", icon: PackageIcon, count: packagesCount }'),
      "SpacePage must render SpacePackagesTab with dynamic packagesCount pill badge",
    );

    // 2. SpacePackagesTab renders polished Git Vault PDM card with protocol tabs and copy button
    assert.ok(
      spacePackagesSrc.includes("Backing Git Vault & Multi-Model PDM Repository") &&
        spacePackagesSrc.includes("ProtocolTabBar") &&
        spacePackagesSrc.includes("Supported PDM Formats") &&
        spacePackagesSrc.includes("git: ") &&
        spacePackagesSrc.includes("Git LFS") &&
        spacePackagesSrc.includes("DAE Semantic Diff"),
      "SpacePackagesTab must render polished Git Vault card with protocol switcher and PDM telemetry",
    );

    // 3. SpacePackagesTab renders standard PackagesHeader, ResultCount, ScopeSegmentedControl, and SearchFieldWrapper
    assert.ok(
      spacePackagesSrc.includes("PackagesHeader") &&
        spacePackagesSrc.includes("ResultCount") &&
        spacePackagesSrc.includes("ScopeSegmentedControl") &&
        spacePackagesSrc.includes("SearchFieldWrapper") &&
        spacePackagesSrc.includes("ToolbarSelectWrapper") &&
        spacePackagesSrc.includes("DOMAIN_FILTER_OPTIONS"),
      "SpacePackagesTab must implement standard PackagesHeader, search, scope, and domain filters matching LibraryFilterBar",
    );

    // 4. SpacePackagesTab renders CardList and PackageCardItem with quick install snippet
    assert.ok(
      spacePackagesSrc.includes("CardList") &&
        spacePackagesSrc.includes("<PackageCardItem") &&
        spacePackagesSrc.includes("handleCopyInstall") &&
        spacePackagesSrc.includes("msx install"),
      "SpacePackagesTab must render CardList with PackageCardItem and one-click msx install snippet",
    );

    // 5. SpacePackagesTab integrates PublishPackageModal
    assert.ok(
      spacePackagesSrc.includes("<PublishPackageModal") &&
        spacePackagesSrc.includes("publishModalOpen") &&
        spacePackagesSrc.includes("defaultPackageName={`@${space.owner_namespace}/${space.slug}`}"),
      "SpacePackagesTab must integrate PublishPackageModal prefilled with space package name",
    );
  });

  it("verifies Space Settings tab implements high-density two-column layout matching workspace settings", () => {
    const spaceSettingsPath = path.resolve(import.meta.dirname, "../src/pages/space/SpaceSettingsTab.tsx");

    assert.ok(fs.existsSync(spaceSettingsPath), "SpaceSettingsTab.tsx must exist");
    const spaceSettingsSrc = fs.readFileSync(spaceSettingsPath, "utf-8");

    // 1. SpacePage mounts SpaceSettingsTab with 2-column container maxWidth 1280px
    assert.ok(
      spacePageSrc.includes("<SpaceSettingsTab") &&
        spacePageSrc.includes('activeTab === "settings"') &&
        spacePageSrc.includes('maxWidth: "1280px"'),
      "SpacePage must mount SpaceSettingsTab with maxWidth 1280px container",
    );

    // 2. SpaceSettingsTab implements two-column grid layout with 260px sidebar
    assert.ok(
      spaceSettingsSrc.includes("SettingsLayout") &&
        spaceSettingsSrc.includes("grid-template-columns: 260px minmax(0, 1fr)") &&
        spaceSettingsSrc.includes("<ActionList>"),
      "SpaceSettingsTab must implement a two-column SettingsLayout with 260px sidebar and ActionList",
    );

    // 3. SpaceSettingsTab has full suite of settings sections
    assert.ok(
      spaceSettingsSrc.includes('activeSection === "general"') &&
        spaceSettingsSrc.includes('activeSection === "access"') &&
        spaceSettingsSrc.includes('activeSection === "git"') &&
        spaceSettingsSrc.includes('activeSection === "plm"') &&
        spaceSettingsSrc.includes('activeSection === "features"') &&
        spaceSettingsSrc.includes('activeSection === "integrations"') &&
        spaceSettingsSrc.includes('activeSection === "danger"'),
      "SpaceSettingsTab must provide General, Access, Git, PLM, Features, Integrations, and Danger sections",
    );

    // 4. General section includes profile identity, domain taxonomy, and branding
    assert.ok(
      spaceSettingsSrc.includes("Space Name") &&
        spaceSettingsSrc.includes("Tagline") &&
        spaceSettingsSrc.includes("Domain Preset") &&
        spaceSettingsSrc.includes("Space Avatar") &&
        spaceSettingsSrc.includes("Banner Graphic URL"),
      "General section must support Name, Tagline, Domain Preset, Avatar, and Banner",
    );

    // 5. Access section includes member filter, role dropdowns, and RBAC matrix
    assert.ok(
      spaceSettingsSrc.includes("Space Engineering Members") &&
        spaceSettingsSrc.includes("addSpaceMember") &&
        spaceSettingsSrc.includes("removeSpaceMember") &&
        spaceSettingsSrc.includes("Role Permissions"),
      "Access section must provide member filtering, role management, and RBAC matrix",
    );

    // 6. Integrations section supports Atlassian Jira credentials, custom field mapping, and simulation gate writeback
    assert.ok(
      spaceSettingsSrc.includes("Integrations & Jira") &&
        spaceSettingsSrc.includes("Atlassian Jira Cloud & Data Center") &&
        spaceSettingsSrc.includes("Automated Simulation Gate Writeback") &&
        spaceSettingsSrc.includes("handleSaveJiraIntegration"),
      "SpaceSettingsTab must provide Integrations section for Jira credentials and simulation writeback",
    );

    // 7. Danger zone includes visibility change, transfer container ownership, and delete space dialogs
    assert.ok(
      spaceSettingsSrc.includes("DangerCard") &&
        spaceSettingsSrc.includes("showVisibilityModal") &&
        spaceSettingsSrc.includes("showTransferModal") &&
        spaceSettingsSrc.includes("showDeleteModal") &&
        spaceSettingsSrc.includes("deleteSpace"),
      "Danger section must provide visibility toggle, transfer container ownership, and typed delete confirmation dialog",
    );
  });

  it("verifies Change Control tab implements 21 CFR Part 11 signatures, BOM redline, and one-click release workflow", () => {
    // 1. Declarative BOM Redline Sub-Tab with metrics HUD & table
    assert.ok(
      spaceChangeControlSrc.includes('activeSubTab === "bom"') &&
        spaceChangeControlSrc.includes("BOM Redline") &&
        spaceChangeControlSrc.includes("Net Part Delta") &&
        spaceChangeControlSrc.includes("Net Mass Delta") &&
        spaceChangeControlSrc.includes("Unit Cost Delta") &&
        spaceChangeControlSrc.includes("Net Carbon Impact"),
      "Change Control tab must render Declarative BOM Redline inspector with summary metrics HUD",
    );

    // 2. 21 CFR Part 11 & ISO 26262 Electronic Signature Modal
    assert.ok(
      spaceChangeControlSrc.includes("showSignatureModal") &&
        spaceChangeControlSrc.includes("21 CFR Part 11 / ISO 26262 Electronic Signature") &&
        spaceChangeControlSrc.includes("Lead Systems Architect") &&
        spaceChangeControlSrc.includes("Functional Safety Officer (ISO 26262 ASIL-D)") &&
        spaceChangeControlSrc.includes("Dual-component identification binds this cryptographic signature"),
      "Change Control tab must integrate 21 CFR Part 11 electronic signature modal with role and credential verification",
    );

    // 3. One-Click Merge & Release Workflow
    assert.ok(
      spaceChangeControlSrc.includes("handleMergeEco") &&
        spaceChangeControlSrc.includes("🚀 Merge ECO & Tag Release") &&
        spaceChangeControlSrc.includes("Merged & Released") &&
        spaceChangeControlSrc.includes("AASX (IDTA v3.0)") &&
        spaceChangeControlSrc.includes("ISO 10303-242 DDP"),
      "Change Control tab must implement one-click merge & release workflow with AASX and DDP bundle indicators",
    );

    // 4. Computable Simulation Gate & Monaco Diff
    assert.ok(
      spaceChangeControlSrc.includes("<DiffEditor") &&
        spaceChangeControlSrc.includes("<LineChart") &&
        spaceChangeControlSrc.includes("handleReverifySimulation") &&
        spaceChangeControlSrc.includes("Salsa Computable Blast Radius & Traceability"),
      "Change Control tab must integrate Monaco diff editor, simulation trajectories, and computable blast radius",
    );

    // 5. Blast Radius API client export
    assert.ok(
      apiSpacesSrc.includes("export const getSpaceEcoBlastRadius") &&
        apiSpacesSrc.includes("export const getSpaceEcoImpact"),
      "api/spaces.ts must export getSpaceEcoBlastRadius and getSpaceEcoImpact for ECO blast radius inspection",
    );
  });

  it("verifies World-Class Space Chat UI/UX: theme tokens, pinned bottom composer, LaTeX math & simulation telemetry", () => {
    // 1. AppShell locks viewport height to 100dvh on /chat to eliminate outer page scroll
    assert.ok(
      appShellSrc.includes('const isChatLayout = location.pathname.startsWith("/chat");'),
      "AppShell must compute isChatLayout for /chat route",
    );
    assert.ok(
      appShellSrc.includes("$isChatLayout") && appShellSrc.includes("overflow: hidden;"),
      "AppShell must pass $isChatLayout and suppress window overflow",
    );

    // 2. SpaceChatPage uses theme tokens and eliminates muddy dark transparencies breaking light mode
    assert.ok(
      !spaceChatSrc.includes('background: "rgba(2, 6, 23, 0.85)"') &&
        !spaceChatSrc.includes('background: "rgba(15, 23, 42, 0.45)"') &&
        !spaceChatSrc.includes('background: "rgba(30, 41, 59, 0.35)"'),
      "SpaceChatPage must eliminate hardcoded dark rgba values that break light mode contrast",
    );
    assert.ok(
      spaceChatSrc.includes("var(--ms-bg)") && spaceChatSrc.includes("var(--ms-bg-alt)"),
      "SpaceChatPage must adopt semantic theme design tokens",
    );

    // 3. Pinned bottom composer with zero page scroll needed
    assert.ok(
      spaceChatSrc.includes("<textarea") &&
        spaceChatSrc.includes("flexShrink: 0") &&
        spaceChatSrc.includes("PaperAirplaneIcon"),
      "SpaceChatPage must provide pinned bottom composer with PaperAirplaneIcon send button",
    );

    // 4. LaTeX math rendering with KaTeX and simulation telemetry card
    assert.ok(
      spaceChatSrc.includes("katex") && spaceChatSrc.includes("renderLatex"),
      "SpaceChatPage must integrate KaTeX for inline and display LaTeX math",
    );
    assert.ok(
      spaceChatSrc.includes("SimulationTelemetryCard") && spaceChatSrc.includes("SIMULATION PASSED"),
      "SpaceChatPage must render executive simulation telemetry card for simulation runner outputs",
    );

    // 5. Space tabs navigation and quick action chips
    assert.ok(
      spaceChatSrc.includes("SpaceTabsNav") && spaceChatSrc.includes("SpaceTabButton"),
      "SpaceChatPage must implement horizontal SpaceTabsNav and SpaceTabButton matching SpacePage tabs",
    );
    assert.ok(
      spaceChatSrc.includes("/run Rotational3D") && spaceChatSrc.includes("scrollToBottom"),
      "SpaceChatPage must provide instant /run quick chips and auto-scroll",
    );

    // 6. Slack-style contextual Thread side panel with replies and pinned reply composer
    assert.ok(
      spaceChatSrc.includes("activeThreadMessage") &&
        spaceChatSrc.includes("handleSendThreadReply") &&
        spaceChatSrc.includes("Also send to #") &&
        spaceChatSrc.includes("CommentDiscussionIcon"),
      "SpaceChatPage must implement Slack-style Thread side panel with contextual replies and broadcast option",
    );
  });

  it("verifies Space Code & Files tab integrates native Git Vault browsing and Open Studio launcher", () => {
    const spaceCodeTabPath = path.resolve(import.meta.dirname, "../src/pages/space/SpaceCodeTab.tsx");
    assert.ok(fs.existsSync(spaceCodeTabPath), "SpaceCodeTab.tsx must exist");
    const spaceCodeTabSrc = fs.readFileSync(spaceCodeTabPath, "utf-8");

    assert.ok(spacePageSrc.includes("<SpaceCodeTab"), "SpacePage must mount SpaceCodeTab component");
    assert.ok(
      spacePageSrc.includes('{ id: "code", label: "Code", icon: CodeIcon }'),
      "SpaceTabsNav must include Code tab",
    );
    assert.ok(spacePageSrc.includes("Open Studio"), "SpacePage must render Open Studio button in header");
    assert.ok(
      spaceCodeTabSrc.includes("getSpaceTree") && spaceCodeTabSrc.includes("getSpaceFileRaw"),
      "SpaceCodeTab must fetch tree and file blobs via spaces API",
    );
    assert.ok(
      spaceCodeTabSrc.includes("Heading") && spaceCodeTabSrc.includes('from "@primer/react"'),
      "SpaceCodeTab must import Heading from @primer/react",
    );
    assert.ok(
      spaceCodeTabSrc.includes("SplitLayout") &&
        spaceCodeTabSrc.includes("FileTreeSidebar") &&
        spaceCodeTabSrc.includes("SymbolOutlineBar") &&
        spaceCodeTabSrc.includes("extractCodeSymbols"),
      "SpaceCodeTab must implement SplitLayout with FileTreeSidebar and SymbolOutlineBar for polyglot models",
    );
    assert.ok(
      spaceCodeTabSrc.includes("ensureMonacoThemesDefined") && spaceCodeTabSrc.includes("getLanguageFromFileName"),
      "SpaceCodeTab must configure Monaco themes and map polyglot language definitions",
    );
  });

  it("verifies Unified CodeWorkbench architecture, hierarchical folder tree, and polyglot formatting in SpaceCodeTab", () => {
    const spaceCodeTabPath = path.resolve(import.meta.dirname, "../src/pages/space/SpaceCodeTab.tsx");
    const spaceCodeTabSrc = fs.readFileSync(spaceCodeTabPath, "utf-8");

    // 1. buildFileTree creates nested hierarchy with folders first and alphabetical sorting
    const sampleFiles = [
      { path: "README.md", name: "README.md", type: "blob", size: 1024 },
      { path: "circuits/Inverter_Station.mo", name: "Inverter_Station.mo", type: "blob", size: 2048 },
      { path: "circuits/HVDC_Transmission_Link.mo", name: "HVDC_Transmission_Link.mo", type: "blob", size: 4096 },
      { path: "grid/IEEE_39_Bus.raw", name: "IEEE_39_Bus.raw", type: "blob", size: 740 },
      { path: "control/VirtualSynchronousMachine.mo", name: "VirtualSynchronousMachine.mo", type: "blob", size: 3000 },
    ];

    const tree = buildFileTree(sampleFiles);
    assert.equal(tree.length, 4, "Root should contain 3 folders and 1 file");
    // Folders first: circuits, control, grid, then README.md
    assert.equal(tree[0].name, "circuits");
    assert.equal(tree[0].type, "tree");
    assert.equal(tree[1].name, "control");
    assert.equal(tree[1].type, "tree");
    assert.equal(tree[2].name, "grid");
    assert.equal(tree[2].type, "tree");
    assert.equal(tree[3].name, "README.md");
    assert.equal(tree[3].type, "blob");

    // Check children inside circuits (alphabetical: HVDC_Transmission_Link before Inverter_Station)
    assert.ok(tree[0].children && tree[0].children.length === 2);
    assert.equal(tree[0].children[0].name, "HVDC_Transmission_Link.mo");
    assert.equal(tree[0].children[1].name, "Inverter_Station.mo");

    // 2. SpaceCodeTab implements WorkbenchBody ensuring equal height for sidebar and editor
    assert.ok(
      spaceCodeTabSrc.includes("WorkbenchBody") &&
        spaceCodeTabSrc.includes("height: 640px;") &&
        spaceCodeTabSrc.includes("min-height: 520px;"),
      "SpaceCodeTab must implement WorkbenchBody with matched height for sidebar and editor",
    );

    // 3. SpaceCodeTab implements TreeFolderRow and TreeFileRow with collapsible chevrons
    assert.ok(
      spaceCodeTabSrc.includes("TreeFolderRow") &&
        spaceCodeTabSrc.includes("TreeFileRow") &&
        spaceCodeTabSrc.includes("ChevronRightIcon") &&
        spaceCodeTabSrc.includes("ChevronDownIcon"),
      "SpaceCodeTab must implement hierarchical TreeFolderRow and TreeFileRow with Chevron expand/collapse icons",
    );

    // 4. SpaceCodeTab uses formatLanguageLabel for accurate badge labels (e.g. PSS/E Raw)
    assert.ok(
      spaceCodeTabSrc.includes("formatLanguageLabel(getLanguageFromFileName(currentFile), currentFile)"),
      "SpaceCodeTab must format language badge using formatLanguageLabel",
    );

    // 5. SpaceCodeTab configures slim Monaco scrollbars and suppresses overview ruler on short files
    assert.ok(
      spaceCodeTabSrc.includes("scrollbar: {") &&
        spaceCodeTabSrc.includes('vertical: lineCount > 25 ? "auto" : "hidden"') &&
        spaceCodeTabSrc.includes("overviewRulerLanes: 0"),
      "SpaceCodeTab must suppress Monaco vertical scrollbars and overview ruler on short files",
    );
  });

  it("verifies Issues tab implements GitHub-native problem reports cockpit with severity badges, Morsel links, and PR linkages", () => {
    // 1. SpacePage delegates Tab 3 to SpaceIssuesTab
    assert.ok(
      spacePageSrc.includes("<SpaceIssuesTab") && spacePageSrc.includes('activeTab === "issues"'),
      "SpacePage must mount SpaceIssuesTab for 'issues' tab route",
    );

    // 2. SpaceIssuesTab 2-mode cockpit (list + detail)
    assert.ok(
      spaceIssuesSrc.includes('viewMode === "list"') &&
        spaceIssuesSrc.includes('viewMode === "detail"') &&
        spaceIssuesSrc.includes("IssueTableRow") &&
        spaceIssuesSrc.includes("IssueSectionCard") &&
        spaceIssuesSrc.includes("IssueSplitLayout"),
      "SpaceIssuesTab must implement 2-mode GitHub-native cockpit with list and detail views",
    );

    // 3. Issue creation modal and API calls
    assert.ok(
      spaceIssuesSrc.includes("createSpaceIssue") &&
        spaceIssuesSrc.includes("addSpaceIssueComment") &&
        spaceIssuesSrc.includes("updateSpaceIssue") &&
        spaceIssuesSrc.includes("showNewIssueModal"),
      "SpaceIssuesTab must implement issue creation modal and comment/status updates",
    );

    // 4. Engineering metadata: Severity badges, impacted models linked to Morsel, and linked PR badge
    assert.ok(
      spaceIssuesSrc.includes("issue.severity") &&
        spaceIssuesSrc.includes("impacted_models") &&
        spaceIssuesSrc.includes("/morsel?code=") &&
        spaceIssuesSrc.includes("linked_pr_number"),
      "SpaceIssuesTab must render engineering severity badges, Morsel simulator links for impacted models, and linked PR badges",
    );

    // 5. Discussion thread and Close / Reopen state management
    assert.ok(
      spaceIssuesSrc.includes("handleAddComment") &&
        spaceIssuesSrc.includes("handleToggleIssueStatus") &&
        spaceIssuesSrc.includes("commentInput"),
      "SpaceIssuesTab must provide discussion thread and one-click Close/Reopen state transitions",
    );
  });

  it("verifies Issues tab supports Jira bi-directional synchronization, external badges, and JQL sync modal", () => {
    // 1. API client provides syncSpaceJiraIssues
    assert.ok(apiSpacesSrc.includes("syncSpaceJiraIssues"), "spaces API client must export syncSpaceJiraIssues");

    // 2. SpaceIssuesTab includes Sync Jira action button and modal state
    assert.ok(
      spaceIssuesSrc.includes("Sync Jira") &&
        spaceIssuesSrc.includes("showJiraModal") &&
        spaceIssuesSrc.includes("handleSyncJira"),
      "SpaceIssuesTab must render Sync Jira button and manage modal state",
    );

    // 3. IssueTableRow renders Jira external badge and direct link
    assert.ok(
      spaceIssuesSrc.includes('issue.external_source === "jira"') &&
        spaceIssuesSrc.includes("issue.external_key") &&
        spaceIssuesSrc.includes("issue.external_url"),
      "IssueTableRow must display external Jira key badge and direct link",
    );

    // 4. Detail view renders Jira External Sync banner
    assert.ok(
      spaceIssuesSrc.includes("Synchronized with Atlassian Jira") && spaceIssuesSrc.includes("Open in Jira"),
      "Detail view must render Jira external sync HUD banner",
    );

    // 5. Search filter supports external_key and is:jira
    assert.ok(
      spaceIssuesSrc.includes('q === "is:jira"') && spaceIssuesSrc.includes('(issue.external_key || "").toLowerCase()'),
      "Search filter must support filtering by is:jira and Jira issue key",
    );
  });
});

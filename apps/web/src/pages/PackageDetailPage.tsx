// SPDX-License-Identifier: AGPL-3.0-or-later

import { AlertIcon, ArrowLeftIcon } from "@primer/octicons-react";
import { Heading, Text } from "@primer/react";
import React, { Suspense, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import styledImport, { keyframes } from "styled-components";
import { useAuth } from "../AuthContext";
import { useFeatureFlag } from "../FeatureFlagContext";
import Box from "../components/Box";
import { TerminalLogViewer } from "../components/TerminalLogViewer";
import { usePageTitle } from "../util/title";
import { resolvePackageParams } from "../util/url";
import { ClassDetailView } from "./class-detail";
import { PackageHeader } from "./package/components/PackageHeader";
import { PackageManageModals } from "./package/components/PackageManageModals";
import { PackageTreeSidebar } from "./package/components/PackageTreeSidebar";
import { usePackageData } from "./package/hooks/usePackageData";
import { usePackageManagement } from "./package/hooks/usePackageManagement";
import { PackageArtifactsTab } from "./package/tabs/PackageArtifactsTab";
import { PackageCompareTab } from "./package/tabs/PackageCompareTab";
import { PackageDependenciesTab } from "./package/tabs/PackageDependenciesTab";
import { PackageDigitalThreadTab } from "./package/tabs/PackageDigitalThreadTab";
import { PackageReadmeTab } from "./package/tabs/PackageReadmeTab";
import { PackageStudiesTab } from "./package/tabs/PackageStudiesTab";
import { PackageVersionsTab } from "./package/tabs/PackageVersionsTab";
import { HeaderBar, TABS, TreeSidebar, type PolyglotDomain, type TabId } from "./package/types";

const styled: typeof styledImport =
  (styledImport as unknown as { default?: typeof styledImport }).default ?? styledImport;

const PublishPackageModal = React.lazy(() => import("../components/PublishPackageModal"));
const LibraryVersionPage = React.lazy(() => import("./LibraryVersionPage"));

/* ─── animations ─── */

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
`;

/* ─── layout styled components ─── */

const PageWrap = styled.div`
  background-color: transparent;
  color: var(--color-text-primary);
  min-height: 100%;
  display: flex;
  flex-direction: row;
  transition:
    background-color 0.3s ease,
    color 0.3s ease;
  flex: 1;

  @media (max-width: 960px) {
    flex-direction: column;
  }
`;

const MainContentWrap = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
`;

const ContentWrap = styled.div`
  width: 100%;
  padding: 0 24px 60px;
  box-sizing: border-box;
  animation: ${fadeIn} 0.3s ease;

  @media (max-width: 960px) {
    padding: 0 16px 40px;
  }
`;

const TabBar = styled.div`
  display: flex;
  gap: 8px;
  border-bottom: 1px solid var(--color-border-default, var(--ms-divider));
  margin-bottom: 24px;
  width: 100%;
  padding: 0 24px;
  box-sizing: border-box;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;
  &::-webkit-scrollbar {
    display: none;
  }
  position: sticky;
  top: var(--dev-header-height, 0px);
  z-index: 45;
  background: var(--surface-sticky);
  backdrop-filter: var(--backdrop-sticky);
  -webkit-backdrop-filter: var(--backdrop-sticky);
  transition: background-color 0.25s ease;

  @media (max-width: 960px) {
    padding: 0 16px;
    gap: 4px;
  }
`;

const Tab = styled.button<{ $active: boolean }>`
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 48px;
  padding: 0 16px;
  font-size: 14px;
  font-weight: ${({ $active }) => ($active ? 650 : 500)};
  border: none;
  background: none;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  color: ${({ $active }) =>
    $active ? "var(--color-fg-default, var(--ms-text-1))" : "var(--color-fg-muted, var(--ms-text-2))"};
  transition: all 0.15s ease;
  border-radius: 8px 8px 0 0;

  &:hover {
    color: var(--color-text-heading, var(--ms-text-heading));
    background-color: var(--color-canvas-subtle, var(--ms-surface-hover));
  }

  &::after {
    content: "";
    position: absolute;
    bottom: 0;
    left: 12px;
    right: 12px;
    height: 3px;
    background: var(--gradient-cta, var(--ms-brand));
    box-shadow: 0 0 10px rgba(6, 182, 212, 0.45);
    border-radius: 9999px;
    display: ${({ $active }) => ($active ? "block" : "none")};
  }
`;

const TabCountBadge = styled.span<{ $active?: boolean | undefined }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  line-height: 14px;
  border-radius: 9999px;
  background: ${(p) =>
    p.$active ? "var(--ms-brand-soft, rgba(6, 182, 212, 0.15))" : "var(--ms-surface-hover, rgba(255, 255, 255, 0.06))"};
  color: ${(p) =>
    p.$active ? "var(--ms-brand, var(--color-accent-cyan, #06b6d4))" : "var(--color-text-muted, var(--ms-text-3))"};
  transition: all 0.15s ease;
`;

/* ─── skeleton ─── */

const PackageDetailSkeleton: React.FC = () => (
  <PageWrap>
    <TreeSidebar $mobileOpen={false}>
      <div className="skeleton" style={{ width: "60%", height: "20px", margin: "16px 0 12px" }} />
      <div className="skeleton" style={{ width: "90%", height: "24px", marginBottom: "8px" }} />
      <div className="skeleton" style={{ width: "70%", height: "24px", marginBottom: "8px" }} />
      <div className="skeleton" style={{ width: "80%", height: "24px", marginBottom: "8px" }} />
    </TreeSidebar>
    <MainContentWrap>
      <HeaderBar>
        {/* Top Strip Skeleton: Breadcrumb on Left, Actions on Right */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
            marginBottom: "16px",
          }}
        >
          <div className="skeleton" style={{ width: "220px", height: "18px", borderRadius: "4px" }} />
          <div style={{ display: "flex", gap: "8px" }}>
            <div className="skeleton" style={{ width: "130px", height: "32px", borderRadius: "8px" }} />
            <div className="skeleton" style={{ width: "80px", height: "32px", borderRadius: "8px" }} />
            <div className="skeleton" style={{ width: "60px", height: "32px", borderRadius: "8px" }} />
          </div>
        </div>

        {/* Hero Row Skeleton: 52px Icon + Title */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "16px",
            marginBottom: "14px",
          }}
        >
          <div className="skeleton" style={{ width: "52px", height: "52px", borderRadius: "12px", flexShrink: 0 }} />
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div className="skeleton" style={{ width: "280px", height: "26px", borderRadius: "6px" }} />
              <div className="skeleton" style={{ width: "56px", height: "22px", borderRadius: "6px" }} />
              <div className="skeleton" style={{ width: "48px", height: "20px", borderRadius: "9999px" }} />
            </div>
            <div className="skeleton" style={{ width: "480px", height: "15px", borderRadius: "4px" }} />
          </div>
        </div>

        {/* Utility Row Skeleton: Meta Strip + Install Pill */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
            paddingTop: "10px",
            borderTop: "1px solid var(--ms-divider, var(--color-border))",
            paddingBottom: "12px",
          }}
        >
          <div style={{ display: "flex", gap: "12px" }}>
            <div className="skeleton" style={{ width: "90px", height: "14px", borderRadius: "4px" }} />
            <div className="skeleton" style={{ width: "50px", height: "14px", borderRadius: "4px" }} />
            <div className="skeleton" style={{ width: "70px", height: "14px", borderRadius: "4px" }} />
          </div>
          <div className="skeleton" style={{ width: "240px", height: "30px", borderRadius: "8px" }} />
        </div>
      </HeaderBar>
      <ContentWrap style={{ marginTop: "24px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div className="skeleton" style={{ width: "100%", height: "160px", borderRadius: "12px" }} />
          <div className="skeleton" style={{ width: "100%", height: "280px", borderRadius: "12px" }} />
        </div>
      </ContentWrap>
    </MainContentWrap>
  </PageWrap>
);

const LogsModalOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(4px);
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  animation: ${fadeIn} 0.15s ease-out;
`;

const LogsModalContainer = styled.div`
  width: 1000px;
  max-width: 95vw;
  height: 82vh;
  max-height: 850px;
  display: flex;
  flex-direction: column;
  position: relative;
  border-radius: 10px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.85);

  & > div {
    height: 100%;
    margin-bottom: 0;
  }
`;

/* ─── main controller component ─── */

interface PackageDetailContentProps {
  rawParams: {
    scope?: string | undefined;
    name?: string | undefined;
    version?: string | undefined;
    className?: string | undefined;
    first?: string | undefined;
    second?: string | undefined;
  };
}

const PackageDetailContent: React.FC<PackageDetailContentProps> = ({ rawParams }) => {
  const { user } = useAuth();
  const { name, version, className } = resolvePackageParams(rawParams);
  const navigate = useNavigate();
  usePageTitle(
    className && name && version
      ? `${className} | ${name}@${version}`
      : name && version
        ? `${name}@${version}`
        : "Package Details",
  );
  const hasCae = useFeatureFlag("cae_cloud_solver");
  const hasDigitalThread = useFeatureFlag("digital_thread_explorer");
  const hasArtifactsTab = useFeatureFlag("package_artifacts_tab");
  const hasCompareTab = useFeatureFlag("package_version_compare");
  const visibleTabs = React.useMemo(() => {
    return TABS.filter((t) => {
      if (t.id === "studies" && !hasCae) return false;
      if (t.id === "digital-thread" && !hasDigitalThread) return false;
      if (t.id === "artifacts" && !hasArtifactsTab) return false;
      if (t.id === "compare" && !hasCompareTab) return false;
      return true;
    });
  }, [hasCae, hasDigitalThread, hasArtifactsTab, hasCompareTab]);
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get("tab") as TabId | null;
  const activeTab: TabId = rawTab && visibleTabs.some((t) => t.id === rawTab) ? rawTab : "readme";
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [treeSearchFilter, setTreeSearchFilter] = useState("");
  const [selectedDomain, setSelectedDomain] = useState<PolyglotDomain>("all");

  React.useEffect(() => {
    if (className) {
      setTreeCollapsed(false);
    }
  }, [className]);
  const [artifactTabDomainFilter, setArtifactTabDomainFilter] = useState<PolyglotDomain>("all");
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [compareTargetVersion, setCompareTargetVersion] = useState<string | undefined>(undefined);
  const [logsModalOpen, setLogsModalOpen] = useState(false);

  const setTab = (tab: TabId) => {
    setSearchParams({ tab });
  };

  const pkg = usePackageData(name, version, user, treeSearchFilter, artifactTabDomainFilter);
  const mgmt = usePackageManagement({
    name,
    version,
    isCurrentYanked: pkg.isCurrentYanked,
    isCurrentDeprecated: pkg.isCurrentDeprecated,
    fetchData: pkg.fetchData,
    navigate,
  });

  const handleOpenArtifact = (av: { id: string | number }) => {
    if (!hasArtifactsTab) return;
    setTab("artifacts");
    setTimeout(() => {
      const el = document.getElementById(`artifact-${av.id}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        el.style.transition = "box-shadow 0.3s ease, border-color 0.3s ease";
        el.style.boxShadow = "0 0 20px rgba(6, 182, 212, 0.4)";
        setTimeout(() => {
          el.style.boxShadow = "";
        }, 1500);
      }
    }, 100);
  };

  if (pkg.loading) {
    return <PackageDetailSkeleton />;
  }

  if (pkg.error) {
    return (
      <PageWrap style={{ justifyContent: "center", alignItems: "center" }}>
        <Box
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
            padding: 40,
            textAlign: "center",
          }}
        >
          <AlertIcon size={48} fill="var(--color-error)" />
          <Heading as="h2" style={{ color: "var(--color-text-heading)", fontSize: 22, margin: 0 }}>
            Failed to load artifact details
          </Heading>
          <Text as="p" style={{ color: "var(--color-text-muted)", fontSize: 15, margin: 0, maxWidth: 400 }}>
            The artifact may not exist, is still being processed, or the server is unavailable.
          </Text>
          <Link
            to="/packages"
            style={{
              color: "var(--color-link)",
              fontSize: 14,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <ArrowLeftIcon size={14} /> Back to libraries
          </Link>
        </Box>
      </PageWrap>
    );
  }

  return (
    <PageWrap>
      {/* ── Left Sidebar (Classes or Polyglot Artifacts) ── */}
      {(pkg.tree.length > 0 ||
        pkg.loading ||
        pkg.jobStatus === "pending" ||
        pkg.jobStatus === "processing" ||
        pkg.jobStatus === "running" ||
        (hasArtifactsTab && pkg.artifactViewers.length > 0)) && (
        <PackageTreeSidebar
          name={name!}
          version={version!}
          rootClassName={pkg.rootClassName}
          activeClassName={className}
          mobileTreeOpen={mobileTreeOpen}
          setMobileTreeOpen={setMobileTreeOpen}
          availableDomains={
            hasArtifactsTab ? pkg.availableDomains : pkg.availableDomains.filter((d) => d.id === "modelica")
          }
          selectedDomain={hasArtifactsTab ? selectedDomain : "modelica"}
          setSelectedDomain={setSelectedDomain}
          treeSearchFilter={treeSearchFilter}
          setTreeSearchFilter={setTreeSearchFilter}
          filteredTree={pkg.filteredTree}
          filteredSysml={hasArtifactsTab ? pkg.filteredSysml : []}
          filteredCad={hasArtifactsTab ? pkg.filteredCad : []}
          filteredDatasets={hasArtifactsTab ? pkg.filteredDatasets : []}
          filteredFmu={hasArtifactsTab ? pkg.filteredFmu : []}
          filteredOther={hasArtifactsTab ? pkg.filteredOther : []}
          onOpenArtifact={handleOpenArtifact}
          collapsed={treeCollapsed}
          onToggleCollapse={() => setTreeCollapsed((p) => !p)}
          totalClassesCount={pkg.classes.length}
          loading={pkg.loading}
          jobStatus={pkg.jobStatus}
          classesProcessed={pkg.jobInfo?.classesProcessed}
          onOpenLogs={() => setLogsModalOpen(true)}
        />
      )}

      <MainContentWrap>
        {className ? (
          <ClassDetailView
            name={name!}
            version={version!}
            className={className}
            allClasses={pkg.classes}
            jobStatus={pkg.jobStatus || null}
            treeCollapsed={treeCollapsed}
            onToggleTreeCollapse={() => setTreeCollapsed((p) => !p)}
            onOpenLogs={() => setLogsModalOpen(true)}
          />
        ) : (
          <>
            {/* ── Header & Alerts ── */}
            <PackageHeader
              name={name!}
              version={version!}
              rootClassName={pkg.rootClassName}
              description={pkg.description}
              publishedAt={pkg.publishedAt}
              license={pkg.libraryDetail?.license || pkg.packument?.license}
              classCount={pkg.classes.length}
              classes={pkg.classes}
              canManage={pkg.canManage}
              isCurrentYanked={pkg.isCurrentYanked}
              currentYankReason={pkg.currentYankReason}
              isCurrentDeprecated={pkg.isCurrentDeprecated}
              currentDeprecateReason={pkg.currentDeprecateReason}
              pendingTransfers={pkg.pendingTransfers}
              user={user}
              actionSuccess={mgmt.actionSuccess}
              setActionSuccess={mgmt.setActionSuccess}
              actionLoading={mgmt.actionLoading}
              setActionError={mgmt.setActionError}
              collaborators={pkg.collaborators}
              setPublishModalOpen={setPublishModalOpen}
              setManageModal={mgmt.setManageModal}
              onAcceptPendingTransfer={mgmt.handleAcceptPendingTransfer}
              onCancelPendingTransfer={mgmt.handleCancelPendingTransfer}
              versionList={pkg.versionList}
              latestVersion={pkg.latestVersion}
              treeCollapsed={treeCollapsed}
              onToggleTreeCollapse={() => setTreeCollapsed((p) => !p)}
              jobStatus={pkg.jobStatus}
              hasLogs={(pkg.jobInfo?.logs?.length ?? 0) > 0}
              onOpenLogs={() => setLogsModalOpen(true)}
              installCmd={pkg.installCmd}
              contentHash={pkg.contentHash}
              packageSignature={pkg.packageSignature}
              packageStats={pkg.packageStats}
              packageOwner={
                pkg.packument?.author?.name || pkg.collaborators.find((c) => c.permission === "owner")?.username
              }
              modelicaVersion={pkg.currentManifest?.modelscript?.modelicaVersion}
              oidcRepository={pkg.oidcRepository}
              oidcWorkflow={pkg.oidcWorkflow}
              oidcIssuer={pkg.oidcIssuer}
              vulnerabilityCount={pkg.vulnerabilityCount}
              vulnerabilities={pkg.vulnerabilities}
            />

            {/* ── Tab Bar ── */}
            <TabBar role="tablist">
              {visibleTabs.map((tab) => {
                const depCount = Object.keys(pkg.dependencies || {}).length;
                const studiesCount =
                  (pkg.linkedStudies?.bundledStudies?.length || 0) +
                  (pkg.linkedStudies?.linkedTemplates?.length || 0) +
                  (pkg.linkedStudies?.linkedJobs?.length || 0);
                return (
                  <Tab
                    key={tab.id}
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    $active={activeTab === tab.id}
                    onClick={() => setTab(tab.id)}
                  >
                    {React.isValidElement(tab.icon)
                      ? tab.icon
                      : typeof tab.icon === "function" ||
                          (typeof tab.icon === "object" && tab.icon !== null && "$$typeof" in tab.icon)
                        ? React.createElement(tab.icon as unknown as React.ComponentType<{ size?: number }>, {
                            size: 16,
                          })
                        : tab.icon}
                    <span>{tab.label}</span>
                    {tab.id === "artifacts" && pkg.artifactViewers.length > 0 && (
                      <TabCountBadge $active={activeTab === tab.id}>{pkg.artifactViewers.length}</TabCountBadge>
                    )}
                    {tab.id === "studies" && studiesCount > 0 && (
                      <TabCountBadge $active={activeTab === tab.id}>{studiesCount}</TabCountBadge>
                    )}
                    {tab.id === "versions" && pkg.versionList.length > 0 && (
                      <TabCountBadge $active={activeTab === tab.id}>{pkg.versionList.length}</TabCountBadge>
                    )}
                    {tab.id === "dependencies" && depCount > 0 && (
                      <TabCountBadge $active={activeTab === tab.id}>{depCount}</TabCountBadge>
                    )}
                  </Tab>
                );
              })}
            </TabBar>

            {/* ── Body ── */}
            <ContentWrap>
              {activeTab === "readme" && (
                <PackageReadmeTab
                  name={name!}
                  version={version!}
                  rootClassName={pkg.rootClassName}
                  rootClass={pkg.rootClass}
                  packument={pkg.packument}
                  classes={pkg.classes}
                  availableDomains={pkg.availableDomains}
                  onNavigateToDigitalThread={() => setTab("digital-thread")}
                  jobStatus={pkg.jobStatus || undefined}
                />
              )}

              {activeTab === "versions" && (
                <PackageVersionsTab
                  name={name!}
                  version={version!}
                  versionList={pkg.versionList}
                  packument={pkg.packument}
                  packageStats={pkg.packageStats}
                  onCompare={(v) => {
                    setCompareTargetVersion(v);
                    setTab("compare");
                  }}
                />
              )}

              {hasCompareTab && activeTab === "compare" && name && version && (
                <PackageCompareTab
                  name={name}
                  version={version}
                  versionList={pkg.versionList}
                  initialBaseVersion={compareTargetVersion}
                  baseVersion={compareTargetVersion}
                />
              )}

              {hasDigitalThread && activeTab === "digital-thread" && (
                <PackageDigitalThreadTab
                  name={name!}
                  version={version!}
                  classes={pkg.classes}
                  rootClass={pkg.rootClass}
                  artifactViewers={pkg.artifactViewers}
                  onOpenArtifact={handleOpenArtifact}
                  onNavigateToClass={(c) => {
                    navigate(`/packages/${name}/${version}/classes/${c}`);
                  }}
                />
              )}

              {hasArtifactsTab && activeTab === "artifacts" && (
                <PackageArtifactsTab
                  name={name!}
                  version={version!}
                  availableDomains={pkg.availableDomains}
                  artifactTabDomainFilter={artifactTabDomainFilter}
                  setArtifactTabDomainFilter={setArtifactTabDomainFilter}
                  displayedArtifactViewers={pkg.displayedArtifactViewers}
                  fallbackArtifacts={pkg.artifacts}
                  linkedStudies={pkg.linkedStudies}
                  onViewArtifactStudies={
                    hasCae
                      ? (artifactPath) => {
                          setSearchParams({ tab: "studies", artifact: artifactPath });
                        }
                      : undefined
                  }
                />
              )}

              {hasCae && activeTab === "studies" && (
                <PackageStudiesTab
                  name={name!}
                  version={version!}
                  rootClassName={pkg.rootClassName}
                  targetArtifactFilter={searchParams.get("artifact") || undefined}
                  targetModelFilter={searchParams.get("model") || undefined}
                  onClearArtifactFilter={() => {
                    setSearchParams({ tab: "studies" });
                  }}
                  bundledStudies={pkg.linkedStudies.bundledStudies}
                  linkedTemplates={pkg.linkedStudies.linkedTemplates}
                  compatibleTemplates={pkg.linkedStudies.compatibleTemplates}
                  linkedJobs={pkg.linkedStudies.linkedJobs}
                  onRefresh={() => {
                    pkg.fetchData();
                  }}
                />
              )}

              {activeTab === "dependencies" && (
                <PackageDependenciesTab
                  name={name}
                  version={version}
                  dependencies={pkg.dependencies}
                  devDependencies={pkg.currentManifest?.devDependencies}
                  resources={pkg.libraryDetail?.resources}
                  dependents={pkg.dependents}
                />
              )}
            </ContentWrap>
          </>
        )}
      </MainContentWrap>

      {/* ── Modals ── */}
      <PackageManageModals
        manageModal={mgmt.manageModal}
        setManageModal={mgmt.setManageModal}
        name={name!}
        version={version!}
        isCurrentYanked={pkg.isCurrentYanked}
        yankReasonInput={mgmt.yankReasonInput}
        setYankReasonInput={mgmt.setYankReasonInput}
        onToggleYank={mgmt.handleToggleYank}
        isCurrentDeprecated={pkg.isCurrentDeprecated}
        deprecateReasonInput={mgmt.deprecateReasonInput}
        setDeprecateReasonInput={mgmt.setDeprecateReasonInput}
        onToggleDeprecate={mgmt.handleToggleDeprecate}
        transferTargetInput={mgmt.transferTargetInput}
        setTransferTargetInput={mgmt.setTransferTargetInput}
        onTransfer={mgmt.handleTransfer}
        collaboratorUsernameInput={mgmt.collaboratorUsernameInput}
        setCollaboratorUsernameInput={mgmt.setCollaboratorUsernameInput}
        collaboratorPermissionInput={mgmt.collaboratorPermissionInput}
        setCollaboratorPermissionInput={mgmt.setCollaboratorPermissionInput}
        onAddCollaborator={mgmt.handleAddCollaborator}
        onRemoveCollaborator={(userIdOrUsername) => {
          const matched = pkg.collaborators.find(
            (c) => String(c.user_id) === String(userIdOrUsername) || c.username === userIdOrUsername,
          );
          void mgmt.handleRemoveCollaborator(String(matched?.user_id || userIdOrUsername));
        }}
        collaborators={pkg.collaborators}
        packageOwner={pkg.packageOwner}
        onUnpublish={mgmt.handleUnpublish}
        actionLoading={mgmt.actionLoading}
        actionError={mgmt.actionError}
      />

      {publishModalOpen && (
        <Suspense fallback={null}>
          <PublishPackageModal
            isOpen={publishModalOpen}
            onClose={() => setPublishModalOpen(false)}
            defaultPackageName={name}
            onPublished={() => {
              pkg.fetchData();
            }}
          />
        </Suspense>
      )}

      {/* ── Background Ingestion & Indexer Logs Modal ──
          Not shown by default as an unclosable sidebar.
          Rendered as a sleek modal dialog when opened via header button or alert banner. */}
      {logsModalOpen && name && version && (
        <LogsModalOverlay
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setLogsModalOpen(false);
            }
          }}
        >
          <LogsModalContainer>
            <TerminalLogViewer
              packageName={name}
              packageVersion={version}
              jobId={pkg.jobInfo?.id}
              initialJobInfo={pkg.jobInfo}
              isProcessing={pkg.jobStatus === "pending" || pkg.jobStatus === "running"}
              defaultCollapsed={false}
              isModal={true}
              onClose={() => setLogsModalOpen(false)}
            />
          </LogsModalContainer>
        </LogsModalOverlay>
      )}
    </PageWrap>
  );
};

const PackageDetailPage: React.FC = () => {
  const rawParams = useParams<{
    scope?: string | undefined;
    name?: string | undefined;
    version?: string | undefined;
    className?: string | undefined;
    first?: string | undefined;
    second?: string | undefined;
  }>();

  if (rawParams.first?.startsWith("@")) {
    return (
      <Suspense fallback={<PackageDetailSkeleton />}>
        <LibraryVersionPage />
      </Suspense>
    );
  }

  return <PackageDetailContent rawParams={rawParams} />;
};

export default PackageDetailPage;

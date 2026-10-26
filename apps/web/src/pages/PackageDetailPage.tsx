// SPDX-License-Identifier: AGPL-3.0-or-later

import { AlertIcon, ArrowLeftIcon } from "@primer/octicons-react";
import { Heading, Label, Text } from "@primer/react";
import React, { Suspense, useContext, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import styled, { keyframes } from "styled-components";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import { ComposeContext } from "../components/ComposeContext";
import { TerminalLogViewer } from "../components/TerminalLogViewer";
import { usePageTitle } from "../util/title";
import { resolvePackageParams } from "../util/url";
import { PackageHeader } from "./package/components/PackageHeader";
import { PackageManageModals } from "./package/components/PackageManageModals";
import { PackageRightSidebar } from "./package/components/PackageRightSidebar";
import { PackageTreeSidebar } from "./package/components/PackageTreeSidebar";
import { usePackageData } from "./package/hooks/usePackageData";
import { usePackageManagement } from "./package/hooks/usePackageManagement";
import { PackageArtifactsTab } from "./package/tabs/PackageArtifactsTab";
import { PackageCompareTab } from "./package/tabs/PackageCompareTab";
import { PackageDependenciesTab } from "./package/tabs/PackageDependenciesTab";
import { PackageDigitalThreadTab } from "./package/tabs/PackageDigitalThreadTab";
import { PackageReadmeTab } from "./package/tabs/PackageReadmeTab";
import { PackageVersionsTab } from "./package/tabs/PackageVersionsTab";
import { HeaderBar, TABS, TreeSidebar, type PolyglotDomain, type TabId } from "./package/types";

const PublishPackageModal = React.lazy(() => import("../components/PublishPackageModal"));

/* ─── animations ─── */

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
`;

/* ─── layout styled components ─── */

const PageWrap = styled.div`
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
  min-height: 100%;
  display: flex;
  flex-direction: row;
  transition:
    background-color 0.3s ease,
    color 0.3s ease;
  flex: 1;

  @media (max-width: 900px) {
    flex-direction: column;
  }
`;

const MainContentWrap = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
`;

const ContentGrid = styled.div`
  max-width: none;
  margin: 0 auto;
  padding: 0 40px 60px;
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 40px;
  width: 100%;
  box-sizing: border-box;
  animation: ${fadeIn} 0.4s ease;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
    padding: 0 16px 40px;
    gap: 24px;
  }
`;

const TabBar = styled.div`
  display: flex;
  gap: 0;
  border-bottom: 2px solid var(--color-border);
  margin-bottom: 24px;
  max-width: none;
  width: 100%;
  margin-left: auto;
  margin-right: auto;
  padding: 0 40px;
  box-sizing: border-box;
`;

const Tab = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 20px;
  font-size: 14px;
  font-weight: 500;
  border: none;
  background: none;
  cursor: pointer;
  border-bottom: 2px solid ${({ $active }) => ($active ? "var(--color-accent-emphasis)" : "transparent")};
  margin-bottom: -2px;
  color: ${({ $active }) => ($active ? "var(--color-accent-emphasis)" : "var(--color-text-muted)")};
  transition: all 0.15s ease;

  &:hover {
    color: var(--color-text-primary);
  }
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
        <div style={{ display: "flex", gap: "16px", alignItems: "center", marginBottom: "16px" }}>
          <div className="skeleton" style={{ width: "52px", height: "52px", borderRadius: "10px" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div className="skeleton" style={{ width: "240px", height: "28px" }} />
            <div className="skeleton" style={{ width: "160px", height: "14px" }} />
          </div>
        </div>
        <div
          style={{ display: "flex", gap: "12px", borderBottom: "1px solid var(--color-border)", paddingBottom: "12px" }}
        >
          <div className="skeleton" style={{ width: "80px", height: "20px" }} />
          <div className="skeleton" style={{ width: "80px", height: "20px" }} />
          <div className="skeleton" style={{ width: "80px", height: "20px" }} />
        </div>
      </HeaderBar>
      <ContentGrid style={{ marginTop: "24px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div className="skeleton" style={{ width: "100%", height: "160px", borderRadius: "12px" }} />
          <div className="skeleton" style={{ width: "100%", height: "280px", borderRadius: "12px" }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div className="skeleton" style={{ width: "100%", height: "180px", borderRadius: "12px" }} />
          <div className="skeleton" style={{ width: "100%", height: "140px", borderRadius: "12px" }} />
        </div>
      </ContentGrid>
    </MainContentWrap>
  </PageWrap>
);

/* ─── main controller component ─── */

const PackageDetailPage: React.FC = () => {
  const rawParams = useParams<{
    scope?: string | undefined;
    name?: string | undefined;
    version?: string | undefined;
  }>();
  const { name, version } = resolvePackageParams(rawParams);
  const navigate = useNavigate();
  usePageTitle(name && version ? `${name}@${version}` : "Package Details");
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("tab") as TabId) || "readme";
  const { openCompose } = useContext(ComposeContext);
  const { user } = useAuth();

  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);
  const [treeSearchFilter, setTreeSearchFilter] = useState("");
  const [selectedDomain, setSelectedDomain] = useState<PolyglotDomain>("all");
  const [artifactTabDomainFilter, setArtifactTabDomainFilter] = useState<PolyglotDomain>("all");
  const [publishModalOpen, setPublishModalOpen] = useState(false);

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
      {(pkg.tree.length > 0 || pkg.artifactViewers.length > 0) && (
        <PackageTreeSidebar
          name={name!}
          version={version!}
          rootClassName={pkg.rootClassName}
          mobileTreeOpen={mobileTreeOpen}
          setMobileTreeOpen={setMobileTreeOpen}
          availableDomains={pkg.availableDomains}
          selectedDomain={selectedDomain}
          setSelectedDomain={setSelectedDomain}
          treeSearchFilter={treeSearchFilter}
          setTreeSearchFilter={setTreeSearchFilter}
          filteredTree={pkg.filteredTree}
          filteredSysml={pkg.filteredSysml}
          filteredCad={pkg.filteredCad}
          filteredDatasets={pkg.filteredDatasets}
          filteredFmu={pkg.filteredFmu}
          filteredOther={pkg.filteredOther}
          onOpenArtifact={handleOpenArtifact}
        />
      )}

      <MainContentWrap>
        {/* ── Header & Alerts ── */}
        <PackageHeader
          name={name!}
          version={version!}
          rootClassName={pkg.rootClassName}
          description={pkg.description}
          publishedAt={pkg.publishedAt}
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
          openCompose={openCompose}
          setPublishModalOpen={setPublishModalOpen}
          setManageModal={mgmt.setManageModal}
          onAcceptPendingTransfer={mgmt.handleAcceptPendingTransfer}
          onCancelPendingTransfer={mgmt.handleCancelPendingTransfer}
        />

        {/* ── Tab Bar ── */}
        <TabBar>
          {TABS.map((tab) => (
            <Tab key={tab.id} $active={activeTab === tab.id} onClick={() => setTab(tab.id)}>
              {tab.icon}
              <span>{tab.label}</span>
              {tab.id === "artifacts" && pkg.artifactViewers.length > 0 && (
                <Label variant="secondary" style={{ fontSize: 10, padding: "0 4px", lineHeight: "14px" }}>
                  {pkg.artifactViewers.length}
                </Label>
              )}
            </Tab>
          ))}
        </TabBar>

        {/* ── Body ── */}
        <ContentGrid>
          {/* ── Main column ── */}
          <div>
            {activeTab === "readme" && (
              <PackageReadmeTab
                name={name!}
                version={version!}
                rootClassName={pkg.rootClassName}
                rootClass={pkg.rootClass}
                packument={pkg.packument}
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
                onCompare={() => setTab("compare")}
              />
            )}

            {activeTab === "compare" && name && version && (
              <PackageCompareTab name={name} version={version} versionList={pkg.versionList} />
            )}

            {activeTab === "digital-thread" && (
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

            {activeTab === "artifacts" && (
              <PackageArtifactsTab
                name={name!}
                version={version!}
                availableDomains={pkg.availableDomains}
                artifactTabDomainFilter={artifactTabDomainFilter}
                setArtifactTabDomainFilter={setArtifactTabDomainFilter}
                displayedArtifactViewers={pkg.displayedArtifactViewers}
                fallbackArtifacts={pkg.artifacts}
              />
            )}

            {activeTab === "dependencies" && (
              <PackageDependenciesTab
                dependencies={pkg.dependencies}
                devDependencies={pkg.currentManifest?.devDependencies}
              />
            )}
          </div>

          {/* ── Sidebar ── */}
          <PackageRightSidebar
            name={name!}
            version={version!}
            installCmd={pkg.installCmd}
            packument={pkg.packument}
            libraryDetail={pkg.libraryDetail}
            currentManifest={pkg.currentManifest}
            publishedAt={pkg.publishedAt}
            contentHash={pkg.contentHash}
            packageSignature={pkg.packageSignature}
            availableDomains={pkg.availableDomains}
            packageStats={pkg.packageStats}
            dependents={pkg.dependents}
            packageOwner={pkg.packageOwner}
            collaborators={pkg.collaborators}
            canManage={pkg.canManage}
            onOpenManageCollaborators={() => {
              mgmt.setActionError(null);
              mgmt.setManageModal("collaborators");
            }}
            hasSalsaIndex={Boolean(pkg.libraryDetail?.salsaIndexed)}
          />
        </ContentGrid>
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
        onRemoveCollaborator={mgmt.handleRemoveCollaborator}
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

      {/* ── Background Ingestion & Indexer Logs ── */}
      {name && version && (
        <TerminalLogViewer
          packageName={name}
          packageVersion={version}
          jobId={pkg.jobInfo?.id}
          isProcessing={pkg.jobStatus === "pending" || pkg.jobStatus === "running"}
        />
      )}
    </PageWrap>
  );
};

export default PackageDetailPage;

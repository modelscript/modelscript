// SPDX-License-Identifier: AGPL-3.0-or-later

import { Flash } from "@primer/react";
import React from "react";
import Box from "../../components/Box";
import { DangerZoneSettingsSection } from "./settings/DangerZoneSettingsSection";
import { GeneralSettingsSection } from "./settings/GeneralSettingsSection";
import { GitVaultSettingsSection } from "./settings/GitVaultSettingsSection";
import { IntegrationsSettingsSection } from "./settings/IntegrationsSettingsSection";
import { MembersSettingsSection } from "./settings/MembersSettingsSection";
import { ModulesSettingsSection } from "./settings/ModulesSettingsSection";
import { PlmGovernanceSettingsSection } from "./settings/PlmGovernanceSettingsSection";
import { SettingsSidebar } from "./settings/SettingsSidebar";
import { SettingsLayout } from "./settings/styles";
import type { SpaceSettingsTabProps } from "./settings/types";
import { useSpaceSettings } from "./settings/useSpaceSettings";

export type { SpaceSettingsTabProps };

export const SpaceSettingsTab: React.FC<SpaceSettingsTabProps> = ({
  detail,
  viewerState,
  myOrgs,
  onSpaceUpdated,
  onMembersUpdated,
  onRefresh,
}) => {
  const { space, preset, members } = detail;
  const settings = useSpaceSettings({
    detail,
    myOrgs,
    onSpaceUpdated,
    onMembersUpdated,
    onRefresh,
  });

  return (
    <SettingsLayout>
      <SettingsSidebar
        activeSection={settings.activeSection}
        memberCount={members.length}
        onSelectSection={settings.setActiveSection}
      />

      <Box display="flex" flexDirection="column" gap={5}>
        {settings.savedMessage && (
          <Flash variant="success" style={{ marginBottom: "8px" }}>
            {settings.savedMessage}
          </Flash>
        )}
        {settings.saveError && (
          <Flash variant="danger" style={{ marginBottom: "8px" }}>
            {settings.saveError}
          </Flash>
        )}

        {settings.activeSection === "general" && (
          <GeneralSettingsSection
            space={space}
            canAdmin={viewerState.canAdmin}
            saving={settings.saving}
            onSaveSpacePatch={settings.handleSaveSpacePatch}
            {...settings.general}
          />
        )}

        {settings.activeSection === "access" && (
          <MembersSettingsSection
            canAdmin={viewerState.canAdmin}
            totalMembers={members.length}
            memberFilter={settings.access.memberFilter}
            setMemberFilter={settings.access.setMemberFilter}
            newMemberUsername={settings.access.newMemberUsername}
            setNewMemberUsername={settings.access.setNewMemberUsername}
            newMemberRole={settings.access.newMemberRole}
            setNewMemberRole={settings.access.setNewMemberRole}
            addingMember={settings.access.addingMember}
            filteredMembers={settings.access.filteredMembers}
            onAddMember={settings.access.handleAddMember}
            onRemoveMember={settings.access.handleRemoveMember}
            onChangeRole={settings.access.handleChangeRole}
          />
        )}

        {settings.activeSection === "git" && (
          <GitVaultSettingsSection
            space={space}
            preset={preset}
            canAdmin={viewerState.canAdmin}
            saving={settings.saving}
            defaultBranch={settings.git.defaultBranch}
            setDefaultBranch={settings.git.setDefaultBranch}
            requireEcoSignoff={settings.git.requireEcoSignoff}
            setRequireEcoSignoff={settings.git.setRequireEcoSignoff}
            requireSimCheck={settings.git.requireSimCheck}
            setRequireSimCheck={settings.git.setRequireSimCheck}
            requireSignedCommits={settings.git.requireSignedCommits}
            setRequireSignedCommits={settings.git.setRequireSignedCommits}
            cadDiffing={settings.git.cadDiffing}
            setCadDiffing={settings.git.setCadDiffing}
            daeDiffing={settings.git.daeDiffing}
            setDaeDiffing={settings.git.setDaeDiffing}
            autoIndexOnPush={settings.git.autoIndexOnPush}
            setAutoIndexOnPush={settings.git.setAutoIndexOnPush}
            copiedCloneUrl={settings.git.copiedCloneUrl}
            gitCloneUrl={settings.git.gitCloneUrl}
            onCopyCloneUrl={settings.git.handleCopyCloneUrl}
            onSaveSpacePatch={settings.handleSaveSpacePatch}
          />
        )}

        {settings.activeSection === "plm" && (
          <PlmGovernanceSettingsSection
            canAdmin={viewerState.canAdmin}
            onSavePolicy={() => settings.showSuccess("Governance and PLM sign-off policies updated.")}
            {...settings.plm}
          />
        )}

        {settings.activeSection === "features" && (
          <ModulesSettingsSection
            canAdmin={viewerState.canAdmin}
            saving={settings.saving}
            enableChat={settings.modules.enableChat}
            setEnableChat={settings.modules.setEnableChat}
            enableDocs={settings.modules.enableDocs}
            setEnableDocs={settings.modules.setEnableDocs}
            enablePlm={settings.modules.enablePlm}
            setEnablePlm={settings.modules.setEnablePlm}
            enableRepos={settings.modules.enableRepos}
            setEnableRepos={settings.modules.setEnableRepos}
            landingTab={settings.modules.landingTab}
            setLandingTab={settings.modules.setLandingTab}
            onSaveModules={settings.modules.handleSaveModules}
          />
        )}

        {settings.activeSection === "integrations" && (
          <IntegrationsSettingsSection
            canAdmin={viewerState.canAdmin}
            savedJira={settings.integrations.savedJira}
            jiraBaseUrl={settings.integrations.jiraBaseUrl}
            setJiraBaseUrl={settings.integrations.setJiraBaseUrl}
            jiraEmail={settings.integrations.jiraEmail}
            setJiraEmail={settings.integrations.setJiraEmail}
            jiraApiToken={settings.integrations.jiraApiToken}
            setJiraApiToken={settings.integrations.setJiraApiToken}
            jiraJql={settings.integrations.jiraJql}
            setJiraJql={settings.integrations.setJiraJql}
            jiraModelField={settings.integrations.jiraModelField}
            setJiraModelField={settings.integrations.setJiraModelField}
            jiraAutoComment={settings.integrations.jiraAutoComment}
            setJiraAutoComment={settings.integrations.setJiraAutoComment}
            testingJira={settings.integrations.testingJira}
            savingJira={settings.integrations.savingJira}
            onSaveJiraIntegration={settings.integrations.handleSaveJiraIntegration}
          />
        )}

        {settings.activeSection === "danger" && (
          <DangerZoneSettingsSection
            space={space}
            canAdmin={viewerState.canAdmin}
            myOrgs={myOrgs}
            currentUsername={settings.user ? settings.user.username : null}
            visibility={settings.danger.visibility}
            showVisibilityModal={settings.danger.showVisibilityModal}
            setShowVisibilityModal={settings.danger.setShowVisibilityModal}
            selectedNewVisibility={settings.danger.selectedNewVisibility}
            setSelectedNewVisibility={settings.danger.setSelectedNewVisibility}
            transferTargetType={settings.danger.transferTargetType}
            setTransferTargetType={settings.danger.setTransferTargetType}
            transferTargetSlug={settings.danger.transferTargetSlug}
            setTransferTargetSlug={settings.danger.setTransferTargetSlug}
            showTransferModal={settings.danger.showTransferModal}
            setShowTransferModal={settings.danger.setShowTransferModal}
            showDeleteModal={settings.danger.showDeleteModal}
            setShowDeleteModal={settings.danger.setShowDeleteModal}
            deleteConfirmSlug={settings.danger.deleteConfirmSlug}
            setDeleteConfirmSlug={settings.danger.setDeleteConfirmSlug}
            onConfirmVisibilityChange={settings.danger.handleConfirmVisibilityChange}
            onConfirmTransfer={settings.danger.handleConfirmTransfer}
            onConfirmDelete={settings.danger.handleConfirmDelete}
          />
        )}
      </Box>
    </SettingsLayout>
  );
};

export default SpaceSettingsTab;

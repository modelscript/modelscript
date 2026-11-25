// SPDX-License-Identifier: AGPL-3.0-or-later

import { DiffEditor } from "@monaco-editor/react";
import type React from "react";
import { useCallback } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AnsatzSemanticDiffStudio } from "../../components/diff/AnsatzSemanticDiffStudio";
import { useTheme } from "../../theme";
import { ensureMonacoThemesDefined, getMonacoThemeName } from "../../util/monaco-theme";
import { applyParameterConflictResolution } from "./change-control/badges";
import { EcoBlastRadiusCard } from "./change-control/EcoBlastRadiusCard";
import { EcoBomCard } from "./change-control/EcoBomCard";
import { EcoDetailHeader } from "./change-control/EcoDetailHeader";
import { EcoDetailSidebar } from "./change-control/EcoDetailSidebar";
import { EcoDiscussionCard } from "./change-control/EcoDiscussionCard";
import { EcoFilesChangedCard } from "./change-control/EcoFilesChangedCard";
import { EcoListView } from "./change-control/EcoListView";
import { EcoMergeBox } from "./change-control/EcoMergeBox";
import { EcoRationaleCard } from "./change-control/EcoRationaleCard";
import { EcoSimulationCard } from "./change-control/EcoSimulationCard";
import { NewEcoModal } from "./change-control/NewEcoModal";
import { SignatureModal } from "./change-control/SignatureModal";
import { PrSplitLayout, SpaceCockpitGrid } from "./change-control/styles";
import type { SpaceChangeControlTabProps } from "./change-control/types";
import { useChangeControlState } from "./change-control/useChangeControlState";

export {
  MasterDetailGrid,
  MergeBox,
  PrSectionCard,
  PrSplitLayout,
  PrTableRow,
  SpaceCardPanel,
  SpaceCockpitGrid,
  SpaceInspectorPanel,
  TimelineConnector,
  TimelineNode,
} from "./change-control/styles";
export type { SpaceChangeControlTabProps } from "./change-control/types";

const SIGNATORY_ROLE_OPTIONS: ReadonlyArray<string> = [
  "Lead Systems Architect",
  "Functional Safety Officer (ISO 26262 ASIL-D)",
  "Verification & Validation Engineer",
  "Chief Engineer / Release Authority",
  "Quality Assurance Specialist (21 CFR Part 11)",
];

const RELEASE_BUNDLES: ReadonlyArray<string> = ["AASX (IDTA v3.0)", "ISO 10303-242 DDP"];

export const SpaceChangeControlTab: React.FC<SpaceChangeControlTabProps> = ({
  detail,
  viewerState,
  user,
  onEcoCreated,
  onEcoReviewed,
}) => {
  const { theme } = useTheme();
  const preset = detail?.preset || { complianceStandards: ["ISO 26262", "21 CFR Part 11"] };

  // Section highlight / jump link state (keeps 'activeSubTab === "bom"' invariant satisfied)
  const {
    toast,
    viewMode,
    ecoSearchQuery,
    setEcoSearchQuery,
    ecoStatusFilter,
    setEcoStatusFilter,
    ecoSeverityFilter,
    setEcoSeverityFilter,
    ecoGateFilter,
    setEcoGateFilter,
    activeSection,
    scrollToSection,
    diffResult,
    setDiffResult,
    loadingDiff,
    selectedDiffFileIndex,
    setSelectedDiffFileIndex,
    diffSideBySide,
    setDiffSideBySide,
    diffStudioMode,
    setDiffStudioMode,
    focusedSemanticEdit,
    setFocusedSemanticEdit,
    activeDiffFile,
    simResult,
    loadingSim,
    reverifyingSim,
    impactResult,
    loadingImpact,
    bomResult,
    commentInput,
    setCommentInput,
    timelineComments,
    showSignatureModal,
    setShowSignatureModal,
    signingDecision,
    setSigningDecision,
    signingRole,
    setSigningRole,
    signingIntent,
    setSigningIntent,
    signingPassword,
    setSigningPassword,
    signingComment,
    setSigningComment,
    submittingSignature,
    mergingEco,
    mergeResult,
    showNewEcoForm,
    setShowNewEcoForm,
    newEcoTitle,
    setNewEcoTitle,
    newEcoDesc,
    setNewEcoDesc,
    newEcoSeverity,
    setNewEcoSeverity,
    newEcoModels,
    setNewEcoModels,
    newEcoSourceBranch,
    setNewEcoSourceBranch,
    newEcoTargetBranch,
    setNewEcoTargetBranch,
    metrics,
    filteredEcos,
    activeEco,
    handleSelectEco,
    handleBackToList,
    handleReverifySimulation,
    handleCreateEco,
    handleOpenSignatureModal,
    handleExecuteSignature,
    handleMergeEco,
    handleAddComment,
  } = useChangeControlState({
    detail,
    viewerState,
    user,
    onEcoCreated,
    onEcoReviewed,
  });

  const handleCopySignatureHex = useCallback(
    (signatureHex: string) => {
      void navigator.clipboard.writeText(signatureHex);
      toast.success("Copied Ed25519 signature hex");
    },
    [toast],
  );

  const handleResolveParameterConflict = useCallback(
    (paramName: string, val: number, strategy: string) => {
      if (activeDiffFile && diffResult) {
        const updated = applyParameterConflictResolution(activeDiffFile.newContent, paramName, val);
        const updatedFiles = [...diffResult.files];
        updatedFiles[selectedDiffFileIndex] = {
          ...activeDiffFile,
          newContent: updated,
        };
        setDiffResult({
          ...diffResult,
          files: updatedFiles,
        });
      }
      toast.showToast(`Reconciled '${paramName}' to ${val} via ${strategy} strategy (Applied to buffer)`, "success");
    },
    [activeDiffFile, diffResult, selectedDiffFileIndex, setDiffResult, toast],
  );

  const isMerged = activeEco?.status === "merged";
  const hasApprovedSig = activeEco?.approvals.some((a) => a.decision === "approved") ?? false;
  const hasBlockingSig =
    activeEco?.approvals.some((a) => a.decision === "changes_requested" || a.decision === "rejected") ?? false;
  const gatePassed = activeEco?.simulation_gate_status === "passed";
  const canMerge = !isMerged && gatePassed && hasApprovedSig && !hasBlockingSig;

  return (
    <div style={{ padding: "24px 32px", width: "100%", boxSizing: "border-box" }}>
      <SpaceCockpitGrid>
        {/* MODE 1: Full-Width Pull Requests List (GitHub Native Style) */}
        {viewMode === "list" && (
          <EcoListView
            filteredEcos={filteredEcos}
            metrics={metrics}
            canWrite={viewerState.canWrite}
            searchQuery={ecoSearchQuery}
            onSearchQueryChange={setEcoSearchQuery}
            statusFilter={ecoStatusFilter}
            onStatusFilterChange={setEcoStatusFilter}
            severityFilter={ecoSeverityFilter}
            onSeverityFilterChange={setEcoSeverityFilter}
            gateFilter={ecoGateFilter}
            onGateFilterChange={setEcoGateFilter}
            onSelectEco={handleSelectEco}
            onOpenNewEcoForm={() => setShowNewEcoForm(true)}
            newButtonLabel="+ New Change Request"
            telemetryLabels={{
              activeProposals: "Active Proposals",
              simulationGate: "DAE Simulation Gate",
              cryptographicSignOffs: "Ed25519 cryptographic",
            }}
          />
        )}

        {/* MODE 2: Vertically Stacked Primer / GitHub PR Timeline & Boxes */}
        {viewMode === "detail" && activeEco && (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px", width: "100%" }}>
            <EcoDetailHeader
              eco={activeEco}
              isMerged={isMerged}
              mergeResult={mergeResult}
              activeSection={activeSection}
              onBackToList={handleBackToList}
              onScrollToSection={scrollToSection}
              backLabel="All Change Requests"
            />

            {/* 2-Column PR Body Layout: 75% Vertically Stacked Cards + 25% PR Sidebar */}
            <PrSplitLayout>
              <div style={{ display: "flex", flexDirection: "column", gap: "28px", minWidth: 0 }}>
                <EcoRationaleCard eco={activeEco} />

                <EcoBlastRadiusCard
                  impactResult={impactResult}
                  loading={loadingImpact}
                  title="Salsa Computable Blast Radius & Traceability"
                />

                <EcoSimulationCard
                  eco={activeEco}
                  simResult={simResult}
                  loading={loadingSim}
                  reverifying={reverifyingSim}
                  canWrite={viewerState.canWrite}
                  focusedSemanticEdit={focusedSemanticEdit}
                  onReverify={handleReverifySimulation}
                  chartSlot={
                    simResult?.trajectories && simResult.trajectories.length > 0 ? (
                      <div style={{ width: "100%", height: "320px" }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={simResult.trajectories} margin={{ top: 12, right: 24, left: -6, bottom: 4 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-default)" opacity={0.6} />
                            <XAxis
                              dataKey="time"
                              tick={{ fontSize: 11, fill: "var(--color-fg-muted)" }}
                              unit="s"
                              stroke="var(--color-border-default)"
                            />
                            <YAxis
                              tick={{ fontSize: 11, fill: "var(--color-fg-muted)" }}
                              domain={[-1.2, 1.2]}
                              stroke="var(--color-border-default)"
                            />
                            <Tooltip
                              contentStyle={{
                                background: "var(--color-canvas-overlay, var(--ms-bg))",
                                borderColor: "var(--color-border-default)",
                                borderRadius: "6px",
                                fontSize: "12px",
                              }}
                            />
                            <Line
                              type="monotone"
                              dataKey="baseline"
                              stroke="#8c959f"
                              strokeDasharray="4 4"
                              dot={false}
                              name="Baseline"
                              strokeWidth={1.5}
                            />
                            <Line
                              type="monotone"
                              dataKey="branch"
                              stroke="#0969da"
                              dot={false}
                              name="Branch"
                              strokeWidth={2.4}
                            />
                            <Line
                              type="monotone"
                              dataKey="upperTolerance"
                              stroke="#1a7f37"
                              strokeDasharray="2 2"
                              dot={false}
                              name="Upper Margin"
                              strokeWidth={1}
                              opacity={0.6}
                            />
                            <Line
                              type="monotone"
                              dataKey="lowerTolerance"
                              stroke="#1a7f37"
                              strokeDasharray="2 2"
                              dot={false}
                              name="Lower Margin"
                              strokeWidth={1}
                              opacity={0.6}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    ) : null
                  }
                />

                <EcoFilesChangedCard
                  eco={activeEco}
                  diffResult={diffResult}
                  loading={loadingDiff}
                  selectedDiffFileIndex={selectedDiffFileIndex}
                  onSelectDiffFileIndex={setSelectedDiffFileIndex}
                  diffStudioMode={diffStudioMode}
                  onDiffStudioModeChange={setDiffStudioMode}
                  diffSideBySide={diffSideBySide}
                  onDiffSideBySideChange={setDiffSideBySide}
                >
                  {activeDiffFile &&
                    (diffStudioMode === "studio" ? (
                      <AnsatzSemanticDiffStudio
                        oldCode={activeDiffFile.oldContent}
                        newCode={activeDiffFile.newContent}
                        ancestorCode={activeDiffFile.ancestorContent}
                        filename={activeDiffFile.filename}
                        language={activeDiffFile.language || "modelica"}
                        baseLabel={activeEco.target_branch}
                        headLabel={activeEco.source_branch}
                        defaultSideBySide={diffSideBySide}
                        onSelectSemanticEdit={(edit) => setFocusedSemanticEdit(edit)}
                        onResolveParameterConflict={handleResolveParameterConflict}
                        onOpenDiagramWorkbench={() => {
                          toast.showToast(`Opening Diagram Workbench for ${activeDiffFile.filename}...`, "info");
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          borderRadius: "6px",
                          border: "1px solid var(--color-border-default)",
                          overflow: "hidden",
                          height: "480px",
                        }}
                      >
                        <DiffEditor
                          height="480px"
                          language={activeDiffFile.language || "modelica"}
                          original={activeDiffFile.oldContent}
                          modified={activeDiffFile.newContent}
                          theme={getMonacoThemeName(theme)}
                          beforeMount={ensureMonacoThemesDefined}
                          options={{
                            readOnly: true,
                            renderSideBySide: diffSideBySide,
                            automaticLayout: true,
                            minimap: { enabled: false },
                            scrollBeyondLastLine: false,
                            fontSize: 13,
                            lineHeight: 20,
                          }}
                        />
                      </div>
                    ))}
                </EcoFilesChangedCard>

                <EcoBomCard
                  bomResult={bomResult}
                  title="Declarative BOM Redline & Parameter Overrides"
                  metricLabels={{
                    parts: "Net Part Delta",
                    mass: "Net Mass Delta",
                    cost: "Unit Cost Delta",
                    carbon: "Net Carbon Impact",
                  }}
                />

                <EcoDiscussionCard
                  eco={activeEco}
                  gatePassed={gatePassed}
                  canWrite={viewerState.canWrite}
                  timelineComments={timelineComments}
                  commentInput={commentInput}
                  onCommentInputChange={setCommentInput}
                  onAddComment={handleAddComment}
                  onCopySignatureHex={handleCopySignatureHex}
                  title="Timeline, Discussion & Cryptographic Sign-Offs (Ed25519 Audit Trail)"
                />

                <EcoMergeBox
                  isMerged={isMerged}
                  canMerge={canMerge}
                  gatePassed={gatePassed}
                  hasApprovedSig={hasApprovedSig}
                  hasBlockingSig={hasBlockingSig}
                  canWrite={viewerState.canWrite}
                  mergingEco={mergingEco}
                  onOpenSignatureModal={handleOpenSignatureModal}
                  onMergeEco={handleMergeEco}
                  mergeButtonLabel="🚀 Merge ECO & Tag Release"
                  mergedBadgeLabel="Merged & Released"
                  releaseBundles={RELEASE_BUNDLES}
                />
              </div>

              <EcoDetailSidebar
                eco={activeEco}
                complianceStandards={preset.complianceStandards}
                sectionLabels={{
                  underChangeControl: "Under Change Control",
                  plmGovernance: "PLM Governance",
                }}
              />
            </PrSplitLayout>
          </div>
        )}
      </SpaceCockpitGrid>

      {showNewEcoForm && (
        <NewEcoModal
          title={newEcoTitle}
          onTitleChange={setNewEcoTitle}
          description={newEcoDesc}
          onDescriptionChange={setNewEcoDesc}
          severity={newEcoSeverity}
          onSeverityChange={setNewEcoSeverity}
          sourceBranch={newEcoSourceBranch}
          onSourceBranchChange={setNewEcoSourceBranch}
          targetBranch={newEcoTargetBranch}
          onTargetBranchChange={setNewEcoTargetBranch}
          models={newEcoModels}
          onModelsChange={setNewEcoModels}
          onClose={() => setShowNewEcoForm(false)}
          onSubmit={handleCreateEco}
        />
      )}

      {showSignatureModal && activeEco && (
        <SignatureModal
          eco={activeEco}
          decision={signingDecision}
          onDecisionChange={setSigningDecision}
          role={signingRole}
          onRoleChange={setSigningRole}
          intent={signingIntent}
          onIntentChange={setSigningIntent}
          comment={signingComment}
          onCommentChange={setSigningComment}
          password={signingPassword}
          onPasswordChange={setSigningPassword}
          submitting={submittingSignature}
          onClose={() => setShowSignatureModal(false)}
          onSubmit={handleExecuteSignature}
          title="21 CFR Part 11 / ISO 26262 Electronic Signature"
          roleOptions={SIGNATORY_ROLE_OPTIONS}
          identificationNotice="Dual-component identification binds this cryptographic signature directly to your identity."
        />
      )}
    </div>
  );
};

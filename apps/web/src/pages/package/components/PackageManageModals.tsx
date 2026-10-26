// SPDX-License-Identifier: AGPL-3.0-or-later

import { PlusIcon, TrashIcon } from "@primer/octicons-react";
import { Button, Dialog, Flash, Label, Select, Spinner, Text, TextInput } from "@primer/react";
import React from "react";
import type { CollaboratorPermission, PackageCollaborator } from "../../../api";
import Box from "../../../components/Box";

export type ManageModalType = "yank" | "deprecate" | "collaborators" | "transfer" | "unpublish" | null;

export interface PackageManageModalsProps {
  manageModal: ManageModalType;
  setManageModal: (modal: ManageModalType) => void;
  name: string;
  version: string;
  isCurrentYanked: boolean;
  yankReasonInput: string;
  setYankReasonInput: (val: string) => void;
  onToggleYank: () => void;
  isCurrentDeprecated: boolean;
  deprecateReasonInput: string;
  setDeprecateReasonInput: (val: string) => void;
  onToggleDeprecate: () => void;
  transferTargetInput: string;
  setTransferTargetInput: (val: string) => void;
  onTransfer: () => void;
  collaboratorUsernameInput: string;
  setCollaboratorUsernameInput: (val: string) => void;
  collaboratorPermissionInput: CollaboratorPermission;
  setCollaboratorPermissionInput: (val: CollaboratorPermission) => void;
  onAddCollaborator: (e: React.FormEvent) => void;
  onRemoveCollaborator: (username: string) => void;
  collaborators: PackageCollaborator[];
  packageOwner?: string | null | undefined;
  onUnpublish: () => void;
  actionLoading: boolean;
  actionError?: string | null | undefined;
}

export const PackageManageModals: React.FC<PackageManageModalsProps> = ({
  manageModal,
  setManageModal,
  name,
  version,
  isCurrentYanked,
  yankReasonInput,
  setYankReasonInput,
  onToggleYank,
  isCurrentDeprecated,
  deprecateReasonInput,
  setDeprecateReasonInput,
  onToggleDeprecate,
  transferTargetInput,
  setTransferTargetInput,
  onTransfer,
  collaboratorUsernameInput,
  setCollaboratorUsernameInput,
  collaboratorPermissionInput,
  setCollaboratorPermissionInput,
  onAddCollaborator,
  onRemoveCollaborator,
  collaborators,
  packageOwner,
  onUnpublish,
  actionLoading,
  actionError,
}) => {
  if (!manageModal) return null;

  return (
    <>
      {manageModal === "yank" && (
        <Dialog
          title={isCurrentYanked ? `Restore Release v${version}` : `Yank Release v${version}`}
          onClose={() => setManageModal(null)}
        >
          <Box p={3} display="flex" flexDirection="column" gap={3}>
            <Text style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
              {isCurrentYanked
                ? `Restoring this release will remove the yank warning and make v${version} visible in normal index listings.`
                : `Yanking marks v${version} as discouraged and hides it from search. Existing projects depending on this version will still be able to resolve it.`}
            </Text>
            {!isCurrentYanked && (
              <Box>
                <Text style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>
                  Reason for yanking
                </Text>
                <TextInput
                  block
                  placeholder="e.g. Critical security bug or broken dependency"
                  value={yankReasonInput}
                  onChange={(e) => setYankReasonInput(e.target.value)}
                />
              </Box>
            )}
            {actionError && <Flash variant="danger">{actionError}</Flash>}
            <Box display="flex" justifyContent="flex-end" gap={2} mt={2}>
              <Button onClick={() => setManageModal(null)}>Cancel</Button>
              <Button variant={isCurrentYanked ? "primary" : "danger"} onClick={onToggleYank} disabled={actionLoading}>
                {actionLoading ? <Spinner size="small" /> : isCurrentYanked ? "Restore Release" : "Yank Release"}
              </Button>
            </Box>
          </Box>
        </Dialog>
      )}

      {manageModal === "deprecate" && (
        <Dialog
          title={isCurrentDeprecated ? `Remove Deprecation from v${version}` : `Deprecate Release v${version}`}
          onClose={() => setManageModal(null)}
        >
          <Box p={3} display="flex" flexDirection="column" gap={3}>
            <Text style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
              {isCurrentDeprecated
                ? `Removing deprecation will clear the warning banner on v${version}.`
                : `Deprecating v${version} displays a warning banner informing users to migrate to a newer version.`}
            </Text>
            {!isCurrentDeprecated && (
              <Box>
                <Text style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>
                  Deprecation message
                </Text>
                <TextInput
                  block
                  placeholder="e.g. Please upgrade to v2.0.0; this version is no longer maintained."
                  value={deprecateReasonInput}
                  onChange={(e) => setDeprecateReasonInput(e.target.value)}
                />
              </Box>
            )}
            {actionError && <Flash variant="danger">{actionError}</Flash>}
            <Box display="flex" justifyContent="flex-end" gap={2} mt={2}>
              <Button onClick={() => setManageModal(null)}>Cancel</Button>
              <Button variant="primary" onClick={onToggleDeprecate} disabled={actionLoading}>
                {actionLoading ? (
                  <Spinner size="small" />
                ) : isCurrentDeprecated ? (
                  "Remove Deprecation"
                ) : (
                  "Deprecate Release"
                )}
              </Button>
            </Box>
          </Box>
        </Dialog>
      )}

      {manageModal === "transfer" && (
        <Dialog title="Transfer Package Ownership" onClose={() => setManageModal(null)}>
          <Box p={3} display="flex" flexDirection="column" gap={3}>
            <Text style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
              Initiate an ownership transfer of <strong>{name}</strong> to another registered user. The transfer will
              remain pending until the recipient accepts it.
            </Text>
            <Box>
              <Text style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>
                Recipient username
              </Text>
              <TextInput
                block
                placeholder="e.g. alice"
                value={transferTargetInput}
                onChange={(e) => setTransferTargetInput(e.target.value)}
              />
            </Box>
            {actionError && <Flash variant="danger">{actionError}</Flash>}
            <Box display="flex" justifyContent="flex-end" gap={2} mt={2}>
              <Button onClick={() => setManageModal(null)}>Cancel</Button>
              <Button variant="primary" onClick={onTransfer} disabled={actionLoading || !transferTargetInput.trim()}>
                {actionLoading ? <Spinner size="small" /> : "Send Transfer Request"}
              </Button>
            </Box>
          </Box>
        </Dialog>
      )}

      {manageModal === "collaborators" && (
        <Dialog title={`Collaborators & Permissions — ${name}`} onClose={() => setManageModal(null)} width="large">
          <Box p={3} display="flex" flexDirection="column" gap={3}>
            <Text style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
              Grant team members granular access to <strong>{name}</strong>. <code>write</code> allows publishing and
              deprecating releases; <code>admin</code> also allows managing collaborators.
            </Text>

            <form onSubmit={onAddCollaborator} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <TextInput
                placeholder="Username (e.g. bob)"
                value={collaboratorUsernameInput}
                onChange={(e) => setCollaboratorUsernameInput(e.target.value)}
                style={{ flex: 1 }}
              />
              <Select
                value={collaboratorPermissionInput}
                onChange={(e) => setCollaboratorPermissionInput(e.target.value as CollaboratorPermission)}
                aria-label="Collaborator permission"
              >
                <Select.Option value="read">read</Select.Option>
                <Select.Option value="write">write</Select.Option>
                <Select.Option value="admin">admin</Select.Option>
              </Select>
              <Button
                type="submit"
                variant="primary"
                leadingVisual={PlusIcon}
                disabled={actionLoading || !collaboratorUsernameInput.trim()}
              >
                Add
              </Button>
            </form>

            {actionError && <Flash variant="danger">{actionError}</Flash>}

            <Box
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                overflow: "hidden",
              }}
            >
              {packageOwner && (
                <Box
                  display="flex"
                  alignItems="center"
                  justifyContent="space-between"
                  p={2}
                  style={{ borderBottom: collaborators.length > 0 ? "1px solid var(--color-border)" : "none" }}
                >
                  <Box display="flex" alignItems="center" gap={2}>
                    <Text style={{ fontWeight: 600, fontSize: 13 }}>@{packageOwner}</Text>
                    <Label variant="accent" style={{ fontSize: 10 }}>
                      owner
                    </Label>
                  </Box>
                  <Text style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Full package control</Text>
                </Box>
              )}

              {collaborators.length > 0 ? (
                collaborators.map((collab) => (
                  <Box
                    key={collab.username}
                    display="flex"
                    alignItems="center"
                    justifyContent="space-between"
                    p={2}
                    style={{ borderBottom: "1px solid var(--color-border)" }}
                  >
                    <Box display="flex" alignItems="center" gap={2}>
                      <Text style={{ fontWeight: 600, fontSize: 13 }}>@{collab.username}</Text>
                      <Label
                        variant={
                          collab.permission === "admin"
                            ? "attention"
                            : collab.permission === "write"
                              ? "success"
                              : "secondary"
                        }
                        style={{ fontSize: 10 }}
                      >
                        {collab.permission}
                      </Label>
                    </Box>
                    <Button
                      size="small"
                      variant="danger"
                      leadingVisual={TrashIcon}
                      disabled={actionLoading}
                      onClick={() => onRemoveCollaborator(collab.username)}
                    >
                      Remove
                    </Button>
                  </Box>
                ))
              ) : (
                <Box p={3} style={{ textAlign: "center" }}>
                  <Text style={{ fontSize: 13, color: "var(--color-text-muted)", fontStyle: "italic" }}>
                    No additional collaborators added yet.
                  </Text>
                </Box>
              )}
            </Box>

            <Box display="flex" justifyContent="flex-end" mt={1}>
              <Button onClick={() => setManageModal(null)}>Done</Button>
            </Box>
          </Box>
        </Dialog>
      )}

      {manageModal === "unpublish" && (
        <Dialog title={`Unpublish ${name}@${version}`} onClose={() => setManageModal(null)}>
          <Box p={3} display="flex" flexDirection="column" gap={3}>
            <Text style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
              Are you sure you want to permanently unpublish{" "}
              <strong>
                {name}@{version}
              </strong>
              ? Unlike yanking, unpublishing removes the archive and indexed classes from the registry.
            </Text>
            {actionError && <Flash variant="danger">{actionError}</Flash>}
            <Box display="flex" justifyContent="flex-end" gap={2} mt={2}>
              <Button onClick={() => setManageModal(null)}>Cancel</Button>
              <Button variant="danger" onClick={onUnpublish} disabled={actionLoading}>
                {actionLoading ? <Spinner size="small" /> : `Unpublish v${version}`}
              </Button>
            </Box>
          </Box>
        </Dialog>
      )}
    </>
  );
};

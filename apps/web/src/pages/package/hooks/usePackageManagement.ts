// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState } from "react";
import {
  acceptPackageTransfer,
  addPackageCollaborator,
  cancelPackageTransfer,
  deprecatePackage,
  removePackageCollaborator,
  transferPackageOwnership,
  undeprecatePackage,
  unpublishPackageRelease,
  unyankPackage,
  yankPackage,
  type CollaboratorPermission,
} from "../../../api";
import type { ManageModalType } from "../components/PackageManageModals";

export interface UsePackageManagementOptions {
  name?: string;
  version?: string;
  isCurrentYanked: boolean;
  isCurrentDeprecated: boolean;
  fetchData: () => Promise<void>;
  navigate: (path: string) => void;
}

export function usePackageManagement({
  name,
  version,
  isCurrentYanked,
  isCurrentDeprecated,
  fetchData,
  navigate,
}: UsePackageManagementOptions) {
  const [manageModal, setManageModal] = useState<ManageModalType>(null);
  const [yankReasonInput, setYankReasonInput] = useState("");
  const [deprecateReasonInput, setDeprecateReasonInput] = useState("");
  const [transferTargetInput, setTransferTargetInput] = useState("");
  const [collaboratorUsernameInput, setCollaboratorUsernameInput] = useState("");
  const [collaboratorPermissionInput, setCollaboratorPermissionInput] = useState<CollaboratorPermission>("write");

  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const handleToggleYank = async () => {
    if (!name || !version) return;
    setActionLoading(true);
    setActionError(null);
    try {
      if (isCurrentYanked) {
        await unyankPackage(name, version);
        setActionSuccess(`Release v${version} has been restored (unyanked).`);
      } else {
        await yankPackage(name, version, yankReasonInput.trim() || "Yanked by maintainer");
        setActionSuccess(`Release v${version} has been yanked.`);
      }
      setManageModal(null);
      setYankReasonInput("");
      await fetchData();
    } catch (err: unknown) {
      const e = err as {
        response?: { data?: { error?: string | undefined } | undefined } | undefined;
        message?: string | undefined;
      };
      setActionError(e.response?.data?.error || e.message || "Failed to update yank status");
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleDeprecate = async () => {
    if (!name || !version) return;
    setActionLoading(true);
    setActionError(null);
    try {
      if (isCurrentDeprecated) {
        await undeprecatePackage(name, version);
        setActionSuccess(`Deprecation removed from release v${version}.`);
      } else {
        await deprecatePackage(name, version, deprecateReasonInput.trim() || "Deprecated by maintainer");
        setActionSuccess(`Release v${version} has been marked as deprecated.`);
      }
      setManageModal(null);
      setDeprecateReasonInput("");
      await fetchData();
    } catch (err: unknown) {
      const e = err as {
        response?: { data?: { error?: string | undefined } | undefined } | undefined;
        message?: string | undefined;
      };
      setActionError(e.response?.data?.error || e.message || "Failed to update deprecation status");
    } finally {
      setActionLoading(false);
    }
  };

  const handleTransfer = async () => {
    if (!name || !transferTargetInput.trim()) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await transferPackageOwnership(name, transferTargetInput.trim());
      setActionSuccess(`Ownership transfer request sent to @${transferTargetInput.trim()}.`);
      setManageModal(null);
      setTransferTargetInput("");
      await fetchData();
    } catch (err: unknown) {
      const e = err as {
        response?: { data?: { error?: string | undefined } | undefined } | undefined;
        message?: string | undefined;
      };
      setActionError(e.response?.data?.error || e.message || "Failed to transfer ownership");
    } finally {
      setActionLoading(false);
    }
  };

  const handleAcceptPendingTransfer = async (transferId: number) => {
    if (!name) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await acceptPackageTransfer(name, transferId);
      setActionSuccess(`You have accepted ownership of ${name}.`);
      await fetchData();
    } catch (err: unknown) {
      const e = err as {
        response?: { data?: { error?: string | undefined } | undefined } | undefined;
        message?: string | undefined;
      };
      setActionError(e.response?.data?.error || e.message || "Failed to accept transfer");
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelPendingTransfer = async (transferId: number) => {
    if (!name) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await cancelPackageTransfer(name, transferId);
      setActionSuccess(`Pending ownership transfer for ${name} has been cancelled.`);
      await fetchData();
    } catch (err: unknown) {
      const e = err as {
        response?: { data?: { error?: string | undefined } | undefined } | undefined;
        message?: string | undefined;
      };
      setActionError(e.response?.data?.error || e.message || "Failed to cancel transfer");
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddCollaborator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !collaboratorUsernameInput.trim()) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const targetUser = collaboratorUsernameInput.trim().replace(/^@/, "");
      await addPackageCollaborator(name, targetUser, collaboratorPermissionInput);
      setCollaboratorUsernameInput("");
      setActionSuccess(`Collaborator @${targetUser} granted '${collaboratorPermissionInput}' access.`);
      await fetchData();
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { data?: { error?: string | undefined } | undefined } | undefined;
        message?: string | undefined;
      };
      setActionError(axiosErr.response?.data?.error || axiosErr.message || "Failed to add collaborator");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemoveCollaborator = async (usernameToRemove: string) => {
    if (!name) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await removePackageCollaborator(name, usernameToRemove);
      setActionSuccess(`Removed collaborator @${usernameToRemove}.`);
      await fetchData();
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { data?: { error?: string | undefined } | undefined } | undefined;
        message?: string | undefined;
      };
      setActionError(axiosErr.response?.data?.error || axiosErr.message || "Failed to remove collaborator");
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnpublish = async () => {
    if (!name || !version) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await unpublishPackageRelease(name, version);
      setManageModal(null);
      navigate("/packages");
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { data?: { error?: string | undefined } | undefined } | undefined;
        message?: string | undefined;
      };
      setActionError(axiosErr.response?.data?.error || axiosErr.message || "Failed to unpublish release");
    } finally {
      setActionLoading(false);
    }
  };

  return {
    manageModal,
    setManageModal,
    yankReasonInput,
    setYankReasonInput,
    deprecateReasonInput,
    setDeprecateReasonInput,
    transferTargetInput,
    setTransferTargetInput,
    collaboratorUsernameInput,
    setCollaboratorUsernameInput,
    collaboratorPermissionInput,
    setCollaboratorPermissionInput,
    actionLoading,
    actionError,
    setActionError,
    actionSuccess,
    setActionSuccess,
    handleToggleYank,
    handleToggleDeprecate,
    handleTransfer,
    handleAcceptPendingTransfer,
    handleCancelPendingTransfer,
    handleAddCollaborator,
    handleRemoveCollaborator,
    handleUnpublish,
  };
}

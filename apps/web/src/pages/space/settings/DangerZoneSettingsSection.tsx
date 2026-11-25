// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Dialog, Heading, Text, TextInput } from "@primer/react";
import React from "react";
import type { Organization, SpaceOwnerType, SpaceRecord, SpaceVisibility } from "../../../api";
import Box from "../../../components/Box";
import { DangerCard, DangerRow, FieldLabel, FormRow } from "./styles";
import { VISIBILITY_OPTIONS } from "./types";

export interface DangerZoneSettingsSectionProps {
  space: SpaceRecord;
  canAdmin: boolean;
  myOrgs: Organization[];
  currentUsername: string | null;
  visibility: SpaceVisibility;
  showVisibilityModal: boolean;
  setShowVisibilityModal: (show: boolean) => void;
  selectedNewVisibility: SpaceVisibility;
  setSelectedNewVisibility: (value: SpaceVisibility) => void;
  transferTargetType: SpaceOwnerType;
  setTransferTargetType: (value: SpaceOwnerType) => void;
  transferTargetSlug: string;
  setTransferTargetSlug: (value: string) => void;
  showTransferModal: boolean;
  setShowTransferModal: (show: boolean) => void;
  showDeleteModal: boolean;
  setShowDeleteModal: (show: boolean) => void;
  deleteConfirmSlug: string;
  setDeleteConfirmSlug: (value: string) => void;
  onConfirmVisibilityChange: () => Promise<void>;
  onConfirmTransfer: () => Promise<void>;
  onConfirmDelete: () => Promise<void>;
}

export const DangerZoneSettingsSection: React.FC<DangerZoneSettingsSectionProps> = ({
  space,
  canAdmin,
  myOrgs,
  currentUsername,
  visibility,
  showVisibilityModal,
  setShowVisibilityModal,
  selectedNewVisibility,
  setSelectedNewVisibility,
  transferTargetType,
  setTransferTargetType,
  transferTargetSlug,
  setTransferTargetSlug,
  showTransferModal,
  setShowTransferModal,
  showDeleteModal,
  setShowDeleteModal,
  deleteConfirmSlug,
  setDeleteConfirmSlug,
  onConfirmVisibilityChange,
  onConfirmTransfer,
  onConfirmDelete,
}) => (
  <>
    <Box display="flex" flexDirection="column" gap={4}>
      <Box>
        <Heading
          as="h2"
          style={{
            fontSize: "24px",
            color: "var(--color-danger-fg)",
            borderBottom: "1px solid var(--color-danger-muted)",
            paddingBottom: "8px",
            marginBottom: "8px",
          }}
        >
          Danger Zone
        </Heading>
        <Text color="var(--color-fg-muted)" style={{ fontSize: "13px", display: "block", marginBottom: "20px" }}>
          Irreversible administrative actions for Space container governance, ownership, and deletion.
        </Text>

        <DangerCard>
          {/* 1. Change Visibility */}
          <DangerRow>
            <Box>
              <Text style={{ fontWeight: 700, fontSize: "14px", display: "block" }}>Change Space Visibility</Text>
              <Text color="var(--color-fg-muted)" style={{ fontSize: "12.5px", marginTop: "2px" }}>
                This Space is currently <strong>{visibility.toUpperCase()}</strong>.
              </Text>
            </Box>
            <Button
              variant="danger"
              disabled={!canAdmin}
              onClick={() => {
                setSelectedNewVisibility(visibility);
                setShowVisibilityModal(true);
              }}
            >
              Change visibility
            </Button>
          </DangerRow>

          {/* 2. Transfer Ownership */}
          <DangerRow>
            <Box>
              <Text style={{ fontWeight: 700, fontSize: "14px", display: "block" }}>Transfer Container Ownership</Text>
              <Text color="var(--color-fg-muted)" style={{ fontSize: "12.5px", marginTop: "2px" }}>
                Graduate a personal Space into an Organization container, or relocate between namespaces.
              </Text>
            </Box>
            <Button variant="danger" disabled={!canAdmin} onClick={() => setShowTransferModal(true)}>
              Transfer ownership
            </Button>
          </DangerRow>

          {/* 3. Delete Space */}
          <DangerRow>
            <Box>
              <Text style={{ fontWeight: 700, fontSize: "14px", display: "block" }}>Delete this Space</Text>
              <Text color="var(--color-fg-muted)" style={{ fontSize: "12.5px", marginTop: "2px" }}>
                Once you delete a Space, there is no going back. All living docs, ECO proposals, chat channels, and the
                backing Git repository will be permanently deleted.
              </Text>
            </Box>
            <Button
              variant="danger"
              disabled={!canAdmin}
              onClick={() => {
                setDeleteConfirmSlug("");
                setShowDeleteModal(true);
              }}
            >
              Delete this space
            </Button>
          </DangerRow>
        </DangerCard>
      </Box>
    </Box>

    {/* ── Dialog: Change Space Visibility ── */}
    {showVisibilityModal && (
      <Dialog onClose={() => setShowVisibilityModal(false)} title="Change Space Visibility">
        <Box p={3} display="flex" flexDirection="column" gap={3}>
          <Text style={{ fontSize: "13.5px" }}>
            Select the new visibility level for <strong>{space.name}</strong>:
          </Text>
          <Box display="flex" flexDirection="column" gap={2}>
            {VISIBILITY_OPTIONS.map((opt) => (
              <label
                key={opt.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "10px",
                  borderRadius: "6px",
                  border: "1px solid var(--color-border-default)",
                  background: selectedNewVisibility === opt.id ? "rgba(59, 130, 246, 0.08)" : "transparent",
                  cursor: "pointer",
                }}
              >
                <input
                  type="radio"
                  name="space-visibility"
                  value={opt.id}
                  checked={selectedNewVisibility === opt.id}
                  onChange={() => setSelectedNewVisibility(opt.id)}
                  style={{ marginTop: "3px" }}
                />
                <Box>
                  <Text style={{ fontWeight: 700, fontSize: "13.5px", display: "block" }}>{opt.label}</Text>
                  <Text color="var(--color-fg-muted)" style={{ fontSize: "12px" }}>
                    {opt.desc}
                  </Text>
                </Box>
              </label>
            ))}
          </Box>
          <Box display="flex" justifyContent="flex-end" gap={2} mt={3}>
            <Button onClick={() => setShowVisibilityModal(false)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={selectedNewVisibility === visibility}
              onClick={() => void onConfirmVisibilityChange()}
            >
              Confirm Visibility Change
            </Button>
          </Box>
        </Box>
      </Dialog>
    )}

    {/* ── Dialog: Transfer Ownership ── */}
    {showTransferModal && (
      <Dialog onClose={() => setShowTransferModal(false)} title="Transfer Container Ownership">
        <Box p={3} display="flex" flexDirection="column" gap={3}>
          <Text style={{ fontSize: "13.5px" }}>
            Relocate <strong>{space.name}</strong> to an Organization container or your personal profile. The backing
            Git Vault and all references will be transferred automatically.
          </Text>
          <FormRow>
            <FieldLabel>Target Container Type</FieldLabel>
            <select
              value={transferTargetType}
              onChange={(e) => {
                const nextType = e.target.value as SpaceOwnerType;
                setTransferTargetType(nextType);
                if (nextType === "user" && currentUsername) {
                  setTransferTargetSlug(currentUsername);
                } else if (nextType === "organization" && myOrgs[0]) {
                  setTransferTargetSlug(myOrgs[0].slug);
                }
              }}
              style={{
                padding: "8px 12px",
                borderRadius: "6px",
                border: "1px solid var(--color-border-default)",
                background: "var(--color-canvas-default)",
                color: "var(--color-fg-default)",
                fontSize: "13.5px",
              }}
            >
              <option value="organization">🏢 Organization Container</option>
              <option value="user">👤 Personal Profile</option>
            </select>
          </FormRow>
          <FormRow>
            <FieldLabel>Target Namespace @slug</FieldLabel>
            <TextInput
              placeholder="e.g. aether-dynamics or username"
              value={transferTargetSlug}
              onChange={(e) => setTransferTargetSlug(e.target.value)}
              block
            />
          </FormRow>
          <Box display="flex" justifyContent="flex-end" gap={2} mt={3}>
            <Button onClick={() => setShowTransferModal(false)}>Cancel</Button>
            <Button variant="danger" disabled={!transferTargetSlug.trim()} onClick={() => void onConfirmTransfer()}>
              Transfer Space →
            </Button>
          </Box>
        </Box>
      </Dialog>
    )}

    {/* ── Dialog: Delete Space ── */}
    {showDeleteModal && (
      <Dialog onClose={() => setShowDeleteModal(false)} title="Delete Space Container">
        <Box p={3} display="flex" flexDirection="column" gap={3}>
          <Text color="var(--color-danger-fg)" style={{ fontSize: "13.5px", lineHeight: 1.4 }}>
            This action <strong>cannot</strong> be undone. This will permanently delete the{" "}
            <strong>{space.name}</strong> Space (@{space.owner_namespace}/{space.slug}), along with all Living
            Architecture Docs, ECO approval history, channel messages, and the backing Git repository.
          </Text>
          <Text style={{ fontSize: "13px" }}>
            Please type <strong>{space.slug}</strong> to confirm:
          </Text>
          <TextInput
            value={deleteConfirmSlug}
            onChange={(e) => setDeleteConfirmSlug(e.target.value)}
            placeholder={space.slug}
            block
          />
          <Box display="flex" justifyContent="flex-end" gap={2} mt={3}>
            <Button onClick={() => setShowDeleteModal(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => void onConfirmDelete()}
              disabled={deleteConfirmSlug.trim().toLowerCase() !== space.slug.toLowerCase()}
            >
              I understand the consequences, delete this space
            </Button>
          </Box>
        </Box>
      </Dialog>
    )}
  </>
);

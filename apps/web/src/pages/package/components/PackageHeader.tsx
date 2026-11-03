// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertFillIcon,
  AlertIcon,
  GearIcon,
  PeopleIcon,
  PlusIcon,
  SidebarExpandIcon,
  SyncIcon,
  TrashIcon,
} from "@primer/octicons-react";
import { ActionList, ActionMenu, Button, Flash, Heading, IconButton, Label, Text } from "@primer/react";
import React from "react";
import { useNavigate } from "react-router-dom";
import { getIconUrl, type PackageCollaborator, type PendingPackageTransfer } from "../../../api";
import Box from "../../../components/Box";
import Breadcrumbs from "../../../components/Breadcrumbs";
import InvertedSvg from "../../../components/InvertedSvg";
import { HeaderBar, timeAgo } from "../types";
import type { ManageModalType } from "./PackageManageModals";

export interface PackageHeaderProps {
  name: string;
  version: string;
  rootClassName?: string | null;
  description?: string | null;
  publishedAt?: string | null;
  license?: string | null | undefined;
  classCount?: number | undefined;
  canManage: boolean;
  isCurrentYanked: boolean;
  currentYankReason?: string | null;
  isCurrentDeprecated: boolean;
  currentDeprecateReason?: string | null;
  pendingTransfers: PendingPackageTransfer[];
  user: { id: number; username: string } | null;
  actionSuccess: string | null;
  setActionSuccess: (msg: string | null) => void;
  actionLoading: boolean;
  setActionError: (msg: string | null) => void;
  collaborators: PackageCollaborator[];
  setPublishModalOpen: (open: boolean) => void;
  setManageModal: (modal: ManageModalType) => void;
  onAcceptPendingTransfer: (transferId: number) => void;
  onCancelPendingTransfer: (transferId: number) => void;
  versionList?: string[] | undefined;
  treeCollapsed?: boolean | undefined;
  onToggleTreeCollapse?: (() => void) | undefined;
}

export const PackageHeader: React.FC<PackageHeaderProps> = ({
  name,
  version,
  rootClassName,
  description,
  publishedAt,
  license,
  classCount,
  canManage,
  isCurrentYanked,
  currentYankReason,
  isCurrentDeprecated,
  currentDeprecateReason,
  pendingTransfers,
  user,
  actionSuccess,
  setActionSuccess,
  actionLoading,
  setActionError,
  collaborators,
  setPublishModalOpen,
  setManageModal,
  onAcceptPendingTransfer,
  onCancelPendingTransfer,
  versionList,
  treeCollapsed,
  onToggleTreeCollapse,
}) => {
  const navigate = useNavigate();
  const isLatestVersion = Boolean(versionList && versionList.length > 0 && versionList[0] === version);

  return (
    <>
      <HeaderBar>
        <Box mb={3} display="flex" alignItems="center" gap="8px">
          {treeCollapsed && onToggleTreeCollapse && (
            <IconButton
              icon={SidebarExpandIcon}
              size="small"
              variant="invisible"
              onClick={onToggleTreeCollapse}
              aria-label="Browse symbols"
              title="Browse symbols"
              style={{ color: "var(--color-accent-cyan, #06b6d4)" }}
            />
          )}
          <Breadcrumbs
            items={[
              { label: "Packages", href: "/packages" },
              { label: name || "", href: `/packages/${name}` },
              { label: `v${version}` },
            ]}
          />
        </Box>
        <Box display="flex" alignItems="flex-start" justifyContent="space-between" gap="16px" mb={3} flexWrap="wrap">
          <Box display="flex" alignItems="center" gap="16px" style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 12,
                background: "var(--color-canvas-subtle, rgba(255,255,255,0.04))",
                border: "1px solid var(--color-border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <InvertedSvg
                src={getIconUrl(name, version, rootClassName || name)}
                alt=""
                width={38}
                height={38}
                style={{ flexShrink: 0 }}
              />
            </div>
            <Box style={{ minWidth: 0 }}>
              <Box display="flex" alignItems="center" gap="8px" flexWrap="wrap">
                <Heading
                  as="h1"
                  style={{
                    color: "var(--color-text-heading)",
                    fontWeight: 700,
                    fontSize: 26,
                    lineHeight: 1.2,
                    margin: 0,
                  }}
                >
                  {name}
                </Heading>
                {versionList && versionList.length > 1 ? (
                  <ActionMenu>
                    <ActionMenu.Button
                      size="small"
                      style={{
                        fontSize: 12,
                        padding: "2px 8px",
                        fontWeight: 600,
                        fontFamily: "var(--font-mono, monospace)",
                        borderRadius: 6,
                        background: "var(--color-canvas-subtle)",
                        border: "1px solid var(--color-border)",
                        color: "var(--color-text-primary)",
                        cursor: "pointer",
                      }}
                    >
                      v{version}
                    </ActionMenu.Button>
                    <ActionMenu.Overlay align="start">
                      <ActionList style={{ maxHeight: 260, overflowY: "auto" }}>
                        <ActionList.Group title="Release Versions">
                          {versionList.map((v) => (
                            <ActionList.Item
                              key={v}
                              selected={v === version}
                              onSelect={() => {
                                if (v !== version) {
                                  navigate(`/packages/${name}/${v}`);
                                }
                              }}
                            >
                              v{v}
                              {v === versionList[0] && (
                                <ActionList.TrailingVisual>
                                  <Label variant="accent" style={{ fontSize: 10 }}>
                                    latest
                                  </Label>
                                </ActionList.TrailingVisual>
                              )}
                            </ActionList.Item>
                          ))}
                        </ActionList.Group>
                      </ActionList>
                    </ActionMenu.Overlay>
                  </ActionMenu>
                ) : (
                  <Label
                    variant="secondary"
                    style={{ fontSize: 12, padding: "2px 8px", fontFamily: "var(--font-mono, monospace)" }}
                  >
                    v{version}
                  </Label>
                )}
                {isLatestVersion && (
                  <Label variant="success" style={{ fontSize: 11, padding: "0 6px" }}>
                    latest
                  </Label>
                )}
              </Box>
              {description && (
                <Text as="p" style={{ color: "var(--color-text-muted)", fontSize: 14, margin: "4px 0 0" }}>
                  {description}
                </Text>
              )}
              <Box display="flex" alignItems="center" gap="8px" flexWrap="wrap" style={{ marginTop: 4 }}>
                {publishedAt && (
                  <Text as="span" style={{ color: "var(--color-text-tertiary)", fontSize: 12 }}>
                    Published {timeAgo(publishedAt)}
                  </Text>
                )}
                {license && (
                  <>
                    <span style={{ color: "var(--color-text-tertiary)", fontSize: 12 }}>·</span>
                    <Text as="span" style={{ color: "var(--color-text-tertiary)", fontSize: 12, fontWeight: 500 }}>
                      {license}
                    </Text>
                  </>
                )}
                {typeof classCount === "number" && classCount > 0 && (
                  <>
                    <span style={{ color: "var(--color-text-tertiary)", fontSize: 12 }}>·</span>
                    <Text as="span" style={{ color: "var(--color-text-tertiary)", fontSize: 12 }}>
                      {classCount.toLocaleString()} {classCount === 1 ? "symbol" : "symbols"}
                    </Text>
                  </>
                )}
              </Box>
            </Box>
          </Box>

          {canManage && (
            <Box display="flex" alignItems="center" gap="8px" style={{ alignSelf: "center" }}>
              <ActionMenu>
                <ActionMenu.Button size="small" leadingVisual={GearIcon}>
                  Manage Release
                </ActionMenu.Button>
                <ActionMenu.Overlay align="end">
                  <ActionList>
                    <ActionList.Item
                      onSelect={() => {
                        setActionError(null);
                        setPublishModalOpen(true);
                      }}
                    >
                      <ActionList.LeadingVisual>
                        <PlusIcon size={14} />
                      </ActionList.LeadingVisual>
                      Publish New Version
                    </ActionList.Item>

                    <ActionList.Item
                      onSelect={() => {
                        setActionError(null);
                        setManageModal("collaborators");
                      }}
                    >
                      <ActionList.LeadingVisual>
                        <PeopleIcon size={14} />
                      </ActionList.LeadingVisual>
                      Manage Collaborators ({collaborators.length})
                    </ActionList.Item>

                    <ActionList.Divider />

                    <ActionList.Item
                      onSelect={() => {
                        setActionError(null);
                        setManageModal("yank");
                      }}
                    >
                      <ActionList.LeadingVisual>
                        <AlertFillIcon
                          size={14}
                          fill={
                            isCurrentYanked ? "var(--color-success-fg, #2da44e)" : "var(--color-danger-fg, #cf222e)"
                          }
                        />
                      </ActionList.LeadingVisual>
                      {isCurrentYanked ? "Restore (Unyank) Release" : "Yank Release"}
                    </ActionList.Item>

                    <ActionList.Item
                      onSelect={() => {
                        setActionError(null);
                        setManageModal("deprecate");
                      }}
                    >
                      <ActionList.LeadingVisual>
                        <AlertIcon size={14} fill="#d97706" />
                      </ActionList.LeadingVisual>
                      {isCurrentDeprecated ? "Remove Deprecation" : "Deprecate Release"}
                    </ActionList.Item>

                    <ActionList.Divider />

                    <ActionList.Item
                      onSelect={() => {
                        setActionError(null);
                        setManageModal("transfer");
                      }}
                    >
                      <ActionList.LeadingVisual>
                        <SyncIcon size={14} />
                      </ActionList.LeadingVisual>
                      Transfer Ownership
                    </ActionList.Item>

                    <ActionList.Item
                      variant="danger"
                      onSelect={() => {
                        setActionError(null);
                        setManageModal("unpublish");
                      }}
                    >
                      <ActionList.LeadingVisual>
                        <TrashIcon size={14} />
                      </ActionList.LeadingVisual>
                      Unpublish Release (v{version})
                    </ActionList.Item>
                  </ActionList>
                </ActionMenu.Overlay>
              </ActionMenu>
            </Box>
          )}
        </Box>
      </HeaderBar>

      {/* Alerts & Notifications */}
      <Box px={5} pt={2}>
        {actionSuccess && (
          <Box mb={3}>
            <Flash variant="success" onDismiss={() => setActionSuccess(null)}>
              {actionSuccess}
            </Flash>
          </Box>
        )}

        {user &&
          pendingTransfers.map((tr) => {
            const isIncoming = tr.to_user_id === user.id || tr.to_username === user.username;
            return (
              <Box
                key={tr.id}
                mb={3}
                p={3}
                style={{
                  borderRadius: 8,
                  background: "rgba(139, 92, 246, 0.12)",
                  border: "1px solid rgba(139, 92, 246, 0.4)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 12,
                }}
              >
                <Box display="flex" alignItems="center" gap={2}>
                  <SyncIcon size={18} fill="#a855f7" />
                  <Text style={{ fontSize: 13, color: "var(--color-text-primary)" }}>
                    {isIncoming ? (
                      <>
                        <strong>@{tr.from_username || "Owner"}</strong> requested to transfer ownership of{" "}
                        <strong>{name}</strong> to you.
                      </>
                    ) : (
                      <>
                        Transfer request sent to <strong>@{tr.to_username}</strong>. Awaiting acceptance.
                      </>
                    )}
                  </Text>
                </Box>
                <Box display="flex" gap={2}>
                  {isIncoming ? (
                    <Button
                      size="small"
                      variant="primary"
                      disabled={actionLoading}
                      onClick={() => onAcceptPendingTransfer(tr.id)}
                    >
                      Accept Transfer
                    </Button>
                  ) : (
                    <Button
                      size="small"
                      variant="danger"
                      disabled={actionLoading}
                      onClick={() => onCancelPendingTransfer(tr.id)}
                    >
                      Cancel Request
                    </Button>
                  )}
                </Box>
              </Box>
            );
          })}

        {isCurrentYanked && (
          <Box
            mb={3}
            p={3}
            style={{
              borderRadius: 8,
              background: "rgba(207, 34, 46, 0.12)",
              border: "1px solid rgba(207, 34, 46, 0.4)",
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
            }}
          >
            <AlertFillIcon size={20} fill="var(--color-danger-fg, #cf222e)" style={{ flexShrink: 0, marginTop: 2 }} />
            <Box>
              <Text style={{ fontWeight: 600, color: "var(--color-danger-fg, #cf222e)", display: "block" }}>
                This version (v{version}) has been yanked
              </Text>
              <Text style={{ fontSize: 13, color: "var(--color-text-primary)", display: "block", marginTop: 2 }}>
                {currentYankReason || "The maintainer has yanked this release. It should not be used in new projects."}
              </Text>
            </Box>
          </Box>
        )}

        {isCurrentDeprecated && (
          <Box
            mb={3}
            p={3}
            style={{
              borderRadius: 8,
              background: "rgba(217, 119, 6, 0.12)",
              border: "1px solid rgba(217, 119, 6, 0.4)",
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
            }}
          >
            <AlertIcon size={20} fill="#d97706" style={{ flexShrink: 0, marginTop: 2 }} />
            <Box>
              <Text style={{ fontWeight: 600, color: "#d97706", display: "block" }}>
                This version (v{version}) is deprecated
              </Text>
              <Text style={{ fontSize: 13, color: "var(--color-text-primary)", display: "block", marginTop: 2 }}>
                {currentDeprecateReason || "The package author has deprecated this version. Please consider upgrading."}
              </Text>
            </Box>
          </Box>
        )}
      </Box>
    </>
  );
};

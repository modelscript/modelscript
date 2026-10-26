// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  AdminAuditLog,
  AdminDbStatus,
  AdminDmcaNotice,
  AdminFeatureFlag,
  AdminFederationDomain,
  AdminModerationReport,
} from "../../api";

export type {
  AdminAuditLog,
  AdminDbStatus,
  AdminDmcaNotice,
  AdminFeatureFlag,
  AdminFederationDomain,
  AdminModerationReport,
};

export type AdminTab = "moderation" | "federation" | "dmca" | "audit" | "database" | "flags";

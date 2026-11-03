// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import PackageDetailPage from "./PackageDetailPage";
import { ClassDetailView } from "./class-detail";

/**
 * Unified class detail controller — delegates to PackageDetailPage to share the same
 * package layout, persistent class tree sidebar, and cache without blank flashes.
 */
const ClassDetailPage: React.FC = () => {
  return <PackageDetailPage />;
};

export { ClassDetailView };
export default ClassDetailPage;

// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import RealSysmlViewer, { type SysmlViewerProps as RealSysmlViewerProps } from "./artifacts/SysmlViewer.js";

export interface SysmlViewerProps {
  config?: Record<string, unknown> | undefined;
  artifactPath?: string | undefined;
  viewConfig?: RealSysmlViewerProps["viewConfig"] | undefined;
  isFullScreen?: boolean | undefined;
}

/**
 * SysML v2 Architecture & Diagram Viewer component.
 * Adapts artifact configuration and delegates to the full-featured SysML architecture viewer.
 */
export const SysmlViewer: React.FC<SysmlViewerProps> = (props) => {
  const viewConfig = props.viewConfig ?? {
    format: "SysML2",
    systemName:
      props.artifactPath
        ?.split("/")
        .pop()
        ?.replace(/\.sysml$/, "") ?? "System Architecture",
    title: props.artifactPath?.split("/").pop() ?? "SysML Model",
    code: typeof props.config?.code === "string" ? props.config.code : undefined,
    ...props.config,
  };

  return <RealSysmlViewer viewConfig={viewConfig} isFullScreen={props.isFullScreen} />;
};

export default SysmlViewer;

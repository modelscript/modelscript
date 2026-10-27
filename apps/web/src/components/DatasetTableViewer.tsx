// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Dataset Table Viewer Component
 *
 * Thin wrapper delegating CSV/TSV dataset table parsing, sorting, search,
 * column statistics, and pagination to the unified CsvViewer artifact component.
 */

import React from "react";
import CsvViewer, { type DatasetColumn } from "./artifacts/CsvViewer";

export type { DatasetColumn };

export interface DatasetTableViewerProps {
  url?: string | undefined;
  rawCsv?: string | undefined;
  title?: string | undefined;
  maxPreviewRows?: number | undefined;
  isFullScreen?: boolean | undefined;
  config?:
    | {
        columns?: DatasetColumn[] | undefined;
        rowCount?: number | undefined;
        format?: string | undefined;
        previewRows?: string[][] | undefined;
        rows?: string[][] | undefined;
        hasHeader?: boolean | undefined;
        url?: string | undefined;
        code?: string | undefined;
        data?: string | string[][] | undefined;
        title?: string | undefined;
        maxPreviewRows?: number | undefined;
        [key: string]: unknown;
      }
    | undefined;
  artifactPath?: string | undefined;
}

export type DatasetViewerProps = DatasetTableViewerProps;

export const DatasetTableViewer: React.FC<DatasetTableViewerProps> = (props) => {
  const resolvedTitle =
    props.title ??
    (typeof props.config?.title === "string" ? props.config.title : undefined) ??
    (props.artifactPath ? props.artifactPath.split("/").pop() || props.artifactPath : undefined);

  return (
    <CsvViewer
      viewConfig={{
        ...props.config,
        url: props.url ?? (typeof props.config?.url === "string" ? props.config.url : undefined),
        code: props.rawCsv ?? (typeof props.config?.code === "string" ? props.config.code : undefined),
        title: resolvedTitle,
        maxPreviewRows:
          props.maxPreviewRows ??
          (typeof props.config?.maxPreviewRows === "number" ? props.config.maxPreviewRows : undefined),
      }}
      isFullScreen={props.isFullScreen}
    />
  );
};

export default DatasetTableViewer;

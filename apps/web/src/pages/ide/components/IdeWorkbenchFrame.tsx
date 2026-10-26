// SPDX-License-Identifier: AGPL-3.0-or-later

import { Spinner, Text } from "@primer/react";
import React from "react";
import { IframeWrapper, LoadingOverlay } from "../styles";

export interface IdeWorkbenchFrameProps {
  isLoading: boolean;
  reloadKey: number;
  workbenchUrl: string;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  onIframeLoad: () => void;
}

export const IdeWorkbenchFrame: React.FC<IdeWorkbenchFrameProps> = ({
  isLoading,
  reloadKey,
  workbenchUrl,
  iframeRef,
  onIframeLoad,
}) => {
  return (
    <IframeWrapper>
      {isLoading && (
        <LoadingOverlay>
          <Spinner size="large" />
          <Text>Initializing ModelScript IDE &amp; WebAssembly Solvers...</Text>
        </LoadingOverlay>
      )}
      <iframe
        key={reloadKey}
        ref={iframeRef}
        src={workbenchUrl}
        title="ModelScript IDE Workbench"
        allow="clipboard-read; clipboard-write"
        onLoad={onIframeLoad}
      />
    </IframeWrapper>
  );
};

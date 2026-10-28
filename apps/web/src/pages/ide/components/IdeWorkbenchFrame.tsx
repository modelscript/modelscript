// SPDX-License-Identifier: AGPL-3.0-or-later

import { CodeIcon, SyncIcon } from "@primer/octicons-react";
import { Button, Spinner, Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import { IframeWrapper, LoadingOverlay } from "../styles";

export interface IdeWorkbenchFrameProps {
  isLoading: boolean;
  reloadKey: number;
  workbenchUrl: string;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  onIframeLoad: () => void;
  onRetry?: (() => void) | undefined;
  onOpenInPlayground?: (() => void) | undefined;
}

export const IdeWorkbenchFrame: React.FC<IdeWorkbenchFrameProps> = ({
  isLoading,
  reloadKey,
  workbenchUrl,
  iframeRef,
  onIframeLoad,
  onRetry,
  onOpenInPlayground,
}) => {
  const [isSlowLoad, setIsSlowLoad] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setIsSlowLoad(false);
      return;
    }
    setIsSlowLoad(false);
    const timer = setTimeout(() => {
      setIsSlowLoad(true);
    }, 8000);
    return () => clearTimeout(timer);
  }, [isLoading, reloadKey]);

  return (
    <IframeWrapper>
      {isLoading && (
        <LoadingOverlay>
          <Spinner size="large" />
          <Text>Initializing ModelScript IDE &amp; WebAssembly Solvers...</Text>
          {isSlowLoad && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", marginTop: 8 }}>
              <Text style={{ fontSize: "12px", color: "var(--color-fg-muted)" }}>
                Workbench is taking longer than expected to initialize.
              </Text>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                {onRetry && (
                  <Button size="small" variant="default" leadingVisual={SyncIcon} onClick={onRetry}>
                    Retry
                  </Button>
                )}
                {onOpenInPlayground && (
                  <Button size="small" variant="primary" leadingVisual={CodeIcon} onClick={onOpenInPlayground}>
                    Open in Playground
                  </Button>
                )}
              </div>
            </div>
          )}
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

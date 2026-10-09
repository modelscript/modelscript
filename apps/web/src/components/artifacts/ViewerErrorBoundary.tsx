// SPDX-License-Identifier: AGPL-3.0-or-later

import { AlertIcon, SyncIcon } from "@primer/octicons-react";
import { Button, Text } from "@primer/react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import styled from "styled-components";
import Box from "../Box";

interface Props {
  children: ReactNode;
  viewerTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

const ErrorContainer = styled.div`
  width: 100%;
  min-height: 240px;
  background: var(--color-canvas-subtle, #161b22);
  border: 1px dashed var(--color-danger-emphasis, #da3633);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
  gap: 12px;
`;

export class ViewerErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Artifact Viewer encountered an unhandled error:", error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  public override render() {
    if (this.state.hasError) {
      return (
        <ErrorContainer>
          <Box p={2} bg="rgba(239, 68, 68, 0.15)" borderRadius="50%">
            <AlertIcon size={24} fill="var(--color-danger-fg, #f85149)" />
          </Box>
          <Text fontWeight="bold" fontSize="13.5px" color="var(--color-fg-default)">
            {this.props.viewerTitle ? `${this.props.viewerTitle} Render Error` : "Artifact Viewer Render Error"}
          </Text>
          <Text fontSize="12px" color="var(--color-fg-muted)" maxWidth="400px">
            {this.state.error?.message || "An unexpected error occurred while rendering this artifact."}
          </Text>
          <Button size="small" leadingVisual={SyncIcon} onClick={this.handleReset}>
            Reload Viewer
          </Button>
        </ErrorContainer>
      );
    }

    return this.props.children;
  }
}

export default ViewerErrorBoundary;

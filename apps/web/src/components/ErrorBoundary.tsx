import { AlertIcon, HomeIcon, SyncIcon } from "@primer/octicons-react";
import { Button, Heading, Text } from "@primer/react";
import { Component, ErrorInfo, ReactNode } from "react";
import styled from "styled-components";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

const ErrorContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  min-height: 320px;
  text-align: center;
  background-color: var(--color-canvas-default);
  color: var(--color-fg-default);
`;

const ErrorCard = styled.div`
  max-width: 580px;
  width: 100%;
  padding: 32px;
  border-radius: 12px;
  border: 1px solid var(--color-border-default);
  background-color: var(--color-canvas-subtle);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
`;

const IconCircle = styled.div`
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background-color: rgba(248, 81, 73, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-danger-fg, #f85149);
`;

const ErrorDetails = styled.details`
  margin-top: 12px;
  width: 100%;
  text-align: left;
  background-color: var(--color-canvas-default);
  border: 1px solid var(--color-border-subtle);
  border-radius: 6px;
  padding: 12px;
  font-family: monospace;
  font-size: 12px;
  color: var(--color-danger-fg, #f85149);
  overflow-x: auto;
  white-space: pre-wrap;

  summary {
    cursor: pointer;
    font-weight: 600;
    color: var(--color-fg-muted);
    outline: none;
    margin-bottom: 8px;
  }
`;

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <ErrorContainer>
          <ErrorCard>
            <IconCircle>
              <AlertIcon size={28} />
            </IconCircle>

            <Heading as="h2" sx={{ fontSize: 20, m: 0 }}>
              Something unexpected occurred
            </Heading>

            <Text sx={{ color: "fg.muted", fontSize: 14 }}>
              An error occurred while rendering this section. You can try refreshing or returning to the explore feed.
            </Text>

            <div style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
              <Button leadingVisual={SyncIcon} onClick={this.handleReload} variant="primary">
                Refresh Page
              </Button>
              <Button
                leadingVisual={HomeIcon}
                onClick={() => {
                  this.handleReset();
                  window.location.href = "/";
                }}
              >
                Go Home
              </Button>
            </div>

            {import.meta.env.DEV && this.state.error && (
              <ErrorDetails>
                <summary>Technical Details (Dev Mode)</summary>
                <div>
                  <strong>{this.state.error.name}: </strong>
                  {this.state.error.message}
                </div>
                {this.state.error.stack && (
                  <div style={{ marginTop: "8px", opacity: 0.85 }}>{this.state.error.stack}</div>
                )}
              </ErrorDetails>
            )}
          </ErrorCard>
        </ErrorContainer>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

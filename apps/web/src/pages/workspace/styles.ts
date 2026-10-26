// SPDX-License-Identifier: AGPL-3.0-or-later

import styled from "styled-components";
import Box from "../../components/Box";

export const StyledBox = styled(Box)`
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  overflow: hidden;
`;

export const FileRow = styled(Box)`
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  border-top: 1px solid var(--color-border-muted);
  color: var(--color-fg-default);
  font-size: 14px;
  cursor: pointer;

  &:hover {
    background-color: var(--color-canvas-subtle);
  }
`;

export const CommitRow = styled(Box)`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 16px;
  border-top: 1px solid var(--color-border-muted);
  font-size: 14px;
`;

export const MarkdownBody = styled.div`
  color: var(--color-text-primary);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 1.5;
  word-wrap: break-word;

  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    margin-top: 24px;
    margin-bottom: 16px;
    font-weight: 600;
    line-height: 1.25;
  }
  h1 {
    font-size: 2em;
    padding-bottom: 0.3em;
    border-bottom: 1px solid var(--color-border-default);
  }
  h2 {
    font-size: 1.5em;
    padding-bottom: 0.3em;
    border-bottom: 1px solid var(--color-border-default);
  }
  p {
    margin-top: 0;
    margin-bottom: 16px;
  }
  code {
    padding: 0.2em 0.4em;
    margin: 0;
    font-size: 85%;
    white-space: break-spaces;
    background-color: var(--color-canvas-subtle);
    border-radius: 6px;
  }
  pre {
    padding: 16px;
    overflow: auto;
    font-size: 85%;
    line-height: 1.45;
    background-color: var(--color-canvas-subtle);
    border-radius: 6px;
    code {
      background-color: transparent;
      padding: 0;
    }
  }
`;

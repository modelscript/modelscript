// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, CodeIcon, CopyIcon, FileCodeIcon, WorkflowIcon } from "@primer/octicons-react";
import { Button, Label, Text } from "@primer/react";
import React, { useState } from "react";
import Box from "../../../components/Box";
import { CodeBlockHeader, CodeBlockPre, CodeBlockWrap, GlassCard, JavadocSection, SectionTitle } from "../styles";

export interface ClassEquationsTabProps {
  equations: string[];
}

export const ClassEquationsTab: React.FC<ClassEquationsTabProps> = ({ equations }) => {
  return (
    <JavadocSection>
      <SectionTitle as="h3">
        <WorkflowIcon size={14} /> Equations &amp; Connections ({equations.length})
      </SectionTitle>
      {equations.length > 0 ? (
        <CodeBlockWrap>
          <CodeBlockHeader>
            <Text style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-muted)" }}>
              Declarative Equation &amp; Connect Clauses
            </Text>
            <Label variant="secondary" style={{ fontSize: 11 }}>
              {equations.length} {equations.length === 1 ? "equation" : "equations"}
            </Label>
          </CodeBlockHeader>
          <CodeBlockPre>
            <code>{equations.join("\n")}</code>
          </CodeBlockPre>
        </CodeBlockWrap>
      ) : (
        <GlassCard>
          <Text style={{ color: "var(--color-text-muted)", fontStyle: "italic" }}>
            No top-level equations or connect clauses declared directly in this class.
          </Text>
        </GlassCard>
      )}
    </JavadocSection>
  );
};

export interface ClassSourceTabProps {
  sourceCode: string | null | undefined;
  sourceFile?: string | null | undefined;
  className: string;
}

export const ClassSourceTab: React.FC<ClassSourceTabProps> = ({ sourceCode, sourceFile, className }) => {
  const [copiedSource, setCopiedSource] = useState(false);

  const handleCopySource = () => {
    if (!sourceCode) return;
    void navigator.clipboard.writeText(sourceCode);
    setCopiedSource(true);
    setTimeout(() => setCopiedSource(false), 2000);
  };

  return (
    <JavadocSection>
      <SectionTitle as="h3">
        <FileCodeIcon size={14} /> Class Definition Source
      </SectionTitle>
      {sourceCode ? (
        <CodeBlockWrap>
          <CodeBlockHeader>
            <Box display="flex" alignItems="center" gap="8px">
              <CodeIcon size={14} />
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: "var(--font-mono, monospace)",
                  color: "var(--color-text-heading)",
                }}
              >
                {sourceFile || className}
              </Text>
            </Box>
            <Button
              size="small"
              variant="invisible"
              leadingVisual={copiedSource ? CheckIcon : CopyIcon}
              onClick={handleCopySource}
            >
              {copiedSource ? "Copied" : "Copy"}
            </Button>
          </CodeBlockHeader>
          <CodeBlockPre>
            <code>{sourceCode}</code>
          </CodeBlockPre>
        </CodeBlockWrap>
      ) : (
        <GlassCard>
          <Text style={{ color: "var(--color-text-muted)", fontStyle: "italic" }}>
            Source code is not available for this class.
          </Text>
        </GlassCard>
      )}
    </JavadocSection>
  );
};

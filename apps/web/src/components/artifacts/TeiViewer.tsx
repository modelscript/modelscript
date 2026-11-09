// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, CopyIcon } from "@primer/octicons-react";
import { Button, Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import styled from "styled-components";
import Box from "../Box";
import Spinner from "../Spinner";

// Provide some document-like typography styling
const TeiContainer = styled.div<{ $isFullScreen?: boolean | undefined }>`
  font-family: "Georgia", "Times New Roman", serif;
  line-height: 1.6;
  color: var(--color-fg-default);
  background-color: var(--color-canvas-default);
  padding: ${(props) => (props.$isFullScreen ? "40px 10%" : "20px")};
  height: ${(props) => (props.$isFullScreen ? "100%" : "400px")};
  max-height: ${(props) => (props.$isFullScreen ? "100%" : "400px")};
  box-sizing: border-box;
  overflow-y: auto;
  border-radius: 6px;

  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: var(--color-fg-default);
    margin-top: 1.5em;
    margin-bottom: 0.5em;
  }

  p {
    margin-bottom: 1em;
    text-align: justify;
  }

  .tei-header {
    border-bottom: 2px solid var(--color-border-default);
    margin-bottom: 20px;
    padding-bottom: 10px;
  }

  .tei-title {
    font-size: 2em;
    font-weight: bold;
    margin-bottom: 0.2em;
  }

  .tei-author {
    font-size: 1.2em;
    color: var(--color-fg-muted);
    font-style: italic;
  }

  .tei-lg {
    margin-bottom: 1em;
  }

  .tei-l {
    display: block;
  }
`;

interface TeiViewerProps {
  viewConfig: any;
  isFullScreen?: boolean | undefined;
}

const TeiViewer: React.FC<TeiViewerProps> = ({ viewConfig, isFullScreen }) => {
  const [teiData, setTeiData] = useState<Document | null>(null);
  const [rawXml, setRawXml] = useState<string>(() => viewConfig.data || viewConfig.code || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const parseTei = (text: string) => {
    try {
      setRawXml(text);
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(text, "text/xml");
      if (xmlDoc.getElementsByTagName("parsererror").length > 0) {
        throw new Error("Invalid XML format");
      }
      setTeiData(xmlDoc);
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => {
    if (teiData || error) {
      (window as any).__ARTIFACT_READY = true;
    }
  }, [teiData, error]);

  useEffect(() => {
    const inline = viewConfig.data || viewConfig.code;
    if (inline) {
      parseTei(inline);
    } else if (viewConfig.url) {
      setLoading(true);
      const fetchUrl = viewConfig.url.startsWith("/") ? `/api${viewConfig.url}` : viewConfig.url;
      fetch(fetchUrl)
        .then((res) => {
          if (!res.ok) throw new Error("Failed to load TEI XML");
          return res.text();
        })
        .then((text) => {
          parseTei(text);
          setLoading(false);
        })
        .catch((err) => {
          setError(err.message);
          setLoading(false);
        });
    } else {
      setError("No TEI data or URL provided.");
    }
  }, [viewConfig]);

  if (loading) {
    return (
      <TeiContainer $isFullScreen={isFullScreen}>
        <Box height="100%" display="flex" justifyContent="center" alignItems="center">
          <Spinner size="small" />
        </Box>
      </TeiContainer>
    );
  }

  if (error) {
    return (
      <TeiContainer $isFullScreen={isFullScreen}>
        <Box p={3} color="var(--color-danger-fg)">
          <Text>{error}</Text>
        </Box>
      </TeiContainer>
    );
  }

  if (!teiData) return null;

  const getElementText = (tagName: string) => {
    const el = teiData.getElementsByTagName(tagName)[0];
    return el ? el.textContent : null;
  };

  const title = getElementText("title");
  const author = getElementText("author");

  const renderNode = (node: Node, index: number): React.ReactNode => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }

    const el = node as Element;
    const tagName = el.tagName.toLowerCase();
    const children = Array.from(el.childNodes).map((child, i) => renderNode(child, i));

    switch (tagName) {
      case "head":
        return <h3 key={index}>{children}</h3>;
      case "p":
        return <p key={index}>{children}</p>;
      case "div":
        return (
          <div key={index} className="tei-div">
            {children}
          </div>
        );
      case "lg":
        return (
          <div key={index} className="tei-lg">
            {children}
          </div>
        );
      case "l":
        return (
          <span key={index} className="tei-l">
            {children}
          </span>
        );
      default:
        return <React.Fragment key={index}>{children}</React.Fragment>;
    }
  };

  const bodyNode = teiData.getElementsByTagName("body")[0];

  return (
    <TeiContainer $isFullScreen={isFullScreen}>
      <div
        className="tei-header"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}
      >
        <div>
          {title && <div className="tei-title">{title}</div>}
          {author && <div className="tei-author">{author}</div>}
        </div>
        {rawXml && (
          <Button
            size="small"
            leadingVisual={copied ? CheckIcon : CopyIcon}
            onClick={() => {
              navigator.clipboard?.writeText(rawXml).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? "Copied" : "Copy XML"}
          </Button>
        )}
      </div>
      {bodyNode ? (
        <div className="tei-body">{Array.from(bodyNode.childNodes).map((child, i) => renderNode(child, i))}</div>
      ) : (
        <Text color="var(--color-fg-muted)">No TEI body found.</Text>
      )}
    </TeiContainer>
  );
};

export default TeiViewer;

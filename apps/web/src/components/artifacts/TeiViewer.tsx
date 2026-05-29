/* eslint-disable @typescript-eslint/no-explicit-any */
import { Spinner, Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import styled from "styled-components";
import Box from "../Box";

// Provide some document-like typography styling
const TeiContainer = styled.div<{ $isFullScreen?: boolean }>`
  font-family: "Georgia", "Times New Roman", serif;
  line-height: 1.6;
  color: var(--color-fg-default);
  background-color: var(--color-canvas-default);
  padding: ${(props) => (props.$isFullScreen ? "40px 10%" : "20px")};
  max-height: ${(props) => (props.$isFullScreen ? "100%" : "400px")};
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
  isFullScreen?: boolean;
}

const TeiViewer: React.FC<TeiViewerProps> = ({ viewConfig, isFullScreen }) => {
  const [teiData, setTeiData] = useState<Document | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (viewConfig.data) {
      parseTei(viewConfig.data);
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

  const parseTei = (text: string) => {
    try {
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

  if (loading) {
    return (
      <Box p={3} display="flex" justifyContent="center">
        <Spinner size="small" />
      </Box>
    );
  }

  if (error) {
    return (
      <Box p={3} color="var(--color-danger-fg)">
        <Text>{error}</Text>
      </Box>
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
      {(title || author) && (
        <div className="tei-header">
          {title && <div className="tei-title">{title}</div>}
          {author && <div className="tei-author">{author}</div>}
        </div>
      )}
      {bodyNode ? (
        <div className="tei-body">{Array.from(bodyNode.childNodes).map((child, i) => renderNode(child, i))}</div>
      ) : (
        <Text color="var(--color-fg-muted)">No TEI body found.</Text>
      )}
    </TeiContainer>
  );
};

export default TeiViewer;

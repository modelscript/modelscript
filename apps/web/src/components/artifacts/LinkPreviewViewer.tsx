import { LinkIcon } from "@primer/octicons-react";
import React from "react";
import styled from "styled-components";

const LinkCard = styled.a`
  display: flex;
  flex-direction: column;
  text-decoration: none;
  color: inherit;
  background-color: var(--color-canvas-subtle);
  width: 100%;
  height: 100%;

  &:hover {
    background-color: var(--color-canvas-default);
  }
`;

const ImageContainer = styled.div`
  width: 100%;
  height: 150px;
  background-color: var(--color-border-subtle);
  background-size: cover;
  background-position: center;
  border-bottom: 1px solid var(--color-border-subtle);
`;

const ContentContainer = styled.div`
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Title = styled.div`
  font-size: 15px;
  font-weight: 700;
  color: var(--color-fg-default);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
`;

const Description = styled.div`
  font-size: 14px;
  color: var(--color-fg-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
`;

const Domain = styled.div`
  font-size: 13px;
  color: var(--color-fg-muted);
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
`;

interface LinkPreviewViewerProps {
  viewConfig: unknown;
  isFullScreen?: boolean;
}

const LinkPreviewViewer: React.FC<LinkPreviewViewerProps> = ({ viewConfig }) => {
  const { url, domain, title, description, image } = viewConfig;

  return (
    <LinkCard href={url} target="_blank" rel="noopener noreferrer">
      {image && <ImageContainer style={{ backgroundImage: `url(${image})` }} />}
      <ContentContainer>
        {title && <Title>{title}</Title>}
        {description && <Description>{description}</Description>}
        <Domain>
          <LinkIcon size={14} />
          {domain || new URL(url || "https://modelscript.org").hostname}
        </Domain>
      </ContentContainer>
    </LinkCard>
  );
};

export default LinkPreviewViewer;

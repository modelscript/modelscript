// SPDX-License-Identifier: AGPL-3.0-or-later

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

interface LinkPreviewConfig {
  url?: string | undefined;
  domain?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  image?: string | undefined;
}

interface LinkPreviewViewerProps {
  viewConfig: LinkPreviewConfig | Record<string, any> | null | undefined;
  isFullScreen?: boolean | undefined;
}

import { safeCssImageUrl, safeHostname, sanitizeHttpUrl } from "../../util/url";

const LinkPreviewViewer: React.FC<LinkPreviewViewerProps> = ({ viewConfig }) => {
  const { url, domain, title, description, image } = (viewConfig || {}) as LinkPreviewConfig;
  const safeHref = sanitizeHttpUrl(url, { allowRelative: true, prependHttpsIfMissingScheme: true });
  const safeBgImage = safeCssImageUrl(image);

  return (
    <LinkCard
      href={safeHref || "#"}
      target={safeHref ? "_blank" : undefined}
      rel="noopener noreferrer"
      onClick={!safeHref ? (e) => e.preventDefault() : undefined}
    >
      {safeBgImage && <ImageContainer style={{ backgroundImage: safeBgImage }} />}
      <ContentContainer>
        {title && <Title>{title}</Title>}
        {description && <Description>{description}</Description>}
        <Domain>
          <LinkIcon size={14} />
          {domain || safeHostname(url, "modelscript.org")}
        </Domain>
      </ContentContainer>
    </LinkCard>
  );
};

export default LinkPreviewViewer;

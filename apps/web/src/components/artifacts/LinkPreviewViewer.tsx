// SPDX-License-Identifier: AGPL-3.0-or-later

import { LinkIcon } from "@primer/octicons-react";
import React, { useEffect, useState } from "react";
import styled from "styled-components";
import { safeHostname, sanitizeHttpUrl } from "../../util/url";

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

const PreviewImage = styled.img`
  width: 100%;
  height: 150px;
  object-fit: cover;
  background-color: var(--color-border-subtle);
  border-bottom: 1px solid var(--color-border-subtle);
  display: block;
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

const LinkPreviewViewer: React.FC<LinkPreviewViewerProps> = ({ viewConfig }) => {
  const { url, domain, title, description, image } = (viewConfig || {}) as LinkPreviewConfig;
  const safeHref = sanitizeHttpUrl(url, { allowRelative: true, prependHttpsIfMissingScheme: true });
  const safeImageSrc = sanitizeHttpUrl(image, { allowRelative: true });
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    setImageError(false);
  }, [safeImageSrc]);

  return (
    <LinkCard
      href={safeHref || "#"}
      target={safeHref ? "_blank" : undefined}
      rel="noopener noreferrer"
      onClick={(e) => {
        e.stopPropagation();
        if (!safeHref) e.preventDefault();
      }}
    >
      {safeImageSrc && !imageError && (
        <PreviewImage
          src={safeImageSrc}
          alt={title || "Link preview"}
          loading="lazy"
          decoding="async"
          onError={() => setImageError(true)}
        />
      )}
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

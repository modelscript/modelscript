// SPDX-License-Identifier: AGPL-3.0-or-later

import { PlayIcon } from "@primer/octicons-react";
import React, { useEffect, useState } from "react";
import styled from "styled-components";
import { sanitizeHttpUrl } from "../../util/url";
import Box from "../Box";

interface YoutubeVideoViewerProps {
  viewConfig: any;
  isFullScreen?: boolean | undefined;
}

const ThumbnailWrapper = styled.div<{ $isFullScreen?: boolean | undefined }>`
  position: relative;
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "auto")};
  padding-bottom: ${(props) => (props.$isFullScreen ? "0" : "56.25%")}; /* 16:9 aspect ratio */
  background-color: black;
  cursor: pointer;
  overflow: hidden;
  outline: none;

  &:focus-visible {
    box-shadow: 0 0 0 2px var(--color-accent-fg, #38bdf8) inset;
  }
`;

const ThumbnailImage = styled.img`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.2s;

  ${ThumbnailWrapper}:hover & {
    transform: scale(1.05);
  }
`;

const PlayButton = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 68px;
  height: 48px;
  background-color: rgba(0, 0, 0, 0.7);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  transition:
    background-color 0.2s,
    color 0.2s;

  ${ThumbnailWrapper}:hover &,
  ${ThumbnailWrapper}:focus-visible & {
    background-color: #ff0000;
  }
`;

function extractYoutubeVideoId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Match full YouTube URLs: youtube.com/watch?v=..., youtu.be/..., youtube.com/embed/..., youtube.com/shorts/...
  const urlMatch = trimmed.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:[?&/#]|$)/,
  );
  if (urlMatch?.[1]) {
    return urlMatch[1];
  }

  // Match direct video ID
  if (/^[a-zA-Z0-9_-]{6,20}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

const YoutubeVideoViewer: React.FC<YoutubeVideoViewerProps> = ({ viewConfig, isFullScreen }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [useFallbackThumb, setUseFallbackThumb] = useState(false);

  const videoId =
    extractYoutubeVideoId(viewConfig?.videoId) ||
    extractYoutubeVideoId(viewConfig?.url) ||
    extractYoutubeVideoId(viewConfig?.src);

  useEffect(() => {
    setIsPlaying(false);
    setUseFallbackThumb(false);
  }, [videoId]);

  if (!videoId) {
    return <Box p={3}>Invalid YouTube video configuration.</Box>;
  }

  const hqDefaultUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  const customThumb = sanitizeHttpUrl(viewConfig?.thumbnail_url || viewConfig?.thumbnailUrl, { allowRelative: true });
  const thumbnailUrl = !useFallbackThumb && customThumb ? customThumb : hqDefaultUrl;
  const title = viewConfig?.title || "YouTube video player";

  const handleActivate = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsPlaying(true);
  };

  if (!isPlaying) {
    return (
      <ThumbnailWrapper
        $isFullScreen={isFullScreen}
        role="button"
        tabIndex={0}
        aria-label={`Play ${title}`}
        onClick={handleActivate}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            handleActivate(e);
          }
        }}
      >
        <ThumbnailImage
          src={thumbnailUrl}
          alt={title}
          decoding="async"
          onError={() => {
            if (!useFallbackThumb) {
              setUseFallbackThumb(true);
            }
          }}
        />
        <PlayButton>
          <PlayIcon size={24} />
        </PlayButton>
      </ThumbnailWrapper>
    );
  }

  return (
    <Box
      width="100%"
      height={isFullScreen ? "100%" : undefined}
      style={isFullScreen ? { height: "100%" } : { aspectRatio: "16 / 9" }}
      bg="black"
    >
      <iframe
        width="100%"
        height="100%"
        src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
        title={title}
        frameBorder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        onClick={(e) => e.stopPropagation()}
        style={{ display: "block", border: "none" }}
      />
    </Box>
  );
};

export default YoutubeVideoViewer;

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { PlayIcon } from "@primer/octicons-react";
import React, { useState } from "react";
import styled from "styled-components";
import Box from "../Box";

interface YoutubeVideoViewerProps {
  viewConfig: any;
  isFullScreen?: boolean;
}

const ThumbnailWrapper = styled.div`
  position: relative;
  width: 100%;
  padding-bottom: 56.25%; /* 16:9 aspect ratio */
  background-color: black;
  cursor: pointer;
  overflow: hidden;
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

  ${ThumbnailWrapper}:hover & {
    background-color: #ff0000;
  }
`;

const YoutubeVideoViewer: React.FC<YoutubeVideoViewerProps> = ({ viewConfig, isFullScreen }) => {
  const [isPlaying, setIsPlaying] = useState(false);

  const videoId = viewConfig.videoId;
  // If thumbnail_url isn't passed via viewConfig, we can fallback to a generated one if needed,
  // but it's passed as artifact.thumbnail_url normally. We will just use standard YouTube thumbnail.
  const thumbnailUrl = viewConfig.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  if (!videoId) {
    return <Box p={3}>Invalid YouTube video configuration.</Box>;
  }

  if (!isPlaying) {
    return (
      <ThumbnailWrapper
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsPlaying(true);
        }}
      >
        <ThumbnailImage src={thumbnailUrl} alt="YouTube thumbnail" />
        <PlayButton>
          <PlayIcon size={24} />
        </PlayButton>
      </ThumbnailWrapper>
    );
  }

  return (
    <Box width="100%" style={{ aspectRatio: "16 / 9" }} bg="black">
      <iframe
        width="100%"
        height="100%"
        src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
        title="YouTube video player"
        frameBorder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        onClick={(e) => e.stopPropagation()}
        style={{ display: "block" }}
      ></iframe>
    </Box>
  );
};

export default YoutubeVideoViewer;

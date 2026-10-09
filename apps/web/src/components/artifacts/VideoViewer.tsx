// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import { DownloadIcon, PlayIcon, SquareFillIcon, SyncIcon, VideoIcon } from "@primer/octicons-react";
import { Button, IconButton, Text } from "@primer/react";
import React, { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import Box from "../Box";

interface VideoViewerProps {
  viewConfig: any;
  isFullScreen?: boolean;
}

const Wrapper = styled.div<{ $isFullScreen?: boolean }>`
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "440px")};
  background: #05080f;
  border: ${(props) => (props.$isFullScreen ? "none" : "1px solid var(--color-border-default, #30363d)")};
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "8px")};
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
`;

const Toolbar = styled.div`
  height: 42px;
  min-height: 42px;
  background: var(--surface-hud, rgba(14, 20, 36, 0.7));
  border-bottom: 1px solid var(--color-border-default, #30363d);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  gap: 8px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  z-index: 10;
`;

const Badge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  font-family: var(--font-mono, monospace);
  padding: 2px 7px;
  border-radius: 4px;
  background: rgba(239, 68, 68, 0.12);
  color: var(--color-accent-red, #ef4444);
  border: 1px solid rgba(239, 68, 68, 0.25);
  font-weight: 600;
`;

const TimeBadge = styled.span`
  font-size: 11px;
  font-family: var(--font-mono, monospace);
  color: var(--color-fg-muted, #8b949e);
  background: rgba(255, 255, 255, 0.05);
  padding: 2px 6px;
  border-radius: 4px;
`;

const VideoContainer = styled.div`
  flex: 1;
  width: 100%;
  height: 100%;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
  overflow: hidden;

  video {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
`;

const ControlBar = styled.div`
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.85) 0%, rgba(0, 0, 0, 0.4) 70%, transparent 100%);
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 5;
`;

const ProgressBar = styled.input`
  width: 100%;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
  transition: height 0.15s;

  &:hover {
    height: 6px;
  }

  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #06b6d4;
    cursor: pointer;
  }
`;

const SPEED_OPTIONS = [0.25, 0.5, 1.0, 1.5, 2.0];

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return "00:00.00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 100);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${millis.toString().padStart(2, "0")}`;
}

const VideoViewer: React.FC<VideoViewerProps> = ({ viewConfig, isFullScreen }) => {
  const url = viewConfig?.url || viewConfig?.src;
  const title = viewConfig?.title || (url ? url.split("/").pop()?.split("?")[0] : "Physical Simulation Video");

  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speedIndex, setSpeedIndex] = useState(2); // default 1.0x
  const [isLoop, setIsLoop] = useState(true);

  const speed = SPEED_OPTIONS[speedIndex];

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
  }, [speed]);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
  };

  const handleStep = (frames: number) => {
    if (!videoRef.current) return;
    videoRef.current.pause();
    const frameDuration = 1 / 30; // 30 FPS step
    const target = Math.max(0, Math.min(duration || 100, videoRef.current.currentTime + frames * frameDuration));
    videoRef.current.currentTime = target;
  };

  const cycleSpeed = () => {
    setSpeedIndex((prev) => (prev + 1) % SPEED_OPTIONS.length);
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.replace(/\s+/g, "_")}.mp4`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!url) {
    return (
      <Box p={3} backgroundColor="var(--color-canvas-subtle)" borderRadius="8px">
        <Text color="var(--color-danger-fg)">No video URL provided in artifact configuration.</Text>
      </Box>
    );
  }

  return (
    <Wrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <Box display="flex" alignItems="center" gap={2} overflow="hidden">
          <Badge>
            <VideoIcon size={13} />
            SIM-VIDEO
          </Badge>
          <Text
            fontWeight="bold"
            fontSize="12.5px"
            color="var(--color-fg-default)"
            style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}
          >
            {title}
          </Text>
          <TimeBadge>
            {formatTime(currentTime)} / {formatTime(duration)}
          </TimeBadge>
        </Box>

        <Box display="flex" alignItems="center" gap={1}>
          <Button
            size="small"
            onClick={() => handleStep(-1)}
            title="Step back 1 frame (1/30s)"
            style={{ padding: "3px 8px", fontFamily: "var(--font-mono)", fontSize: "11px" }}
          >
            ⏮ -1f
          </Button>
          <Button
            size="small"
            onClick={togglePlay}
            leadingVisual={isPlaying ? SquareFillIcon : PlayIcon}
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? "Pause" : "Play"}
          </Button>
          <Button
            size="small"
            onClick={() => handleStep(1)}
            title="Step forward 1 frame (1/30s)"
            style={{ padding: "3px 8px", fontFamily: "var(--font-mono)", fontSize: "11px" }}
          >
            +1f ⏭
          </Button>
          <Button
            size="small"
            onClick={cycleSpeed}
            title="Cycle playback speed"
            style={{ minWidth: "46px", fontFamily: "var(--font-mono)", fontSize: "11px" }}
          >
            {speed}x
          </Button>
          <Button
            size="small"
            onClick={() => setIsLoop(!isLoop)}
            title="Toggle cyclical loop"
            leadingVisual={SyncIcon}
            style={{
              background: isLoop ? "rgba(6, 182, 212, 0.15)" : undefined,
              borderColor: isLoop ? "rgba(6, 182, 212, 0.4)" : undefined,
              color: isLoop ? "#06b6d4" : undefined,
            }}
          >
            Loop
          </Button>
          <IconButton
            size="small"
            icon={DownloadIcon}
            aria-label="Download Video"
            title="Download Video File"
            onClick={handleDownload}
          />
        </Box>
      </Toolbar>

      <VideoContainer onClick={togglePlay}>
        <video
          ref={videoRef}
          src={url}
          autoPlay
          muted
          loop={isLoop}
          playsInline
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        />
        <ControlBar onClick={(e) => e.stopPropagation()}>
          <ProgressBar
            type="range"
            min={0}
            max={duration || 100}
            step={0.01}
            value={currentTime}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setCurrentTime(val);
              if (videoRef.current) {
                videoRef.current.currentTime = val;
              }
            }}
          />
        </ControlBar>
      </VideoContainer>
    </Wrapper>
  );
};

export default VideoViewer;

// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DownloadIcon,
  MuteIcon,
  PlayIcon,
  SquareFillIcon,
  SyncIcon,
  UnmuteIcon,
  VideoIcon,
} from "@primer/octicons-react";
import { Button, IconButton, Text } from "@primer/react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { sanitizeHttpUrl } from "../../util/url";
import Box from "../Box";

interface VideoViewerProps {
  viewConfig: any;
  isFullScreen?: boolean | undefined;
}

const Wrapper = styled.div<{ $isFullScreen?: boolean | undefined }>`
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "440px")};
  background: #05080f;
  border: ${(props) => (props.$isFullScreen ? "none" : "1px solid var(--color-border-default, #30363d)")};
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "8px")};
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  outline: none;
`;

const Toolbar = styled.div`
  height: 42px;
  min-height: 42px;
  background: var(--color-canvas-subtle, #161b22);
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
  color: var(--color-fg-muted, #57606a);
  background: var(--color-neutral-muted, rgba(175, 184, 193, 0.2));
  border: 1px solid var(--color-border-muted, rgba(175, 184, 193, 0.2));
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
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

  &:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  &:hover:not(:disabled) {
    height: 6px;
  }

  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--ms-accent-cyan, #06b6d4);
    cursor: pointer;
  }

  &::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: none;
    background: var(--ms-accent-cyan, #06b6d4);
    cursor: pointer;
  }
`;

const VolumeSlider = styled.input`
  width: 56px;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--color-neutral-muted, rgba(175, 184, 193, 0.35));
  border-radius: 2px;
  outline: none;
  cursor: pointer;

  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--ms-accent-cyan, #06b6d4);
    cursor: pointer;
  }

  &::-moz-range-thumb {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: none;
    background: var(--ms-accent-cyan, #06b6d4);
    cursor: pointer;
  }
`;

const SPEED_OPTIONS = [0.25, 0.5, 1.0, 1.5, 2.0];

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00.00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 100);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${millis.toString().padStart(2, "0")}`;
}

function buildDownloadFilename(rawTitle: string, url: string): string {
  const sanitizedBase = rawTitle.trim().replace(/\s+/g, "_") || "simulation_video";
  if (/\.(mp4|webm|mov|mkv|avi|ogv|m4v)$/i.test(sanitizedBase)) {
    return sanitizedBase;
  }
  const urlPath = url.split("?")[0]?.split("#")[0] || "";
  const extMatch = urlPath.match(/\.(mp4|webm|mov|mkv|avi|ogv|m4v)$/i);
  const ext = extMatch ? extMatch[0].toLowerCase() : ".mp4";
  return `${sanitizedBase}${ext}`;
}

const VideoViewer: React.FC<VideoViewerProps> = ({ viewConfig, isFullScreen }) => {
  const url = sanitizeHttpUrl(viewConfig?.url || viewConfig?.src, { allowRelative: true });
  const title = viewConfig?.title || (url ? url.split("/").pop()?.split("?")[0] : "Physical Simulation Video");
  const fps = Math.max(1, Number(viewConfig?.fps || viewConfig?.frameRate) || 30);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speedIndex, setSpeedIndex] = useState(2); // default 1.0x
  const [isLoop, setIsLoop] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [volume, setVolume] = useState(0.8);
  const [videoError, setVideoError] = useState(false);

  const speed = SPEED_OPTIONS[speedIndex]!;

  // Reset state when URL changes
  useEffect(() => {
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setVideoError(false);
  }, [url]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
  }, [speed]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
      videoRef.current.volume = volume;
    }
  }, [isMuted, volume]);

  // Pause video when scrolled out of view
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || !wrapperRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting && videoRef.current && !videoRef.current.paused) {
            videoRef.current.pause();
          }
        }
      },
      { threshold: 0.05 },
    );
    observer.observe(wrapperRef.current);
    return () => observer.disconnect();
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || videoError) return;
    if (!video.paused) {
      video.pause();
    } else {
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => setIsPlaying(false));
      }
    }
  }, [videoError]);

  const handleStep = useCallback(
    (frames: number) => {
      const video = videoRef.current;
      if (!video) return;
      video.pause();
      const frameDuration = 1 / fps;
      const maxTime = duration > 0 ? duration : Math.max(0, video.currentTime + Math.abs(frames) * frameDuration);
      const target = Math.max(0, Math.min(maxTime, video.currentTime + frames * frameDuration));
      video.currentTime = target;
      setCurrentTime(target);
    },
    [fps, duration],
  );

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      if (!next && volume === 0) {
        setVolume(0.8);
      }
      return next;
    });
  }, [volume]);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextVol = Math.max(0, Math.min(1, parseFloat(e.target.value)));
    setVolume(nextVol);
    if (nextVol > 0 && isMuted) {
      setIsMuted(false);
    } else if (nextVol === 0 && !isMuted) {
      setIsMuted(true);
    }
  };

  const cycleSpeed = () => {
    setSpeedIndex((prev) => (prev + 1) % SPEED_OPTIONS.length);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
    if (tag === "input" || tag === "button" || tag === "select" || tag === "textarea") return;
    if (e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      togglePlay();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      handleStep(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      handleStep(1);
    } else if (e.key === "m" || e.key === "M") {
      e.preventDefault();
      toggleMute();
    }
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = buildDownloadFilename(String(title || "simulation_video"), url);
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

  const currentFrame = Math.max(0, Math.floor(currentTime * fps));

  return (
    <Wrapper ref={wrapperRef} $isFullScreen={isFullScreen} tabIndex={0} onKeyDown={handleKeyDown}>
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
          <TimeBadge title={`${fps} FPS`}>F:{currentFrame}</TimeBadge>
        </Box>

        <Box display="flex" alignItems="center" gap={1}>
          <Button
            size="small"
            onClick={() => handleStep(-1)}
            title={`Step back 1 frame (1/${fps}s)`}
            style={{ padding: "3px 8px", fontFamily: "var(--font-mono)", fontSize: "11px" }}
          >
            ⏮ -1f
          </Button>
          <Button
            size="small"
            onClick={togglePlay}
            leadingVisual={isPlaying ? SquareFillIcon : PlayIcon}
            title={isPlaying ? "Pause (Space)" : "Play (Space)"}
          >
            {isPlaying ? "Pause" : "Play"}
          </Button>
          <Button
            size="small"
            onClick={() => handleStep(1)}
            title={`Step forward 1 frame (1/${fps}s)`}
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
              color: isLoop ? "var(--ms-accent-cyan)" : undefined,
            }}
          >
            Loop
          </Button>
          <IconButton
            size="small"
            icon={isMuted ? MuteIcon : UnmuteIcon}
            aria-label={isMuted ? "Unmute video" : "Mute video"}
            title={isMuted ? "Unmute Audio (M)" : "Mute Audio (M)"}
            onClick={toggleMute}
          />
          <VolumeSlider
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={isMuted ? 0 : volume}
            aria-label="Video volume"
            title={`Volume: ${Math.round((isMuted ? 0 : volume) * 100)}%`}
            onChange={handleVolumeChange}
          />
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
        {videoError ? (
          <Box
            p={4}
            display="flex"
            flexDirection="column"
            alignItems="center"
            justifyContent="center"
            gap={2}
            textAlign="center"
            onClick={(e) => e.stopPropagation()}
          >
            <Text color="var(--color-danger-fg, #f85149)" fontWeight="bold" fontSize="13px">
              Unable to load or decode video stream
            </Text>
            <Text color="var(--color-fg-muted, #8b949e)" fontSize="12px">
              {title}
            </Text>
            <Box display="flex" gap={2}>
              <Button size="small" onClick={() => setVideoError(false)}>
                Retry
              </Button>
              <Button size="small" onClick={handleDownload} leadingVisual={DownloadIcon}>
                Download File
              </Button>
            </Box>
          </Box>
        ) : (
          <video
            ref={videoRef}
            src={url}
            autoPlay
            muted={isMuted}
            loop={isLoop}
            playsInline
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onError={() => {
              setIsPlaying(false);
              setVideoError(true);
            }}
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              setDuration(Number.isFinite(d) && d > 0 ? d : 0);
            }}
          />
        )}
        <ControlBar onClick={(e) => e.stopPropagation()}>
          <ProgressBar
            type="range"
            min={0}
            max={duration > 0 ? duration : 0}
            step={0.01}
            disabled={duration <= 0}
            value={duration > 0 ? Math.min(currentTime, duration) : 0}
            aria-label="Video playback seekbar"
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (!Number.isFinite(val)) return;
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

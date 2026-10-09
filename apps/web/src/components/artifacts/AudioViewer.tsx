// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import { DownloadIcon, MuteIcon, PlayIcon, PulseIcon, SquareFillIcon, UnmuteIcon } from "@primer/octicons-react";
import { Button, IconButton, Text } from "@primer/react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import Box from "../Box";

interface AudioViewerProps {
  viewConfig: any;
  isFullScreen?: boolean;
}

const Wrapper = styled.div<{ $isFullScreen?: boolean }>`
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "260px")};
  background: var(--color-canvas-default, #0d1117);
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
  background: rgba(168, 85, 247, 0.12);
  color: var(--color-accent-purple, #a855f7);
  border: 1px solid rgba(168, 85, 247, 0.25);
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

const VisualizerContainer = styled.div`
  flex: 1;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 16px 24px;
  background: linear-gradient(180deg, #090d16 0%, #0d1117 100%);
  gap: 12px;
  user-select: none;
`;

const WaveformCanvas = styled.canvas`
  width: 100%;
  height: 70px;
  cursor: pointer;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.02);
`;

const ControlsRow = styled.div`
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return "00:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

const SPEED_OPTIONS = [0.5, 1.0, 1.5, 2.0];

const AudioViewer: React.FC<AudioViewerProps> = ({ viewConfig, isFullScreen }) => {
  const url = viewConfig?.url || viewConfig?.src;
  const title = viewConfig?.title || (url ? url.split("/").pop()?.split("?")[0] : "Acoustic NVH Recording");

  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speedIndex, setSpeedIndex] = useState(1); // default 1.0x
  const [isMuted, setIsMuted] = useState(false);

  const speed = SPEED_OPTIONS[speedIndex];

  // Generate deterministic acoustic waveform bars
  const waveformBars = useMemo(() => {
    const barsCount = 80;
    const bars: number[] = [];
    let seed = 0;
    for (let i = 0; i < (url || "").length; i++) {
      seed = (seed * 31 + url.charCodeAt(i)) & 0xffffff;
    }
    for (let i = 0; i < barsCount; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const rand = (seed % 100) / 100;
      // Envelope shape: tapered at start and end
      const envelope = Math.sin((i / (barsCount - 1)) * Math.PI);
      const val = 0.2 + 0.8 * rand * envelope;
      bars.push(Math.max(0.1, val));
    }
    return bars;
  }, [url]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  }, [speed]);

  // Render waveform to canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, rect.width, rect.height);

    const progress = duration > 0 ? currentTime / duration : 0;
    const barWidth = rect.width / waveformBars.length;
    const gap = 2;
    const maxHeight = rect.height * 0.85;

    waveformBars.forEach((barHeightFraction, index) => {
      const x = index * barWidth;
      const h = barHeightFraction * maxHeight;
      const y = (rect.height - h) / 2;

      const isPlayed = index / waveformBars.length <= progress;

      if (isPlayed) {
        ctx.fillStyle = "#a855f7"; // purple played
      } else {
        ctx.fillStyle = "rgba(168, 85, 247, 0.25)"; // muted unplayed
      }

      ctx.beginPath();
      ctx.roundRect(x, y, Math.max(1, barWidth - gap), h, 2);
      ctx.fill();
    });
  }, [waveformBars, currentTime, duration]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
  };

  const handleWaveformClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!audioRef.current || duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const ratio = x / rect.width;
    const target = ratio * duration;
    audioRef.current.currentTime = target;
    setCurrentTime(target);
  };

  const cycleSpeed = () => {
    setSpeedIndex((prev) => (prev + 1) % SPEED_OPTIONS.length);
  };

  const toggleMute = () => {
    if (!audioRef.current) return;
    audioRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.replace(/\s+/g, "_")}.mp3`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!url) {
    return (
      <Box p={3} backgroundColor="var(--color-canvas-subtle)" borderRadius="8px">
        <Text color="var(--color-danger-fg)">No audio URL provided in artifact configuration.</Text>
      </Box>
    );
  }

  return (
    <Wrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <Box display="flex" alignItems="center" gap={2} overflow="hidden">
          <Badge>
            <PulseIcon size={13} />
            ACOUSTIC-NVH
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
            onClick={cycleSpeed}
            title="Cycle playback speed"
            style={{ minWidth: "46px", fontFamily: "var(--font-mono)", fontSize: "11px" }}
          >
            {speed}x
          </Button>
          <IconButton
            size="small"
            icon={isMuted ? MuteIcon : UnmuteIcon}
            aria-label={isMuted ? "Unmute" : "Mute"}
            title={isMuted ? "Unmute Audio" : "Mute Audio"}
            onClick={toggleMute}
          />
          <IconButton
            size="small"
            icon={DownloadIcon}
            aria-label="Download Audio"
            title="Download Audio Track"
            onClick={handleDownload}
          />
        </Box>
      </Toolbar>

      <VisualizerContainer>
        <WaveformCanvas ref={canvasRef} onClick={handleWaveformClick} title="Click to seek" />

        <ControlsRow>
          <Button
            size="medium"
            onClick={togglePlay}
            leadingVisual={isPlaying ? SquareFillIcon : PlayIcon}
            variant="primary"
          >
            {isPlaying ? "Pause" : "Play"}
          </Button>

          <Text fontSize="12px" color="var(--color-fg-muted)">
            44.1 kHz • Single-Axis Sensor Stream
          </Text>
        </ControlsRow>

        <audio
          ref={audioRef}
          src={url}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        />
      </VisualizerContainer>
    </Wrapper>
  );
};

export default AudioViewer;

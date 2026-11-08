// SPDX-License-Identifier: AGPL-3.0-or-later

import { DownloadIcon, MuteIcon, PlayIcon, PulseIcon, SquareFillIcon, UnmuteIcon } from "@primer/octicons-react";
import { Button, IconButton, Text } from "@primer/react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { sanitizeHttpUrl } from "../../util/url";
import Box from "../Box";

interface AudioViewerProps {
  viewConfig: any;
  isFullScreen?: boolean | undefined;
}

const Wrapper = styled.div<{ $isFullScreen?: boolean | undefined }>`
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
  background: rgba(168, 85, 247, 0.12);
  color: var(--color-accent-purple, #a855f7);
  border: 1px solid rgba(168, 85, 247, 0.25);
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

const VisualizerContainer = styled.div`
  flex: 1;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 16px 24px;
  background: linear-gradient(
    180deg,
    var(--color-canvas-subtle, #090d16) 0%,
    var(--color-canvas-default, #0d1117) 100%
  );
  gap: 12px;
  user-select: none;
`;

const WaveformCanvas = styled.canvas<{ $isFullScreen?: boolean | undefined }>`
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "180px" : "70px")};
  cursor: pointer;
  border-radius: 6px;
  background: var(--color-canvas-inset, rgba(128, 128, 128, 0.06));
  outline: none;

  &:focus-visible {
    box-shadow: 0 0 0 2px var(--color-accent-purple, #a855f7);
  }
`;

const ControlsRow = styled.div`
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

function normalizePeaksArray(rawPeaks: unknown[]): number[] | null {
  const nums = rawPeaks.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v >= 0);
  if (nums.length === 0) return null;
  const maxPeak = Math.max(...nums, 0);
  return nums.map((p) => (maxPeak > 0 ? Math.max(0.05, Math.min(1, p / maxPeak)) : 0.05));
}

function drawRoundedBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.fill();
  } else {
    ctx.fillRect(x, y, width, height);
  }
}

function buildAudioDownloadFilename(rawTitle: string, url: string): string {
  const sanitizedBase = rawTitle.trim().replace(/\s+/g, "_") || "audio_recording";
  if (/\.(mp3|wav|flac|ogg|m4a|aac|opus|webm)$/i.test(sanitizedBase)) {
    return sanitizedBase;
  }
  const urlPath = url.split("?")[0]?.split("#")[0] || "";
  const extMatch = urlPath.match(/\.(mp3|wav|flac|ogg|m4a|aac|opus|webm)$/i);
  const ext = extMatch ? extMatch[0].toLowerCase() : ".mp3";
  return `${sanitizedBase}${ext}`;
}

const SPEED_OPTIONS = [0.5, 1.0, 1.5, 2.0];

const AudioViewer: React.FC<AudioViewerProps> = ({ viewConfig, isFullScreen }) => {
  const url = sanitizeHttpUrl(viewConfig?.url || viewConfig?.src, { allowRelative: true });
  const title = viewConfig?.title || (url ? url.split("/").pop()?.split("?")[0] : "Acoustic NVH Recording");

  const wrapperRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speedIndex, setSpeedIndex] = useState(1); // default 1.0x
  const [isMuted, setIsMuted] = useState(false);
  const [waveformBars, setWaveformBars] = useState<number[] | null>(() =>
    Array.isArray(viewConfig?.peaks) ? normalizePeaksArray(viewConfig.peaks) : null,
  );
  const [audioMeta, setAudioMeta] = useState<{ sampleRate?: number; channels?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shouldDecode, setShouldDecode] = useState(
    () => Boolean(isFullScreen) || typeof IntersectionObserver === "undefined",
  );
  const [canvasLayoutVersion, setCanvasLayoutVersion] = useState(0);
  const prevUrlRef = useRef<string | undefined>(url);

  const speed = SPEED_OPTIONS[speedIndex]!;

  // Reset state when URL changes
  useEffect(() => {
    if (prevUrlRef.current !== url) {
      prevUrlRef.current = url;
      setDuration(0);
      setCurrentTime(0);
      setIsPlaying(false);
      setError(null);
      setAudioMeta(null);
      setWaveformBars(Array.isArray(viewConfig?.peaks) ? normalizePeaksArray(viewConfig.peaks) : null);
    } else if (Array.isArray(viewConfig?.peaks)) {
      setWaveformBars(normalizePeaksArray(viewConfig.peaks));
    }
  }, [url, viewConfig?.peaks]);

  useEffect(() => {
    if (isFullScreen) {
      setShouldDecode(true);
    }
  }, [isFullScreen]);

  // Observe visibility to defer waveform fetch/decode until visible and pause when scrolled out
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || !wrapperRef.current) {
      setShouldDecode(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShouldDecode(true);
          } else if (audioRef.current && !audioRef.current.paused) {
            audioRef.current.pause();
          }
        }
      },
      { threshold: 0.05 },
    );
    observer.observe(wrapperRef.current);
    return () => observer.disconnect();
  }, []);

  // Observe canvas resize so we only reallocate backing store when dimensions or DPR change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      setCanvasLayoutVersion((v) => v + 1);
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!url) {
      setWaveformBars(null);
      setAudioMeta(null);
      return;
    }

    // If precomputed peaks are provided in viewConfig, use them directly without fetching/decoding the audio file
    if (Array.isArray(viewConfig?.peaks)) {
      const normalized = normalizePeaksArray(viewConfig.peaks);
      if (normalized) {
        setWaveformBars(normalized);
        return;
      }
    }

    if (!shouldDecode) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    let audioCtx: AudioContext | null = null;

    const decodeWaveform = async () => {
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arrayBuf = await res.arrayBuffer();
        if (cancelled || controller.signal.aborted) return;
        const AudioCtx =
          window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        audioCtx = new AudioCtx();
        const decoded = await audioCtx.decodeAudioData(arrayBuf);
        if (cancelled || controller.signal.aborted) return;

        const channelData = decoded.getChannelData(0);
        const barsCount = 80;
        const blockSize = Math.max(1, Math.floor(channelData.length / barsCount));
        const peaks: number[] = [];
        let maxPeak = 0;

        for (let i = 0; i < barsCount; i++) {
          const start = i * blockSize;
          let peak = 0;
          const end = Math.min(channelData.length, start + blockSize);
          for (let j = start; j < end; j++) {
            const abs = Math.abs(channelData[j] ?? 0);
            if (abs > peak) peak = abs;
          }
          peaks.push(peak);
          if (peak > maxPeak) maxPeak = peak;
        }

        const normalized = peaks.map((p) => (maxPeak > 0 ? Math.max(0.05, p / maxPeak) : 0.05));
        setWaveformBars(normalized);
        setAudioMeta({
          sampleRate: decoded.sampleRate,
          channels: decoded.numberOfChannels,
        });
        if (Number.isFinite(decoded.duration) && decoded.duration > 0) {
          setDuration(decoded.duration);
        }
      } catch (err) {
        if ((err as { name?: string } | null)?.name === "AbortError") return;
        if (!cancelled) {
          setWaveformBars(null);
          setAudioMeta(null);
        }
      } finally {
        if (audioCtx && audioCtx.state !== "closed") {
          void audioCtx.close().catch(() => undefined);
        }
      }
    };

    void decodeWaveform();

    return () => {
      cancelled = true;
      controller.abort();
      if (audioCtx && audioCtx.state !== "closed") {
        void audioCtx.close().catch(() => undefined);
      }
    };
  }, [url, viewConfig?.peaks, shouldDecode]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  }, [speed]);

  // Render waveform or linear progress bar to canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const targetWidth = Math.max(1, Math.round(rect.width * dpr));
    const targetHeight = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const progress = duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) : 0;

    if (waveformBars && waveformBars.length > 0) {
      const barWidth = rect.width / waveformBars.length;
      const gap = 2;
      const maxHeight = rect.height * 0.85;

      waveformBars.forEach((barHeightFraction, index) => {
        const x = index * barWidth;
        const h = barHeightFraction * maxHeight;
        const y = (rect.height - h) / 2;

        const isPlayed = index / waveformBars.length <= progress;
        ctx.fillStyle = isPlayed ? "#a855f7" : "rgba(168, 85, 247, 0.25)";
        drawRoundedBar(ctx, x, y, Math.max(1, barWidth - gap), h, 2);
      });
    } else {
      const trackHeight = 6;
      const trackY = (rect.height - trackHeight) / 2;
      ctx.fillStyle = "rgba(168, 85, 247, 0.25)";
      drawRoundedBar(ctx, 0, trackY, rect.width, trackHeight, 3);

      if (progress > 0) {
        ctx.fillStyle = "#a855f7";
        drawRoundedBar(ctx, 0, trackY, Math.max(4, rect.width * progress), trackHeight, 3);
      }
    }
  }, [waveformBars, currentTime, duration, isFullScreen, canvasLayoutVersion]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || error) return;
    setShouldDecode(true);
    if (!audio.paused) {
      audio.pause();
    } else {
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => setIsPlaying(false));
      }
    }
  }, [error]);

  const seekToTime = useCallback(
    (targetSeconds: number) => {
      if (!audioRef.current || duration <= 0) return;
      const clamped = Math.max(0, Math.min(duration, targetSeconds));
      audioRef.current.currentTime = clamped;
      setCurrentTime(clamped);
    },
    [duration],
  );

  const handleWaveformClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!audioRef.current || duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const ratio = x / rect.width;
    seekToTime(ratio * duration);
  };

  const handleWaveformKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      const step = duration > 0 ? Math.min(5, Math.max(0.5, duration * 0.05)) : 2;
      seekToTime(currentTime - step);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      const step = duration > 0 ? Math.min(5, Math.max(0.5, duration * 0.05)) : 2;
      seekToTime(currentTime + step);
    } else if (e.key === " " || e.key === "Spacebar" || e.key === "Enter") {
      e.preventDefault();
      togglePlay();
    }
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
    link.download = buildAudioDownloadFilename(String(title || "audio_recording"), url);
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

  const resolvedSampleRate =
    audioMeta?.sampleRate ?? (typeof viewConfig?.sampleRate === "number" ? viewConfig.sampleRate : undefined);
  const resolvedChannels =
    audioMeta?.channels ??
    (typeof viewConfig?.channels === "number"
      ? viewConfig.channels
      : typeof viewConfig?.numberOfChannels === "number"
        ? viewConfig.numberOfChannels
        : undefined);
  const metadataParts: string[] = [];
  if (resolvedSampleRate) {
    metadataParts.push(`${(resolvedSampleRate / 1000).toFixed(1).replace(/\.0$/, "")} kHz`);
  }
  if (resolvedChannels) {
    metadataParts.push(
      resolvedChannels === 1 ? "Mono" : resolvedChannels === 2 ? "Stereo" : `${resolvedChannels} Channels`,
    );
  }

  return (
    <Wrapper ref={wrapperRef} $isFullScreen={isFullScreen}>
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
        {error && (
          <Box
            width="100%"
            p={2}
            backgroundColor="rgba(248, 81, 73, 0.12)"
            border="1px solid rgba(248, 81, 73, 0.35)"
            borderRadius="6px"
            display="flex"
            alignItems="center"
            justifyContent="space-between"
          >
            <Text fontSize="12px" color="var(--color-danger-fg, #f85149)">
              {error}
            </Text>
            <Button size="small" onClick={() => setError(null)}>
              Retry
            </Button>
          </Box>
        )}

        <WaveformCanvas
          ref={canvasRef}
          $isFullScreen={isFullScreen}
          role="slider"
          tabIndex={0}
          aria-label="Audio seekbar"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration || 0)}
          aria-valuenow={Math.round(currentTime || 0)}
          onClick={handleWaveformClick}
          onKeyDown={handleWaveformKeyDown}
          title="Click or use Left/Right arrows to seek"
        />

        <ControlsRow>
          <Button
            size="medium"
            onClick={togglePlay}
            leadingVisual={isPlaying ? SquareFillIcon : PlayIcon}
            variant="primary"
            disabled={Boolean(error)}
          >
            {isPlaying ? "Pause" : "Play"}
          </Button>

          {metadataParts.length > 0 && (
            <Text fontSize="12px" color="var(--color-fg-muted)">
              {metadataParts.join(" • ")}
            </Text>
          )}
        </ControlsRow>

        <audio
          ref={audioRef}
          src={url}
          preload="metadata"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          onError={() => {
            setIsPlaying(false);
            setError("Unable to load or decode audio track.");
          }}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d) && d > 0) {
              setDuration(d);
            }
          }}
        />
      </VisualizerContainer>
    </Wrapper>
  );
};

export default AudioViewer;

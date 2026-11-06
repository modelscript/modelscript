// SPDX-License-Identifier: AGPL-3.0-or-later

import { ChevronLeftIcon, ChevronRightIcon } from "@primer/octicons-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { safeJsonParse } from "../../util/json";
import { isLongFormArticle } from "../../util/notebook";
import ArtifactViewCard from "../artifacts/ArtifactViewCard";
import { PostMarkdownContent } from "./PostMarkdownContent";

export interface PostSlideItem {
  id: string | number;
  type: "code" | "artifact";
  lang?: string | undefined;
  code?: string | undefined;
  rawBlock?: string | undefined;
  artifactId?: string | number | undefined;
  initialArtifactView?: unknown;
  caption?: string | undefined;
  figureNumber?: number | undefined;
}

export interface PostArtifactSliderProps {
  slides: PostSlideItem[];
  forkedFromId?: number | null | undefined;
  onPinCreated?: ((pin: unknown) => void) | undefined;
}

const SliderContainer = styled.div`
  position: relative;
  width: 100%;
  max-width: 100%;
  margin-top: 10px;
  margin-bottom: 4px;
  overflow: visible;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const SliderHeaderBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 0 2px;
  box-sizing: border-box;
`;

const TrackStage = styled.div`
  position: relative;
  width: 100%;
  max-width: 100%;
  overflow: visible;
`;

const TrackViewport = styled.div`
  position: relative;
  width: 100%;
  max-width: 100%;
  border-radius: 12px;
  overflow: hidden;
`;

const Track = styled.div`
  display: flex;
  flex-direction: row;
  align-items: stretch;
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scroll-behavior: smooth;
  scrollbar-width: none;
  -ms-overflow-style: none;
  -webkit-overflow-scrolling: touch;

  &::-webkit-scrollbar {
    display: none;
  }
`;

const SlideWrapper = styled.div`
  flex: 0 0 100%;
  min-width: 100%;
  max-width: 100%;
  align-self: stretch;
  height: 100%;
  scroll-snap-align: start;
  scroll-snap-stop: always;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;

  /* Ensure cards and code blocks inside slides take full height without redundant outer vertical margins */
  & > div {
    margin-top: 0 !important;
    margin-bottom: 0 !important;
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  & > .markdown-body {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  pre.msx-code-pre {
    margin: 0 !important;
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    box-sizing: border-box;
    border-radius: 12px;
  }

  .msx-code-header {
    flex: 0 0 auto !important;
  }

  .msx-code-body {
    flex: 1 1 auto !important;
    overflow-y: auto;
  }

  .msx-code-diagram {
    flex: 1 1 auto !important;
  }

  /* Stretch artifact cards and nested viewers to take full height */
  & > div > :first-child {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  & > div > :first-child > * {
    flex: 1 1 auto;
    min-height: 0;
  }
`;

const NavButton = styled.button<{ $direction: "left" | "right" }>`
  position: absolute;
  top: 50%;
  ${(props) => (props.$direction === "left" ? "left: -16px;" : "right: -16px;")}
  transform: translateY(-50%);
  z-index: 5;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.15));
  background: rgba(15, 23, 42, 0.78);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
  transition:
    transform 0.18s ease,
    background-color 0.18s ease,
    opacity 0.18s ease;

  &:hover {
    background: rgba(15, 23, 42, 0.95);
    transform: translateY(-50%) scale(1.08);
  }

  &:active {
    transform: translateY(-50%) scale(0.96);
  }
`;

const SlideCounterBadge = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  font-weight: 600;
  color: var(--color-fg-muted, #8b949e);
  background: var(--color-canvas-subtle, rgba(15, 23, 42, 0.06));
  border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.12));
  pointer-events: none;
  user-select: none;
  line-height: 1.4;
`;

const BubbleSliderContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 7px;
  padding: 2px 0;
  user-select: none;
`;

const SkeletonBubble = styled.button<{ $active: boolean }>`
  height: 7px;
  width: ${(props) => (props.$active ? "24px" : "8px")};
  border-radius: 999px;
  border: 1px solid
    ${(props) => (props.$active ? "var(--color-accent-blue-border, #388bfd)" : "rgba(255, 255, 255, 0.08)")};
  background: ${(props) =>
    props.$active
      ? "var(--ms-brand, var(--color-accent-emphasis, #388bfd))"
      : "var(--color-border-default, rgba(255, 255, 255, 0.22))"};
  box-shadow: ${(props) => (props.$active ? "0 0 8px rgba(56, 139, 253, 0.45)" : "none")};
  cursor: pointer;
  padding: 0;
  outline: none;
  transition:
    width 0.25s cubic-bezier(0.4, 0, 0.2, 1),
    background-color 0.25s ease,
    box-shadow 0.25s ease,
    border-color 0.25s ease;

  &:hover {
    background: ${(props) =>
      props.$active ? "var(--ms-brand, #388bfd)" : "var(--color-fg-muted, rgba(255, 255, 255, 0.45))"};
  }

  &:focus-visible {
    box-shadow: 0 0 0 2px var(--ms-brand, #388bfd);
  }
`;

export const PostArtifactSlider: React.FC<PostArtifactSliderProps> = ({ slides, forkedFromId, onPinCreated }) => {
  // Enforce maximum 4 slides for short posts
  const effectiveSlides = slides.slice(0, 4);
  const [activeIndex, setActiveIndex] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const isScrollingRef = useRef(false);

  const totalSlides = effectiveSlides.length;

  const scrollToSlide = useCallback(
    (index: number) => {
      const track = trackRef.current;
      if (!track) return;
      const clamped = Math.max(0, Math.min(index, totalSlides - 1));
      isScrollingRef.current = true;
      track.scrollTo({
        left: clamped * track.clientWidth,
        behavior: "smooth",
      });
      setActiveIndex(clamped);
      setTimeout(() => {
        isScrollingRef.current = false;
      }, 350);
    },
    [totalSlides],
  );

  const handleScroll = useCallback(() => {
    if (isScrollingRef.current) return;
    const track = trackRef.current;
    if (!track || track.clientWidth <= 0) return;
    const newIdx = Math.round(track.scrollLeft / track.clientWidth);
    const clamped = Math.max(0, Math.min(newIdx, totalSlides - 1));
    setActiveIndex(clamped);
  }, [totalSlides]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    track.addEventListener("scroll", handleScroll, { passive: true });
    return () => track.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  // Adjust on window resize
  useEffect(() => {
    const handleResize = () => {
      const track = trackRef.current;
      if (!track) return;
      track.scrollTo({
        left: activeIndex * track.clientWidth,
        behavior: "auto",
      });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [activeIndex]);

  if (effectiveSlides.length === 0) {
    return null;
  }

  // Single artifact: Render directly without slider chrome
  if (effectiveSlides.length === 1) {
    const single = effectiveSlides[0]!;
    return (
      <div style={{ width: "100%", maxWidth: "100%", marginTop: "10px" }}>
        {single.type === "code" ? (
          <PostMarkdownContent text={single.rawBlock || `\`\`\`${single.lang || "modelica"}\n${single.code}\n\`\`\``} />
        ) : (
          <ArtifactViewCard
            artifactId={single.artifactId!}
            initialArtifactView={single.initialArtifactView}
            figureNumber={single.figureNumber}
            caption={single.caption}
            forkedFromId={forkedFromId}
            onPinCreated={onPinCreated}
          />
        )}
      </div>
    );
  }

  return (
    <SliderContainer
      data-testid="post-artifact-slider"
      data-active-index={activeIndex}
      data-total-slides={totalSlides}
      onClick={(e) => {
        // Prevent clicking inside the slider from triggering whole-post navigation
        e.stopPropagation();
      }}
    >
      {/* Top Bar above content: Skeleton Bubble Slider (top-left) + Page Number (top-right) */}
      <SliderHeaderBar data-testid="artifact-slider-header">
        <BubbleSliderContainer
          role="tablist"
          aria-label="Artifact slide navigation"
          data-testid="artifact-skeleton-bubble-slider"
        >
          {effectiveSlides.map((slide, idx) => {
            const isActive = activeIndex === idx;
            return (
              <SkeletonBubble
                key={slide.id || `bubble-${idx}`}
                type="button"
                role="tab"
                $active={isActive}
                aria-selected={isActive}
                aria-label={`Slide ${idx + 1} of ${totalSlides}`}
                data-testid={`artifact-bubble-${idx}`}
                data-active={isActive ? "true" : "false"}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  scrollToSlide(idx);
                }}
              />
            );
          })}
        </BubbleSliderContainer>

        {/* Counter Badge */}
        <SlideCounterBadge data-testid="artifact-slider-counter">
          {activeIndex + 1} / {totalSlides}
        </SlideCounterBadge>
      </SliderHeaderBar>

      <TrackStage>
        <TrackViewport>
          <Track ref={trackRef} data-testid="artifact-slider-track">
            {effectiveSlides.map((slide, idx) => (
              <SlideWrapper key={slide.id || `slide-${idx}`} data-slide-index={idx}>
                {slide.type === "code" ? (
                  <PostMarkdownContent
                    text={slide.rawBlock || `\`\`\`${slide.lang || "modelica"}\n${slide.code}\n\`\`\``}
                  />
                ) : (
                  <ArtifactViewCard
                    artifactId={slide.artifactId!}
                    initialArtifactView={slide.initialArtifactView}
                    figureNumber={slide.figureNumber ?? idx + 1}
                    caption={slide.caption}
                    forkedFromId={forkedFromId}
                    onPinCreated={onPinCreated}
                  />
                )}
              </SlideWrapper>
            ))}
          </Track>
        </TrackViewport>

        {/* Navigation Arrows split in the center of the left/right artifact borders */}
        {activeIndex > 0 && (
          <NavButton
            type="button"
            $direction="left"
            data-testid="artifact-slider-prev"
            aria-label="Previous artifact slide"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              scrollToSlide(activeIndex - 1);
            }}
          >
            <ChevronLeftIcon size={18} />
          </NavButton>
        )}

        {activeIndex < totalSlides - 1 && (
          <NavButton
            type="button"
            $direction="right"
            data-testid="artifact-slider-next"
            aria-label="Next artifact slide"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              scrollToSlide(activeIndex + 1);
            }}
          >
            <ChevronRightIcon size={18} />
          </NavButton>
        )}
      </TrackStage>
    </SliderContainer>
  );
};

export default React.memo(PostArtifactSlider);

/**
 * Extracts artifact slides and clean prose text for short posts.
 * If the post has multiple items (code blocks and/or artifacts), they are extracted into
 * slides (limited to max 4). Longer articles are bypassed.
 */
export function extractShortPostSlides(
  displayPost: unknown,
  notebookData?: unknown,
): {
  isShortPost: boolean;
  proseText: string;
  slides: PostSlideItem[];
} {
  const isArticle = isLongFormArticle(displayPost, notebookData);
  const postObj = (displayPost && typeof displayPost === "object" ? displayPost : {}) as Record<string, unknown>;
  const rawContent = typeof postObj["content"] === "string" ? (postObj["content"] as string) : "";
  if (isArticle) {
    return { isShortPost: false, proseText: rawContent, slides: [] };
  }

  const postMeta =
    typeof postObj["metadata"] === "string"
      ? safeJsonParse<Record<string, unknown>>(postObj["metadata"] as string, {})
      : ((postObj["metadata"] && typeof postObj["metadata"] === "object" ? postObj["metadata"] : {}) as Record<
          string,
          unknown
        >);

  const slides: PostSlideItem[] = [];
  const seenArtifactIds = new Set<string>();

  // 1. Extract fenced code blocks from content
  const FENCED_CODE_REGEX = /```([a-zA-Z0-9_.-]*)\s*\n([\s\S]*?)```/g;
  let codeMatch: RegExpExecArray | null;
  const codeBlocks: { lang: string; code: string; raw: string; index: number; length: number }[] = [];

  while ((codeMatch = FENCED_CODE_REGEX.exec(rawContent)) !== null) {
    codeBlocks.push({
      lang: codeMatch[1]?.trim() || "modelica",
      code: codeMatch[2] || "",
      raw: codeMatch[0],
      index: codeMatch.index,
      length: codeMatch[0].length,
    });
  }

  // 2. Extract artifact IDs and views (must be valid non-empty string or numeric IDs)
  const metaArtIds: string[] = Array.isArray(postMeta?.["artifactIds"])
    ? (postMeta["artifactIds"] as unknown[])
        .filter((id: unknown) => id !== null && id !== undefined && String(id).trim() !== "" && String(id) !== "0")
        .map(String)
    : [];

  const nbObj = (notebookData && typeof notebookData === "object" ? notebookData : {}) as Record<string, unknown>;
  const notebookCells = Array.isArray(nbObj["cells"])
    ? (nbObj["cells"] as { id?: string; type?: string; artifactId?: unknown; title?: string; caption?: string }[])
    : [];
  const notebookArtCells = notebookCells.filter(
    (c) =>
      c.type === "artifact" &&
      c.artifactId !== null &&
      c.artifactId !== undefined &&
      String(c.artifactId).trim() !== "" &&
      String(c.artifactId) !== "0",
  );

  const rawPrimary = postObj["artifact_view_id"];
  const primaryArtId =
    rawPrimary !== null && rawPrimary !== undefined && String(rawPrimary).trim() !== "" && String(rawPrimary) !== "0"
      ? String(rawPrimary)
      : null;

  // Directives in content
  const directiveRegex = /::artifact(?:\[([^\]]*)\])?\{([^}]*)\}/g;
  let dirMatch: RegExpExecArray | null;
  const directiveArtIds: { id: string; title?: string; caption?: string }[] = [];
  while ((dirMatch = directiveRegex.exec(rawContent)) !== null) {
    const idM = (dirMatch[2] || "").match(/(?:^|\s)id\s*=\s*["']?(\d+)["']?/);
    const capM = (dirMatch[2] || "").match(/(?:^|\s)caption\s*=\s*(?:"([^"]*)"|'([^']*)')/);
    if (idM && idM[1] && idM[1] !== "0") {
      directiveArtIds.push({
        id: idM[1],
        title: dirMatch[1]?.trim(),
        caption: capM ? (capM[1] ?? capM[2]) : undefined,
      });
    }
  }

  const combinedArtifacts: { id: string; title?: string; caption?: string; initialView?: unknown }[] = [];

  const addArtifact = (id: string | number, title?: string, caption?: string) => {
    const strId = String(id).trim();
    if (!strId || strId === "0" || seenArtifactIds.has(strId)) return;
    seenArtifactIds.add(strId);
    const artViews = postObj["artifact_views"] as Record<string, unknown> | undefined;
    const isMatchingPrimary =
      primaryArtId &&
      (strId === primaryArtId ||
        (/^\d{16,}$/.test(strId) &&
          /^\d{16,}$/.test(primaryArtId) &&
          Math.abs(Number(strId) - Number(primaryArtId)) <= 128));
    const initialView = artViews?.[strId] || (isMatchingPrimary ? postObj["artifact_view"] : undefined);
    combinedArtifacts.push({ id: strId, title, caption, initialView });
  };

  // Add from notebook cells first
  for (const cell of notebookArtCells) {
    addArtifact(String(cell.artifactId), cell.title, cell.caption);
  }

  // Add from directives
  for (const dir of directiveArtIds) {
    addArtifact(dir.id, dir.title, dir.caption);
  }

  // Add from metadata.artifactIds
  for (const aid of metaArtIds) {
    addArtifact(aid);
  }

  // Add primary artifact view id
  if (primaryArtId !== null) {
    addArtifact(primaryArtId);
  }

  const totalItemsCount = codeBlocks.length + combinedArtifacts.length;

  // If there are multiple items (>= 2):
  // Put them into the horizontal slider!
  if (totalItemsCount >= 2) {
    // Add code blocks as slides
    for (let i = 0; i < codeBlocks.length; i++) {
      const cb = codeBlocks[i]!;
      slides.push({
        id: `code-${i}`,
        type: "code",
        lang: cb.lang,
        code: cb.code,
        rawBlock: cb.raw,
      });
    }

    // Add artifacts as slides
    for (let i = 0; i < combinedArtifacts.length; i++) {
      const art = combinedArtifacts[i]!;
      slides.push({
        id: `art-${art.id}-${i}`,
        type: "artifact",
        artifactId: art.id,
        initialArtifactView: art.initialView,
        caption: art.caption,
        figureNumber: i + 1,
      });
    }

    // Enforce max 4 limit for short posts!
    const cappedSlides = slides.slice(0, 4);

    const proseText = rawContent
      .replace(FENCED_CODE_REGEX, "")
      .replace(/::artifact(?:\[[^\]]*\])?\{[^}]*\}/g, "")
      .trim();

    return {
      isShortPost: true,
      proseText,
      slides: cappedSlides,
    };
  }

  // If exactly 1 artifact and 0 code blocks:
  if (combinedArtifacts.length === 1 && codeBlocks.length === 0) {
    return {
      isShortPost: true,
      proseText: rawContent.replace(/::artifact(?:\[[^\]]*\])?\{[^}]*\}/g, "").trim(),
      slides: [
        {
          id: `art-${combinedArtifacts[0]!.id}`,
          type: "artifact",
          artifactId: combinedArtifacts[0]!.id,
          initialArtifactView: combinedArtifacts[0]!.initialView,
          caption: combinedArtifacts[0]!.caption,
        },
      ],
    };
  }

  // If 0 or 1 code block and 0 artifacts:
  return {
    isShortPost: true,
    proseText: rawContent,
    slides: [],
  };
}

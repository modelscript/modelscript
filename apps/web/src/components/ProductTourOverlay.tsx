// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, SparklesFillIcon, XIcon } from "@primer/octicons-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import styledImport from "styled-components";
import { completeUserOnboarding } from "../api/admin";
import { useAuth } from "../AuthContext";
import { DEFAULT_FRONTEND_FLAGS, useFeatureFlag } from "../FeatureFlagContext";
import { useInstanceBranding } from "../InstanceBrandingContext";
import { useTheme } from "../theme";

const styled: typeof styledImport = (styledImport as any).default ?? styledImport;

export interface ProductTourStep {
  id: string;
  selector: string;
  fallbackSelector?: string;
  badge: string;
  title: string;
  description: string;
  preferredPlacement: "bottom" | "right" | "left";
}

export interface ProductTourFlagConfig {
  package_browser?: boolean | undefined;
  git_repositories?: boolean | undefined;
  heavy_vscode_ide?: boolean | undefined;
  cae_cloud_solver?: boolean | undefined;
  activitypub_federation?: boolean | undefined;
}

export function getProductTourSteps(flags: ProductTourFlagConfig = DEFAULT_FRONTEND_FLAGS): ProductTourStep[] {
  const hasPackages = flags.package_browser !== false;
  const hasRepos = flags.git_repositories !== false;
  const hasIde = flags.heavy_vscode_ide !== false;
  const hasCloudSolver = Boolean(flags.cae_cloud_solver);
  const hasFederation = Boolean(flags.activitypub_federation);

  const steps: ProductTourStep[] = [
    {
      id: "timeline",
      selector: '[data-tour-id="tour-timeline"]',
      fallbackSelector: "main",
      badge: "Timeline & Compose",
      title: "Your Engineering Timeline",
      description: hasFederation
        ? "Share executable models, interactive simulation plots, and technical notes—or switch between For You, Following, and Federated feeds."
        : "Share executable models, interactive simulation plots, and technical notes—or switch between your For You and Following feeds.",
      preferredPlacement: "bottom",
    },
    {
      id: "explore",
      selector: '[data-tour-id="tour-explore"]',
      fallbackSelector: '[data-tour-id="tour-mobile-explore"]',
      badge: "Discovery & Search",
      title: "Explore & Instant Search",
      description: hasPackages
        ? "Discover community models, benchmarks, and discussions—or press Cmd/Ctrl + K anytime to search across posts, equations, and packages."
        : "Discover community models, benchmarks, and discussions—or press Cmd/Ctrl + K anytime to search across posts, equations, and topics.",
      preferredPlacement: "right",
    },
  ];

  if (hasPackages || hasRepos) {
    steps.push({
      id: "registry",
      selector: '[data-tour-id="tour-registry"]',
      fallbackSelector: "header",
      badge: hasPackages && hasRepos ? "Libraries & Git" : hasPackages ? "Standard Libraries" : "Git Repositories",
      title:
        hasPackages && hasRepos
          ? "Packages & Git Repositories"
          : hasPackages
            ? "Engineering Package Registry"
            : "Engineering Git Repositories",
      description:
        hasPackages && hasRepos
          ? "Browse versioned standard libraries (Modelica Standard Library, SysML v2, STEP) and collaborate on Git-backed engineering repositories."
          : hasPackages
            ? "Browse versioned standard libraries (Modelica Standard Library, SysML v2, STEP) and inspect reusable components."
            : "Collaborate on version-controlled engineering repositories, model source trees, and project branches.",
      preferredPlacement: "right",
    });
  }

  steps.push({
    id: "workbenches",
    selector: '[data-tour-id="tour-workbenches"]',
    fallbackSelector: "header",
    badge: hasIde ? "Simulation & IDE" : "Simulation & Docs",
    title: hasIde ? "Zero-Install Playground & IDE" : "Zero-Install Playground & Docs",
    description: hasIde
      ? "Launch instant WebAssembly simulations in the Playground or open the full VS Code-powered IDE Workbench for multi-file projects."
      : "Launch instant in-browser WebAssembly simulations in the Playground and browse the engineering documentation.",
    preferredPlacement: "right",
  });

  steps.push({
    id: "right-panel",
    selector: '[data-tour-id="tour-right-panel"]',
    fallbackSelector: "main",
    badge: hasCloudSolver ? "Solvers & Community" : "Trending & Community",
    title: hasCloudSolver ? "Cloud Solvers, Trends & Peers" : "Trending Topics & Peers",
    description: hasCloudSolver
      ? "Monitor cloud CAE solver queues, track trending engineering topics, and follow researchers and engineers across the network."
      : "Track trending engineering topics and tags, and discover researchers and engineers to follow across your network.",
    preferredPlacement: "left",
  });

  return steps;
}

export const PRODUCT_TOUR_STEPS: ProductTourStep[] = getProductTourSteps(DEFAULT_FRONTEND_FLAGS);

const OverlayRoot = styled.div`
  position: fixed;
  inset: 0;
  z-index: 9998;
  pointer-events: auto;
  user-select: none;
`;

const SpotlightRing = styled.div`
  position: fixed;
  z-index: 9999;
  pointer-events: none;
  border-radius: 14px;
  border: 2px solid var(--ms-brand, #06b6d4);
  box-shadow:
    0 0 0 4px color-mix(in srgb, var(--ms-brand, #06b6d4) 22%, transparent),
    0 0 28px color-mix(in srgb, var(--ms-brand, #06b6d4) 38%, transparent);
  transition:
    top 0.24s cubic-bezier(0.16, 1, 0.3, 1),
    left 0.24s cubic-bezier(0.16, 1, 0.3, 1),
    width 0.24s cubic-bezier(0.16, 1, 0.3, 1),
    height 0.24s cubic-bezier(0.16, 1, 0.3, 1);
`;

const PopoverCard = styled.div`
  position: fixed;
  z-index: 10000;
  width: 372px;
  max-width: calc(100vw - 32px);
  background: var(--ms-bg-elv, #0e1424);
  border: 1px solid color-mix(in srgb, var(--ms-brand, #06b6d4) 38%, var(--ms-border, rgba(148, 163, 184, 0.25)));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-radius: 16px;
  padding: 18px 20px;
  box-shadow: var(--ms-shadow-pop, 0 24px 60px rgba(0, 0, 0, 0.35));
  color: var(--ms-text-1, #e2e8f0);
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition:
    top 0.24s cubic-bezier(0.16, 1, 0.3, 1),
    left 0.24s cubic-bezier(0.16, 1, 0.3, 1);
`;

const TopMetaRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const StepBadge = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
  color: var(--ms-brand, #06b6d4);
  background: var(--ms-brand-soft, rgba(6, 182, 212, 0.12));
  border: 1px solid color-mix(in srgb, var(--ms-brand, #06b6d4) 28%, transparent);
  padding: 4px 10px;
  border-radius: 999px;
`;

const DismissButton = styled.button`
  background: transparent;
  border: none;
  color: var(--ms-text-2, #64748b);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition:
    color 0.15s ease,
    background-color 0.15s ease;

  &:hover {
    color: var(--ms-text-heading, #0f172a);
    background: var(--ms-surface-hover, rgba(148, 163, 184, 0.12));
  }
`;

const StepTitle = styled.h3`
  margin: 0;
  font-size: 16.5px;
  font-weight: 750;
  color: var(--ms-text-heading, #0f172a);
  letter-spacing: -0.01em;
  line-height: 1.3;
`;

const StepDescription = styled.p`
  margin: 0;
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--ms-text-2, #475569);
`;

const FooterRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--ms-divider, rgba(148, 163, 184, 0.2));
`;

const DotsRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

const DotButton = styled.button<{ $active: boolean }>`
  width: ${(props) => (props.$active ? "18px" : "7px")};
  height: 7px;
  border-radius: 999px;
  border: none;
  padding: 0;
  cursor: pointer;
  background: ${(props) =>
    props.$active ? "var(--ms-brand, #06b6d4)" : "color-mix(in srgb, var(--ms-text-3, #94a3b8) 45%, transparent)"};
  transition: all 0.2s ease;

  &:hover {
    background: ${(props) =>
      props.$active ? "var(--ms-brand, #06b6d4)" : "color-mix(in srgb, var(--ms-text-2, #64748b) 70%, transparent)"};
  }
`;

const NavButtons = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const SecondaryNavButton = styled.button`
  background: var(--ms-surface-hover, rgba(148, 163, 184, 0.1));
  border: 1px solid var(--ms-border, rgba(148, 163, 184, 0.25));
  color: var(--ms-text-1, #1e293b);
  font-size: 12.5px;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: 8px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: all 0.15s ease;

  &:hover {
    background: var(--ms-surface-selected, rgba(148, 163, 184, 0.18));
    border-color: var(--ms-border-strong, rgba(148, 163, 184, 0.4));
  }
`;

const PrimaryNavButton = styled.button`
  background: var(--ms-brand, linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%));
  border: none;
  color: var(--ms-brand-contrast, #fff);
  font-size: 12.5px;
  font-weight: 700;
  padding: 6px 14px;
  border-radius: 8px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition:
    background-color 0.15s ease,
    opacity 0.15s ease;

  &:hover {
    background: var(--ms-brand-hover, var(--ms-brand));
    opacity: 0.94;
  }
`;

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const SPOTLIGHT_PADDING = 6;
const POPOVER_GAP = 14;
const POPOVER_WIDTH = 372;
const POPOVER_ESTIMATED_HEIGHT = 210;

function getTourStorageKey(userId: number | string | undefined): string {
  return `modelscript:product_tour_seen:${userId ?? "guest"}`;
}

export interface ProductTourOverlayProps {
  /** Force open for testing or static preview */
  forceOpen?: boolean | undefined;
  initialStepIndex?: number | undefined;
  flagOverrides?: ProductTourFlagConfig | undefined;
}

export const ProductTourOverlay: React.FC<ProductTourOverlayProps> = ({
  forceOpen = false,
  initialStepIndex = 0,
  flagOverrides,
}) => {
  const { user, refreshUser } = useAuth();
  const branding = useInstanceBranding();
  const { theme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const hasPackages = useFeatureFlag("package_browser");
  const hasRepos = useFeatureFlag("git_repositories");
  const hasIde = useFeatureFlag("heavy_vscode_ide");
  const hasCloudSolver = useFeatureFlag("cae_cloud_solver");
  const hasFederation = useFeatureFlag("activitypub_federation");

  const tourSteps = useMemo(
    () =>
      getProductTourSteps({
        package_browser: flagOverrides?.package_browser ?? hasPackages,
        git_repositories: flagOverrides?.git_repositories ?? hasRepos,
        heavy_vscode_ide: flagOverrides?.heavy_vscode_ide ?? hasIde,
        cae_cloud_solver: flagOverrides?.cae_cloud_solver ?? hasCloudSolver,
        activitypub_federation: flagOverrides?.activitypub_federation ?? hasFederation,
      }),
    [flagOverrides, hasPackages, hasRepos, hasIde, hasCloudSolver, hasFederation],
  );

  const [isOpen, setIsOpen] = useState<boolean>(forceOpen);
  const [stepIndex, setStepIndex] = useState<number>(initialStepIndex);
  const [targetRect, setTargetRect] = useState<SpotlightRect | null>(null);
  const [viewport, setViewport] = useState<{ width: number; height: number }>(() => ({
    width: typeof window !== "undefined" ? window.innerWidth : 1280,
    height: typeof window !== "undefined" ? window.innerHeight : 800,
  }));

  const markOnboardingSeen = useCallback(() => {
    try {
      if (typeof localStorage !== "undefined" && user?.id) {
        localStorage.setItem(getTourStorageKey(user.id), "1");
      }
    } catch {
      // Ignore storage errors
    }
    if (user && !user.onboarding_completed) {
      completeUserOnboarding().catch(() => {});
    }
  }, [user]);

  // 1. Check URL ?tour=1 trigger or first-time user onboarding status
  useEffect(() => {
    if (forceOpen) {
      setIsOpen(true);
      return;
    }

    const searchParams = new URLSearchParams(location.search);
    if (searchParams.get("tour") === "1") {
      setStepIndex(0);
      setIsOpen(true);
      markOnboardingSeen();
      searchParams.delete("tour");
      const nextSearch = searchParams.toString();
      navigate(`${location.pathname}${nextSearch ? `?${nextSearch}` : ""}${location.hash}`, { replace: true });
      return;
    }

    if (
      user &&
      !user.onboarding_completed &&
      branding.loaded &&
      branding.onboardingWizardEnabled !== false &&
      location.pathname === "/home"
    ) {
      let alreadySeenLocal = false;
      try {
        alreadySeenLocal = localStorage.getItem(getTourStorageKey(user.id)) === "1";
      } catch {
        // Ignore storage errors
      }
      if (!alreadySeenLocal) {
        setStepIndex(0);
        setIsOpen(true);
        markOnboardingSeen();
      }
    }
  }, [
    forceOpen,
    location.pathname,
    location.search,
    location.hash,
    user,
    branding.loaded,
    branding.onboardingWizardEnabled,
    navigate,
    markOnboardingSeen,
  ]);

  // 2. Listen for custom event `modelscript:start-product-tour`
  useEffect(() => {
    const handleStartTour = () => {
      if (location.pathname !== "/home") {
        navigate("/home?tour=1");
      } else {
        setStepIndex(0);
        setIsOpen(true);
        markOnboardingSeen();
      }
    };
    window.addEventListener("modelscript:start-product-tour", handleStartTour);
    return () => {
      window.removeEventListener("modelscript:start-product-tour", handleStartTour);
    };
  }, [location.pathname, navigate, markOnboardingSeen]);

  const safeStepIndex = Math.min(stepIndex, Math.max(0, tourSteps.length - 1));
  const currentStep = tourSteps[safeStepIndex] ?? tourSteps[0]!;

  // 3. Measure active target DOM element and keep rect synced on scroll/resize
  const updateTargetMeasurement = useCallback(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    setViewport({ width: window.innerWidth, height: window.innerHeight });

    const findVisibleElement = (selector?: string): HTMLElement | null => {
      if (!selector) return null;
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      return el;
    };

    const el = findVisibleElement(currentStep.selector) ?? findVisibleElement(currentStep.fallbackSelector);
    if (!el) {
      setTargetRect(null);
      return;
    }

    const rect = el.getBoundingClientRect();
    const pad = SPOTLIGHT_PADDING;
    const clampedTop = Math.max(8, rect.top - pad);
    const clampedLeft = Math.max(8, rect.left - pad);
    const maxHeight = Math.min(rect.height + pad * 2, window.innerHeight - clampedTop - 8);
    const maxWidth = Math.min(rect.width + pad * 2, window.innerWidth - clampedLeft - 8);

    setTargetRect({
      top: Math.round(clampedTop),
      left: Math.round(clampedLeft),
      width: Math.round(Math.max(40, maxWidth)),
      height: Math.round(Math.max(32, maxHeight)),
    });
  }, [currentStep]);

  useEffect(() => {
    if (!isOpen || typeof window === "undefined") return;

    const el =
      document.querySelector<HTMLElement>(currentStep.selector) ??
      (currentStep.fallbackSelector ? document.querySelector<HTMLElement>(currentStep.fallbackSelector) : null);

    if (el) {
      const rect = el.getBoundingClientRect();
      const isOffscreen = rect.top < 0 || rect.bottom > window.innerHeight;
      if (isOffscreen && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }

    updateTargetMeasurement();
    const timer = setTimeout(updateTargetMeasurement, 120);

    window.addEventListener("resize", updateTargetMeasurement);
    window.addEventListener("scroll", updateTargetMeasurement, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", updateTargetMeasurement);
      window.removeEventListener("scroll", updateTargetMeasurement, true);
    };
  }, [isOpen, currentStep, updateTargetMeasurement]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    markOnboardingSeen();
    if (user && !user.onboarding_completed) {
      completeUserOnboarding()
        .then(() => refreshUser())
        .catch(() => {});
    }
  }, [markOnboardingSeen, user, refreshUser]);

  const handleNext = useCallback(() => {
    if (safeStepIndex < tourSteps.length - 1) {
      setStepIndex(safeStepIndex + 1);
    } else {
      handleClose();
    }
  }, [safeStepIndex, tourSteps.length, handleClose]);

  const handlePrev = useCallback(() => {
    if (safeStepIndex > 0) {
      setStepIndex(safeStepIndex - 1);
    }
  }, [safeStepIndex]);

  // 4. Keyboard navigation (ArrowRight / Enter -> Next, ArrowLeft -> Back, Escape -> Close)
  useEffect(() => {
    if (!isOpen || typeof window === "undefined") return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        handleNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        handlePrev();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleClose, handleNext, handlePrev]);

  const popoverPosition = useMemo(() => {
    if (!targetRect) {
      return {
        top: Math.max(16, Math.round((viewport.height - POPOVER_ESTIMATED_HEIGHT) / 2)),
        left: Math.max(16, Math.round((viewport.width - POPOVER_WIDTH) / 2)),
      };
    }

    const clampLeft = (l: number) => Math.max(16, Math.min(l, viewport.width - POPOVER_WIDTH - 16));
    const clampTop = (t: number) => Math.max(16, Math.min(t, viewport.height - POPOVER_ESTIMATED_HEIGHT - 16));

    if (currentStep.preferredPlacement === "right") {
      const candidateLeft = targetRect.left + targetRect.width + POPOVER_GAP;
      if (candidateLeft + POPOVER_WIDTH <= viewport.width - 16) {
        return {
          top: clampTop(targetRect.top),
          left: candidateLeft,
        };
      }
    }

    if (currentStep.preferredPlacement === "left") {
      const candidateLeft = targetRect.left - POPOVER_WIDTH - POPOVER_GAP;
      if (candidateLeft >= 16) {
        return {
          top: clampTop(targetRect.top),
          left: candidateLeft,
        };
      }
    }

    // Default / fallback to bottom or top
    const belowTop = targetRect.top + targetRect.height + POPOVER_GAP;
    if (belowTop + POPOVER_ESTIMATED_HEIGHT <= viewport.height - 16) {
      return {
        top: belowTop,
        left: clampLeft(targetRect.left),
      };
    }

    const aboveTop = targetRect.top - POPOVER_ESTIMATED_HEIGHT - POPOVER_GAP;
    return {
      top: clampTop(aboveTop),
      left: clampLeft(targetRect.left),
    };
  }, [targetRect, viewport, currentStep.preferredPlacement]);

  if (!isOpen) return null;

  const isLastStep = safeStepIndex === tourSteps.length - 1;

  return (
    <OverlayRoot role="dialog" aria-modal="true" aria-label="Ansatz Product Tour" data-testid="product-tour-overlay">
      <svg
        width="100%"
        height="100%"
        style={{ position: "fixed", inset: 0, pointerEvents: "auto" }}
        onClick={handleClose}
      >
        <defs>
          <mask id="ansatz-tour-spotlight-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {targetRect && (
              <rect
                x={targetRect.left}
                y={targetRect.top}
                width={targetRect.width}
                height={targetRect.height}
                rx="14"
                ry="14"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill={theme === "light" ? "rgba(15, 23, 42, 0.45)" : "rgba(2, 6, 23, 0.72)"}
          mask="url(#ansatz-tour-spotlight-mask)"
        />
      </svg>

      {targetRect && (
        <SpotlightRing
          style={{
            top: `${targetRect.top}px`,
            left: `${targetRect.left}px`,
            width: `${targetRect.width}px`,
            height: `${targetRect.height}px`,
          }}
        />
      )}

      <PopoverCard
        style={{
          top: `${popoverPosition.top}px`,
          left: `${popoverPosition.left}px`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <TopMetaRow>
          <StepBadge>
            <SparklesFillIcon size={12} />
            <span>
              Step {safeStepIndex + 1} of {tourSteps.length} &middot; {currentStep.badge}
            </span>
          </StepBadge>
          <DismissButton type="button" onClick={handleClose} aria-label="Skip product tour">
            Skip tour <XIcon size={13} />
          </DismissButton>
        </TopMetaRow>

        <StepTitle>{currentStep.title}</StepTitle>
        <StepDescription>{currentStep.description}</StepDescription>

        <FooterRow>
          <DotsRow role="tablist" aria-label="Tour steps">
            {tourSteps.map((s, idx) => (
              <DotButton
                key={s.id}
                type="button"
                role="tab"
                aria-selected={idx === safeStepIndex}
                aria-label={`Step ${idx + 1}: ${s.title}`}
                $active={idx === safeStepIndex}
                onClick={() => setStepIndex(idx)}
              />
            ))}
          </DotsRow>

          <NavButtons>
            {safeStepIndex > 0 && (
              <SecondaryNavButton type="button" onClick={handlePrev}>
                <ArrowLeftIcon size={13} /> Back
              </SecondaryNavButton>
            )}
            <PrimaryNavButton type="button" onClick={handleNext}>
              {isLastStep ? (
                <>
                  Done <CheckIcon size={13} />
                </>
              ) : (
                <>
                  Next <ArrowRightIcon size={13} />
                </>
              )}
            </PrimaryNavButton>
          </NavButtons>
        </FooterRow>
      </PopoverCard>
    </OverlayRoot>
  );
};

export default ProductTourOverlay;

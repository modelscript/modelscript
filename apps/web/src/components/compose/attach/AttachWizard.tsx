// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useEffect, useRef } from "react";
import styledImport from "styled-components";
import { allBlockingIssues, clampStepIndex, stepIssues, visibleSteps } from "./engine";
import { IssueList, SummaryChips } from "./Primitives";
import type { AttachFlow } from "./useAttachFlow";

const styled: typeof styledImport = (styledImport as any).default ?? styledImport;

const Shell = styled.section`
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 8px 0;
  padding: 14px;
  border-radius: 14px;
  border: 1px solid var(--ms-border);
  background: var(--ms-surface, transparent);
  animation: attach-shell-in 0.18s ease-out;

  @keyframes attach-shell-in {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const Header = styled.header`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
`;

const Title = styled.h3`
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--ms-text-heading, var(--ms-text-1));
  &:focus {
    outline: none;
  }
`;

const Sub = styled.p`
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--ms-text-3);
  word-break: break-all;
`;

const Stepper = styled.ol`
  display: flex;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
`;

const Dot = styled.li<{ $state: "done" | "current" | "todo" }>`
  height: 6px;
  flex: 1;
  border-radius: 3px;
  background: ${(p: { $state: string }) => (p.$state === "todo" ? "var(--ms-divider)" : "var(--ms-brand)")};
  opacity: ${(p: { $state: string }) => (p.$state === "done" ? 0.55 : 1)};
  transition:
    background-color 0.2s,
    opacity 0.2s;
`;

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: attach-step-in 0.16s ease-out;

  @keyframes attach-step-in {
    from {
      opacity: 0;
      transform: translateX(6px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const Footer = styled.footer`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
`;

const Button = styled.button<{ $primary?: boolean }>`
  height: 32px;
  padding: 0 16px;
  border-radius: var(--ms-radius-pill);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  border: 1px solid ${(p: { $primary?: boolean }) => (p.$primary ? "transparent" : "var(--ms-border-strong)")};
  color: ${(p: { $primary?: boolean }) => (p.$primary ? "var(--ms-brand-contrast)" : "var(--ms-text-1)")};
  background: ${(p: { $primary?: boolean }) => (p.$primary ? "var(--ms-brand)" : "transparent")};

  &:hover:not(:disabled) {
    background: ${(p: { $primary?: boolean }) => (p.$primary ? "var(--ms-brand-hover)" : "var(--ms-surface-hover)")};
  }
  &:focus-visible {
    outline: none;
    box-shadow: var(--ms-focus-ring);
  }
  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;

const CloseButton = styled.button`
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--ms-text-2);
  font-size: 15px;
  cursor: pointer;
  &:hover {
    background: var(--ms-surface-hover);
  }
  &:focus-visible {
    outline: none;
    box-shadow: var(--ms-focus-ring);
  }
`;

const Progress = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--ms-text-2);
`;

const Spinner = styled.span`
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid var(--ms-divider);
  border-top-color: var(--ms-brand);
  animation: attach-spin 0.8s linear infinite;

  @keyframes attach-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    animation-duration: 2.4s;
  }
`;

/**
 * Inline, per-language attach wizard. Renders nothing while idle. Esc cancels, Enter advances
 * (when focus is not on an interactive control), and focus moves to the step title on each step.
 */
export const AttachWizard: React.FC<{ flow: AttachFlow }> = ({ flow }) => {
  const { state, profile } = flow;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const stepKey = state.phase === "wizard" ? `${state.profileId}:${state.stepIndex}` : state.phase;

  useEffect(() => {
    if (state.phase === "wizard" || state.phase === "error") titleRef.current?.focus();
  }, [stepKey, state.phase]);

  if (state.phase === "idle") return null;

  if (state.phase === "analyzing" || state.phase === "building") {
    return (
      <Shell aria-label="Attaching file">
        <Progress role="status" aria-live="polite">
          <Spinner aria-hidden="true" />
          <span>
            {state.phase === "analyzing" ? "Reading" : "Attaching"} <strong>{state.fileName}</strong>
            {flow.queued > 0 ? ` (${flow.queued} more queued)` : ""}…
          </span>
        </Progress>
      </Shell>
    );
  }

  if (state.phase === "error") {
    return (
      <Shell aria-label="Attach failed" onKeyDown={(e: React.KeyboardEvent) => e.key === "Escape" && flow.cancel()}>
        <Title ref={titleRef} tabIndex={-1}>
          Couldn&apos;t attach {state.fileName}
        </Title>
        <IssueList issues={[{ severity: "error", message: state.message }]} />
        <Footer>
          <Button type="button" onClick={flow.cancel}>
            Dismiss
          </Button>
          <Button type="button" $primary onClick={flow.retry}>
            Try again
          </Button>
        </Footer>
      </Shell>
    );
  }

  if (!profile) return null;
  const steps = visibleSteps(profile, state.draft);
  const index = clampStepIndex(profile, state.draft, state.stepIndex);
  const step = steps[index];
  const isLast = index >= steps.length - 1;
  const blocking = allBlockingIssues(profile, state.draft, state.issues);
  const currentIssues = [...state.issues, ...(step ? stepIssues(step, state.draft) : [])];
  const currentBlocking = currentIssues.some((i) => i.severity === "error");
  const Preview = profile.Preview;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      flow.cancel();
      return;
    }
    if (e.key !== "Enter" || e.defaultPrevented) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "TEXTAREA" || tag === "BUTTON" || tag === "SELECT" || tag === "A") return;
    e.preventDefault();
    if (currentBlocking) return;
    if (isLast) flow.finish();
    else flow.next();
  };

  return (
    <Shell aria-label={`Attach ${profile.label}`} onKeyDown={onKeyDown}>
      <Header>
        <div style={{ minWidth: 0 }}>
          <Title ref={titleRef} tabIndex={-1}>
            {step ? step.title : `Attach ${profile.label}`}
          </Title>
          <Sub>
            {profile.label} · {state.fileName}
          </Sub>
        </div>
        <CloseButton type="button" onClick={flow.cancel} aria-label="Cancel attaching">
          ✕
        </CloseButton>
      </Header>

      {steps.length > 1 && (
        <Stepper aria-label={`Step ${index + 1} of ${steps.length}`}>
          {steps.map((s, i) => (
            <Dot
              key={s.id}
              $state={i < index ? "done" : i === index ? "current" : "todo"}
              aria-current={i === index ? "step" : undefined}
            />
          ))}
        </Stepper>
      )}

      <SummaryChips chips={state.chips} />

      {step ? (
        <Body key={step.id}>
          {step.description && <p style={{ margin: 0, fontSize: 13, color: "var(--ms-text-2)" }}>{step.description}</p>}
          <step.Component draft={state.draft} update={flow.updateDraft} issues={currentIssues} ctx={flow.ctx} />
        </Body>
      ) : (
        <IssueList issues={state.issues} />
      )}

      {step && <IssueList issues={currentIssues.filter((i) => !state.issues.includes(i))} />}
      {Preview && <Preview draft={state.draft} />}

      <Footer>
        {profile.derive?.cancelLabel && state.derive && (
          <Button type="button" onClick={flow.cancel} style={{ marginRight: "auto" }}>
            {profile.derive.cancelLabel}
          </Button>
        )}
        {index > 0 && (
          <Button type="button" onClick={flow.back}>
            Back
          </Button>
        )}
        {step?.skippable && !isLast && (
          <Button type="button" onClick={flow.next}>
            Skip
          </Button>
        )}
        {step && !isLast ? (
          <Button type="button" $primary onClick={flow.next} disabled={currentBlocking}>
            Continue
          </Button>
        ) : (
          <Button
            type="button"
            $primary
            data-testid="attach-wizard-submit"
            onClick={flow.finish}
            disabled={blocking.length > 0}
          >
            {state.edit ? "Save" : state.derive ? (profile.derive?.submitLabel ?? "Create") : "Attach"}
          </Button>
        )}
      </Footer>
    </Shell>
  );
};

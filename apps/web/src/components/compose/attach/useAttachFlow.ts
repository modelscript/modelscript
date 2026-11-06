// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  allBlockingIssues,
  attachFlowReducer,
  type BatchEntry,
  clampStepIndex,
  needsWizard,
  planBatch,
  visibleSteps,
} from "./engine";
import { findDeriveProfile, findEditProfile, getAttachProfile, resolveAttachProfile } from "./registry";
import type {
  AnyAttachProfile,
  AttachArtifactSummary,
  AttachContext,
  AttachEditableView,
  AttachFlowState,
} from "./types";

/** Called when a derived artifact (e.g. a chart made from a table) has been created. */
export type DeriveDone = (
  newArtifactId: number | string,
  displayTitle: string,
  createdView: Record<string, unknown>,
) => void;

export interface UseAttachFlowParams {
  ctx: AttachContext;
  /** Called with the created artifact once the user finishes (or immediately for step-less profiles). */
  onAttached: (artifactId: number | string, title: string, suggestedCaption?: string) => void;
  /** Called after a customization was saved to an existing artifact. */
  onEdited?: ((artifactId: number | string) => void) | undefined;
}

export interface AttachFlow {
  state: AttachFlowState;
  ctx: AttachContext;
  profile: AnyAttachProfile | undefined;
  /** Busy while analyzing or building. */
  busy: boolean;
  /** Number of files waiting behind the current one. */
  queued: number;
  start: (file: File, companions?: File[]) => void;
  /** Attach a file with an already-attached artifact folded in (e.g. a QIF report for an attached STEP model). */
  startWithLinked: (file: File, linked: AttachArtifactSummary) => void;
  /** Reopen the wizard on an existing artifact. Returns false when nothing can be customized or the flow is busy. */
  startEdit: (artifactId: number | string, view: AttachEditableView) => boolean;
  /**
   * Open the wizard to derive a new artifact from an existing one (e.g. table to chart). `onDone` receives the new
   * artifact so the caller can replace or add to the source. Returns false when the flow is busy.
   */
  startDerive: (artifactId: number | string, onDone: DeriveDone, view?: AttachEditableView) => boolean;
  /** Attach several files from one drop/selection, pairing companions (e.g. .qif + .step). */
  startMany: (files: File[]) => void;
  updateDraft: (patch: unknown) => void;
  next: () => void;
  back: () => void;
  finish: () => void;
  cancel: () => void;
  retry: () => void;
}

/** A wizard opened on an existing artifact rather than a new file. */
interface Session {
  mode: "edit" | "derive";
  artifactId: number | string;
  view?: AttachEditableView | undefined;
  onDone?: DeriveDone | undefined;
}

export function useAttachFlow({ ctx, onAttached, onEdited }: UseAttachFlowParams): AttachFlow {
  const [state, dispatch] = useReducer(attachFlowReducer, { phase: "idle" } as AttachFlowState);
  const queue = useRef<BatchEntry[]>([]);
  const current = useRef<BatchEntry | null>(null);
  const [queued, setQueued] = useState(0);
  const session = useRef<Session | null>(null);

  const profile = useMemo(() => (state.phase === "wizard" ? getAttachProfile(state.profileId) : undefined), [state]);

  // `begin` is re-created when its dependencies change; drain reaches the latest one through a ref.
  const beginRef = useRef<(entry: BatchEntry) => Promise<void>>(async () => {});

  const drain = useCallback(() => {
    current.current = null;
    session.current = null;
    const nextEntry = queue.current.shift();
    setQueued(queue.current.length);
    if (nextEntry) void beginRef.current(nextEntry);
  }, []);

  const build = useCallback(
    async (p: AnyAttachProfile, draft: unknown, fileName: string) => {
      dispatch({ type: "build-start", fileName });
      try {
        const result = await p.build(draft, ctx);
        const created = await ctx.createArtifact({
          artifact_type: result.artifact_type,
          view_config: result.view_config,
          title: result.title,
        });
        onAttached(created.id, result.title, result.suggestedCaption);
        dispatch({ type: "reset" });
        drain();
      } catch (err) {
        console.error(err);
        dispatch({ type: "failed", fileName, message: err instanceof Error ? err.message : "Attachment failed." });
      }
    },
    [ctx, onAttached, drain],
  );

  const begin = useCallback(
    async (entry: BatchEntry) => {
      const { file, companions, linked } = entry;
      current.current = entry;
      dispatch({ type: "analyze-start", fileName: file.name });
      let p = resolveAttachProfile(file.name);
      if ((!p || p.fallback) && file.name.toLowerCase().endsWith(".zip")) {
        try {
          const slice = file.slice(0, 4096);
          const head = await slice.text();
          if (head.toLowerCase().includes(".qif") || head.includes("QIF")) {
            p = getAttachProfile("qif") ?? p;
          }
        } catch {}
      }
      if (!p) {
        dispatch({ type: "failed", fileName: file.name, message: `No handler is registered for '${file.name}'.` });
        return;
      }
      try {
        const analysis = await p.analyze(file, ctx);
        if (companions.length > 0 && p.withCompanions) {
          analysis.draft = await p.withCompanions(analysis.draft, companions);
        }
        if (linked && p.withLinkedArtifact) {
          analysis.draft = await p.withLinkedArtifact(analysis.draft, linked, ctx);
        }
        if (needsWizard(p, analysis)) {
          dispatch({ type: "analyzed", profileId: p.id, fileName: file.name, analysis });
        } else {
          await build(p, analysis.draft, file.name);
        }
      } catch (err) {
        console.error(err);
        dispatch({
          type: "failed",
          fileName: file.name,
          message: err instanceof Error ? err.message : "Could not read file.",
        });
      }
    },
    [ctx, build],
  );

  useEffect(() => {
    beginRef.current = begin;
  });

  const enqueue = useCallback(
    (entry: BatchEntry) => {
      if (current.current) {
        queue.current.push(entry);
        setQueued(queue.current.length);
        return;
      }
      void begin(entry);
    },
    [begin],
  );

  /** Open the wizard for an edit/derive session (loading the view first when the caller did not have it). */
  const openSession = useCallback(
    async (s: Session) => {
      let fileName = s.view?.title || "Morsel";
      dispatch({ type: "analyze-start", fileName });
      try {
        const view = s.view ?? (await ctx.loadArtifactView(s.artifactId));
        if (!view) throw new Error("This morsel could not be loaded.");
        s.view = view;
        fileName = view.title || fileName;
        const p = s.mode === "edit" ? findEditProfile(view) : findDeriveProfile(view);
        if (!p) throw new Error(s.mode === "edit" ? "Nothing to customize here." : "Nothing can be created from this.");
        const cap = s.mode === "edit" ? p.edit! : p.derive!;
        const analysis = await cap.open(view, ctx);
        const link = { artifactId: s.artifactId, view };
        dispatch({
          type: "analyzed",
          profileId: p.id,
          fileName,
          analysis,
          ...(s.mode === "edit" ? { edit: link } : { derive: link }),
        });
      } catch (err) {
        console.error(err);
        dispatch({
          type: "failed",
          fileName,
          message: err instanceof Error ? err.message : "Could not open this morsel.",
        });
      }
    },
    [ctx],
  );

  /** Occupy the flow so drops/picks queue behind the session; the marker file is never read. */
  const startSession = useCallback(
    (s: Session): boolean => {
      if (current.current) return false;
      current.current = { file: new File([], s.view?.title || "Morsel"), companions: [] };
      session.current = s;
      void openSession(s);
      return true;
    },
    [openSession],
  );

  const startEdit = useCallback(
    (artifactId: number | string, view: AttachEditableView): boolean => {
      if (!findEditProfile(view)) return false;
      return startSession({ mode: "edit", artifactId, view });
    },
    [startSession],
  );

  const startDerive = useCallback(
    (artifactId: number | string, onDone: DeriveDone, view?: AttachEditableView): boolean => {
      if (view && !findDeriveProfile(view)) return false;
      return startSession({ mode: "derive", artifactId, view, onDone });
    },
    [startSession],
  );

  const applySession = useCallback(
    async (p: AnyAttachProfile, draft: unknown, s: Session, view: AttachEditableView, fileName: string) => {
      dispatch({ type: "build-start", fileName });
      try {
        if (s.mode === "edit") {
          const { view_config } = await p.edit!.apply(draft, view, ctx);
          await ctx.updateArtifact(s.artifactId, { view_config });
          onEdited?.(s.artifactId);
        } else {
          const result = await p.derive!.build(draft, view, ctx);
          const created = await ctx.createArtifact({
            artifact_type: result.artifact_type,
            view_config: result.view_config,
            title: result.title,
          });
          s.onDone?.(created.id, result.displayTitle ?? result.title, {
            id: created.id,
            view_type: result.artifact_type,
            artifact_type: result.artifact_type,
            title: result.title,
            view_config: result.view_config,
          });
        }
        dispatch({ type: "reset" });
        drain();
      } catch (err) {
        console.error(err);
        dispatch({ type: "failed", fileName, message: err instanceof Error ? err.message : "Could not save changes." });
      }
    },
    [ctx, onEdited, drain],
  );

  const start = useCallback((file: File, companions: File[] = []) => enqueue({ file, companions }), [enqueue]);

  const startWithLinked = useCallback(
    (file: File, linked: AttachArtifactSummary) => enqueue({ file, companions: [], linked }),
    [enqueue],
  );

  const startMany = useCallback(
    (files: File[]) => {
      for (const entry of planBatch(files, (name) => resolveAttachProfile(name))) enqueue(entry);
    },
    [enqueue],
  );

  // Updates are applied inside the reducer so a step's async handlers (which may run after later renders)
  // always merge into the latest draft rather than a stale snapshot.
  const updateDraft = useCallback((patch: unknown) => {
    dispatch({ type: "update-draft", patch });
  }, []);

  const next = useCallback(() => {
    if (state.phase !== "wizard" || !profile) return;
    const steps = visibleSteps(profile, state.draft);
    const idx = clampStepIndex(profile, state.draft, state.stepIndex);
    if (idx < steps.length - 1) dispatch({ type: "goto", stepIndex: idx + 1 });
  }, [state, profile]);

  const back = useCallback(() => {
    if (state.phase !== "wizard") return;
    dispatch({ type: "goto", stepIndex: state.stepIndex - 1 });
  }, [state]);

  const finish = useCallback(() => {
    if (state.phase !== "wizard" || !profile) return;
    if (allBlockingIssues(profile, state.draft, state.issues).length > 0) return;
    const s = session.current;
    const linkedView = state.edit?.view ?? state.derive?.view;
    if (s && linkedView) {
      void applySession(profile, state.draft, s, linkedView, state.fileName);
      return;
    }
    void build(profile, state.draft, state.fileName);
  }, [state, profile, build, applySession]);

  const cancel = useCallback(() => {
    dispatch({ type: "reset" });
    drain();
  }, [drain]);

  const retry = useCallback(() => {
    const s = session.current;
    if (s) {
      void openSession(s);
      return;
    }
    const entry = current.current;
    if (entry) void begin(entry);
  }, [begin, openSession]);

  return {
    state,
    ctx,
    profile,
    busy: state.phase === "analyzing" || state.phase === "building",
    queued,
    start,
    startWithLinked,
    startEdit,
    startDerive,
    startMany,
    updateDraft,
    next,
    back,
    finish,
    cancel,
    retry,
  };
}

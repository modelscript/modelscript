// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from "react";
import type { ComputeDialPreset } from "../panels";
import type { AnsatzXRayTokenHeat } from "../util/hypergraph-overlay";
import type { AnsatzRelationalHypergraphRecord } from "../util/lsp-bridge";
import {
  buildGeneratorSummaries,
  createInitialZonotopeWorkbenchState,
  toApiHypergraphOverrides,
  type ApiHypergraphOverride,
  type FaultGeneratorSpec,
  type LinearConstraintSpec,
  type ModalityPerturbationBudgets,
  type ZonotopeBrushMode,
  type ZonotopePendingOverride,
  type ZonotopeWorkbenchState,
} from "../util/zonotope-workbench-state";

export interface UseAnsatzZonotopeStateOptions {
  initialStudioActive: boolean;
  setShowHypergraphOverlay: (next: boolean) => void;
  onZonotopeOverridesChange?: (overrides: ApiHypergraphOverride[], constraints: LinearConstraintSpec[]) => void;
}

export function useAnsatzZonotopeState({
  initialStudioActive,
  setShowHypergraphOverlay,
  onZonotopeOverridesChange,
}: UseAnsatzZonotopeStateOptions) {
  const [computeDial, setComputeDial] = useState<ComputeDialPreset>("auto-escalate");
  const [xrayTokenHeat, setXRayTokenHeat] = useState<AnsatzXRayTokenHeat[] | null>(null);
  const [zonotopeState, setZonotopeState] = useState<ZonotopeWorkbenchState>(() =>
    createInitialZonotopeWorkbenchState(),
  );
  const [hypergraphRecord, setHypergraphRecord] = useState<AnsatzRelationalHypergraphRecord | null>(null);
  const [worstCaseXiByGroupId, setWorstCaseXiByGroupId] = useState<Record<number, number>>({});
  const [zonotopeViolatingSymbols, setZonotopeViolatingSymbols] = useState<string[]>([]);
  const [isStudioActive, setIsStudioActive] = useState<boolean>(initialStudioActive);
  const [requestedInspectorSubtab, setRequestedInspectorSubtab] = useState<"domain" | "studio" | undefined>(() =>
    initialStudioActive ? "studio" : undefined,
  );
  const [zonotopeRibbonCollapsed, setZonotopeRibbonCollapsed] = useState(false);

  const handleChangeXi = useCallback((groupId: number, xi: number) => {
    setZonotopeState((prev) => ({
      ...prev,
      xiByGroupId: { ...prev.xiByGroupId, [groupId]: xi },
    }));
  }, []);

  const handleChangeStressScale = useCallback((scale: number) => {
    setZonotopeState((prev) => ({ ...prev, stressScale: scale }));
  }, []);

  const handleSelectZonotopeGroup = useCallback((groupId: number | null) => {
    setZonotopeState((prev) => ({ ...prev, activeGroupId: groupId }));
  }, []);

  const handleChangeZonotopeBrush = useCallback(
    (brush: ZonotopeBrushMode) => {
      setZonotopeState((prev) => ({ ...prev, activeBrush: brush }));
      if (brush !== "select") {
        setShowHypergraphOverlay(true);
      }
    },
    [setShowHypergraphOverlay],
  );

  const handleToggleScramblePreview = useCallback(() => {
    setZonotopeState((prev) => ({ ...prev, scramblePreview: !prev.scramblePreview }));
  }, []);

  const handleResetNominal = useCallback(() => {
    setZonotopeState((prev) => ({ ...prev, xiByGroupId: {}, stressScale: 1.0 }));
  }, []);

  const handleSnapWorstCase = useCallback(() => {
    setZonotopeState((prev) => {
      if (Object.keys(worstCaseXiByGroupId).length > 0) {
        return {
          ...prev,
          xiByGroupId: { ...worstCaseXiByGroupId },
          stressScale: Math.max(1.0, prev.stressScale),
        };
      }
      const summaries = buildGeneratorSummaries(hypergraphRecord);
      const nextXi: Record<number, number> = {};
      for (let i = 0; i < summaries.length; i++) {
        const summary = summaries[i]!;
        nextXi[summary.groupId] = i % 2 === 0 ? 1 : -1;
      }
      return {
        ...prev,
        xiByGroupId: nextXi,
        stressScale: Math.max(1.0, prev.stressScale),
      };
    });
  }, [worstCaseXiByGroupId, hypergraphRecord]);

  const handleAddZonotopeConstraint = useCallback((constraint: LinearConstraintSpec) => {
    setZonotopeState((prev) => {
      const exists = prev.constraints.some((c) => c.id === constraint.id);
      const nextConstraints = exists
        ? prev.constraints.map((c) => (c.id === constraint.id ? constraint : c))
        : [...prev.constraints, constraint];
      return { ...prev, constraints: nextConstraints };
    });
  }, []);

  const handleRemoveZonotopeConstraint = useCallback((constraintId: string) => {
    setZonotopeState((prev) => ({
      ...prev,
      constraints: prev.constraints.filter((c) => c.id !== constraintId),
    }));
  }, []);

  const handleAddZonotopeOverride = useCallback((override: ZonotopePendingOverride) => {
    setZonotopeState((prev) => {
      const filtered = prev.pendingOverrides.filter((existing) => {
        if (existing.id === override.id) return false;
        if (
          existing.modality === override.modality &&
          override.tokenIndex !== undefined &&
          existing.tokenIndex === override.tokenIndex
        ) {
          return false;
        }
        if (
          existing.modality === override.modality &&
          override.tokenIndex === undefined &&
          existing.tokenIndex === undefined &&
          override.symbolName &&
          existing.symbolName === override.symbolName
        ) {
          return false;
        }
        return true;
      });
      return { ...prev, pendingOverrides: [...filtered, override] };
    });
  }, []);

  const handleToggleFaultGenerator = useCallback((spec: FaultGeneratorSpec) => {
    setZonotopeState((prev) => {
      const exists = prev.faultGenerators.some((fg) => fg.id === spec.id);
      const nextFaults = exists
        ? prev.faultGenerators.map((fg) => (fg.id === spec.id ? spec : fg))
        : [...prev.faultGenerators, spec];
      return { ...prev, faultGenerators: nextFaults };
    });
  }, []);

  const handleUpdateZonotopeBudgets = useCallback((patch: Partial<ModalityPerturbationBudgets>) => {
    setZonotopeState((prev) => ({
      ...prev,
      budgets: { ...prev.budgets, ...patch },
    }));
  }, []);

  const handleChangeCadToleranceFraction = useCallback(
    (nextFraction: number) => {
      handleUpdateZonotopeBudgets({ cadToleranceFraction: nextFraction });
    },
    [handleUpdateZonotopeBudgets],
  );

  const handleClearPendingOverrides = useCallback(() => {
    setZonotopeState((prev) => ({ ...prev, pendingOverrides: [] }));
  }, []);

  const onZonotopeOverridesChangeRef = useRef(onZonotopeOverridesChange);
  onZonotopeOverridesChangeRef.current = onZonotopeOverridesChange;
  const hasMountedZonotopeOverridesRef = useRef(false);
  useEffect(() => {
    if (!hasMountedZonotopeOverridesRef.current) {
      hasMountedZonotopeOverridesRef.current = true;
      if (zonotopeState.pendingOverrides.length === 0 && zonotopeState.constraints.length === 0) {
        return;
      }
    }
    onZonotopeOverridesChangeRef.current?.(
      toApiHypergraphOverrides(zonotopeState.pendingOverrides),
      zonotopeState.constraints,
    );
  }, [zonotopeState.pendingOverrides, zonotopeState.constraints]);

  return {
    computeDial,
    setComputeDial,
    xrayTokenHeat,
    setXRayTokenHeat,
    zonotopeState,
    setZonotopeState,
    hypergraphRecord,
    setHypergraphRecord,
    worstCaseXiByGroupId,
    setWorstCaseXiByGroupId,
    zonotopeViolatingSymbols,
    setZonotopeViolatingSymbols,
    isStudioActive,
    setIsStudioActive,
    requestedInspectorSubtab,
    setRequestedInspectorSubtab,
    zonotopeRibbonCollapsed,
    setZonotopeRibbonCollapsed,
    handleChangeXi,
    handleChangeStressScale,
    handleSelectZonotopeGroup,
    handleChangeZonotopeBrush,
    handleToggleScramblePreview,
    handleResetNominal,
    handleSnapWorstCase,
    handleAddZonotopeConstraint,
    handleRemoveZonotopeConstraint,
    handleAddZonotopeOverride,
    handleToggleFaultGenerator,
    handleUpdateZonotopeBudgets,
    handleChangeCadToleranceFraction,
    handleClearPendingOverrides,
  };
}

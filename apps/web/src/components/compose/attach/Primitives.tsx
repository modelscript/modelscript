// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared building blocks for wizard steps. Profiles compose these instead of hand-rolling UI,
 * which keeps spacing, focus handling and a11y consistent across every language.
 */

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import styledImport from "styled-components";
import type { AttachArtifactSummary, AttachChip, AttachIssue, AttachProvenance } from "./types";

const styled: typeof styledImport = (styledImport as any).default ?? styledImport;

// ── Summary chips ─────────────────────────────────────────────

const ChipRow = styled.ul`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
`;

const Chip = styled.li<{ $tone: string }>`
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 9px;
  border-radius: var(--ms-radius-pill);
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--ms-border);
  color: ${(p: { $tone: string }) =>
    p.$tone === "success" ? "#16a34a" : p.$tone === "warning" ? "#d97706" : "var(--ms-text-2)"};
  background: var(--ms-surface-hover);
`;

export const SummaryChips: React.FC<{ chips: AttachChip[] }> = ({ chips }) =>
  chips.length === 0 ? null : (
    <ChipRow aria-label="Detected contents">
      {chips.map((c) => (
        <Chip key={c.label} $tone={c.tone ?? "neutral"}>
          {c.label}
        </Chip>
      ))}
    </ChipRow>
  );

// ── Issues ────────────────────────────────────────────────────

const IssueBox = styled.div<{ $severity: string }>`
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 18px;
  color: var(--ms-text-1);
  border: 1px solid
    ${(p: { $severity: string }) =>
      p.$severity === "error" ? "#ef4444" : p.$severity === "warning" ? "#f59e0b" : "var(--ms-border)"};
  background: ${(p: { $severity: string }) =>
    p.$severity === "error"
      ? "rgba(239,68,68,0.08)"
      : p.$severity === "warning"
        ? "rgba(245,158,11,0.08)"
        : "var(--ms-surface-hover)"};
`;

export const IssueList: React.FC<{ issues: AttachIssue[] }> = ({ issues }) =>
  issues.length === 0 ? null : (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {issues.map((issue, i) => (
        <IssueBox
          key={`${issue.severity}-${i}`}
          $severity={issue.severity}
          role={issue.severity === "error" ? "alert" : "status"}
        >
          <span aria-hidden="true">
            {issue.severity === "error" ? "⛔" : issue.severity === "warning" ? "⚠️" : "ℹ️"}
          </span>
          <span>{issue.message}</span>
        </IssueBox>
      ))}
    </div>
  );

// ── Provenance ────────────────────────────────────────────────

const PROVENANCE_LABEL: Record<AttachProvenance, string> = {
  "user-provided": "Provided by you",
  linked: "Linked morsel",
  synthesized: "Generated, not from your file",
  sample: "Sample data",
};

export const ProvenanceBadge: React.FC<{ provenance: AttachProvenance; detail?: string | undefined }> = ({
  provenance,
  detail,
}) => (
  <Chip $tone={provenance === "synthesized" || provenance === "sample" ? "warning" : "success"}>
    {PROVENANCE_LABEL[provenance]}
    {detail ? ` · ${detail}` : ""}
  </Chip>
);

// ── Choice cards (radio group) ────────────────────────────────

const CardGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
`;

const Card = styled.label<{ $selected: boolean }>`
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-radius: 10px;
  cursor: pointer;
  border: 1px solid ${(p: { $selected: boolean }) => (p.$selected ? "var(--ms-brand)" : "var(--ms-border)")};
  background: ${(p: { $selected: boolean }) => (p.$selected ? "var(--ms-brand-soft)" : "transparent")};
  transition:
    border-color 0.15s,
    background-color 0.15s;

  &:hover {
    background: var(--ms-surface-hover);
  }
  &:focus-within {
    box-shadow: var(--ms-focus-ring);
  }
  input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
`;

const CardTitle = styled.span`
  font-size: 14px;
  font-weight: 600;
  color: var(--ms-text-1);
`;

const CardHint = styled.span`
  font-size: 12px;
  color: var(--ms-text-3);
`;

const RecommendedTag = styled.span`
  align-self: flex-start;
  margin-bottom: 4px;
  padding: 0 6px;
  border-radius: var(--ms-radius-pill);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--ms-brand-contrast);
  background: var(--ms-brand);
`;

export interface ChoiceOption<V extends string> {
  value: V;
  title: string;
  hint?: string | undefined;
  recommended?: boolean | undefined;
  disabled?: boolean | undefined;
}

export function ChoiceCards<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V | undefined;
  options: ChoiceOption<V>[];
  onChange: (value: V) => void;
}): React.ReactElement {
  const name = useId();
  return (
    <CardGrid role="radiogroup" aria-label={label}>
      {options.map((opt) => (
        <Card
          key={opt.value}
          $selected={value === opt.value}
          style={opt.disabled ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
        >
          <input
            type="radio"
            name={name}
            value={opt.value}
            checked={value === opt.value}
            disabled={opt.disabled}
            onChange={() => onChange(opt.value)}
          />
          {opt.recommended && <RecommendedTag>Recommended</RecommendedTag>}
          <CardTitle>{opt.title}</CardTitle>
          {opt.hint && <CardHint>{opt.hint}</CardHint>}
        </Card>
      ))}
    </CardGrid>
  );
}

// ── File slot (drop target) ───────────────────────────────────

const Slot = styled.div<{ $active: boolean; $filled: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1.5px ${(p: { $filled: boolean }) => (p.$filled ? "solid" : "dashed")}
    ${(p: { $active: boolean }) => (p.$active ? "var(--ms-brand)" : "var(--ms-border-strong)")};
  background: ${(p: { $active: boolean }) => (p.$active ? "var(--ms-brand-soft)" : "transparent")};
  transition:
    border-color 0.15s,
    background-color 0.15s;
`;

const SlotButton = styled.button`
  height: 28px;
  padding: 0 12px;
  border-radius: var(--ms-radius-pill);
  border: 1px solid var(--ms-border-strong);
  background: transparent;
  color: var(--ms-text-1);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    background: var(--ms-surface-hover);
  }
  &:focus-visible {
    outline: none;
    box-shadow: var(--ms-focus-ring);
  }
`;

/**
 * A single-file drop target with a button fallback. Controlled: the step owns the `file` in its draft.
 */
export const FileSlot: React.FC<{
  label: string;
  accept: string;
  file: { name: string } | null | undefined;
  onFile: (file: File) => void;
  onClear?: (() => void) | undefined;
}> = ({ label, accept, file, onFile, onClear }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(false);
  return (
    <Slot
      $active={active}
      $filled={Boolean(file)}
      onDragOver={(e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setActive(true);
      }}
      onDragLeave={() => setActive(false)}
      onDrop={(e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setActive(false);
        const dropped = e.dataTransfer.files?.[0];
        if (dropped) onFile(dropped);
      }}
    >
      <span
        style={{ fontSize: 13, color: "var(--ms-text-2)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}
      >
        {file ? <strong style={{ color: "var(--ms-text-1)" }}>{file.name}</strong> : `Drop ${label} here`}
      </span>
      <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        {file && onClear && (
          <SlotButton type="button" onClick={onClear} aria-label={`Remove ${file.name}`}>
            Remove
          </SlotButton>
        )}
        <SlotButton type="button" onClick={() => inputRef.current?.click()}>
          {file ? "Replace" : "Browse"}
        </SlotButton>
      </span>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: "none" }}
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (picked) onFile(picked);
          e.target.value = "";
        }}
      />
    </Slot>
  );
};

// ── Artifact picker ───────────────────────────────────────────

const PickerList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 188px;
  overflow-y: auto;
  padding: 2px;
`;

const PickerSearch = styled.input`
  height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--ms-border-strong);
  background: transparent;
  color: var(--ms-text-1);
  font: inherit;
  font-size: 13px;

  &:focus-visible {
    outline: none;
    box-shadow: var(--ms-focus-ring);
  }
`;

const PickerRow = styled.button<{ $selected: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 6px 8px;
  text-align: left;
  border-radius: 8px;
  font: inherit;
  color: var(--ms-text-1);
  cursor: pointer;
  border: 1px solid ${(p: { $selected: boolean }) => (p.$selected ? "var(--ms-brand)" : "transparent")};
  background: ${(p: { $selected: boolean }) => (p.$selected ? "var(--ms-brand-soft)" : "transparent")};

  &:hover {
    background: var(--ms-surface-hover);
  }
  &:focus-visible {
    outline: none;
    box-shadow: var(--ms-focus-ring);
  }
`;

const Thumb = styled.span`
  flex: 0 0 36px;
  height: 36px;
  border-radius: 6px;
  background: var(--ms-surface-hover) center / cover no-repeat;
  border: 1px solid var(--ms-border);
`;

/**
 * Searchable list of the user's existing artifacts. `load` must be referentially stable
 * (memoize it); items whose title contains `suggestMatch` are floated to the top and tagged.
 */
export const ArtifactPicker: React.FC<{
  label: string;
  load: () => Promise<AttachArtifactSummary[]>;
  selectedId: number | string | undefined;
  onSelect: (item: AttachArtifactSummary) => void;
  suggestMatch?: string | undefined;
  emptyMessage?: string | undefined;
}> = ({ label, load, selectedId, onSelect, suggestMatch, emptyMessage }) => {
  const [items, setItems] = useState<AttachArtifactSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    load().then(
      (rows) => {
        if (!cancelled) {
          setItems(rows);
          setError(null);
        }
      },
      (err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load your morsels.");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [load, attempt]);

  const needle = suggestMatch?.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!items) return [];
    const q = query.trim().toLowerCase();
    const withFlag = items
      .filter((i) => !q || i.title.toLowerCase().includes(q))
      .map((i) => ({ item: i, suggested: Boolean(needle) && i.title.toLowerCase().includes(needle as string) }));
    return withFlag.sort((a, b) => Number(b.suggested) - Number(a.suggested));
  }, [items, query, needle]);

  if (error) {
    return (
      <div
        role="alert"
        style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ms-text-2)" }}
      >
        <span>{error}</span>
        <SlotButton
          type="button"
          onClick={() => {
            setError(null);
            setItems(null);
            setAttempt((n) => n + 1);
          }}
        >
          Retry
        </SlotButton>
      </div>
    );
  }
  if (!items) {
    return (
      <div role="status" style={{ fontSize: 13, color: "var(--ms-text-3)" }}>
        Loading your morsels…
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div style={{ fontSize: 13, color: "var(--ms-text-3)" }}>{emptyMessage ?? "Nothing to choose from yet."}</div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <PickerSearch
        type="search"
        placeholder="Search…"
        aria-label={`Search ${label}`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <PickerList role="listbox" aria-label={label}>
        {visible.length === 0 && (
          <span style={{ fontSize: 13, color: "var(--ms-text-3)", padding: 6 }}>No matches.</span>
        )}
        {visible.map(({ item, suggested }) => (
          <PickerRow
            key={String(item.id)}
            type="button"
            role="option"
            aria-selected={String(item.id) === String(selectedId)}
            $selected={String(item.id) === String(selectedId)}
            onClick={() => onSelect(item)}
          >
            <Thumb
              style={item.thumbnailUrl ? { backgroundImage: `url("${item.thumbnailUrl}")` } : undefined}
              aria-hidden="true"
            />
            <span
              style={{
                minWidth: 0,
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: 13,
              }}
            >
              {item.title}
            </span>
            {suggested && <RecommendedTag style={{ margin: 0 }}>Suggested</RecommendedTag>}
          </PickerRow>
        ))}
      </PickerList>
    </div>
  );
};

// ── Form fields ───────────────────────────────────────────────

const FieldLabel = styled.label`
  display: block;
  margin-bottom: 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ms-text-3);
`;

const controlCss = `
  width: 100%;
  box-sizing: border-box;
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--ms-border-strong);
  background: transparent;
  color: var(--ms-text-1);
  font: inherit;
  font-size: 13px;

  &:focus-visible {
    outline: none;
    box-shadow: var(--ms-focus-ring);
  }
`;

const SelectControl = styled.select`
  ${controlCss}
`;

const TextControl = styled.input`
  ${controlCss}
`;

/** A labelled native select. Pass `<option>`s as children. */
export const SelectField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  id?: string | undefined;
}> = ({ label, value, onChange, children, id }) => {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <div>
      <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
      <SelectControl
        id={fieldId}
        value={value}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
      >
        {children}
      </SelectControl>
    </div>
  );
};

/** A labelled single-line text input. */
export const TextField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string | undefined;
  id?: string | undefined;
}> = ({ label, value, onChange, placeholder, id }) => {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <div>
      <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
      <TextControl
        id={fieldId}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      />
    </div>
  );
};

/** A labelled checkbox. */
export const CheckboxField: React.FC<{
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}> = ({ label, checked, onChange }) => (
  <label
    style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      fontSize: 13,
      color: "var(--ms-text-1)",
      cursor: "pointer",
    }}
  >
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    <span>{label}</span>
  </label>
);

/** Pills used to filter or switch between a few views (not a tab panel: each button toggles `aria-pressed`). */
export function PillToggleGroup<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V;
  options: Array<{ value: V; label: string }>;
  onChange: (value: V) => void;
}): React.ReactElement {
  return (
    <div role="group" aria-label={label} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {options.map((o) => (
        <SlotButton
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          style={
            value === o.value
              ? { background: "var(--ms-brand-soft)", borderColor: "var(--ms-brand)" }
              : { color: "var(--ms-text-2)" }
          }
        >
          {o.label}
        </SlotButton>
      ))}
    </div>
  );
}

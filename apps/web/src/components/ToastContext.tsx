// SPDX-License-Identifier: AGPL-3.0-or-later

import { AlertIcon, CheckCircleFillIcon, InfoIcon, XCircleFillIcon, XIcon } from "@primer/octicons-react";
import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import styled, { css, keyframes } from "styled-components";

export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastOptions {
  id?: string;
  type?: ToastType;
  title?: string;
  message: string;
  duration?: number; // ms, defaults to 4000
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastItem extends ToastOptions {
  id: string;
  type: ToastType;
}

interface ToastContextValue {
  toast: (options: string | ToastOptions) => string;
  success: (message: string, title?: string) => string;
  error: (message: string, title?: string) => string;
  info: (message: string, title?: string) => string;
  warning: (message: string, title?: string) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const slideIn = keyframes`
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
`;

const ToastViewport = styled.div`
  position: fixed;
  bottom: 24px;
  right: 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  z-index: 100000;
  max-width: 420px;
  width: calc(100vw - 48px);
  pointer-events: none;

  @media (max-width: 500px) {
    bottom: 74px; /* Above mobile bottom bar */
    right: 16px;
    left: 16px;
    width: auto;
  }
`;

const ToastCard = styled.div<{ $type: ToastType }>`
  pointer-events: auto;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  background: var(--surface-overlay, rgba(14, 20, 36, 0.95));
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--color-border-glass, rgba(255, 255, 255, 0.12));
  border-radius: var(--radius-lg, 12px);
  box-shadow:
    0 16px 36px -8px rgba(0, 0, 0, 0.5),
    var(--glow-card, 0 0 20px rgba(139, 92, 246, 0.12));
  color: var(--color-text-primary, #f1f5f9);
  animation: ${slideIn} 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  transition: all 0.2s ease;

  ${(props) =>
    props.$type === "success" &&
    css`
      border-left: 4px solid var(--color-status-verified, #10b981);
    `}
  ${(props) =>
    props.$type === "error" &&
    css`
      border-left: 4px solid var(--color-error, #f43f5e);
    `}
  ${(props) =>
    props.$type === "warning" &&
    css`
      border-left: 4px solid var(--color-accent-amber, #f59e0b);
    `}
  ${(props) =>
    props.$type === "info" &&
    css`
      border-left: 4px solid var(--color-accent-cyan, #06b6d4);
    `}
`;

const IconWrap = styled.div<{ $type: ToastType }>`
  flex-shrink: 0;
  margin-top: 1px;
  display: flex;
  align-items: center;
  justify-content: center;

  ${(props) =>
    props.$type === "success" &&
    css`
      color: var(--color-status-verified, #10b981);
    `}
  ${(props) =>
    props.$type === "error" &&
    css`
      color: var(--color-error, #f43f5e);
    `}
  ${(props) =>
    props.$type === "warning" &&
    css`
      color: var(--color-accent-amber, #f59e0b);
    `}
  ${(props) =>
    props.$type === "info" &&
    css`
      color: var(--color-accent-cyan, #06b6d4);
    `}
`;

const ContentWrap = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const Title = styled.div`
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text-heading, #ffffff);
  line-height: 1.3;
`;

const Message = styled.div`
  font-size: 13px;
  color: var(--color-text-muted, #94a3b8);
  line-height: 1.4;
  word-break: break-word;
`;

const ActionButton = styled.button`
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid var(--color-border);
  color: var(--color-text-primary);
  border-radius: var(--radius-sm, 6px);
  padding: 4px 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 6px;
  align-self: flex-start;
  transition: all 0.15s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.15);
    border-color: var(--color-accent-cyan);
  }
`;

const CloseButton = styled.button`
  background: transparent;
  border: none;
  color: var(--color-text-tertiary, #64748b);
  cursor: pointer;
  padding: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: color 0.15s ease;
  flex-shrink: 0;

  &:hover {
    color: var(--color-text-primary, #ffffff);
  }
`;

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (options: string | ToastOptions) => {
      const id = typeof options === "object" && options.id ? options.id : `toast-${Date.now()}-${Math.random()}`;
      const item: ToastItem =
        typeof options === "string"
          ? { id, message: options, type: "info" }
          : {
              id,
              type: options.type || "info",
              title: options.title,
              message: options.message,
              duration: options.duration,
              action: options.action,
            };

      setToasts((prev) => [...prev, item]);

      const duration = item.duration ?? 4000;
      if (duration > 0) {
        setTimeout(() => {
          dismiss(id);
        }, duration);
      }

      return id;
    },
    [dismiss],
  );

  const success = useCallback((message: string, title?: string) => toast({ type: "success", message, title }), [toast]);

  const error = useCallback(
    (message: string, title?: string) => toast({ type: "error", message, title, duration: 6000 }),
    [toast],
  );

  const info = useCallback((message: string, title?: string) => toast({ type: "info", message, title }), [toast]);

  const warning = useCallback(
    (message: string, title?: string) => toast({ type: "warning", message, title, duration: 5000 }),
    [toast],
  );

  const value = useMemo(
    () => ({ toast, success, error, info, warning, dismiss }),
    [toast, success, error, info, warning, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport aria-live="polite" aria-atomic="true">
        {toasts.map((t) => (
          <ToastCard key={t.id} $type={t.type} role="status">
            <IconWrap $type={t.type}>
              {t.type === "success" && <CheckCircleFillIcon size={18} />}
              {t.type === "error" && <XCircleFillIcon size={18} />}
              {t.type === "warning" && <AlertIcon size={18} />}
              {t.type === "info" && <InfoIcon size={18} />}
            </IconWrap>
            <ContentWrap>
              {t.title && <Title>{t.title}</Title>}
              <Message>{t.message}</Message>
              {t.action && (
                <ActionButton
                  type="button"
                  onClick={() => {
                    t.action?.onClick();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </ActionButton>
              )}
            </ContentWrap>
            <CloseButton type="button" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>
              <XIcon size={14} />
            </CloseButton>
          </ToastCard>
        ))}
      </ToastViewport>
    </ToastContext.Provider>
  );
};

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

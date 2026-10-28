// SPDX-License-Identifier: AGPL-3.0-or-later

import styled from "styled-components";

export const PageWrapper = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: calc(100vh - 60px);
  padding: 40px 16px;
`;

export const Card = styled.div`
  width: 100%;
  max-width: 440px;
  background: var(--surface-overlay, rgba(14, 20, 36, 0.9));
  border: 1px solid var(--color-border-glass, rgba(255, 255, 255, 0.12));
  border-radius: var(--radius-xl, 16px);
  padding: 40px 32px;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow:
    0 20px 48px -12px rgba(0, 0, 0, 0.4),
    var(--glow-card);
  display: flex;
  flex-direction: column;
  align-items: center;
  box-sizing: border-box;
`;

export const LogoBadge = styled.div`
  width: 52px;
  height: 52px;
  border-radius: var(--radius-lg, 14px);
  background: var(--surface-hud, rgba(14, 20, 36, 0.65));
  border: 1px solid var(--color-border-glass, rgba(255, 255, 255, 0.15));
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 24px rgba(6, 182, 212, 0.22);
  margin-bottom: 14px;
`;

export const Title = styled.h1`
  font-size: 24px;
  font-weight: 800;
  color: var(--color-text-heading);
  margin: 0 0 6px 0;
  text-align: center;
  letter-spacing: -0.02em;
`;

export const Subtitle = styled.p`
  font-size: 13px;
  color: var(--color-text-muted);
  margin: 0 0 24px 0;
  text-align: center;
  font-weight: 500;
  line-height: 1.4;
`;

export const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
`;

export const Input = styled.input`
  height: 44px;
  padding: 0 14px;
  background: var(--color-search-bg, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md, 8px);
  color: var(--color-text-primary);
  font-size: 14px;
  outline: none;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
  width: 100%;
  box-sizing: border-box;

  &::placeholder {
    color: var(--color-text-muted);
  }

  &:focus {
    border-color: var(--color-accent-cyan, #06b6d4);
    box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.18);
  }
`;

export const Button = styled.button`
  height: 44px;
  background: var(--gradient-cta);
  color: #ffffff;
  border: none;
  border-radius: 9999px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition:
    opacity 0.2s,
    transform 0.15s ease,
    box-shadow 0.2s;
  box-shadow: 0 4px 14px rgba(6, 182, 212, 0.35);
  margin-top: 6px;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;

  &:hover {
    opacity: 0.95;
    transform: translateY(-1px);
    box-shadow: 0 6px 18px rgba(6, 182, 212, 0.45);
  }

  &:active {
    transform: translateY(0);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }
`;

export const GhostButton = styled.button`
  height: 38px;
  background: transparent;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  border-radius: 9999px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  width: 100%;

  &:hover {
    background: var(--surface-row-hover, rgba(255, 255, 255, 0.04));
    color: var(--color-text-primary);
    border-color: var(--color-text-muted);
  }
`;

export const ProviderButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 42px;
  background: var(--surface-overlay, var(--color-canvas-subtle));
  color: var(--color-text-primary, var(--color-fg-default));
  border: 1px solid var(--color-border);
  border-radius: 9999px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  width: 100%;

  &:hover {
    background: var(--surface-row-hover, var(--color-canvas-default));
    border-color: var(--color-accent-cyan, #06b6d4);
    box-shadow: 0 2px 8px rgba(6, 182, 212, 0.15);
    transform: translateY(-1px);
  }

  &:active {
    transform: translateY(0);
  }
`;

export const Divider = styled.div`
  display: flex;
  align-items: center;
  text-align: center;
  margin: 20px 0;
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  width: 100%;

  &::before,
  &::after {
    content: "";
    flex: 1;
    border-bottom: 1px solid var(--color-border);
  }

  &:not(:empty)::before {
    margin-right: 0.8em;
  }

  &:not(:empty)::after {
    margin-left: 0.8em;
  }
`;

export const ErrorBanner = styled.div`
  background: var(--status-unstable-bg, rgba(248, 81, 73, 0.1));
  border: 1px solid var(--status-unstable-border, rgba(248, 81, 73, 0.4));
  color: var(--status-unstable-fg, #f85149);
  padding: 10px 14px;
  border-radius: var(--radius-md, 8px);
  font-size: 13px;
  line-height: 1.4;
  width: 100%;
  box-sizing: border-box;
  display: flex;
  align-items: flex-start;
  gap: 8px;
`;

export const FooterText = styled.p`
  text-align: center;
  font-size: 14px;
  color: var(--color-text-muted);
  margin: 28px 0 0 0;
  width: 100%;

  a {
    color: var(--color-accent-cyan);
    text-decoration: none;
    font-weight: 700;

    &:hover {
      text-decoration: underline;
    }
  }
`;

export const FieldGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  text-align: left;
`;

export const FieldLabel = styled.label`
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  justify-content: space-between;
  user-select: none;
`;

export const PasswordInputWrapper = styled.div`
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;

  input {
    padding-right: 42px;
  }
`;

export const PasswordToggleButton = styled.button`
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  padding: 0;
  transition:
    color 0.15s ease,
    background-color 0.15s ease;

  &:hover {
    color: var(--color-text-primary);
    background: var(--surface-row-hover, rgba(255, 255, 255, 0.06));
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent-cyan, #06b6d4);
    outline-offset: 1px;
  }
`;

export const StrengthMeterContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 100%;
  margin-top: 2px;
`;

export const StrengthBars = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  width: 100%;
`;

export const StrengthSegment = styled.div<{ $active: boolean; $color: string }>`
  height: 4px;
  border-radius: 9999px;
  background: ${(props) => (props.$active ? props.$color : "var(--color-border, rgba(255, 255, 255, 0.12))")};
  transition: background-color 0.2s ease;
`;

export const StrengthLabel = styled.div<{ $color: string }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 600;
  color: ${(props) => props.$color};
  line-height: 1.2;
`;

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: "" | "Weak" | "Fair" | "Good" | "Strong";
  color: string;
}

export function evaluatePasswordStrength(password: string): PasswordStrength {
  if (!password) {
    return { score: 0, label: "", color: "var(--color-border)" };
  }
  if (password.length < 8) {
    return { score: 1, label: "Weak", color: "var(--status-unstable-fg, #f85149)" };
  }
  let points = 1;
  if (password.length >= 12) points++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) points++;
  if (/\d/.test(password)) points++;
  if (/[^A-Za-z0-9]/.test(password)) points++;

  if (points <= 2) {
    return { score: 2, label: "Fair", color: "#f59e0b" };
  }
  if (points === 3) {
    return { score: 3, label: "Good", color: "var(--color-accent-cyan, #06b6d4)" };
  }
  return { score: 4, label: "Strong", color: "#22c55e" };
}

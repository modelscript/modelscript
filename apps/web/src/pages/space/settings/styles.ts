// SPDX-License-Identifier: AGPL-3.0-or-later

import { Text } from "@primer/react";
import styled from "styled-components";
import Box from "../../../components/Box";
import { StyledBox } from "../../workspace/styles";

export const SettingsLayout = styled.div`
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 32px;
  align-items: start;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
    gap: 24px;
  }
`;

export const SidebarCard = styled.div`
  border: 1px solid var(--ms-border-default, var(--color-border-default));
  border-radius: 8px;
  overflow: hidden;
  background: var(--ms-bg-canvas, var(--color-canvas-default));
  position: sticky;
  top: 24px;
`;

export const FormRow = styled(Box)`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

export const FieldLabel = styled(Text)`
  font-weight: 600;
  font-size: 14px;
  color: var(--color-text-primary);
  display: block;
`;

export const FieldDescription = styled(Text)`
  font-size: 12.5px;
  color: var(--color-fg-muted);
  line-height: 1.4;
  margin-top: -4px;
  display: block;
`;

export const DangerCard = styled(StyledBox)`
  border-color: var(--color-danger-muted, rgba(248, 81, 73, 0.4));
  background: rgba(248, 81, 73, 0.03);
`;

export const DangerRow = styled(Box)`
  padding: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  border-bottom: 1px solid var(--color-danger-muted, rgba(248, 81, 73, 0.2));

  &:last-child {
    border-bottom: none;
  }

  @media (max-width: 700px) {
    flex-direction: column;
    align-items: flex-start;
  }
`;

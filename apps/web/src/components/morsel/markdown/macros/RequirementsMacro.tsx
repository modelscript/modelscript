// SPDX-License-Identifier: AGPL-3.0-or-later

import styled from "styled-components";

interface RequirementsMacroProps {
  target?: string | undefined;
}

const Box = styled.div`
  margin: 8px 0;
  padding: 16px;
  border: 1px solid var(--ms-border);
  border-radius: 10px;
  background: var(--ms-bg-alt);
  font-size: 14px;

  h4 {
    margin: 0 0 8px;
    font-weight: 600;
  }
  table {
    width: 100%;
    text-align: left;
    border-collapse: collapse;
  }
  th {
    padding: 4px 8px;
    border-bottom: 1px solid var(--ms-divider);
  }
  td {
    padding: 4px 8px;
    color: var(--ms-text-2);
    font-style: italic;
  }
`;

export function RequirementsMacro(props: RequirementsMacroProps) {
  return (
    <Box className="requirements-macro">
      <h4>Requirements: {props.target || "All"}</h4>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Text</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={3}>Verification data will be populated by the backend...</td>
          </tr>
        </tbody>
      </table>
    </Box>
  );
}

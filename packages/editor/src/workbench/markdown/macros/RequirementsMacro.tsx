// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";

interface RequirementsMacroProps {
  target?: string | undefined;
}

const thStyle: React.CSSProperties = {
  padding: "4px 8px",
  borderBottom: "1px solid var(--ms-divider)",
};

export function RequirementsMacro(props: RequirementsMacroProps) {
  return (
    <div
      className="requirements-macro"
      style={{
        margin: "8px 0",
        padding: "16px",
        border: "1px solid var(--ms-border)",
        borderRadius: "10px",
        background: "var(--ms-bg-alt)",
        fontSize: "14px",
      }}
    >
      <h4 style={{ margin: "0 0 8px", fontWeight: 600 }}>Requirements: {props.target || "All"}</h4>
      <table style={{ width: "100%", textAlign: "left", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={thStyle}>ID</th>
            <th style={thStyle}>Text</th>
            <th style={thStyle}>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td
              colSpan={3}
              style={{
                padding: "4px 8px",
                color: "var(--ms-text-2)",
                fontStyle: "italic",
              }}
            >
              Verification data will be populated by the backend...
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

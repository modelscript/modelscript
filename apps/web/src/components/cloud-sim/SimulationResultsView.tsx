// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleIcon } from "@primer/octicons-react";
import { Text } from "@primer/react";
import React from "react";
import type { CloudSimulationStatus } from "../../api";
import Box from "../Box";
import { StatCard, TableWrap } from "./styles";
import type { ParsedCsvData } from "./types";

interface SimulationResultsViewProps {
  jobStatus: CloudSimulationStatus | null;
  parsedCsv: ParsedCsvData | null;
}

export const SimulationResultsView: React.FC<SimulationResultsViewProps> = ({ jobStatus, parsedCsv }) => {
  return (
    <Box display="flex" flexDirection="column" gap={3}>
      <Box
        p={3}
        borderRadius="8px"
        bg="rgba(46, 160, 67, 0.1)"
        border="1px solid var(--color-success-fg)"
        display="flex"
        alignItems="center"
        gap={2}
      >
        <CheckCircleIcon size={20} fill="var(--color-success-fg)" />
        <Text fontWeight="bold" fontSize="14px" color="var(--color-success-fg)">
          Simulation Succeeded
        </Text>
      </Box>

      {/* Accounting Stats */}
      {jobStatus?.usage && (
        <Box display="flex" gap={2}>
          <StatCard>
            <Text fontSize="11px" color="var(--color-fg-muted)" display="block">
              CPU Runtime
            </Text>
            <Text fontSize="16px" fontWeight="bold">
              {jobStatus.usage.cpuSeconds.toFixed(2)}s
            </Text>
          </StatCard>
          <StatCard>
            <Text fontSize="11px" color="var(--color-fg-muted)" display="block">
              Cost Charged
            </Text>
            <Text fontSize="16px" fontWeight="bold">
              {jobStatus.usage.costCredits.toFixed(4)} cr
            </Text>
          </StatCard>
          <StatCard>
            <Text fontSize="11px" color="var(--color-fg-muted)" display="block">
              Exit Code
            </Text>
            <Text fontSize="16px" fontWeight="bold">
              {jobStatus.usage.exitCode}
            </Text>
          </StatCard>
        </Box>
      )}

      {/* Data Table Preview */}
      {parsedCsv && (
        <Box>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <Text fontSize="12px" fontWeight="bold" color="var(--color-fg-muted)">
              Trajectory Preview ({parsedCsv.headers.length} variables, {parsedCsv.totalRows} time points)
            </Text>
            <span style={{ fontSize: "11px", color: "var(--color-fg-muted)" }}>Showing first 10 rows</span>
          </Box>
          <TableWrap>
            <table>
              <thead>
                <tr>
                  {parsedCsv.headers.map((h, i) => (
                    <th key={i}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsedCsv.rows.map((row, rIdx) => (
                  <tr key={rIdx}>
                    {row.map((cell, cIdx) => (
                      <td key={cIdx}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Box>
      )}
    </Box>
  );
};

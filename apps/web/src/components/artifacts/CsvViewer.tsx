/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */
import { Spinner, Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import Box from "../Box";

interface CsvViewerProps {
  viewConfig: any;
  isFullScreen?: boolean;
}

const CsvViewer: React.FC<CsvViewerProps> = ({ viewConfig, isFullScreen }) => {
  const [csvData, setCsvData] = useState<string[][]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parseCsv = (text: string) => {
    const rows = text
      .trim()
      .split("\n")
      .map((row) => row.split(",").map((cell) => cell.trim().replace(/^"|"$/g, "")));
    setCsvData(rows);
  };

  useEffect(() => {
    if (viewConfig.data) {
      parseCsv(viewConfig.data);
    } else if (viewConfig.url) {
      setLoading(true);
      fetch(viewConfig.url)
        .then((res) => {
          if (!res.ok) throw new Error("Failed to load CSV");
          return res.text();
        })
        .then((text) => {
          parseCsv(text);
          setLoading(false);
        })
        .catch((err) => {
          setError(err.message);
          setLoading(false);
        });
    } else {
      setError("No CSV data or URL provided.");
    }
  }, [viewConfig]);

  if (loading) {
    return (
      <Box p={3} display="flex" justifyContent="center">
        <Spinner size="small" />
      </Box>
    );
  }

  if (error) {
    return (
      <Box p={3} color="var(--color-danger-fg)">
        <Text>{error}</Text>
      </Box>
    );
  }

  if (csvData.length === 0) return null;

  return (
    <Box
      width="100%"
      maxHeight={isFullScreen ? "100%" : "300px"}
      overflow="auto"
      border="1px solid var(--color-border-subtle)"
      borderRadius="6px"
      bg="var(--color-canvas-default)"
    >
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
        <thead>
          <tr
            style={{
              backgroundColor: "var(--color-canvas-subtle)",
              borderBottom: "2px solid var(--color-border-subtle)",
            }}
          >
            {csvData[0]?.map((header, i) => (
              <th key={i} style={{ padding: "8px", textAlign: "left" }}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {csvData.slice(1).map((row, i) => (
            <tr key={i} style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>
              {row.map((cell, j) => (
                <td key={j} style={{ padding: "8px", color: "var(--color-fg-muted)" }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Box>
  );
};

export default CsvViewer;

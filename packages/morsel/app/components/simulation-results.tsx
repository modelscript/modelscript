import { Spinner } from "@primer/react";
import Papa from "papaparse";
import { useEffect, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface SimulationResultsProps {
  jobId: string;
  selectedVariables: string[];
  onVariablesLoaded: (variables: string[]) => void;
}

export function SimulationResults({ jobId, selectedVariables, onVariablesLoaded }: SimulationResultsProps) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function fetchResults() {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(`/api/v1/simulate/${jobId}/result`);
        if (!response.ok) {
          throw new Error(`Failed to fetch results: ${response.statusText}`);
        }

        const csvText = await response.text();

        Papa.parse(csvText, {
          header: true,
          dynamicTyping: true,
          skipEmptyLines: true,
          complete: (results) => {
            if (!isMounted) return;

            if (results.errors.length > 0) {
              console.error("CSV Parsing errors:", results.errors);
              setError("Failed to parse simulation results.");
              setLoading(false);
              return;
            }

            const parsedData = results.data as any[];
            if (parsedData.length > 0) {
              // Extract variable names (all headers except the first column, which is usually 'time')
              const headers = Object.keys(parsedData[0]);
              const timeCol = headers[0]; // Assuming first column is time
              const vars = headers.filter((h) => h !== timeCol);

              onVariablesLoaded(vars);

              // Map data to ensure x-axis is always 'time' for the chart
              const chartData = parsedData.map((row) => {
                const newRow: any = { time: row[timeCol] };
                vars.forEach((v) => {
                  newRow[v] = row[v];
                });
                return newRow;
              });

              setData(chartData);
            }
            setLoading(false);
          },
          error: (err: any) => {
            if (!isMounted) return;
            setError(`Error parsing CSV: ${err.message}`);
            setLoading(false);
          },
        });
      } catch (err: any) {
        if (!isMounted) return;
        setError(err.message || "An unknown error occurred");
        setLoading(false);
      }
    }

    fetchResults();

    return () => {
      isMounted = false;
    };
  }, [jobId]); // Only fetch when jobId changes

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
        }}
      >
        <Spinner size="large" />
        <div style={{ marginTop: "16px" }}>Loading simulation results...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "32px", color: "var(--color-danger-fg)" }}>
        <h2 style={{ margin: 0, marginBottom: "8px", fontSize: "16px", fontWeight: "bold" }}>Error loading results</h2>
        {error}
      </div>
    );
  }

  if (data.length === 0) {
    return <div style={{ padding: "32px", color: "var(--color-fg-muted)" }}>No data available to plot.</div>;
  }

  // Generate distinct colors for lines
  const colors = [
    "#0969da",
    "#2da44e",
    "#bf3989",
    "#db6d28",
    "#8250df",
    "#1168e3",
    "#218bff",
    "#a371f7",
    "#3fb950",
    "#e34c26",
  ];

  return (
    <div style={{ padding: "32px", height: "100%", display: "flex", flexDirection: "column" }}>
      <h2 style={{ margin: 0, marginBottom: "16px", fontSize: "16px", fontWeight: "bold" }}>Simulation Results</h2>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{
              top: 5,
              right: 30,
              left: 20,
              bottom: 5,
            }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="time"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(val) => val.toFixed(2)}
              label={{ value: "Time (s)", position: "insideBottomRight", offset: -5 }}
            />
            <YAxis />
            <Tooltip
              labelFormatter={(val) => {
                const num = typeof val === "number" ? val : Number(val);
                return `Time: ${isNaN(num) ? val : num.toFixed(4)}s`;
              }}
            />
            <Legend />
            {selectedVariables.map((v, i) => (
              <Line
                key={v}
                type="monotone"
                dataKey={v}
                stroke={colors[i % colors.length]}
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

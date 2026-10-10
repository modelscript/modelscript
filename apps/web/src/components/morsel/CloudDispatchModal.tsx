// SPDX-License-Identifier: AGPL-3.0-or-later

import { PlayIcon, ServerIcon, XIcon } from "@primer/octicons-react";
import { Button, Dialog, IconButton, Spinner } from "@primer/react";
import { useEffect, useState } from "react";
import { dispatchCloudJob, getCloudBalance, getCloudJobResult, getCloudProfiles } from "../../api";

export interface CloudDispatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  modelName: string;
  sourceCode: string;
  experimentConfig?:
    | {
        startTime?: number | undefined;
        stopTime?: number | undefined;
        interval?: number | undefined;
      }
    | undefined;
  onResultLoaded: (data: { t: number[]; y: number[][]; states: string[] }) => void;
}

interface ComputeProfile {
  id: string;
  name: string;
  description: string;
  cpus: number;
  memoryMb: number;
  gpus?: number | undefined;
  costCreditsPerHour: number;
}

export function CloudDispatchModal({
  isOpen,
  onClose,
  modelName,
  sourceCode,
  experimentConfig,
  onResultLoaded,
}: CloudDispatchModalProps) {
  const [profiles, setProfiles] = useState<ComputeProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<string>("standard");
  const [balance, setBalance] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [dispatching, setDispatching] = useState<boolean>(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setJobId(null);
      setStatus(null);
      setLogs([]);
      setError(null);
      setDispatching(false);
      return;
    }

    setLoading(true);
    Promise.all([getCloudProfiles().catch(() => ({ profiles: [] })), getCloudBalance().catch(() => ({ balance: 100 }))])
      .then(([profilesData, balanceData]) => {
        setProfiles(profilesData.profiles || []);
        setBalance(balanceData.balance ?? 0);
        if (profilesData.profiles?.length && !profilesData.profiles.some((p: any) => p.id === selectedProfile)) {
          setSelectedProfile(profilesData.profiles[0].id);
        }
      })
      .finally(() => setLoading(false));
  }, [isOpen]);

  const handleDispatch = async () => {
    setDispatching(true);
    setError(null);
    setLogs(["Submitting job to ModelScript Cloud HPC..."]);
    setStatus("queued");

    try {
      const data = await dispatchCloudJob({
        domain: "modelica",
        name: modelName || "Model",
        profile: selectedProfile,
        sourceContent: sourceCode,
        experiment: {
          startTime: experimentConfig?.startTime ?? 0,
          stopTime: experimentConfig?.stopTime ?? 10,
          numberOfIntervals: 500,
        },
      });

      const dispatchedJobId = data.jobId;
      setJobId(dispatchedJobId);
      setStatus("running");

      // Connect to event stream
      const eventSource = new EventSource(`/api/v1/cloud/jobs/${dispatchedJobId}/events`);
      eventSource.onmessage = async (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload.type === "log") {
            setLogs((prev) => [...prev, payload.data]);
          } else if (payload.type === "status") {
            const st = payload.data.status;
            setStatus(st);
            if (st === "completed") {
              eventSource.close();
              setDispatching(false);
              // Fetch results
              try {
                const csvText = await getCloudJobResult(dispatchedJobId);
                const parsed = parseCsvResults(csvText);
                if (parsed) {
                  onResultLoaded(parsed);
                }
              } catch (resErr) {
                console.error("Failed to load result", resErr);
              }
            } else if (st === "failed") {
              eventSource.close();
              setDispatching(false);
              setError(payload.data.error || "Simulation failed on cloud node.");
            }
          }
        } catch {
          // ignore stream parse errors
        }
      };

      eventSource.onerror = () => {
        // SSE connection drop / completion
      };
    } catch (err: any) {
      setError(err.message || String(err));
      setDispatching(false);
    }
  };

  const parseCsvResults = (csvText: string): { t: number[]; y: number[][]; states: string[] } | null => {
    const lines = csvText.trim().split("\n");
    if (lines.length < 2) return null;
    const header = lines[0]?.split(",") || [];
    const timeIdx = header.findIndex((h) => h.toLowerCase() === "time");
    const validTimeIdx = timeIdx >= 0 ? timeIdx : 0;

    const t: number[] = [];
    const y: number[][] = [];
    const states = header.filter((_, idx) => idx !== validTimeIdx);
    for (const _state of states) {
      y.push([]);
    }

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i]?.split(",").map(Number) || [];
      if (parts.length === header.length) {
        t.push(parts[validTimeIdx] ?? 0);
        let varCounter = 0;
        for (let j = 0; j < parts.length; j++) {
          if (j !== validTimeIdx) {
            y[varCounter]?.push(parts[j] ?? 0);
            varCounter++;
          }
        }
      }
    }
    return { t, y, states };
  };

  if (!isOpen) return null;

  return (
    <Dialog
      onClose={onClose}
      aria-labelledby="cloud-modal-title"
      style={{
        width: "95%",
        maxWidth: "640px",
        maxHeight: "90vh",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Dialog.Header id="cloud-modal-title">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ServerIcon size={18} />
            <span style={{ fontWeight: 600 }}>Run on ModelScript Cloud HPC</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span
              style={{
                fontSize: "0.8rem",
                padding: "2px 8px",
                borderRadius: 12,
                backgroundColor: "var(--color-success-subtle)",
                color: "var(--color-success-fg)",
                fontWeight: 600,
              }}
            >
              {balance.toFixed(0)} Credits Available
            </span>
            <IconButton icon={XIcon} aria-label="Close" variant="invisible" size="small" onClick={onClose} />
          </div>
        </div>
      </Dialog.Header>

      <div style={{ padding: 16, overflowY: "auto", flex: 1 }}>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
            <Spinner size="medium" />
          </div>
        ) : (
          <>
            <p style={{ margin: "0 0 12px 0", fontSize: "0.875rem", color: "var(--color-fg-muted)" }}>
              Offload <strong>{modelName || "active model"}</strong> to high-performance ephemeral cloud nodes with
              dedicated compute resources.
            </p>

            <div
              style={{
                fontWeight: 600,
                fontSize: "0.85rem",
                marginBottom: 8,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              Select Compute Profile
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
              {profiles.map((p) => {
                const isSelected = p.id === selectedProfile;
                return (
                  <div
                    key={p.id}
                    onClick={() => !dispatching && setSelectedProfile(p.id)}
                    style={{
                      padding: 12,
                      borderRadius: 6,
                      border: `1px solid ${isSelected ? "var(--color-accent-emphasis)" : "var(--color-border-default)"}`,
                      backgroundColor: isSelected ? "var(--color-accent-subtle)" : "var(--color-canvas-subtle)",
                      cursor: dispatching ? "not-allowed" : "pointer",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: "0.9rem",
                          color: isSelected ? "var(--color-accent-fg)" : "inherit",
                        }}
                      >
                        {p.name}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "var(--color-fg-muted)", marginTop: 4 }}>
                        {p.cpus} vCPUs • {(p.memoryMb / 1024).toFixed(0)}GB RAM {p.gpus ? `• ${p.gpus}x GPU` : ""}
                      </div>
                    </div>
                    <div
                      style={{
                        alignSelf: "flex-end",
                        fontSize: "0.8rem",
                        fontWeight: 600,
                        color: "var(--color-accent-fg)",
                        marginTop: 8,
                      }}
                    >
                      {p.costCreditsPerHour.toFixed(1)} cr/hr
                    </div>
                  </div>
                );
              })}
            </div>

            {error && (
              <div
                style={{
                  padding: 10,
                  borderRadius: 6,
                  backgroundColor: "var(--color-danger-subtle)",
                  color: "var(--color-danger-fg)",
                  fontSize: "0.85rem",
                  marginBottom: 12,
                }}
              >
                {error}
              </div>
            )}

            {jobId && (
              <div style={{ marginBottom: 16 }}>
                <div
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}
                >
                  <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Execution Logs (#{jobId}):</span>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      padding: "2px 6px",
                      borderRadius: 4,
                      backgroundColor:
                        status === "completed" ? "var(--color-success-subtle)" : "var(--color-accent-subtle)",
                      color: status === "completed" ? "var(--color-success-fg)" : "var(--color-accent-fg)",
                    }}
                  >
                    {status}
                  </span>
                </div>
                <div
                  style={{
                    backgroundColor: "var(--color-canvas-subtle)",
                    border: "1px solid var(--color-border-default)",
                    borderRadius: 6,
                    padding: 8,
                    height: 140,
                    overflowY: "auto",
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: "0.75rem",
                    color: "var(--color-fg-default)",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {logs.length > 0 ? logs.join("\n") : "Waiting for logs from cluster node..."}
                </div>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
              <Button variant="invisible" onClick={onClose} disabled={dispatching}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleDispatch}
                disabled={dispatching || status === "completed"}
                leadingVisual={dispatching ? Spinner : PlayIcon}
              >
                {dispatching ? "Executing on Cloud…" : status === "completed" ? "Completed" : "Launch Simulation"}
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

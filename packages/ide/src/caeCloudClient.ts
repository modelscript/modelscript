// SPDX-License-Identifier: AGPL-3.0-or-later

export interface CaeCloudJobSubmission {
  solver: "calculix" | "su2" | "openfoam";
  title?: string;
  deck: {
    content: string;
    format: "inp" | "cfg";
  };
  geometry?: {
    casHash: string;
    filename: string;
  };
  options?: {
    cores?: number;
    timeoutSeconds?: number;
  };
}

export interface CaeCloudJobStatus {
  jobId: string;
  name: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  resultPath?: string;
}

/**
 * Client connector bridging VS Code custom editors to the @modelscript/api Cloud CAE solver backend.
 */
export class CaeCloudClient {
  constructor(private readonly apiBaseUrl = "http://localhost:3000/api/v1") {}

  /**
   * Uploads raw mesh or CAD geometry to the cloud server with Content-Addressable Storage (CAS) deduplication.
   */
  public async uploadGeometry(fileBytes: Uint8Array, fileName: string): Promise<{ hash: string; cached: boolean }> {
    const formData = new FormData();
    const blob = new Blob([fileBytes], { type: "application/octet-stream" });
    formData.append("file", blob, fileName);

    const res = await fetch(`${this.apiBaseUrl}/cae/upload`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      throw new Error(`CAS upload failed: ${res.statusText}`);
    }

    return (await res.json()) as { hash: string; cached: boolean };
  }

  /**
   * Submits a simulation job to the cloud solver queue.
   */
  public async submitJob(submission: CaeCloudJobSubmission): Promise<{ jobId: string }> {
    const res = await fetch(`${this.apiBaseUrl}/cae/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(submission),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(`Job submission failed: ${err.error || res.statusText}`);
    }

    return (await res.json()) as { jobId: string };
  }

  /**
   * Polls the current status of a cloud simulation job.
   */
  public async getJobStatus(jobId: string): Promise<CaeCloudJobStatus> {
    const res = await fetch(`${this.apiBaseUrl}/cae/jobs/${jobId}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch status for job ${jobId}`);
    }
    return (await res.json()) as CaeCloudJobStatus;
  }

  /**
   * Cancels a running job on the server.
   */
  public async cancelJob(jobId: string): Promise<boolean> {
    const res = await fetch(`${this.apiBaseUrl}/cae/jobs/${jobId}`, {
      method: "DELETE",
    });
    if (!res.ok) return false;
    const body = await res.json();
    return !!body.cancelled;
  }

  /**
   * Fetches the synthesized UnstructuredGrid (.vtu) field result.
   */
  public async fetchResultsVtu(jobId: string): Promise<string> {
    const res = await fetch(`${this.apiBaseUrl}/cae/jobs/${jobId}/results`);
    if (!res.ok) {
      throw new Error(`Result .vtu not ready for job ${jobId}`);
    }
    return await res.text();
  }

  /**
   * Fetches 3D surface mesh and result fields (stress, displacement) formatted as FeaMeshPayload.
   */
  public async fetchMeshPayload(jobId: string): Promise<any> {
    const res = await fetch(`${this.apiBaseUrl}/cae/jobs/${jobId}/mesh-payload`);
    if (res.ok) {
      return await res.json();
    }
    // Fallback: fetch VTU XML and parse client-side
    const vtuXml = await this.fetchResultsVtu(jobId);
    return this.parseVtuXmlToPayload(vtuXml);
  }

  /**
   * Fetches scalar KPIs (convergence, max stress, max displacement) for a job.
   */
  public async fetchScalars(jobId: string): Promise<any> {
    const res = await fetch(`${this.apiBaseUrl}/cae/jobs/${jobId}/scalars`);
    if (!res.ok) {
      throw new Error(`Scalars not ready for job ${jobId}`);
    }
    return await res.json();
  }

  /**
   * Parses VTU XML text client-side into FeaMeshPayload structure.
   */
  public parseVtuXmlToPayload(vtuXml: string): any {
    const pointsMatch = vtuXml.match(/<Points>[\s\S]*?<DataArray[^>]*>([\s\S]*?)<\/DataArray>[\s\S]*?<\/Points>/);
    const positions: number[] = [];
    if (pointsMatch && pointsMatch[1]) {
      const vals = pointsMatch[1].trim().split(/\s+/).map(Number);
      for (const v of vals) if (!Number.isNaN(v)) positions.push(v);
    }

    const connMatch = vtuXml.match(/<DataArray[^>]*Name="connectivity"[^>]*>([\s\S]*?)<\/DataArray>/);
    const elements: number[] = [];
    if (connMatch && connMatch[1]) {
      const vals = connMatch[1].trim().split(/\s+/).map(Number);
      for (const v of vals) if (!Number.isNaN(v)) elements.push(v);
    }

    const stressMatch = vtuXml.match(/<DataArray[^>]*Name="(?:Stress_VonMises|Pressure)"[^>]*>([\s\S]*?)<\/DataArray>/);
    const vonMisesStress: number[] = [];
    let maxStress = 0;
    if (stressMatch && stressMatch[1]) {
      const vals = stressMatch[1].trim().split(/\s+/).map(Number);
      for (const v of vals) {
        if (!Number.isNaN(v)) {
          vonMisesStress.push(v);
          if (v > maxStress) maxStress = v;
        }
      }
    }

    const dispMatch = vtuXml.match(/<DataArray[^>]*Name="(?:Displacement|Velocity)"[^>]*>([\s\S]*?)<\/DataArray>/);
    const displacements: number[] = [];
    let maxDisp = 0;
    if (dispMatch && dispMatch[1]) {
      const vals = dispMatch[1].trim().split(/\s+/).map(Number);
      for (let i = 0; i < vals.length; i += 3) {
        const dx = vals[i] || 0;
        const dy = vals[i + 1] || 0;
        const dz = vals[i + 2] || 0;
        displacements.push(dx, dy, dz);
        const mag = Math.hypot(dx, dy, dz);
        if (mag > maxDisp) maxDisp = mag;
      }
    }

    const numNodes = positions.length / 3;
    const numElems = Math.floor(elements.length / 4);
    const surfaceIndices: number[] = [];
    if (numElems > 0) {
      const faceMap = new Map<string, { count: number; face: [number, number, number] }>();
      for (let e = 0; e < numElems; e++) {
        const base = e * 4;
        const n0 = elements[base + 0]!;
        const n1 = elements[base + 1]!;
        const n2 = elements[base + 2]!;
        const n3 = elements[base + 3]!;
        const faces: [number, number, number][] = [
          [n0, n2, n1],
          [n0, n1, n3],
          [n1, n2, n3],
          [n0, n3, n2],
        ];
        for (const f of faces) {
          const key = [f[0], f[1], f[2]].sort((a, b) => a - b).join("_");
          const entry = faceMap.get(key);
          if (entry) entry.count++;
          else faceMap.set(key, { count: 1, face: f });
        }
      }
      for (const { count, face } of faceMap.values()) {
        if (count === 1) surfaceIndices.push(face[0], face[1], face[2]);
      }
    }

    return {
      type: "fea-mesh",
      time: 0,
      geometry: {
        positions,
        indices: surfaceIndices.length > 0 ? surfaceIndices : Array.from({ length: numNodes }, (_, i) => i),
      },
      fields: {
        vonMisesStress,
        displacements,
      },
      stats: {
        maxStress,
        maxDisplacement: maxDisp,
        safetyFactor: maxStress > 0 ? Number((250e6 / maxStress).toFixed(2)) : 2.5,
      },
    };
  }

  /**
   * Connects to the real-time Server-Sent Events (SSE) telemetry stream for a job.
   */

  public connectTelemetry(jobId: string, onMessage: (event: any) => void, onError?: (err: any) => void): () => void {
    const controller = new AbortController();

    fetch(`${this.apiBaseUrl}/cae/jobs/${jobId}/events`, {
      signal: controller.signal,
      headers: { Accept: "text/event-stream" },
    })
      .then(async (response) => {
        if (!response.ok || !response.body) {
          throw new Error(`SSE stream failed: ${response.statusText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";

          for (const part of parts) {
            const line = part.trim();
            if (line.startsWith("data:")) {
              try {
                const json = JSON.parse(line.slice(5).trim());
                onMessage(json);
              } catch {
                // Ignore parse errors on heartbeat
              }
            }
          }
        }
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          onError?.(err);
        }
      });

    return () => controller.abort();
  }
}

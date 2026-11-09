// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Spatial Pin-Annotated Engineering Query (EQ) Service.
 *
 * Enables contract manufacturers (CMs) and OEM engineers to collaborate directly
 * on 2D/3D PCB canvas coordinates without ambiguous email threads or PDF redlines.
 * Tracks deviations, waiver approvals, and formal ECO requests.
 */

import { randomUUID } from "node:crypto";

export type EQSeverity = "critical" | "major" | "minor" | "info";
export type EQStatus = "open" | "approved_deviation" | "eco_requested" | "clarified" | "rejected";

export interface EngineeringQueryRecord {
  id: string;
  spaceId: string;
  revision: string;
  boardCoordinates: [number, number]; // [x, y] in mm
  layer: string;
  refDes?: string | undefined;
  net?: string | undefined;
  title: string;
  description: string;
  severity: EQSeverity;
  status: EQStatus;
  authorId: string;
  authorName: string;
  authorOrg?: string | undefined; // OEM or CM name
  resolutionNotes?: string | undefined;
  resolvedById?: string | undefined;
  resolvedByName?: string | undefined;
  resolvedAt?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEQInput {
  spaceId: string;
  revision: string;
  boardCoordinates: [number, number];
  layer: string;
  refDes?: string | undefined;
  net?: string | undefined;
  title: string;
  description: string;
  severity?: EQSeverity | undefined;
  authorId: string;
  authorName: string;
  authorOrg?: string | undefined;
}

export interface ResolveEQInput {
  status: EQStatus;
  resolutionNotes: string;
  resolvedById: string;
  resolvedByName: string;
}

export class EngineeringQueryService {
  private queries = new Map<string, EngineeringQueryRecord>();

  /**
   * Files a new pin-annotated Engineering Query.
   */
  createEQ(input: CreateEQInput): EngineeringQueryRecord {
    const id = `eq-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    const record: EngineeringQueryRecord = {
      id,
      spaceId: input.spaceId,
      revision: input.revision,
      boardCoordinates: input.boardCoordinates,
      layer: input.layer,
      refDes: input.refDes,
      net: input.net,
      title: input.title,
      description: input.description,
      severity: input.severity ?? "major",
      status: "open",
      authorId: input.authorId,
      authorName: input.authorName,
      authorOrg: input.authorOrg,
      createdAt: now,
      updatedAt: now,
    };

    this.queries.set(id, record);
    return record;
  }

  /**
   * Retrieves an EQ by ID.
   */
  getEQ(id: string): EngineeringQueryRecord | null {
    return this.queries.get(id) ?? null;
  }

  /**
   * Lists all EQs for a given Space.
   */
  listEQsForSpace(spaceId: string, revision?: string): EngineeringQueryRecord[] {
    const list: EngineeringQueryRecord[] = [];
    for (const q of this.queries.values()) {
      if (q.spaceId === spaceId) {
        if (!revision || q.revision === revision) {
          list.push(q);
        }
      }
    }
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Resolves an EQ (approving deviation, requesting ECO, or providing clarification).
   */
  resolveEQ(id: string, input: ResolveEQInput): EngineeringQueryRecord | null {
    const eq = this.queries.get(id);
    if (!eq) return null;

    const now = new Date().toISOString();
    eq.status = input.status;
    eq.resolutionNotes = input.resolutionNotes;
    eq.resolvedById = input.resolvedById;
    eq.resolvedByName = input.resolvedByName;
    eq.resolvedAt = now;
    eq.updatedAt = now;

    return eq;
  }
}

export const defaultEngineeringQueryService = new EngineeringQueryService();

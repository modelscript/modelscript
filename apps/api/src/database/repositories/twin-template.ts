// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  ClassRow,
  ComponentRow,
  ScriptTemplateRow,
  TwinAdaptationRow,
  TwinProposalRow,
  TwinRow,
} from "../../database.js";
import { BaseRepository } from "./base.js";
export class TwinTemplateRepository extends BaseRepository {
  // ── Script & Study Templates ────────────────────────────────────

  createScriptTemplate(
    name: string,
    slug: string,
    description: string,
    category: string,
    icon: string,
    config: Record<string, unknown>,
  ): number {
    const result = this.db
      .prepare(
        `INSERT INTO script_templates (name, slug, description, category, icon, config, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(slug) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           category = excluded.category,
           icon = excluded.icon,
           config = excluded.config,
           updated_at = datetime('now')`,
      )
      .run(name, slug, description, category, icon, JSON.stringify(config));
    return Number(result.lastInsertRowid);
  }

  getScriptTemplates(): ScriptTemplateRow[] {
    return this.db.prepare(`SELECT * FROM script_templates ORDER BY category, name`).all() as ScriptTemplateRow[];
  }

  getScriptTemplate(id: number): ScriptTemplateRow | undefined {
    return this.db.prepare(`SELECT * FROM script_templates WHERE id = ?`).get(id) as ScriptTemplateRow | undefined;
  }

  getScriptTemplateBySlugOrId(idOrSlug: number | string): ScriptTemplateRow | undefined {
    const numId = typeof idOrSlug === "number" ? idOrSlug : parseInt(String(idOrSlug), 10);
    if (!Number.isNaN(numId) && String(numId) === String(idOrSlug)) {
      const byId = this.getScriptTemplate(numId);
      if (byId) return byId;
    }
    return this.db.prepare(`SELECT * FROM script_templates WHERE slug = ? LIMIT 1`).get(String(idOrSlug)) as
      ScriptTemplateRow | undefined;
  }

  updateJobMetadata(jobId: number, patch: Record<string, unknown>): void {
    const existing = this.facade.getJob(jobId);
    if (!existing) return;
    let currentMeta: Record<string, unknown> = {};
    try {
      if (existing.metadata) {
        currentMeta = JSON.parse(existing.metadata) as Record<string, unknown>;
      }
    } catch {
      // Malformed existing job metadata falls back to empty object
    }
    const merged = { ...currentMeta, ...patch };
    this.db.prepare(`UPDATE jobs SET metadata = ? WHERE id = ?`).run(JSON.stringify(merged), existing.id);
  }

  getPackageStudyArtifacts(): {
    artifactId: number;
    packageName: string;
    packageVersion: string;
    path: string;
    metadata: Record<string, unknown>;
  }[] {
    try {
      const rows = this.db
        .prepare(
          `SELECT a.id AS artifactId, p.name AS packageName, pv.version AS packageVersion, a.path, a.metadata
           FROM artifacts a
           JOIN package_versions pv ON pv.id = a.version_id
           JOIN packages p ON p.id = pv.package_id
           WHERE a.type = 'study-template'
           ORDER BY pv.published_at DESC
           LIMIT 100`,
        )
        .all() as {
        artifactId: number;
        packageName: string;
        packageVersion: string;
        path: string;
        metadata: string | null;
      }[];
      return rows.map((r) => {
        let meta: Record<string, unknown> = {};
        try {
          if (r.metadata) meta = JSON.parse(r.metadata) as Record<string, unknown>;
        } catch {
          // Malformed artifact metadata falls back to empty object
        }
        return {
          artifactId: r.artifactId,
          packageName: r.packageName,
          packageVersion: r.packageVersion,
          path: r.path,
          metadata: meta,
        };
      });
    } catch {
      return [];
    }
  }

  searchIndexedModelsForStudy(opts?: { q?: string | undefined; limit?: number | undefined }): {
    libraryName: string;
    libraryVersion: string;
    className: string;
    classKind: string;
    description: string | null;
    components: {
      name: string;
      typeName: string;
      variability: string | null;
      causality: string | null;
      description: string | null;
      defaultValue: string | null;
    }[];
  }[] {
    const limit = Math.min(Math.max(opts?.limit ?? 25, 1), 100);
    const q = opts?.q?.trim();
    try {
      let sql = `SELECT id, library_name, library_version, class_name, class_kind, description
                 FROM classes
                 WHERE class_kind IN ('model', 'block', 'class', 'cad-assembly', 'part')`;
      const params: (string | number)[] = [];
      if (q) {
        sql += ` AND (class_name LIKE ? OR library_name LIKE ? OR description LIKE ?)`;
        params.push(`%${q}%`, `%${q}%`, `%${q}%`);
      }
      sql += ` ORDER BY id DESC LIMIT ?`;
      params.push(limit);

      const classRows = this.db.prepare(sql).all(...params) as ClassRow[];
      const getComps = this.db.prepare(
        `SELECT id, component_name, type_name, description, causality, variability
         FROM components WHERE class_id = ? LIMIT 30`,
      );
      const getMods = this.db.prepare(
        `SELECT modifier_name, modifier_value FROM modifiers WHERE component_id = ? LIMIT 5`,
      );

      return classRows.map((c) => {
        const comps = getComps.all(c.id) as ComponentRow[];
        return {
          libraryName: c.library_name,
          libraryVersion: c.library_version,
          className: c.class_name,
          classKind: c.class_kind,
          description: c.description,
          components: comps.map((comp) => {
            const mods = getMods.all(comp.id) as { modifier_name: string; modifier_value: string | null }[];
            const startMod = mods.find((m) => m.modifier_name === "start" || m.modifier_name === "value");
            return {
              name: comp.component_name,
              typeName: comp.type_name,
              variability: comp.variability,
              causality: comp.causality,
              description: comp.description,
              defaultValue: startMod?.modifier_value ?? null,
            };
          }),
        };
      });
    } catch {
      return [];
    }
  }

  // ── Serialized Instances (Digital Twins) ───────────────────────

  createInstance(data: {
    serialNumber: string;
    packageId: number;
    version: string;
    commitSha?: string | null | undefined;
    variant?: string | null | undefined;
    birthData?: string | null | undefined;
  }): number {
    const result = this.db
      .prepare(
        `INSERT INTO instances (serial_number, package_id, version, commit_sha, variant, birth_data)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.serialNumber,
        data.packageId,
        data.version,
        data.commitSha ?? null,
        data.variant ?? null,
        data.birthData ?? null,
      );
    return Number(result.lastInsertRowid);
  }

  getInstanceBySerialNumber(serialNumber: string):
    | {
        id: number;
        serial_number: string;
        package_id: number;
        package_name: string;
        version: string;
        commit_sha: string | null;
        variant: string | null;
        birth_data: string | null;
        created_at: string;
      }
    | undefined {
    return this.db
      .prepare(
        `SELECT i.*, p.name as package_name
         FROM instances i
         JOIN packages p ON p.id = i.package_id
         WHERE i.serial_number = ?`,
      )
      .get(serialNumber) as
      | {
          id: number;
          serial_number: string;
          package_id: number;
          package_name: string;
          version: string;
          commit_sha: string | null;
          variant: string | null;
          birth_data: string | null;
          created_at: string;
        }
      | undefined;
  }

  listInstancesForPackage(
    packageId: number,
    limit = 50,
  ): {
    id: number;
    serial_number: string;
    version: string;
    commit_sha: string | null;
    variant: string | null;
    created_at: string;
  }[] {
    return this.db
      .prepare(
        `SELECT id, serial_number, version, commit_sha, variant, created_at
         FROM instances
         WHERE package_id = ?
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(packageId, limit) as {
      id: number;
      serial_number: string;
      version: string;
      commit_sha: string | null;
      variant: string | null;
      created_at: string;
    }[];
  }

  listInstances(limit = 50): {
    id: number;
    serial_number: string;
    package_id: number;
    package_name: string;
    version: string;
    commit_sha: string | null;
    variant: string | null;
    created_at: string;
  }[] {
    return this.db
      .prepare(
        `SELECT i.id, i.serial_number, i.package_id, p.name as package_name, i.version, i.commit_sha, i.variant, i.created_at
         FROM instances i
         JOIN packages p ON p.id = i.package_id
         ORDER BY i.id DESC
         LIMIT ?`,
      )
      .all(limit) as {
      id: number;
      serial_number: string;
      package_id: number;
      package_name: string;
      version: string;
      commit_sha: string | null;
      variant: string | null;
      created_at: string;
    }[];
  }

  // ── Digital Twin Methods ──

  createTwin(data: {
    instanceId: number;
    name: string;
    modelicaClass: string;
    status?: string | undefined;
    healthScore?: number | undefined;
    config: string;
    currentParameters: string;
    currentWeights?: string | null | undefined;
  }): number {
    const result = this.db
      .prepare(
        `INSERT INTO twins (instance_id, name, modelica_class, status, health_score, config, current_parameters, current_weights)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.instanceId,
        data.name,
        data.modelicaClass,
        data.status ?? "active",
        data.healthScore ?? 100.0,
        data.config,
        data.currentParameters,
        data.currentWeights ?? null,
      );
    return Number(result.lastInsertRowid);
  }

  getTwin(id: number):
    | (TwinRow & {
        instance_serial: string;
        package_name: string;
        package_version: string;
      })
    | undefined {
    return this.db
      .prepare(
        `SELECT t.*, i.serial_number as instance_serial, p.name as package_name, i.version as package_version
         FROM twins t
         JOIN instances i ON i.id = t.instance_id
         JOIN packages p ON p.id = i.package_id
         WHERE t.id = ?`,
      )
      .get(id) as
      | (TwinRow & {
          instance_serial: string;
          package_name: string;
          package_version: string;
        })
      | undefined;
  }

  getTwinByInstanceId(instanceId: number): TwinRow | undefined {
    return this.db.prepare(`SELECT * FROM twins WHERE instance_id = ? ORDER BY id DESC LIMIT 1`).get(instanceId) as
      TwinRow | undefined;
  }

  listTwins(limit = 50): (TwinRow & {
    instance_serial: string;
    package_name: string;
    package_version: string;
  })[] {
    return this.db
      .prepare(
        `SELECT t.*, i.serial_number as instance_serial, p.name as package_name, i.version as package_version
         FROM twins t
         JOIN instances i ON i.id = t.instance_id
         JOIN packages p ON p.id = i.package_id
         ORDER BY t.id DESC
         LIMIT ?`,
      )
      .all(limit) as (TwinRow & {
      instance_serial: string;
      package_name: string;
      package_version: string;
    })[];
  }

  updateTwinState(
    id: number,
    data: {
      status?: string | undefined;
      healthScore?: number | undefined;
      currentParameters?: string | undefined;
      currentWeights?: string | null | undefined;
      lastTelemetryAt?: string | undefined;
      lastAdaptedAt?: string | undefined;
    },
  ): void {
    const sets: string[] = [];
    const params: (string | number | null)[] = [];

    if (data.status !== undefined) {
      sets.push("status = ?");
      params.push(data.status);
    }
    if (data.healthScore !== undefined) {
      sets.push("health_score = ?");
      params.push(data.healthScore);
    }
    if (data.currentParameters !== undefined) {
      sets.push("current_parameters = ?");
      params.push(data.currentParameters);
    }
    if (data.currentWeights !== undefined) {
      sets.push("current_weights = ?");
      params.push(data.currentWeights);
    }
    if (data.lastTelemetryAt !== undefined) {
      sets.push("last_telemetry_at = ?");
      params.push(data.lastTelemetryAt);
    }
    if (data.lastAdaptedAt !== undefined) {
      sets.push("last_adapted_at = ?");
      params.push(data.lastAdaptedAt);
    }

    if (sets.length === 0) return;
    params.push(id);

    this.db.prepare(`UPDATE twins SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  }

  createTwinAdaptation(data: {
    twinId: number;
    triggerReason: string;
    priorParameters: string;
    updatedParameters: string;
    residualBefore: number;
    residualAfter: number;
    iterations: number;
  }): number {
    const result = this.db
      .prepare(
        `INSERT INTO twin_adaptations (twin_id, trigger_reason, prior_parameters, updated_parameters, residual_before, residual_after, iterations)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.twinId,
        data.triggerReason,
        data.priorParameters,
        data.updatedParameters,
        data.residualBefore,
        data.residualAfter,
        data.iterations,
      );
    return Number(result.lastInsertRowid);
  }

  listTwinAdaptations(twinId: number, limit = 50): TwinAdaptationRow[] {
    return this.db
      .prepare(
        `SELECT * FROM twin_adaptations
         WHERE twin_id = ?
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(twinId, limit) as TwinAdaptationRow[];
  }

  createTwinProposal(data: {
    twinId: number;
    postId?: number | string | null | undefined;
    adaptationId: number;
  }): number {
    const result = this.db
      .prepare(
        `INSERT INTO twin_proposals (twin_id, post_id, adaptation_id, status)
         VALUES (?, ?, ?, 'open')`,
      )
      .run(data.twinId, data.postId ?? null, data.adaptationId);
    return Number(result.lastInsertRowid);
  }

  getTwinProposal(id: number):
    | (TwinProposalRow & {
        twin_name: string;
        prior_parameters: string;
        updated_parameters: string;
      })
    | undefined {
    return this.db
      .prepare(
        `SELECT p.*, CAST(p.post_id AS TEXT) as post_id, t.name as twin_name, a.prior_parameters, a.updated_parameters
         FROM twin_proposals p
         JOIN twins t ON t.id = p.twin_id
         JOIN twin_adaptations a ON a.id = p.adaptation_id
         WHERE p.id = ?`,
      )
      .get(id) as
      | (TwinProposalRow & {
          twin_name: string;
          prior_parameters: string;
          updated_parameters: string;
        })
      | undefined;
  }

  listTwinProposals(
    twinId?: number,
    status?: string,
    limit = 50,
  ): (TwinProposalRow & {
    twin_name: string;
    prior_parameters: string;
    updated_parameters: string;
  })[] {
    let query = `
      SELECT p.*, CAST(p.post_id AS TEXT) as post_id, t.name as twin_name, a.prior_parameters, a.updated_parameters
      FROM twin_proposals p
      JOIN twins t ON t.id = p.twin_id
      JOIN twin_adaptations a ON a.id = p.adaptation_id
    `;
    const clauses: string[] = [];
    const params: (string | number)[] = [];

    if (twinId !== undefined) {
      clauses.push("p.twin_id = ?");
      params.push(twinId);
    }
    if (status !== undefined) {
      clauses.push("p.status = ?");
      params.push(status);
    }
    if (clauses.length > 0) {
      query += ` WHERE ${clauses.join(" AND ")}`;
    }
    query += " ORDER BY p.id DESC LIMIT ?";
    params.push(limit);

    return this.db.prepare(query).all(...params) as (TwinProposalRow & {
      twin_name: string;
      prior_parameters: string;
      updated_parameters: string;
    })[];
  }

  reviewTwinProposal(id: number, status: "approved" | "rejected", reviewerId: number, notes?: string): boolean {
    const proposal = this.getTwinProposal(id);
    if (!proposal || proposal.status !== "open") {
      return false;
    }

    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE twin_proposals
         SET status = ?, reviewer_id = ?, review_notes = ?, reviewed_at = ?
         WHERE id = ?`,
      )
      .run(status, reviewerId, notes ?? null, now, id);

    // If approved, update active twin parameters
    if (status === "approved") {
      this.db
        .prepare(
          `UPDATE twins
           SET current_parameters = ?, last_adapted_at = ?
           WHERE id = ?`,
        )
        .run(proposal.updated_parameters, now, proposal.twin_id);
    }

    return true;
  }
}

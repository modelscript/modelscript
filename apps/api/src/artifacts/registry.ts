// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Extensible Artifact Registry
 *
 * Plugin-based system for handling different artifact types within
 * ModelScript packages. Each handler can:
 *
 *  1. Extract metadata at publish time (from tarball contents)
 *  2. Validate artifact declarations
 *  3. Provide metadata for web UI viewers
 *
 * Architecture:
 *   ArtifactRegistry → registers ArtifactHandler plugins
 *   ArtifactHandler  → one per artifact type (fmu, wasm, dataset, cad, etc.)
 *
 * Example usage:
 *   const registry = new ArtifactRegistry();
 *   registry.register(new FmuArtifactHandler());
 *   registry.register(new DatasetArtifactHandler());
 *
 *   // At publish time:
 *   const metadata = await registry.extractMetadata('fmu', tarballBuffer, 'models/Motor.fmu');
 */

// ── Interfaces ──────────────────────────────────────────────────

/**
 * Metadata extracted from an artifact at publish time.
 */
export interface ArtifactMetadata {
  /** Artifact type identifier (e.g., 'fmu', 'wasm', 'dataset'). */
  type: string;
  /** Path within the tarball. */
  path: string;
  /** Human-readable description. */
  description?: string;
  /** MIME type for serving. */
  mimeType?: string;
  /** Size in bytes (if known). */
  size?: number;
  /** Type-specific metadata (e.g., FMI version, platforms, variables). */
  details: Record<string, unknown>;
}

/**
 * View descriptor returned by handlers for the Web UI.
 * Each viewer type gets a dedicated component in the frontend.
 */
export interface ArtifactViewDescriptor {
  /** The frontend component to render (e.g., 'fmu-simulator', 'dataset-table', 'cad-viewer'). */
  viewer: string;
  /** Label shown in the Web UI tab/card. */
  label: string;
  /** Icon identifier (e.g., 'play-circle', 'table', 'cube'). */
  icon: string;
  /** Configuration passed to the viewer component. */
  config: Record<string, unknown>;
}

/**
 * Interface for artifact handler plugins.
 */
export interface ArtifactHandler {
  /** Unique type identifier (e.g., 'fmu', 'wasm', 'dataset', 'cad'). */
  readonly type: string;

  /** Human-readable display name. */
  readonly displayName: string;

  /** File extensions this handler recognizes (e.g., ['.fmu']). */
  readonly extensions: string[];

  /**
   * Extract metadata from an artifact file within a tarball.
   * Called at publish time when an artifact is declared in package.json.
   *
   * @param fileBuffer - Raw bytes of the artifact file
   * @param filePath - Path within the tarball
   * @returns Extracted metadata, or null if the file is not a valid artifact
   */
  extractMetadata(fileBuffer: Buffer, filePath: string): Promise<ArtifactMetadata | null>;

  /**
   * Validate an artifact declaration in package.json.
   *
   * @param artifact - The artifact declaration from `modelscript.artifacts`
   * @returns Array of validation errors (empty = valid)
   */
  validate(artifact: Record<string, unknown>): string[];

  /**
   * Get the Web UI viewer descriptor for this artifact type.
   *
   * @param metadata - Previously extracted metadata
   * @returns View descriptor, or null if no viewer is available
   */
  getViewDescriptor(metadata: ArtifactMetadata): ArtifactViewDescriptor | null;
}

// ── Registry ────────────────────────────────────────────────────

export class ArtifactRegistry {
  private handlers = new Map<string, ArtifactHandler>();

  /**
   * Register an artifact handler plugin.
   */
  register(handler: ArtifactHandler): void {
    this.handlers.set(handler.type, handler);
    console.log(`[ArtifactRegistry] Registered handler: ${handler.type} (${handler.displayName})`);
  }

  /**
   * Get all registered handler types.
   */
  getRegisteredTypes(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Get a handler by type.
   */
  getHandler(type: string): ArtifactHandler | undefined {
    return this.handlers.get(type);
  }

  /**
   * Auto-detect artifact type from file extension.
   */
  detectType(filePath: string): string | null {
    const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
    for (const handler of this.handlers.values()) {
      if (handler.extensions.includes(ext)) {
        return handler.type;
      }
    }
    return null;
  }

  /**
   * Extract metadata from an artifact file.
   */
  async extractMetadata(type: string, fileBuffer: Buffer, filePath: string): Promise<ArtifactMetadata | null> {
    const handler = this.handlers.get(type);
    if (!handler) return null;
    return handler.extractMetadata(fileBuffer, filePath);
  }

  /**
   * Validate an artifact declaration.
   */
  validate(type: string, artifact: Record<string, unknown>): string[] {
    const handler = this.handlers.get(type);
    if (!handler) return [`Unknown artifact type: "${type}"`];
    return handler.validate(artifact);
  }

  /**
   * Get a view descriptor for the Web UI.
   */
  getViewDescriptor(metadata: ArtifactMetadata): ArtifactViewDescriptor | null {
    const handler = this.handlers.get(metadata.type);
    if (!handler) return null;
    return handler.getViewDescriptor(metadata);
  }

  /**
   * Process all artifacts declared in a package manifest.
   * Returns enriched metadata for each artifact.
   */
  async processArtifacts(
    artifacts: Record<string, unknown>[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _tarballBuffer?: Buffer,
  ): Promise<ArtifactMetadata[]> {
    const results: ArtifactMetadata[] = [];

    for (const artifact of artifacts) {
      const type = artifact.type as string;
      const artifactPath = artifact.path as string;

      if (!type || !artifactPath) continue;

      const handler = this.handlers.get(type);
      if (!handler) {
        // Store as generic artifact with no handler-specific metadata
        results.push({
          type,
          path: artifactPath,
          description: (artifact.description as string) ?? undefined,
          details: { ...artifact },
        });
        continue;
      }

      // Validate the artifact declaration
      const errors = handler.validate(artifact);
      if (errors.length > 0) {
        console.warn(`[ArtifactRegistry] Validation warnings for ${type}@${artifactPath}:`, errors);
      }

      // Create metadata from the declaration (without tarball extraction for now)
      results.push({
        type,
        path: artifactPath,
        description: (artifact.description as string) ?? undefined,
        details: { ...artifact },
      });
    }

    return results;
  }
}

// ── Singleton ───────────────────────────────────────────────────

let _instance: ArtifactRegistry | null = null;

/**
 * Get the global ArtifactRegistry singleton.
 */
export function getArtifactRegistry(): ArtifactRegistry {
  if (!_instance) {
    _instance = new ArtifactRegistry();
  }
  return _instance;
}

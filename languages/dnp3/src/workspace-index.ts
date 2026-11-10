// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Workspace Index for IEEE 1815 / DNP3 Device Profiles.
 */

import { parseDnp3 } from "./parser/dnp3-parser.js";
import type { Dnp3DeviceProfile } from "./types.js";

export interface Dnp3WorkspaceModel {
  uri: string;
  id: string;
  deviceName: string;
  vendor: string;
  outstationAddress: number;
  binaryInputCount: number;
  analogInputCount: number;
  totalPointCount: number;
}

export class Dnp3WorkspaceIndex {
  private readonly models = new Map<string, Dnp3WorkspaceModel>();

  public indexDocument(uri: string, content: string): void {
    try {
      const profile = parseDnp3(content);
      this.addProfile(uri, profile);
    } catch {
      // Ignore indexing errors for non-DNP3 files
    }
  }

  public addProfile(uri: string, profile: Dnp3DeviceProfile): void {
    const totalPointCount =
      profile.binaryInputs.length +
      profile.binaryOutputs.length +
      profile.analogInputs.length +
      profile.analogOutputs.length +
      profile.counters.length;

    this.models.set(uri, {
      uri,
      id: profile.id,
      deviceName: profile.deviceName,
      vendor: profile.vendor,
      outstationAddress: profile.outstationAddress,
      binaryInputCount: profile.binaryInputs.length,
      analogInputCount: profile.analogInputs.length,
      totalPointCount,
    });
  }

  public getModel(uri: string): Dnp3WorkspaceModel | undefined {
    return this.models.get(uri);
  }

  public getAllModels(): Dnp3WorkspaceModel[] {
    return Array.from(this.models.values());
  }

  public clear(): void {
    this.models.clear();
  }
}

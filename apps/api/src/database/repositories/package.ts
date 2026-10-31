// SPDX-License-Identifier: AGPL-3.0-or-later

import { BaseRepository } from "./base.js";

export class PackageRepository extends BaseRepository {
  getPackage(name: string) {
    return this.facade.getPackage(name);
  }

  getPackageCount(): number {
    const row = this.get<{ count: number }>(`SELECT COUNT(*) as count FROM packages`);
    return row?.count ?? 0;
  }

  listPackages(query?: string) {
    return this.facade.listPackages(query);
  }

  recordPackageDownload(name: string, version: string): void {
    this.facade.recordPackageDownload(name, version);
  }
}

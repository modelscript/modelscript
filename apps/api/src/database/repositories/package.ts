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
    const date = new Date().toISOString().slice(0, 10);
    this.run(
      `INSERT INTO package_downloads_daily (library_name, library_version, download_date, downloads_count)
       VALUES (?, ?, ?, 1)
       ON CONFLICT(library_name, library_version, download_date)
       DO UPDATE SET downloads_count = downloads_count + 1`,
      name,
      version,
      date,
    );
  }
}

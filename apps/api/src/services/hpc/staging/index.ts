// SPDX-License-Identifier: AGPL-3.0-or-later

import { LocalFsObjectStager } from "./local-stager.js";
import { S3ObjectStager, type S3StagerOptions } from "./s3-stager.js";
import type { ObjectStager } from "./staging-types.js";

export * from "./local-stager.js";
export * from "./s3-stager.js";
export * from "./staging-types.js";

/**
 * Returns the configured ObjectStager based on environment variables or explicit options.
 */
export function getObjectStager(overrideOptions?: {
  backend?: "s3" | "local";
  s3Options?: Partial<S3StagerOptions>;
  localRoot?: string;
}): ObjectStager {
  const backend = (
    overrideOptions?.backend ||
    process.env["HPC_STAGING_BACKEND"] ||
    (process.env["S3_ENDPOINT"] ? "s3" : "local")
  ).toLowerCase();

  if (backend === "s3") {
    const s3Opts: S3StagerOptions = {
      endpoint: overrideOptions?.s3Options?.endpoint || process.env["S3_ENDPOINT"] || "http://localhost:9000",
      bucket: overrideOptions?.s3Options?.bucket || process.env["S3_BUCKET"] || "modelscript-hpc-artifacts",
      region: overrideOptions?.s3Options?.region || process.env["S3_REGION"] || "us-east-1",
      accessKeyId:
        overrideOptions?.s3Options?.accessKeyId ||
        process.env["S3_ACCESS_KEY"] ||
        process.env["AWS_ACCESS_KEY_ID"] ||
        "minioadmin",
      secretAccessKey:
        overrideOptions?.s3Options?.secretAccessKey ||
        process.env["S3_SECRET_KEY"] ||
        process.env["AWS_SECRET_ACCESS_KEY"] ||
        "minioadmin",
      forcePathStyle: overrideOptions?.s3Options?.forcePathStyle ?? true,
    };
    if (overrideOptions?.s3Options?.fetchFn) {
      s3Opts.fetchFn = overrideOptions.s3Options.fetchFn;
    }
    return new S3ObjectStager(s3Opts);
  }

  return new LocalFsObjectStager(overrideOptions?.localRoot);
}

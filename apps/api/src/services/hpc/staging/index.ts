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
  backend?: "s3" | "local" | undefined;
  s3Options?: Partial<S3StagerOptions> | undefined;
  localRoot?: string | undefined;
}): ObjectStager {
  const backend = (
    overrideOptions?.backend ||
    process.env["HPC_STAGING_BACKEND"] ||
    (process.env["S3_ENDPOINT"] ? "s3" : "local")
  ).toLowerCase();

  if (backend === "s3") {
    const isProd = process.env["NODE_ENV"] === "production";
    const endpoint = overrideOptions?.s3Options?.endpoint || process.env["S3_ENDPOINT"];
    const accessKeyId =
      overrideOptions?.s3Options?.accessKeyId || process.env["S3_ACCESS_KEY"] || process.env["AWS_ACCESS_KEY_ID"];
    const secretAccessKey =
      overrideOptions?.s3Options?.secretAccessKey ||
      process.env["S3_SECRET_KEY"] ||
      process.env["AWS_SECRET_ACCESS_KEY"];

    if (isProd && (!endpoint || !accessKeyId || !secretAccessKey)) {
      throw new Error(
        "S3 staging in production requires S3_ENDPOINT, S3_ACCESS_KEY (or AWS_ACCESS_KEY_ID), and S3_SECRET_KEY (or AWS_SECRET_ACCESS_KEY) to be explicitly configured.",
      );
    }

    const s3Opts: S3StagerOptions = {
      endpoint: endpoint || "http://localhost:9000",
      bucket: overrideOptions?.s3Options?.bucket || process.env["S3_BUCKET"] || "modelscript-hpc-artifacts",
      region: overrideOptions?.s3Options?.region || process.env["S3_REGION"] || "us-east-1",
      accessKeyId: accessKeyId || "minioadmin",
      secretAccessKey: secretAccessKey || "minioadmin",
      forcePathStyle: overrideOptions?.s3Options?.forcePathStyle ?? true,
    };
    if (overrideOptions?.s3Options?.fetchFn) {
      s3Opts.fetchFn = overrideOptions.s3Options.fetchFn;
    }
    return new S3ObjectStager(s3Opts);
  }

  return new LocalFsObjectStager(overrideOptions?.localRoot);
}

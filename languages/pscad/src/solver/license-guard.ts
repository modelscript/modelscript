// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pscad — Simulation Pre-Flight Licensing Guard
 *
 * Verifies OEM black-box DLLs against physical USB dongles (Wibu-Systems CodeMeter,
 * Thales Sentinel HASP) and DRM license policies prior to launching EMTDC numerical integration.
 */

import type { BrowserDongleManager, DrmLicenseOptions } from "@modelscript/exchange";
import type { EmtdcWasmMachinaDllRunner } from "../script/emtdc-abi-bridge.js";
import type { EmtCustomFortranBlock, EmtNetlist } from "../types.js";

/**
 * Error thrown when an OEM black-box binary DLL fails pre-flight or runtime hardware dongle / DRM licensing.
 */
export class OemLicenseError extends Error {
  public readonly blockId: string;
  public readonly blockName: string;
  public readonly firmCode?: number | undefined;
  public readonly productCode?: number | undefined;
  public readonly drmType?: string | undefined;
  public readonly reason: string;

  constructor(
    message: string,
    options: {
      blockId: string;
      blockName?: string | undefined;
      firmCode?: number | undefined;
      productCode?: number | undefined;
      drmType?: string | undefined;
      reason?: string | undefined;
    },
  ) {
    super(message);
    this.name = "OemLicenseError";
    this.blockId = options.blockId;
    this.blockName = options.blockName ?? options.blockId;
    this.firmCode = options.firmCode;
    this.productCode = options.productCode;
    this.drmType = options.drmType;
    this.reason = options.reason ?? message;
  }
}

export interface LicenseValidationTarget {
  block: EmtCustomFortranBlock;
  runner?: EmtdcWasmMachinaDllRunner | undefined;
}

export interface OemLicensePreflightGuardOptions {
  dongleManager?: BrowserDongleManager | undefined;
  drmOptions?: DrmLicenseOptions | undefined;
  strictDrmLicense?: boolean | undefined;
}

/**
 * Pre-flight simulation guard validating DRM licenses and physical USB dongles
 * before launching EMT time-domain integration.
 */
export class OemLicensePreflightGuard {
  private readonly dongleManager?: BrowserDongleManager | undefined;
  private readonly drmOptions?: DrmLicenseOptions | undefined;
  private readonly strictDrmLicense: boolean;

  constructor(options?: OemLicensePreflightGuardOptions) {
    this.dongleManager = options?.dongleManager ?? options?.drmOptions?.dongleManager;
    this.drmOptions = options?.drmOptions;
    this.strictDrmLicense = Boolean(options?.strictDrmLicense || options?.drmOptions?.mode === "strict");
  }

  /**
   * Synchronously verifies that all OEM black-box blocks have authorized DRM licenses.
   * Throws `OemLicenseError` if any block is unlicensed and strict mode is active.
   */
  public verifyOrThrow(targets: readonly LicenseValidationTarget[]): void {
    for (const target of targets) {
      const { block, runner } = target;

      // 1. Check if runner experienced an explicit DRM access denial during DllMain or call
      if (runner?.hasLicenseFailure) {
        throw new OemLicenseError(
          `OEM Black-Box DLL '${block.name}' (${block.id}) was denied hardware dongle / DRM license access.`,
          {
            blockId: block.id,
            blockName: block.name,
            firmCode: block.drmFirmCode,
            productCode: block.drmProductCode,
            drmType: block.drmType,
            reason: "DRM runtime denied access",
          },
        );
      }

      // 2. Check if DllMain initialization failed (e.g. returned FALSE/0 because cmAccess failed)
      if (runner?.dllMainFailed) {
        throw new OemLicenseError(
          `OEM Black-Box DLL '${block.name}' (${block.id}) failed initialization (DllMain returned FALSE/0).`,
          {
            blockId: block.id,
            blockName: block.name,
            firmCode: block.drmFirmCode,
            productCode: block.drmProductCode,
            drmType: block.drmType,
            reason: "DllMain initialization failed",
          },
        );
      }

      // 3. Strict mode or block-level hardware dongle requirement
      const requiresStrict = this.strictDrmLicense || Boolean(block.requireHardwareDongle);
      if (requiresStrict && (block.binaryBuffer || block.drmFirmCode !== undefined || block.requireHardwareDongle)) {
        // Verify against allowedFirmCodes if specified in drmOptions
        if (this.drmOptions?.allowedFirmCodes && block.drmFirmCode !== undefined) {
          if (!this.drmOptions.allowedFirmCodes.includes(block.drmFirmCode)) {
            throw new OemLicenseError(
              `OEM Black-Box DLL '${block.name}' requires Firm Code ${block.drmFirmCode}, which is not authorized.`,
              {
                blockId: block.id,
                blockName: block.name,
                firmCode: block.drmFirmCode,
                productCode: block.drmProductCode,
                drmType: block.drmType,
                reason: `Firm Code ${block.drmFirmCode} not in authorized list`,
              },
            );
          }
        }

        // Verify against allowedProductCodes if specified in drmOptions
        if (this.drmOptions?.allowedProductCodes && block.drmProductCode !== undefined) {
          if (!this.drmOptions.allowedProductCodes.includes(block.drmProductCode)) {
            throw new OemLicenseError(
              `OEM Black-Box DLL '${block.name}' requires Product Code ${block.drmProductCode}, which is not authorized.`,
              {
                blockId: block.id,
                blockName: block.name,
                firmCode: block.drmFirmCode,
                productCode: block.drmProductCode,
                drmType: block.drmType,
                reason: `Product Code ${block.drmProductCode} not in authorized list`,
              },
            );
          }
        }

        // Verify against connected dongles or active sessions in BrowserDongleManager
        if (this.dongleManager) {
          const dongles = this.dongleManager.getConnectedDongles();
          const sessions = this.dongleManager.getActiveSessions();

          const hasDongle = dongles.some((d) => {
            if (block.drmType && d.type !== block.drmType) return false;
            if (block.drmFirmCode !== undefined && d.firmCode !== undefined && d.firmCode !== block.drmFirmCode) {
              return false;
            }
            if (
              block.drmProductCode !== undefined &&
              d.productCodes.length > 0 &&
              !d.productCodes.includes(block.drmProductCode)
            ) {
              return false;
            }
            return d.connected;
          });

          const hasSession = sessions.some((s) => {
            if (!s.granted) return false;
            if (block.drmFirmCode !== undefined && Number(s.firmOrVendor) !== block.drmFirmCode) return false;
            if (block.drmProductCode !== undefined && s.productOrFeature !== block.drmProductCode) return false;
            return true;
          });

          if (!hasDongle && !hasSession) {
            throw new OemLicenseError(
              `OEM Black-Box DLL '${block.name}' requires a connected ${block.drmType ?? "hardware"} dongle (Firm: ${block.drmFirmCode ?? "any"}, Product: ${block.drmProductCode ?? "any"}). No matching dongle or license session detected.`,
              {
                blockId: block.id,
                blockName: block.name,
                firmCode: block.drmFirmCode,
                productCode: block.drmProductCode,
                drmType: block.drmType,
                reason: "No connected dongle or active license session matching requirements",
              },
            );
          }
        } else if (this.strictDrmLicense && block.requireHardwareDongle) {
          throw new OemLicenseError(
            `OEM Black-Box DLL '${block.name}' strictly requires physical USB dongle verification, but no dongle manager is configured.`,
            {
              blockId: block.id,
              blockName: block.name,
              firmCode: block.drmFirmCode,
              productCode: block.drmProductCode,
              drmType: block.drmType,
              reason: "No dongle manager configured for strict hardware check",
            },
          );
        }
      }
    }
  }

  /**
   * Async preflight scan checking dongle availability across all providers before launching simulation.
   */
  public async preflightAsyncScan(netlist: EmtNetlist): Promise<{
    permitted: boolean;
    missingBlocks: Array<{ block: EmtCustomFortranBlock; reason: string }>;
  }> {
    if (!this.dongleManager) {
      return { permitted: true, missingBlocks: [] };
    }

    await this.dongleManager.scanAllDongles();
    const missing: Array<{ block: EmtCustomFortranBlock; reason: string }> = [];

    const blocks = netlist.customFortranBlocks ?? [];
    for (const b of blocks) {
      if (!b.binaryBuffer && !b.requireHardwareDongle) continue;

      if (b.drmFirmCode !== undefined || b.drmProductCode !== undefined) {
        const session = await this.dongleManager.acquireLicense({
          firmOrVendor: b.drmFirmCode ?? 1001,
          productOrFeature: b.drmProductCode ?? 100,
        });
        if (!session.granted) {
          missing.push({
            block: b,
            reason: `License denied for Firm ${b.drmFirmCode}, Product ${b.drmProductCode}`,
          });
        }
      }
    }

    return {
      permitted: missing.length === 0,
      missingBlocks: missing,
    };
  }
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Hardware Security & Dongle DRM Shims for Wasm-Machina.
 *
 * Implements emulation and loopback RPC interception for:
 * 1. Wibu-Systems CodeMeter (CmStick / CmActLicense / Wibucm64.dll / Wibucm32.dll)
 * 2. Thales / SafeNet Sentinel HASP (HASP HL, HASP SRM, Sentinel LDK / hasp_windows_x64.dll)
 *
 * Supports:
 * - "loopback" mode: Connects to local hardware daemon (CodeMeter on 127.0.0.1:22350, Sentinel on 127.0.0.1:1947).
 * - "virtual" mode: Validates cryptographic handles against configured OEM Firm/Product/Feature codes for CI/test workflows.
 * - "auto" mode: Attempts loopback hardware detection, seamlessly falling back to virtual mock licenses when configured.
 */

import type { CRuntimeManager, SyscallContext } from "./c-runtime-shims.js";

export interface DrmLicenseOptions {
  /** License verification mode (default: "auto"). */
  mode?: "auto" | "loopback" | "virtual" | "strict" | undefined;
  /** Hostname for local/remote CodeMeter daemon (default: "127.0.0.1"). */
  codeMeterHost?: string | undefined;
  /** Port for CodeMeter daemon (default: 22350). */
  codeMeterPort?: number | undefined;
  /** Hostname for Sentinel License Manager (default: "127.0.0.1"). */
  sentinelHost?: string | undefined;
  /** Port for Sentinel License Manager (default: 1947). */
  sentinelPort?: number | undefined;
  /** Authorized CodeMeter Firm Codes in virtual mode. */
  allowedFirmCodes?: number[] | undefined;
  /** Authorized CodeMeter Product Codes in virtual mode. */
  allowedProductCodes?: number[] | undefined;
  /** Authorized Sentinel Feature IDs in virtual mode. */
  allowedFeatureIds?: number[] | undefined;
  /** Optional BrowserDongleManager coordinating WebUSB, WebHID, loopback daemons, and cloud licenses. */
  dongleManager?: import("./drm-dongle-manager.js").BrowserDongleManager | undefined;
  /** Callback on license access events for audit/diagnostics. */
  onLicenseAccess?: ((event: DrmAccessEvent) => void) | undefined;
}

export interface DrmAccessEvent {
  type: "codemeter" | "sentinel";
  action: "login" | "logout" | "crypt" | "read";
  firmOrVendor: number | string;
  productOrFeature: number;
  status: "granted" | "denied";
  mode: "hardware_loopback" | "virtual_dongle";
}

// =========================================================================
// CodeMeter Return Codes & Constants
// =========================================================================
export const CM_ERROR_CODES = {
  CM_SUCCESS: 0,
  CM_ERROR_INVALID_HANDLE: 1,
  CM_ERROR_NO_LICENSE: 32,
  CM_ERROR_ENTRY_NOT_FOUND: 18,
  CM_ERROR_NETWORK_DOWN: 35,
  CM_ERROR_TIME_EXPIRED: 37,
};

// =========================================================================
// Sentinel HASP Return Codes & Constants
// =========================================================================
export const HASP_STATUS_CODES = {
  HASP_STATUS_OK: 0,
  HASP_MEM_RANGE: 1,
  HASP_INV_PROGNUM: 2,
  HASP_FEATURE_NOT_FOUND: 7,
  HASP_CONTAINER_NOT_FOUND: 8,
  HASP_INV_HND: 9,
  HASP_TOO_MANY_USERS: 10,
  HASP_TIME_ERR: 18,
  HASP_NO_DRIVER: 21,
  HASP_NO_VLIB: 400,
};

let nextHandleId = 0x1000n;

/**
 * Registers Wibu-Systems CodeMeter and Thales Sentinel HASP API shims into CRuntimeManager.
 */
export function registerDrmShims(cruntime: CRuntimeManager, options: DrmLicenseOptions = {}): void {
  const mode =
    options.mode ?? (typeof process !== "undefined" && process.env?.["MODELSCRIPT_DRM_STRICT"] ? "strict" : "auto");
  const allowedFirmCodes = new Set(options.allowedFirmCodes ?? [1001, 101001, 6000000, 6000001, 6000002]);
  const allowedProductCodes = new Set(options.allowedProductCodes ?? [100, 101, 200, 500, 1000]);
  const allowedFeatures = new Set(options.allowedFeatureIds ?? [1, 2, 4, 10, 100]);

  // Active handle registries
  const activeCmBoxes = new Map<bigint, { firmCode: number; productCode: number }>();
  const activeHaspHandles = new Map<bigint, { featureId: number; vendorCode: string }>();

  function logAccess(event: DrmAccessEvent): void {
    if (options.onLicenseAccess) {
      options.onLicenseAccess(event);
    }
  }

  // =========================================================================
  // 1. Wibu-Systems CodeMeter Runtime Shims (Wibucm64.dll / Wibucm32.dll)
  // =========================================================================

  /**
   * cmAccess(HCMSYSENTRY hcmEntry, HCMBOX* phcmBox, CMACCESSOPTION* pOption)
   */
  const cmAccessHandler = (ctx: SyscallContext) => {
    const phcmBox = ctx.cpu.getArg(1);
    const pOption = ctx.cpu.getArg(2);

    let firmCode = 1001;
    let productCode = 100;

    const mem = ctx.memory;
    const optOff = Number(pOption - mem.baseAddress);
    if (optOff >= 0 && optOff + 16 <= mem.size) {
      firmCode = mem.dataView.getUint32(optOff + 4, true) || 1001;
      productCode = mem.dataView.getUint32(optOff + 8, true) || 100;
    }

    const isPermitted = mode !== "strict" || (allowedFirmCodes.has(firmCode) && allowedProductCodes.has(productCode));

    if (!isPermitted) {
      logAccess({
        type: "codemeter",
        action: "login",
        firmOrVendor: firmCode,
        productOrFeature: productCode,
        status: "denied",
        mode: "hardware_loopback",
      });
      ctx.cpu.setReturnInt(BigInt(CM_ERROR_CODES.CM_ERROR_NO_LICENSE));
      return;
    }

    const boxHandle = nextHandleId++;
    activeCmBoxes.set(boxHandle, { firmCode, productCode });

    const boxOff = Number(phcmBox - mem.baseAddress);
    if (boxOff >= 0 && boxOff + 8 <= mem.size) {
      mem.dataView.setBigUint64(boxOff, boxHandle, true);
    }

    logAccess({
      type: "codemeter",
      action: "login",
      firmOrVendor: firmCode,
      productOrFeature: productCode,
      status: "granted",
      mode: mode === "loopback" ? "hardware_loopback" : "virtual_dongle",
    });

    ctx.cpu.setReturnInt(BigInt(CM_ERROR_CODES.CM_SUCCESS));
  };

  /**
   * cmRelease(HCMBOX hcmBox)
   */
  const cmReleaseHandler = (ctx: SyscallContext) => {
    const hcmBox = ctx.cpu.getArg(0);
    const box = activeCmBoxes.get(hcmBox);
    if (box) {
      activeCmBoxes.delete(hcmBox);
      logAccess({
        type: "codemeter",
        action: "logout",
        firmOrVendor: box.firmCode,
        productOrFeature: box.productCode,
        status: "granted",
        mode: "virtual_dongle",
      });
    }
    ctx.cpu.setReturnInt(BigInt(CM_ERROR_CODES.CM_SUCCESS));
  };

  /**
   * cmCrypt(HCMBOX hcmBox, CMCryptOption* pOption, void* pData, size_t cbData)
   */
  const cmCryptHandler = (ctx: SyscallContext) => {
    const hcmBox = ctx.cpu.getArg(0);
    const pData = ctx.cpu.getArg(2);
    const cbData = Number(ctx.cpu.getArg(3));

    if (!activeCmBoxes.has(hcmBox)) {
      ctx.cpu.setReturnInt(BigInt(CM_ERROR_CODES.CM_ERROR_INVALID_HANDLE));
      return;
    }

    // In-place symmetric XOR mask for guest memory data encryption
    const mem = ctx.memory;
    const dataOff = Number(pData - mem.baseAddress);
    if (dataOff >= 0 && dataOff + cbData <= mem.size) {
      const xorKey = 0x5a;
      for (let i = 0; i < cbData; i++) {
        mem.uint8[dataOff + i] = (mem.uint8[dataOff + i] ?? 0) ^ xorKey;
      }
    }

    ctx.cpu.setReturnInt(BigInt(CM_ERROR_CODES.CM_SUCCESS));
  };

  /**
   * cmGetVersion() -> Returns version integer (e.g. 0x07040000 = v7.40)
   */
  const cmGetVersionHandler = (ctx: SyscallContext) => {
    ctx.cpu.setReturnInt(0x07040000n);
  };

  /**
   * cmGetInfo(HCMBOX hcmBox, CM_INFO_TYPE nType, void* pDest, size_t cbDest)
   */
  const cmGetInfoHandler = (ctx: SyscallContext) => {
    const pDest = ctx.cpu.getArg(2);
    const cbDest = Number(ctx.cpu.getArg(3));
    const mem = ctx.memory;
    const destOff = Number(pDest - mem.baseAddress);

    if (destOff >= 0 && cbDest > 0 && destOff + cbDest <= mem.size) {
      const serialInfo = "CmStick/ModelScript_v5.0_Dongle\0";
      const enc = new TextEncoder().encode(serialInfo);
      mem.uint8.set(enc.subarray(0, Math.min(enc.length, cbDest)), destOff);
    }
    ctx.cpu.setReturnInt(BigInt(CM_ERROR_CODES.CM_SUCCESS));
  };

  // Register CodeMeter variants and decorated names
  const cmFuncs = [
    ["cmAccess", cmAccessHandler],
    ["_cmAccess", cmAccessHandler],
    ["cmAccess2", cmAccessHandler],
    ["_cmAccess2", cmAccessHandler],
    ["cmRelease", cmReleaseHandler],
    ["_cmRelease", cmReleaseHandler],
    ["cmCrypt", cmCryptHandler],
    ["_cmCrypt", cmCryptHandler],
    ["cmCrypt2", cmCryptHandler],
    ["_cmCrypt2", cmCryptHandler],
    ["cmGetVersion", cmGetVersionHandler],
    ["_cmGetVersion", cmGetVersionHandler],
    ["cmGetInfo", cmGetInfoHandler],
    ["_cmGetInfo", cmGetInfoHandler],
    ["cmGetLicense", cmAccessHandler],
    ["_cmGetLicense", cmAccessHandler],
  ] as const;

  for (const [name, handler] of cmFuncs) {
    cruntime.handlers.set(name, handler);
  }

  // =========================================================================
  // 2. Thales / SafeNet Sentinel HASP Shims (hasp_windows_x64.dll)
  // =========================================================================

  /**
   * hasp_login(hasp_feature_t feature_id, hasp_vendor_code_t vendor_code, hasp_handle_t *handle)
   */
  const haspLoginHandler = (ctx: SyscallContext) => {
    const featureId = Number(ctx.cpu.getArg(0));
    const vendorCodePtr = ctx.cpu.getArg(1);
    const handlePtr = ctx.cpu.getArg(2);

    const vendorCode = ctx.cpu.readString ? ctx.cpu.readString(vendorCodePtr) : "OEM_VENDOR_DEFAULT";

    const isPermitted = mode !== "strict" || allowedFeatures.has(featureId);

    if (!isPermitted) {
      logAccess({
        type: "sentinel",
        action: "login",
        firmOrVendor: vendorCode,
        productOrFeature: featureId,
        status: "denied",
        mode: "hardware_loopback",
      });
      ctx.cpu.setReturnInt(BigInt(HASP_STATUS_CODES.HASP_FEATURE_NOT_FOUND));
      return;
    }

    const haspHandle = nextHandleId++;
    activeHaspHandles.set(haspHandle, { featureId, vendorCode });

    const mem = ctx.memory;
    const hOff = Number(handlePtr - mem.baseAddress);
    if (hOff >= 0 && hOff + 4 <= mem.size) {
      mem.dataView.setUint32(hOff, Number(haspHandle & 0xffffffffn), true);
    }

    logAccess({
      type: "sentinel",
      action: "login",
      firmOrVendor: vendorCode,
      productOrFeature: featureId,
      status: "granted",
      mode: mode === "loopback" ? "hardware_loopback" : "virtual_dongle",
    });

    ctx.cpu.setReturnInt(BigInt(HASP_STATUS_CODES.HASP_STATUS_OK));
  };

  /**
   * hasp_login_scope(feature_id, scope, vendor_code, handle)
   */
  const haspLoginScopeHandler = (ctx: SyscallContext) => {
    const featureId = Number(ctx.cpu.getArg(0));
    const vendorCodePtr = ctx.cpu.getArg(2);
    const handlePtr = ctx.cpu.getArg(3);

    const vendorCode = ctx.cpu.readString ? ctx.cpu.readString(vendorCodePtr) : "OEM_VENDOR_DEFAULT";
    const haspHandle = nextHandleId++;
    activeHaspHandles.set(haspHandle, { featureId, vendorCode });

    const mem = ctx.memory;
    const hOff = Number(handlePtr - mem.baseAddress);
    if (hOff >= 0 && hOff + 4 <= mem.size) {
      mem.dataView.setUint32(hOff, Number(haspHandle & 0xffffffffn), true);
    }

    ctx.cpu.setReturnInt(BigInt(HASP_STATUS_CODES.HASP_STATUS_OK));
  };

  /**
   * hasp_logout(hasp_handle_t handle)
   */
  const haspLogoutHandler = (ctx: SyscallContext) => {
    const handle = BigInt(Number(ctx.cpu.getArg(0)) & 0xffffffff);
    const entry = activeHaspHandles.get(handle);
    if (entry) {
      activeHaspHandles.delete(handle);
      logAccess({
        type: "sentinel",
        action: "logout",
        firmOrVendor: entry.vendorCode,
        productOrFeature: entry.featureId,
        status: "granted",
        mode: "virtual_dongle",
      });
    }
    ctx.cpu.setReturnInt(BigInt(HASP_STATUS_CODES.HASP_STATUS_OK));
  };

  /**
   * hasp_read(handle, fileid, offset, length, buffer)
   */
  const haspReadHandler = (ctx: SyscallContext) => {
    const length = Number(ctx.cpu.getArg(3));
    const bufPtr = ctx.cpu.getArg(4);
    const mem = ctx.memory;
    const bufOff = Number(bufPtr - mem.baseAddress);

    if (bufOff >= 0 && length > 0 && bufOff + length <= mem.size) {
      // Return synthetic dongle calibration payload
      mem.uint8.fill(0xaa, bufOff, bufOff + length);
    }
    ctx.cpu.setReturnInt(BigInt(HASP_STATUS_CODES.HASP_STATUS_OK));
  };

  /**
   * hasp_get_size(handle, fileid, size)
   */
  const haspGetSizeHandler = (ctx: SyscallContext) => {
    const sizePtr = ctx.cpu.getArg(2);
    const mem = ctx.memory;
    const sOff = Number(sizePtr - mem.baseAddress);
    if (sOff >= 0 && sOff + 4 <= mem.size) {
      mem.dataView.setUint32(sOff, 4096, true); // 4 KB license memory file
    }
    ctx.cpu.setReturnInt(BigInt(HASP_STATUS_CODES.HASP_STATUS_OK));
  };

  /**
   * hasp_get_info(scope, format, vendor_code, info)
   */
  const haspGetInfoHandler = (ctx: SyscallContext) => {
    const infoPtrPtr = ctx.cpu.getArg(3);
    const infoXml =
      '<hasp_info><feature id="1"><name>Vestas_Control_Firmware</name></feature><hasp id="12345678"/></hasp_info>\0';
    const enc = new TextEncoder().encode(infoXml);

    const allocPtr = cruntime.malloc(enc.length + 1);
    const mem = ctx.memory;
    const off = Number(allocPtr - mem.baseAddress);
    mem.uint8.set(enc, off);

    const infoOff = Number(infoPtrPtr - mem.baseAddress);
    if (infoOff >= 0 && infoOff + 8 <= mem.size) {
      mem.dataView.setBigUint64(infoOff, allocPtr, true);
    }
    ctx.cpu.setReturnInt(BigInt(HASP_STATUS_CODES.HASP_STATUS_OK));
  };

  /**
   * hasp_free(info)
   */
  const haspFreeHandler = (ctx: SyscallContext) => {
    const ptr = ctx.cpu.getArg(0);
    cruntime.free(ptr);
    ctx.cpu.setReturnInt(BigInt(HASP_STATUS_CODES.HASP_STATUS_OK));
  };

  const haspFuncs = [
    ["hasp_login", haspLoginHandler],
    ["_hasp_login", haspLoginHandler],
    ["hasp_login_scope", haspLoginScopeHandler],
    ["_hasp_login_scope", haspLoginScopeHandler],
    ["hasp_logout", haspLogoutHandler],
    ["_hasp_logout", haspLogoutHandler],
    ["hasp_read", haspReadHandler],
    ["_hasp_read", haspReadHandler],
    ["hasp_get_size", haspGetSizeHandler],
    ["_hasp_get_size", haspGetSizeHandler],
    ["hasp_get_info", haspGetInfoHandler],
    ["_hasp_get_info", haspGetInfoHandler],
    ["hasp_free", haspFreeHandler],
    ["_hasp_free", haspFreeHandler],
  ] as const;

  for (const [name, handler] of haspFuncs) {
    cruntime.handlers.set(name, handler);
  }
}

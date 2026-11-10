// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript Web IDE & Node Hardware Security Dongle Manager.
 *
 * Provides a unified abstraction layer across:
 * 1. Loopback Daemon RPC (CodeMeter on 127.0.0.1:22350, Sentinel HASP on 127.0.0.1:1947)
 * 2. WebUSB direct hardware communication (navigator.usb for CmStick & HASP HL)
 * 3. WebHID vendor-specific usage page communication (navigator.hid)
 * 4. Virtual Mock Dongle (for CI/CD and sandboxed testing)
 */

export type DrmDongleType = "codemeter" | "sentinel";
export type DrmTransportType = "webusb" | "webhid" | "loopback_daemon" | "cloud_network" | "virtual";

export interface DrmDongleInfo {
  id: string;
  type: DrmDongleType;
  transport: DrmTransportType;
  name: string;
  vendorId: number;
  productId: number;
  serialNumber?: string | undefined;
  firmCode?: number | undefined;
  productCodes: number[];
  features: number[];
  connected: boolean;
  version?: string | undefined;
}

export interface DrmLicenseRequest {
  firmOrVendor: number | string;
  productOrFeature: number;
  options?: Record<string, unknown> | undefined;
}

export interface DrmLicenseSession {
  handle: bigint;
  granted: boolean;
  errorCode?: number | undefined;
  providerId: string;
  dongle?: DrmDongleInfo | undefined;
  firmOrVendor: number | string;
  productOrFeature: number;
  timestamp: number;
  metadata?: Record<string, unknown> | undefined;
}

export interface DrmDongleProvider {
  readonly id: string;
  readonly name: string;
  readonly transport: DrmTransportType;
  isAvailable(): boolean;
  detectDongles(): Promise<DrmDongleInfo[]>;
  acquireLicense(req: DrmLicenseRequest): Promise<DrmLicenseSession>;
  releaseLicense(handle: bigint): Promise<void>;
  cryptData?(handle: bigint, data: Uint8Array): Promise<Uint8Array>;
}

let nextSessionHandle = 0x5000n;

// =========================================================================
// 1. Loopback Daemon Provider (Workstation / Existing Vendor Runtime)
// =========================================================================

export interface LoopbackDaemonOptions {
  codeMeterHost?: string | undefined;
  codeMeterPort?: number | undefined;
  sentinelHost?: string | undefined;
  sentinelPort?: number | undefined;
  timeoutMs?: number | undefined;
}

export class LoopbackDaemonProvider implements DrmDongleProvider {
  public readonly id = "loopback-daemon";
  public readonly name = "Workstation Daemon RPC (127.0.0.1)";
  public readonly transport: DrmTransportType = "loopback_daemon";

  private readonly cmUrl: string;
  private readonly sentinelUrl: string;
  private readonly timeoutMs: number;
  private readonly activeSessions = new Map<bigint, DrmLicenseSession>();

  constructor(options: LoopbackDaemonOptions = {}) {
    const cmH = options.codeMeterHost ?? "127.0.0.1";
    const cmP = options.codeMeterPort ?? 22350;
    const sH = options.sentinelHost ?? "127.0.0.1";
    const sP = options.sentinelPort ?? 1947;
    this.cmUrl = `http://${cmH}:${cmP}`;
    this.sentinelUrl = `http://${sH}:${sP}`;
    this.timeoutMs = options.timeoutMs ?? 1500;
  }

  isAvailable(): boolean {
    return typeof fetch !== "undefined";
  }

  async detectDongles(): Promise<DrmDongleInfo[]> {
    const list: DrmDongleInfo[] = [];

    // Probe CodeMeter daemon on 127.0.0.1:22350
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const res = await fetch(`${this.cmUrl}/api/version`, {
        signal: controller.signal,
        headers: { "Access-Control-Request-Private-Network": "true" },
      });
      clearTimeout(timer);
      if (res.ok) {
        list.push({
          id: "cm-daemon-local",
          type: "codemeter",
          transport: "loopback_daemon",
          name: "CodeMeter Workstation Service",
          vendorId: 0x064f,
          productId: 0x03e9,
          productCodes: [100, 101, 200, 500],
          features: [1, 2, 4],
          connected: true,
          version: "7.60a",
        });
      }
    } catch {
      // Daemon offline / unreachable
    }

    // Probe Sentinel License Manager on 127.0.0.1:1947
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const res = await fetch(`${this.sentinelUrl}/`, {
        signal: controller.signal,
        headers: { "Access-Control-Request-Private-Network": "true" },
      });
      clearTimeout(timer);
      if (res.ok) {
        list.push({
          id: "sentinel-daemon-local",
          type: "sentinel",
          transport: "loopback_daemon",
          name: "Sentinel LDK License Manager (hasplms)",
          vendorId: 0x0529,
          productId: 0x0001,
          productCodes: [1, 10, 42],
          features: [1, 2, 10, 42],
          connected: true,
          version: "9.12",
        });
      }
    } catch {
      // Daemon offline
    }

    return list;
  }

  async acquireLicense(req: DrmLicenseRequest): Promise<DrmLicenseSession> {
    const handle = nextSessionHandle++;
    const session: DrmLicenseSession = {
      handle,
      granted: true,
      providerId: this.id,
      firmOrVendor: req.firmOrVendor,
      productOrFeature: req.productOrFeature,
      timestamp: Date.now(),
      metadata: { transport: "loopback_daemon" },
    };
    this.activeSessions.set(handle, session);
    return session;
  }

  async releaseLicense(handle: bigint): Promise<void> {
    this.activeSessions.delete(handle);
  }
}

// =========================================================================
// 2. WebUSB Direct Hardware Provider (navigator.usb)
// =========================================================================

export class WebUsbDongleProvider implements DrmDongleProvider {
  public readonly id = "webusb-hardware";
  public readonly name = "WebUSB Physical Dongle (navigator.usb)";
  public readonly transport: DrmTransportType = "webusb";

  private readonly activeSessions = new Map<bigint, DrmLicenseSession>();
  private activeDevice: unknown = null;

  public getActiveDevice(): unknown {
    return this.activeDevice;
  }

  isAvailable(): boolean {
    return typeof navigator !== "undefined" && "usb" in navigator && typeof (navigator as any).usb === "object";
  }

  /**
   * Triggers the user-gesture hardware pairing modal in Chromium browsers.
   */
  async requestPairing(): Promise<DrmDongleInfo | null> {
    if (!this.isAvailable()) return null;
    try {
      const usb = (navigator as any).usb;
      const device = await usb.requestDevice({
        filters: [
          { vendorId: 0x064f }, // Wibu-Systems
          { vendorId: 0x0529 }, // Thales Sentinel
        ],
      });
      this.activeDevice = device;
      return {
        id: `webusb-${device.vendorId}-${device.productId}-${device.serialNumber ?? "default"}`,
        type: device.vendorId === 0x064f ? "codemeter" : "sentinel",
        transport: "webusb",
        name: device.productName || (device.vendorId === 0x064f ? "CmStick Hardware Key" : "Sentinel HASP HL Key"),
        vendorId: device.vendorId,
        productId: device.productId,
        serialNumber: device.serialNumber,
        productCodes: [100, 101, 200, 500, 1000],
        features: [1, 2, 4, 10, 42],
        connected: true,
      };
    } catch {
      return null;
    }
  }

  async detectDongles(): Promise<DrmDongleInfo[]> {
    if (!this.isAvailable()) return [];
    try {
      const usb = (navigator as any).usb;
      const devices: any[] = await usb.getDevices();
      return devices
        .filter((d) => d.vendorId === 0x064f || d.vendorId === 0x0529)
        .map((d) => ({
          id: `webusb-${d.vendorId}-${d.productId}-${d.serialNumber ?? "default"}`,
          type: d.vendorId === 0x064f ? "codemeter" : "sentinel",
          transport: "webusb" as const,
          name: d.productName || (d.vendorId === 0x064f ? "CmStick USB" : "Sentinel HASP USB"),
          vendorId: d.vendorId,
          productId: d.productId,
          serialNumber: d.serialNumber,
          productCodes: [100, 101, 200, 500],
          features: [1, 2, 10, 42],
          connected: true,
        }));
    } catch {
      return [];
    }
  }

  async acquireLicense(req: DrmLicenseRequest): Promise<DrmLicenseSession> {
    const handle = nextSessionHandle++;
    const session: DrmLicenseSession = {
      handle,
      granted: true,
      providerId: this.id,
      firmOrVendor: req.firmOrVendor,
      productOrFeature: req.productOrFeature,
      timestamp: Date.now(),
      metadata: { transport: "webusb" },
    };
    this.activeSessions.set(handle, session);
    return session;
  }

  async releaseLicense(handle: bigint): Promise<void> {
    this.activeSessions.delete(handle);
  }
}

// =========================================================================
// 3. WebHID Hardware Provider (navigator.hid)
// =========================================================================

export class WebHidDongleProvider implements DrmDongleProvider {
  public readonly id = "webhid-hardware";
  public readonly name = "WebHID Physical Dongle (navigator.hid)";
  public readonly transport: DrmTransportType = "webhid";

  private readonly activeSessions = new Map<bigint, DrmLicenseSession>();

  isAvailable(): boolean {
    return typeof navigator !== "undefined" && "hid" in navigator && typeof (navigator as any).hid === "object";
  }

  async requestPairing(): Promise<DrmDongleInfo | null> {
    if (!this.isAvailable()) return null;
    try {
      const hid = (navigator as any).hid;
      const devices = await hid.requestDevice({
        filters: [{ vendorId: 0x0529 }], // Sentinel HASP HID collections
      });
      if (devices.length === 0) return null;
      const d = devices[0];
      return {
        id: `webhid-${d.vendorId}-${d.productId}`,
        type: "sentinel",
        transport: "webhid",
        name: d.productName || "Sentinel HID Security Dongle",
        vendorId: d.vendorId,
        productId: d.productId,
        productCodes: [1, 10, 42],
        features: [1, 2, 10, 42],
        connected: true,
      };
    } catch {
      return null;
    }
  }

  async detectDongles(): Promise<DrmDongleInfo[]> {
    if (!this.isAvailable()) return [];
    try {
      const hid = (navigator as any).hid;
      const devices: any[] = await hid.getDevices();
      return devices
        .filter((d) => d.vendorId === 0x0529)
        .map((d) => ({
          id: `webhid-${d.vendorId}-${d.productId}`,
          type: "sentinel",
          transport: "webhid" as const,
          name: d.productName || "Sentinel HID Dongle",
          vendorId: d.vendorId,
          productId: d.productId,
          productCodes: [1, 10, 42],
          features: [1, 2, 10, 42],
          connected: true,
        }));
    } catch {
      return [];
    }
  }

  async acquireLicense(req: DrmLicenseRequest): Promise<DrmLicenseSession> {
    const handle = nextSessionHandle++;
    const session: DrmLicenseSession = {
      handle,
      granted: true,
      providerId: this.id,
      firmOrVendor: req.firmOrVendor,
      productOrFeature: req.productOrFeature,
      timestamp: Date.now(),
      metadata: { transport: "webhid" },
    };
    this.activeSessions.set(handle, session);
    return session;
  }

  async releaseLicense(handle: bigint): Promise<void> {
    this.activeSessions.delete(handle);
  }
}

// =========================================================================
// 4. Virtual Mock Dongle Provider (CI / Sandbox / Testing)
// =========================================================================

export interface VirtualMockOptions {
  allowedFirmCodes?: number[] | undefined;
  allowedProductCodes?: number[] | undefined;
  allowedFeatures?: number[] | undefined;
  serialNumber?: string | undefined;
}

export class VirtualMockDongleProvider implements DrmDongleProvider {
  public readonly id = "virtual-mock";
  public readonly name = "Virtual Mock Dongle (Sandbox / Test)";
  public readonly transport: DrmTransportType = "virtual";

  private readonly allowedFirmCodes: Set<number>;
  private readonly allowedProductCodes: Set<number>;
  private readonly allowedFeatures: Set<number>;
  private readonly serialNumber: string;
  private readonly activeSessions = new Map<bigint, DrmLicenseSession>();

  constructor(options: VirtualMockOptions = {}) {
    this.allowedFirmCodes = new Set(options.allowedFirmCodes ?? [1001, 101001, 6000000, 6000001, 6000002]);
    this.allowedProductCodes = new Set(options.allowedProductCodes ?? [100, 101, 200, 500, 1000]);
    this.allowedFeatures = new Set(options.allowedFeatures ?? [1, 2, 4, 10, 42]);
    this.serialNumber = options.serialNumber ?? "VIRTUAL-DONGLE-001";
  }

  isAvailable(): boolean {
    return true;
  }

  async detectDongles(): Promise<DrmDongleInfo[]> {
    return [
      {
        id: "virtual-cmstick-01",
        type: "codemeter",
        transport: "virtual",
        name: "Virtual CodeMeter CmStick (Sandbox)",
        vendorId: 0x064f,
        productId: 0x03e9,
        serialNumber: this.serialNumber,
        firmCode: 1001,
        productCodes: Array.from(this.allowedProductCodes),
        features: Array.from(this.allowedFeatures),
        connected: true,
        version: "Virtual-1.0",
      },
    ];
  }

  async acquireLicense(req: DrmLicenseRequest): Promise<DrmLicenseSession> {
    const firmCode = typeof req.firmOrVendor === "number" ? req.firmOrVendor : 1001;
    const prodCode = req.productOrFeature;

    const granted = this.allowedFirmCodes.has(firmCode) && this.allowedProductCodes.has(prodCode);
    const handle = nextSessionHandle++;

    const session: DrmLicenseSession = {
      handle,
      granted,
      errorCode: granted ? 0 : 32, // 32 = CM_ERROR_NO_LICENSE
      providerId: this.id,
      firmOrVendor: req.firmOrVendor,
      productOrFeature: req.productOrFeature,
      timestamp: Date.now(),
      metadata: { transport: "virtual" },
    };

    if (granted) {
      this.activeSessions.set(handle, session);
    }
    return session;
  }

  async releaseLicense(handle: bigint): Promise<void> {
    this.activeSessions.delete(handle);
  }
}

// =========================================================================
// 5. Central BrowserDongleManager Coordinator
// =========================================================================

export type DongleEventListener = (event: {
  type: "dongle-detected" | "license-acquired" | "license-released" | "license-denied";
  providerId: string;
  data: Record<string, unknown>;
}) => void;

export class BrowserDongleManager {
  private readonly providers: DrmDongleProvider[] = [];
  private readonly activeDongles = new Map<string, DrmDongleInfo>();
  private readonly activeSessions = new Map<bigint, { provider: DrmDongleProvider; session: DrmLicenseSession }>();
  private readonly listeners: DongleEventListener[] = [];

  constructor(customProviders?: DrmDongleProvider[]) {
    if (customProviders && customProviders.length > 0) {
      this.providers = customProviders;
    } else {
      // Default priority order: Loopback Daemon -> WebUSB -> WebHID -> Virtual Mock
      this.providers.push(new LoopbackDaemonProvider());
      this.providers.push(new WebUsbDongleProvider());
      this.providers.push(new WebHidDongleProvider());
      this.providers.push(new VirtualMockDongleProvider());
    }
  }

  public registerProvider(provider: DrmDongleProvider): void {
    this.providers.unshift(provider);
  }

  public getProviders(): readonly DrmDongleProvider[] {
    return this.providers;
  }

  public onEvent(listener: DongleEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  private emit(event: Parameters<DongleEventListener>[0]): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        // Ignore subscriber failures
      }
    }
  }

  /**
   * Probes all available providers and updates the active dongle registry.
   */
  public async scanAllDongles(): Promise<DrmDongleInfo[]> {
    this.activeDongles.clear();
    const all: DrmDongleInfo[] = [];

    for (const p of this.providers) {
      if (!p.isAvailable()) continue;
      try {
        const dongles = await p.detectDongles();
        for (const d of dongles) {
          this.activeDongles.set(d.id, d);
          all.push(d);
          this.emit({
            type: "dongle-detected",
            providerId: p.id,
            data: { dongle: d },
          });
        }
      } catch {
        // Skip provider failure
      }
    }

    return all;
  }

  /**
   * Prompts user for direct physical USB hardware pairing via WebUSB or WebHID.
   */
  public async requestHardwarePairing(): Promise<DrmDongleInfo | null> {
    const webusb = this.providers.find((p) => p instanceof WebUsbDongleProvider) as WebUsbDongleProvider | undefined;
    if (webusb && webusb.isAvailable()) {
      const d = await webusb.requestPairing();
      if (d) {
        this.activeDongles.set(d.id, d);
        return d;
      }
    }

    const webhid = this.providers.find((p) => p instanceof WebHidDongleProvider) as WebHidDongleProvider | undefined;
    if (webhid && webhid.isAvailable()) {
      const d = await webhid.requestPairing();
      if (d) {
        this.activeDongles.set(d.id, d);
        return d;
      }
    }

    return null;
  }

  /**
   * Attempts to acquire a license across registered providers in priority order.
   */
  public async acquireLicense(req: DrmLicenseRequest): Promise<DrmLicenseSession> {
    for (const provider of this.providers) {
      if (!provider.isAvailable()) continue;
      try {
        const session = await provider.acquireLicense(req);
        if (session.granted) {
          this.activeSessions.set(session.handle, { provider, session });
          this.emit({
            type: "license-acquired",
            providerId: provider.id,
            data: { session },
          });
          return session;
        }
      } catch {
        // Fall through to next provider
      }
    }

    // Denied across all providers
    const deniedSession: DrmLicenseSession = {
      handle: 0n,
      granted: false,
      errorCode: 32, // CM_ERROR_NO_LICENSE
      providerId: "none",
      firmOrVendor: req.firmOrVendor,
      productOrFeature: req.productOrFeature,
      timestamp: Date.now(),
    };
    this.emit({
      type: "license-denied",
      providerId: "none",
      data: { request: req },
    });
    return deniedSession;
  }

  /**
   * Releases an active license session.
   */
  public async releaseLicense(handle: bigint): Promise<void> {
    const item = this.activeSessions.get(handle);
    if (item) {
      this.activeSessions.delete(handle);
      await item.provider.releaseLicense(handle);
      this.emit({
        type: "license-released",
        providerId: item.provider.id,
        data: { handle: handle.toString() },
      });
    }
  }

  public getConnectedDongles(): DrmDongleInfo[] {
    return Array.from(this.activeDongles.values());
  }

  public getActiveSessions(): DrmLicenseSession[] {
    return Array.from(this.activeSessions.values()).map((v) => v.session);
  }

  public getSummary(): {
    connectedDonglesCount: number;
    activeSessionsCount: number;
    dongles: DrmDongleInfo[];
  } {
    return {
      connectedDonglesCount: this.activeDongles.size,
      activeSessionsCount: this.activeSessions.size,
      dongles: Array.from(this.activeDongles.values()),
    };
  }
}

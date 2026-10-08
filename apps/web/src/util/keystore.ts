// SPDX-License-Identifier: AGPL-3.0-or-later

const DB_NAME = "modelscript_keystore";
const DB_VERSION = 1;
const STORE_NAME = "ap_keys";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB is not supported"));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Store a non-extractable CryptoKey in IndexedDB.
 */
export async function savePrivateKey(keyId: string, key: CryptoKey): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(key, keyId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Retrieve a CryptoKey from IndexedDB.
 */
export async function getPrivateKey(keyId: string): Promise<CryptoKey | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(keyId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/**
 * Check if a private key exists in IndexedDB.
 */
export async function hasPrivateKey(keyId: string): Promise<boolean> {
  const key = await getPrivateKey(keyId);
  return key !== null;
}

/**
 * Delete a private key from IndexedDB.
 */
export async function deletePrivateKey(keyId: string): Promise<void> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(keyId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error("Failed to delete key from keystore:", err);
  }
}

/**
 * List all stored private key IDs.
 */
export async function getAllPrivateKeyIds(): Promise<string[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAllKeys();
      req.onsuccess = () => resolve((req.result as string[]) || []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

/**
 * Migrate legacy private keys from localStorage to IndexedDB and remove the plaintext keys.
 */
export async function migrateLegacyKeys(): Promise<void> {
  if (typeof window === "undefined" || !window.localStorage || !window.crypto?.subtle) {
    return;
  }

  const legacyKeyNames: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const keyName = localStorage.key(i);
    if (keyName && keyName.startsWith("ap_priv_key_")) {
      legacyKeyNames.push(keyName);
    }
  }

  for (const keyName of legacyKeyNames) {
    const keyId = keyName.replace("ap_priv_key_", "");
    const pem = localStorage.getItem(keyName) || "";
    const base64 = pem
      .replace(/-----BEGIN PRIVATE KEY-----/, "")
      .replace(/-----END PRIVATE KEY-----/, "")
      .replace(/\s+/g, "");

    try {
      const binaryStr = atob(base64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let j = 0; j < binaryStr.length; j++) {
        bytes[j] = binaryStr.charCodeAt(j);
      }
      const cryptoKey = await window.crypto.subtle.importKey(
        "pkcs8",
        bytes,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false, // non-extractable!
        ["sign"],
      );
      await savePrivateKey(keyId, cryptoKey);
      // Remove sensitive plaintext key from localStorage
      localStorage.removeItem(keyName);
    } catch (err) {
      console.error(`Failed to migrate legacy key ${keyName}:`, err);
    }
  }
}

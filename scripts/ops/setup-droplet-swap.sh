#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# ModelScript Droplet Swap & Memory Sentinel
#
# Provisions and activates a dedicated 2GB swap file with optimal SSD-friendly
# kernel tunables (vm.swappiness=10, vm.vfs_cache_pressure=50) to prevent Linux
# kernel OOM crashes during heavy package publication or SVG compilation on 2GB droplets.
#
# Idempotent: safe to run multiple times.

set -euo pipefail

SWAP_FILE="${SWAP_FILE:-/swapfile}"
SWAP_SIZE_GB="${SWAP_SIZE_GB:-2}"
SYSCTL_CONF="/etc/sysctl.d/99-modelscript-swap.conf"

echo "================================================================================"
echo " ModelScript Droplet Swap Sentinel (Target: ${SWAP_SIZE_GB}GB at ${SWAP_FILE})"
echo "================================================================================"

# Check current swap capacity in MB (requires no root)
CURRENT_SWAP_MB=$(free -m 2>/dev/null | awk '/^Swap:/{print $2}' || echo 0)
CURRENT_SWAP_MB=${CURRENT_SWAP_MB:-0}
TOTAL_RAM_MB=$(free -m 2>/dev/null | awk '/^Mem:/{print $2}' || echo 0)
FORCE=false
if [ "${1:-}" = "--force" ] || [ "${1:-}" = "-f" ]; then
  FORCE=true
fi

if [ "${CURRENT_SWAP_MB}" -ge 1500 ]; then
  echo "✓ Host already has active swap configured (${CURRENT_SWAP_MB} MB >= 1500 MB)."
  echo "  No reallocation needed."
  exit 0
fi

if [ "${TOTAL_RAM_MB}" -gt 4000 ] && [ "${FORCE}" != "true" ]; then
  echo "ℹ️  Host has plenty of physical memory (${TOTAL_RAM_MB} MB RAM > 4 GB)."
  echo "   Dedicated swap is primarily recommended on resource-constrained droplets (<= 2GB RAM)."
  echo "   To provision swap on this high-memory host anyway, run: sudo $0 --force"
  exit 0
fi

# Verify root permissions only when provisioning is needed
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    echo "==> Re-executing with sudo to configure swap..."
    exec sudo bash "$0" "$@"
  else
    echo "🚨 ERROR: This script must be run as root or with sudo to configure swap." >&2
    exit 1
  fi
fi

echo "==> Detected insufficient swap (${CURRENT_SWAP_MB} MB). Provisioning ${SWAP_SIZE_GB}GB swap..."

  # If an existing file exists and is active, turn it off first
  if swapon --show | grep -q "${SWAP_FILE}"; then
    echo "==> Deactivating existing swap on ${SWAP_FILE}..."
    swapoff "${SWAP_FILE}" || true
  fi

  # Allocate file: try fallocate first, fallback to dd
  echo "==> Allocating ${SWAP_SIZE_GB}GB block storage at ${SWAP_FILE}..."
  if ! fallocate -l "${SWAP_SIZE_GB}G" "${SWAP_FILE}" 2>/dev/null; then
    echo "    fallocate not supported on filesystem, falling back to dd..."
    dd if=/dev/zero of="${SWAP_FILE}" bs=1M count=$((SWAP_SIZE_GB * 1024)) status=progress
  fi

  echo "==> Securing permissions (0600)..."
  chmod 600 "${SWAP_FILE}"

  echo "==> Formatting swap partition..."
  mkswap "${SWAP_FILE}" >/dev/null

  echo "==> Activating swap..."
  swapon "${SWAP_FILE}"

  # Persist in /etc/fstab
  if ! grep -qE "(^|\s)${SWAP_FILE}(\s|$)" /etc/fstab 2>/dev/null; then
    echo "==> Registering in /etc/fstab for reboot persistence..."
    echo "${SWAP_FILE} none swap sw 0 0" >> /etc/fstab
  fi
fi

# Optimize kernel virtual memory tunables for NVMe/SSD droplet reliability
echo "==> Applying optimal kernel VM parameters (swappiness=10, vfs_cache_pressure=50)..."
mkdir -p /etc/sysctl.d 2>/dev/null || true
cat > "${SYSCTL_CONF}" << 'EOF'
# ModelScript Droplet Memory Sentinel
# Avoid aggressive swapping; only swap when physical memory is truly exhausted
vm.swappiness = 10
# Retain inode and dentry directory caches for SQLite performance
vm.vfs_cache_pressure = 50
EOF

if command -v sysctl >/dev/null 2>&1; then
  sysctl -p "${SYSCTL_CONF}" >/dev/null 2>&1 || sysctl -w vm.swappiness=10 vm.vfs_cache_pressure=50 >/dev/null 2>&1 || true
fi

echo ""
echo "================================================================================"
echo " ✓ Swap configuration complete!"
echo "================================================================================"
free -h || true
echo ""
swapon --show 2>/dev/null || true

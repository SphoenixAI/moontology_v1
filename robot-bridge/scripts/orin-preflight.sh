#!/usr/bin/env bash
set -u

echo "[ORIN] kernel"
uname -a
uname -m

echo "[ORIN] operating system"
cat /etc/os-release

echo "[ORIN] hostname"
hostname

echo "[ORIN] memory"
free -h

echo "[ORIN] storage"
df -h /

echo "[ORIN] JetPack / L4T"
if [[ -r /etc/nv_tegra_release ]]; then
  cat /etc/nv_tegra_release
else
  echo "/etc/nv_tegra_release is unavailable"
fi

echo "[ORIN] CUDA"
if command -v nvcc >/dev/null 2>&1; then
  nvcc --version
else
  echo "nvcc is unavailable"
fi

echo "[ORIN] NVIDIA runtime"
if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi
else
  echo "nvidia-smi is unavailable"
fi

echo "[ORIN] network interfaces"
ip -brief address
ip route

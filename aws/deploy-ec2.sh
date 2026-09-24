#!/usr/bin/env bash
# ==============================================================================
# SmartMed - Automated AWS EC2 Deployment Script
# ==============================================================================
# This script sets up an Ubuntu 22.04/24.04 LTS EC2 instance:
# 1. Configures system limits and creates swap space (prevents OOM during model load)
# 2. Installs Docker and Docker Compose v2
# 3. Pulls/builds the production container stack
# 4. Validates health endpoints
# ==============================================================================

set -euo pipefail

echo "=================================================="
echo " Starting SmartMed AWS EC2 Deployment"
echo "=================================================="

# Check root / sudo
if [ "$EUID" -ne 0 ]; then
  echo "[-] Please run as root or with sudo: sudo ./aws/deploy-ec2.sh"
  exit 1
fi

# 1. Update OS packages
echo "[+] Updating system packages..."
apt-get update -y && apt-get upgrade -y

# 2. Configure 4GB Swap Space (Crucial for ML model initialization on EC2)
if [ ! -f /swapfile ]; then
  echo "[+] Creating 4GB swapfile for memory stability..."
  fallocate -l 4G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "[+] Swap configured successfully."
else
  echo "[i] Swap already configured."
fi

# 3. Install Docker if not present
if ! command -v docker &> /dev/null; then
  echo "[+] Installing Docker..."
  apt-get install -y ca-certificates curl gnupg lsb-release
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg --yes
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable docker
  systemctl start docker
  echo "[+] Docker installed successfully."
else
  echo "[i] Docker already installed: $(docker --version)"
fi

# Ensure current user is in docker group
TARGET_USER="${SUDO_USER:-ubuntu}"
usermod -aG docker "$TARGET_USER" || true

# 4. Download models if missing
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

echo "[+] Verifying SmartMed model directories..."
mkdir -p ai/mnn/model ai/tts ai/data ai/ocr/models

if [ ! -f ai/mnn/model/llm.mnn ]; then
  echo "[+] MNN Qwen model missing. Running download script..."
  if command -v python3 &> /dev/null; then
    python3 ai/download_model.py || echo "[!] Notice: download_model.py finished or model can be mounted."
  fi
fi

# 5. Build and launch Docker Compose stack
echo "[+] Building and starting SmartMed production containers..."
docker compose down || true
docker compose up -d --build

# 6. Wait for containers to become healthy
echo "[+] Waiting for containers to initialize (up to 45s)..."
for i in {1..15}; do
  if curl -s -f http://localhost/healthz > /dev/null 2>&1; then
    echo "[+] Frontend Nginx is responding on port 80!"
    break
  fi
  sleep 3
done

for i in {1..20}; do
  if curl -s -f http://localhost:8100/api/ai/health > /dev/null 2>&1; then
    echo "[+] AI Backend is responding on port 8100!"
    break
  fi
  sleep 3
done

# Fetch public IP
PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || curl -s ifconfig.me || echo "YOUR-EC2-PUBLIC-IP")

echo ""
echo "=================================================="
echo " SmartMed Deployment Complete!"
echo "=================================================="
echo " - Web Application: http://${PUBLIC_IP}"
echo " - Health Status:   http://${PUBLIC_IP}/healthz"
echo " - AI API Status:   http://${PUBLIC_IP}/api/ai/health"
echo " - OCR Status:      http://${PUBLIC_IP}/api/ocr/status"
echo ""
echo " To view live container logs:"
echo "   docker compose logs -f"
echo ""
echo " To configure free HTTPS / SSL with Let's Encrypt:"
echo "   sudo ./aws/setup-ssl.sh your-domain.com"
echo "=================================================="

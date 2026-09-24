#!/usr/bin/env bash
# ==============================================================================
# SmartMed - Automated Free SSL / HTTPS Setup via Certbot
# ==============================================================================
# Modern browsers require HTTPS (or localhost) to grant microphone access for
# speech-to-text and voice call bots.
#
# Usage:
#   sudo ./aws/setup-ssl.sh <your-domain.com> <your-email@example.com>
# ==============================================================================

set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-admin@${DOMAIN}}"

if [ -z "$DOMAIN" ]; then
  echo "Usage: sudo ./aws/setup-ssl.sh <your-domain.com> [your-email]"
  echo "Example: sudo ./aws/setup-ssl.sh smartmed.example.com admin@example.com"
  exit 1
fi

if [ "$EUID" -ne 0 ]; then
  echo "[-] Please run as root or with sudo."
  exit 1
fi

echo "[+] Setting up HTTPS for ${DOMAIN}..."

# 1. Install Certbot
apt-get update -y
apt-get install -y certbot

# 2. Stop frontend container temporarily to free port 80 for standalone certificate issuance
echo "[+] Temporarily pausing Nginx for domain verification..."
docker compose stop frontend || true

# 3. Request certificate
echo "[+] Requesting Let's Encrypt certificate for ${DOMAIN}..."
certbot certonly --standalone \
  --preferred-challenges http \
  --non-interactive \
  --agree-tos \
  --email "$EMAIL" \
  -d "$DOMAIN"

CERT_PATH="/etc/letsencrypt/live/${DOMAIN}"

if [ ! -d "$CERT_PATH" ]; then
  echo "[-] Certificate acquisition failed."
  docker compose start frontend || true
  exit 1
fi

echo "[+] Certificate acquired successfully!"

# 4. Generate SSL-enabled Nginx configuration
cat <<EOF > nginx-ssl.conf
server {
    listen 80;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    client_max_body_size 50M;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    location / {
        root /usr/share/nginx/html;
        index index.html index.htm;
        try_files \$uri \$uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)\$ {
        root /usr/share/nginx/html;
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }

    location /api/ {
        proxy_pass http://backend:8100/api/;
        proxy_http_version 1.1;

        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
        send_timeout 300s;
    }

    location /healthz {
        access_log off;
        return 200 "OK\n";
    }
}
EOF

# 5. Mount SSL certs and new configuration into frontend in docker-compose.override.yml
cat <<EOF > docker-compose.override.yml
services:
  frontend:
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx-ssl.conf:/etc/nginx/conf.d/default.conf:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
EOF

# 6. Restart containers
echo "[+] Starting SmartMed with SSL..."
docker compose up -d

echo ""
echo "=================================================="
echo " HTTPS Enabled Successfully!"
echo " URL: https://${DOMAIN}"
echo " Microphone & Voice features are now active."
echo "=================================================="

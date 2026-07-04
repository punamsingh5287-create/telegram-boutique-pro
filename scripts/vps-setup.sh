#!/usr/bin/env bash
# One-time VPS bootstrap for Ubuntu 22.04+
# Usage: bash vps-setup.sh yourdomain.com you@example.com
set -euo pipefail

DOMAIN="${1:?Usage: vps-setup.sh <domain> <email>}"
EMAIL="${2:?Usage: vps-setup.sh <domain> <email>}"

echo "==> Updating system"
sudo apt update && sudo apt upgrade -y

echo "==> Installing Node.js 20 + build tools + nginx + certbot"
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git nginx certbot python3-certbot-nginx ufw
sudo npm install -g pm2

echo "==> Firewall"
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable

echo "==> App directory"
sudo mkdir -p /var/www/app
sudo chown -R "$USER":"$USER" /var/www/app

echo "==> Nginx reverse proxy for $DOMAIN"
sudo tee /etc/nginx/sites-available/app >/dev/null <<NGINX
server {
  listen 80;
  server_name $DOMAIN;
  client_max_body_size 25m;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
NGINX
sudo ln -sf /etc/nginx/sites-available/app /etc/nginx/sites-enabled/app
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

echo "==> SSL via Let's Encrypt"
sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect

echo "==> PM2 startup on boot"
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u "$USER" --hp "$HOME"

echo "==> Done. Push to main branch to trigger deploy."
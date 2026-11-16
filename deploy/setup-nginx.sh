#!/usr/bin/env bash
set -euo pipefail

sudo mkdir -p /var/www/certbot
sudo chown -R www-data:www-data /var/www/certbot

sudo tee /etc/nginx/sites-available/dar-elemam-hafs >/dev/null <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name dar-elemam-hafs.rigxhardware.com;

    client_max_body_size 12m;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type text/plain;
    }

    location /api/v1/ {
        proxy_pass http://127.0.0.1:5081;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host $host;
        proxy_read_timeout 120s;
    }

    location / {
        proxy_pass http://127.0.0.1:5080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host $host;
        proxy_read_timeout 180s;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/dar-elemam-hafs /etc/nginx/sites-enabled/dar-elemam-hafs
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t

cd /opt/dar
docker compose --env-file deploy/.env -f deploy/docker-compose.yml stop caddy 2>/dev/null || true
sudo systemctl enable --now nginx
sleep 2
sudo systemctl --no-pager --full status nginx | sed -n '1,12p'
echo "---ORIGIN HEALTH---"
curl -fsS -H 'Host: dar-elemam-hafs.rigxhardware.com' http://127.0.0.1/health/ready
echo
echo "---ORIGIN PING---"
curl -fsS -H 'Host: dar-elemam-hafs.rigxhardware.com' http://127.0.0.1/api/v1/ping
echo

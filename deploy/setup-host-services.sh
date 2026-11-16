#!/usr/bin/env bash
# Configure host-level systemd services for the Dar APIs.
set -euo pipefail
cd /opt/dar

POSTGRES_PASSWORD="$(sed -n 's/^POSTGRES_PASSWORD=//p' deploy/.env)"
OTP_PEPPER="$(sed -n 's/^OTP_PEPPER=//p' deploy/.env)"
SMTP_HOST="$(sed -n 's/^SMTP_HOST=//p' deploy/.env)"
SMTP_PORT="$(sed -n 's/^SMTP_PORT=//p' deploy/.env)"
SMTP_USER="$(sed -n 's/^SMTP_USER=//p' deploy/.env)"
SMTP_PASSWORD="$(sed -n 's/^SMTP_PASSWORD=//p' deploy/.env)"
SMTP_FROM="$(sed -n 's/^SMTP_FROM=//p' deploy/.env)"
SMTP_ENABLE_SSL="$(sed -n 's/^SMTP_ENABLE_SSL=//p' deploy/.env)"
GOOGLE_CLIENT_ID="$(sed -n 's/^GOOGLE_CLIENT_ID=//p' deploy/.env)"
[ -n "$SMTP_PORT" ] || SMTP_PORT=587
[ -n "$SMTP_ENABLE_SSL" ] || SMTP_ENABLE_SSL=true

DB="Host=127.0.0.1;Port=5432;Database=dareltahfeez;Username=dar_app;Password=$POSTGRES_PASSWORD"

sudo mkdir -p /etc/dar /var/lib/dar/backups /var/lib/dar/.local/share/DarEltahfeez/Logs
sudo chown -R dar:dar /var/lib/dar

sudo tee /etc/dar/legacy.env >/dev/null <<EOF
ASPNETCORE_ENVIRONMENT=Production
ASPNETCORE_URLS=http://127.0.0.1:5080
ConnectionStrings__DarDatabase=$DB
Database__ApplyMigrationsOnStartup=false
Backup__RootPath=/var/lib/dar/backups
Auth__SetupToken=
TZ=Africa/Cairo
HOME=/var/lib/dar
ForwardedHeaders__KnownProxies__0=127.0.0.1
EOF

sudo tee /etc/dar/api.env >/dev/null <<EOF
ASPNETCORE_ENVIRONMENT=Production
ASPNETCORE_URLS=http://127.0.0.1:5081
ConnectionStrings__Default=$DB
Auth__Otp__Pepper=$OTP_PEPPER
Auth__Smtp__Host=$SMTP_HOST
Auth__Smtp__Port=$SMTP_PORT
Auth__Smtp__User=$SMTP_USER
Auth__Smtp__Password=$SMTP_PASSWORD
Auth__Smtp__From=$SMTP_FROM
Auth__Smtp__EnableSsl=$SMTP_ENABLE_SSL
Auth__Google__ClientId=$GOOGLE_CLIENT_ID
TZ=Africa/Cairo
HOME=/var/lib/dar
ForwardedHeaders__KnownProxies__0=127.0.0.1
EOF

sudo chown root:dar /etc/dar/legacy.env /etc/dar/api.env
sudo chmod 640 /etc/dar/legacy.env /etc/dar/api.env

sudo tee /etc/systemd/system/dar-legacy.service >/dev/null <<'EOF'
[Unit]
Description=Dar legacy API
After=network-online.target postgresql.service
Wants=network-online.target
Requires=postgresql.service

[Service]
Type=simple
User=dar
Group=dar
WorkingDirectory=/opt/dar/app/legacy
EnvironmentFile=/etc/dar/legacy.env
ExecStart=/usr/bin/dotnet /opt/dar/app/legacy/DarEltahfeez.Api.dll
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/var/lib/dar
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/dar-api.service >/dev/null <<'EOF'
[Unit]
Description=Dar new API v1
After=network-online.target postgresql.service
Wants=network-online.target
Requires=postgresql.service

[Service]
Type=simple
User=dar
Group=dar
WorkingDirectory=/opt/dar/app/api
EnvironmentFile=/etc/dar/api.env
ExecStart=/usr/bin/dotnet /opt/dar/app/api/Dar.Api.dll
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/var/lib/dar
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now dar-legacy.service dar-api.service
sleep 5
sudo systemctl --no-pager --full status dar-legacy.service dar-api.service | sed -n '1,40p'
echo "---HEALTH---"
curl -fsS http://127.0.0.1:5080/health/ready
echo
curl -fsS http://127.0.0.1:5081/health/ready
echo

#!/usr/bin/env bash
# =============================================================================
# Dar host bootstrap - idempotent first-boot setup
# =============================================================================
# Purpose : prepare a fresh Ubuntu 24.04 host for the Dar production stack.
# Requires: root on a fresh Ubuntu 24.04 server.
# Usage   : scp deploy/bootstrap-server.sh deploy@HOST:/root/
#           ssh root@HOST 'bash /root/bootstrap-server.sh'
# Safe    : every step is idempotent; re-running refreshes the same state and
#           never deletes application data, databases, backups or config.
# Creates : system user "dar" (no shell login) that owns /var/lib/dar.
#           deploy user (sudo + docker) for SSH deployments.
# Writes  : /var/lib/dar/{backups,backups/db,app,logs} owned by dar:dar,
#           /var/log/dar for deployment logs, /opt/dar for the git checkout.
# Notes   : .NET, Node, PostgreSQL, Nginx and Certbot packages are installed by
#           the documented host setup steps (see docs/11-deployment.md), not here.
# =============================================================================
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "==> Base packages"
apt-get update
apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold upgrade
apt-get install -y ca-certificates curl gnupg git ufw fail2ban unattended-upgrades rsync jq

echo "==> Timezone"
timedatectl set-timezone Africa/Cairo

echo "==> Swap"
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  sysctl -w vm.swappiness=10
  grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >>/etc/sysctl.conf
fi

echo "==> Docker"
install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
fi
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  >/etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

echo "==> deploy user (SSH release user)"
if ! id deploy >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" deploy
fi
usermod -aG sudo deploy
usermod -aG docker deploy
install -d -m 0700 -o deploy -g deploy /home/deploy/.ssh
if [ -f /root/.ssh/authorized_keys ]; then
  install -m 0600 -o deploy -g deploy /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
fi
echo 'deploy ALL=(ALL) NOPASSWD:ALL' >/etc/sudoers.d/90-deploy
chmod 440 /etc/sudoers.d/90-deploy

echo "==> dar service user (system account, no login shell)"
if ! id dar >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/dar --create-home \
    --shell /usr/sbin/nologin --comment "Dar application services" dar
fi
dar_home="$(getent passwd dar | cut -d: -f6)"
if [ "$dar_home" != "/var/lib/dar" ]; then
  usermod --home /var/lib/dar --shell /usr/sbin/nologin dar
fi

echo "==> Dar directories"
install -d -m 0750 -o dar -g dar /var/lib/dar
install -d -m 0750 -o dar -g dar /var/lib/dar/backups
install -d -m 0750 -o dar -g dar /var/lib/dar/backups/db
install -d -m 0750 -o dar -g dar /var/lib/dar/app
install -d -m 0750 -o dar -g dar /var/lib/dar/logs
install -d -m 0750 -o dar -g dar /var/lib/dar/.local
install -d -m 0750 -o dar -g dar /var/lib/dar/.local/share
install -d -m 0750 -o dar -g dar /var/lib/dar/.local/share/DarEltahfeez
install -d -m 0750 -o dar -g dar /var/lib/dar/.local/share/DarEltahfeez/Logs
install -d -m 0755 -o root -g root /var/log/dar

echo "==> Firewall"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> SSH hardening"
cat >/etc/ssh/sshd_config.d/99-dar-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
sshd -t
systemctl reload ssh 2>/dev/null || systemctl reload sshd

echo "==> fail2ban"
cat >/etc/fail2ban/jail.d/dar.local <<'EOF'
[sshd]
enabled = true
maxretry = 5
bantime = 1h
findtime = 10m
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

echo "==> Unattended upgrades"
echo 'unattended-upgrades unattended-upgrades/enable_auto_updates boolean true' | debconf-set-selections
dpkg-reconfigure -f noninteractive unattended-upgrades || true

echo "==> App directory"
install -d -m 0755 -o deploy -g deploy /opt/dar

echo "==> Summary"
printf 'dar user : %s\n' "$(id dar)"
printf 'deploy   : %s\n' "$(id deploy)"
ls -ld /var/lib/dar /var/lib/dar/backups /var/lib/dar/app /var/lib/dar/logs /var/log/dar /opt/dar

echo "BOOTSTRAP_OK"

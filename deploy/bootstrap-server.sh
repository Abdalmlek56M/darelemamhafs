#!/usr/bin/env bash
# Idempotent first-boot setup for the Dar host.
# Run as root on a fresh Ubuntu 24.04 server.
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
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10
  grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
fi

echo "==> Docker"
install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
fi
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

echo "==> deploy user"
if ! id deploy >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" deploy
fi
usermod -aG sudo deploy
usermod -aG docker deploy
mkdir -p /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
echo 'deploy ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/90-deploy
chmod 440 /etc/sudoers.d/90-deploy

echo "==> Firewall"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> SSH hardening"
cat > /etc/ssh/sshd_config.d/99-dar-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
sshd -t
systemctl reload ssh

echo "==> fail2ban"
cat > /etc/fail2ban/jail.d/dar.local <<'EOF'
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
mkdir -p /opt/dar
chown deploy:deploy /opt/dar

echo "BOOTSTRAP_OK"

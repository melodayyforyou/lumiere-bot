#!/usr/bin/env bash
# One-shot installer for an Ubuntu/Debian VPS.
# Run from inside the lumiere-bot folder:   sudo bash deploy/install-vps.sh
# The first run asks for the bot token and IDs. To change them later, delete .env and re-run.
# Safe to re-run: it updates dependencies and restarts the bot.
set -euo pipefail

BOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_USER="${SUDO_USER:-$(whoami)}"
SERVICE=/etc/systemd/system/lumiere-bot.service

# Use a private copy of Node.js inside this folder, so any other bot on the
# VPS (and its Node version) is never touched.
NODE_VERSION=v20.18.1
NODE_DIR="$BOT_DIR/.node"
if [ ! -x "$NODE_DIR/bin/node" ]; then
  echo "==> Downloading private Node.js $NODE_VERSION (only for this bot)"
  case "$(uname -m)" in x86_64) ARCH=x64 ;; aarch64) ARCH=arm64 ;; *) echo "Unsupported CPU $(uname -m)"; exit 1 ;; esac
  mkdir -p "$NODE_DIR"
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-$ARCH.tar.xz" | tar -xJ -C "$NODE_DIR" --strip-components=1
  chown -R "$RUN_USER" "$NODE_DIR"
fi
export PATH="$NODE_DIR/bin:$PATH"
echo "==> Node $(node -v) at $NODE_DIR"

cd "$BOT_DIR"
if [ ! -f .env ]; then
  echo
  echo "==> First run: paste your Discord details (from the Developer Portal)."
  read -rp  "Application ID (CLIENT_ID): " CLIENT_ID
  read -rp  "Server ID (GUILD_ID): " GUILD_ID
  read -rsp "Bot token (hidden while you paste): " DISCORD_TOKEN; echo
  umask 077
  printf 'DISCORD_TOKEN=%s\nCLIENT_ID=%s\nGUILD_ID=%s\n' "$DISCORD_TOKEN" "$CLIENT_ID" "$GUILD_ID" > .env
  chown "$RUN_USER" .env
  echo "==> Saved to $BOT_DIR/.env (only readable by you)"
fi

echo "==> Installing packages"
sudo -u "$RUN_USER" env PATH="$PATH" npm ci --omit=dev

echo "==> Registering slash commands on your server"
sudo -u "$RUN_USER" env PATH="$PATH" npm run deploy

echo "==> Installing background service (auto-starts on reboot, restarts on crash)"
cat > "$SERVICE" <<UNIT
[Unit]
Description=Lumiere legion Discord bot
After=network-online.target
Wants=network-online.target

[Service]
User=$RUN_USER
WorkingDirectory=$BOT_DIR
ExecStart=$NODE_DIR/bin/node src/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable lumiere-bot >/dev/null
systemctl restart lumiere-bot
sleep 4
systemctl --no-pager --lines=30 status lumiere-bot || true
echo
echo "==> Done. Live logs:  journalctl -u lumiere-bot -f"

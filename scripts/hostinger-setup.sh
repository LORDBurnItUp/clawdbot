#!/usr/bin/env bash
# ============================================================
# Hostinger Business Plan — Node.js Deployment Setup
# Usage: bash scripts/hostinger-setup.sh
#
# Installs dependencies, builds the project, installs Claude Code,
# creates log directories, and starts the gateway via PM2 as "swagclaw".
# ============================================================

set -euo pipefail

echo ""
echo "=== SwagClaw / Clawdbot — Hostinger Setup ==="
echo ""

# ---- Node version check ----
NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "ERROR: Node.js 22+ required. Found Node $NODE_MAJOR."
  echo "In Hostinger panel: Hosting > Node.js > select version 22.x"
  exit 1
fi
echo "Node.js $(node --version) OK"

# ---- Install pnpm if missing ----
if ! command -v pnpm &> /dev/null; then
  echo "Installing pnpm..."
  npm install -g pnpm
fi
echo "pnpm $(pnpm --version) OK"

# ---- Install project dependencies ----
echo ""
echo "Installing dependencies..."
pnpm install --frozen-lockfile --ignore-scripts 2>/dev/null || pnpm install --ignore-scripts

# ---- Build TypeScript ----
echo ""
echo "Building TypeScript..."
pnpm build

# ---- Install Claude Code CLI (auto, no confirmation needed) ----
echo ""
echo "Installing Claude Code CLI..."
npm install -g @anthropic-ai/claude-code --yes 2>/dev/null || \
  npm install -g claude --yes 2>/dev/null || \
  echo "Note: Claude Code CLI not available via npm — install manually if needed."

# Show claude version if installed
if command -v claude &> /dev/null; then
  echo "Claude Code $(claude --version 2>/dev/null || echo 'installed') OK"
fi

# ---- Install PM2 if missing ----
if ! command -v pm2 &> /dev/null; then
  echo ""
  echo "Installing PM2 process manager..."
  npm install -g pm2
fi
echo "PM2 $(pm2 --version) OK"

# ---- Create log directory ----
mkdir -p logs

# ---- Create .env if missing ----
if [ ! -f .env ]; then
  cat > .env <<'ENV'
# SwagClaw / Clawdbot — Environment Variables
# Fill in your API keys below, then run: source .env

NODE_ENV=production
NODE_OPTIONS=--max-old-space-size=1536
CLAWDBOT_PREFER_PNPM=1

# Set this to your Hostinger app directory state path:
# CLAWDBOT_STATE_DIR=/home/<your-user>/.clawdbot

# AI API Keys (add your keys here):
# ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...
# GEMINI_API_KEY=AIza...
ENV
  echo ""
  echo "Created .env — add your API keys to this file before starting."
fi

# ---- Set up swagclaw binary ----
# Make the dist entry executable so `node dist/entry.js` works as swagclaw
if [ -f dist/entry.js ]; then
  chmod +x dist/entry.js
  echo "swagclaw CLI ready at dist/entry.js"
fi

# ---- Start / Restart with PM2 ----
echo ""
echo "Starting swagclaw gateway via PM2..."

# Stop old instance if running
pm2 stop swagclaw 2>/dev/null || true
pm2 delete swagclaw 2>/dev/null || true

# Start fresh
pm2 start ecosystem.config.cjs
pm2 save

echo ""
echo "=== Setup Complete ==="
echo ""
echo "  Gateway:    pm2 status"
echo "  Logs:       pm2 logs swagclaw"
echo "  CLI:        node dist/entry.js <command>"
echo "              (or: npx clawdbot <command> after npm link)"
echo ""
echo "Next steps:"
echo "  1. Edit .env and add your ANTHROPIC_API_KEY"
echo "  2. Run: node dist/entry.js ai setup"
echo "  3. Run: node dist/entry.js setup --wizard"
echo "  4. In Hostinger panel: point Node.js startup to 'node dist/index.js'"
echo ""

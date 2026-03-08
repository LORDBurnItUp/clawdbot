#!/usr/bin/env bash
set -e

echo "Starting Hostinger Setup for Clawdbot..."

# Install node version manager + node 22 if not present
if ! command -v node >/dev/null 2>&1 || ! node -v | grep -q "^v2[2-9]" ; then
    echo "Installing Node.js..."
    if command -v apt-get >/dev/null 2>&1; then
        curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - || true
        sudo apt-get install -y nodejs || true
    fi
fi

# Install pnpm
if ! command -v pnpm >/dev/null 2>&1; then
    echo "Installing pnpm..."
    npm install -g pnpm
fi

echo "Installing dependencies..."
pnpm install

echo "Building..."
pnpm build

echo "Installing globally..."
npm install -g .

echo "Setup complete! You can now run 'clawdbot onboard' or 'swagclaw onboard'."

#!/usr/bin/env bash
set -e

echo "Starting Hostinger Setup for Clawdbot..."

# Hostinger often has Node.js/pnpm already. Check if they exist.
# If not, try to install locally or skip system-level installs.

# pnpm install (global if possible, but local otherwise)
if ! command -v pnpm >/dev/null 2>&1; then
    echo "Installing pnpm locally..."
    npm install pnpm || true
    PNPM_BIN="./node_modules/.bin/pnpm"
else
    PNPM_BIN="pnpm"
fi

echo "Installing dependencies..."
$PNPM_BIN install

echo "Building..."
$PNPM_BIN build

echo "Installing globally (user bin)..."
# In shared hosting, npm install -g might fail. Try --prefix
npm install -g . --prefix=$HOME/.local || true
export PATH=$PATH:$HOME/.local/bin

echo "Setup complete! You can now run 'clawdbot onboard' or 'swagclaw onboard'."

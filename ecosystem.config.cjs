/**
 * PM2 Ecosystem Config — Hostinger Business Plan (Node.js)
 *
 * Deploy steps:
 *   1. SSH into Hostinger: ssh user@your-domain.com
 *   2. cd ~/public_html (or your Node.js app root)
 *   3. git pull origin claude/setup-ai-cli-interface-bJacE
 *   4. bash scripts/hostinger-setup.sh
 *   5. pm2 start ecosystem.config.cjs
 *   6. pm2 save && pm2 startup
 *
 * Environment variables to set in Hostinger control panel or .env:
 *   NODE_ENV=production
 *   PORT=<auto-assigned by Hostinger>
 *   CLAWDBOT_STATE_DIR=/home/<user>/.clawdbot
 *   ANTHROPIC_API_KEY=<your key>
 */

module.exports = {
  apps: [
    {
      name: "swagclaw",
      script: "node",
      args: "dist/index.js gateway --allow-unconfigured --port ${PORT:-3000} --bind loopback",
      cwd: "./",
      interpreter: "none",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        NODE_OPTIONS: "--max-old-space-size=1536",
        CLAWDBOT_PREFER_PNPM: "1",
      },
      env_production: {
        NODE_ENV: "production",
      },
      error_file: "logs/err.log",
      out_file: "logs/out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
    },
  ],
};

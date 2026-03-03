import type { Command } from "commander";

import { aiBoardCommand, aiGoalsCommand, aiSetupCommand } from "../commands/ai-setup.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { runCommandWithRuntime } from "./cli-utils.js";

export function registerAiCli(program: Command) {
  const ai = program
    .command("ai")
    .description("Multi-model AI brain setup and proactive overnight mode")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/ai", "docs.clawd.bot/cli/ai")}\n`,
    );

  ai.command("setup")
    .description("Interactive wizard: configure brain/code/search models and proactive heartbeat")
    .option("--non-interactive", "Run in non-interactive mode", false)
    .action(async (_opts: { nonInteractive?: boolean }) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await aiSetupCommand({}, defaultRuntime);
      });
    });

  ai.command("goals")
    .description("View the goals file (GOALS.md) in the agent workspace")
    .action(async () => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await aiGoalsCommand({}, defaultRuntime);
      });
    });

  ai.command("board")
    .description("View the task board (TASKS.md) and heartbeat queue (HEARTBEAT.md)")
    .action(async () => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await aiBoardCommand({}, defaultRuntime);
      });
    });
}

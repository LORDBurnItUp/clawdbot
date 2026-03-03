import type { Command } from "commander";

import { voiceCommand } from "../../commands/voice.js";
import { defaultRuntime } from "../../runtime.js";
import { runCommandWithRuntime } from "../cli-utils.js";

export function registerVoiceCommands(program: Command) {
  program
    .command("voice")
    .description("Interactive voice mode: record → transcribe → agent → speak")
    .option("--agent <id>", "Agent id (default: main agent)")
    .option("--duration <seconds>", "Recording duration in seconds (default: 5)", "5")
    .option("--no-tts", "Print response text only, skip audio playback")
    .option("--local", "Run agent locally without the gateway", false)
    .action(async (opts: Record<string, unknown>) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await voiceCommand(
          {
            agent: opts.agent as string | undefined,
            duration: Number(opts.duration ?? 5),
            // commander turns --no-tts into opts.tts === false
            noTts: opts.tts === false,
            local: Boolean(opts.local),
          },
          defaultRuntime,
        );
      });
    });
}

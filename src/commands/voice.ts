import { readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import * as readline from "node:readline";

import { loadConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import { textToSpeech, resolveTtsConfig } from "../tts/tts.js";
import { transcribeOpenAiCompatibleAudio } from "../media-understanding/providers/openai/audio.js";
import { agentViaGatewayCommand, agentCliCommand } from "./agent-via-gateway.js";

export type VoiceOpts = {
  agent?: string;
  duration?: number;
  noTts?: boolean;
  local?: boolean;
};

const TEMP_AUDIO_IN = path.join(tmpdir(), "clawdbot-voice-in.wav");
const TIMEOUT_MS = 30_000;

/** Spawn a process, wait for exit, resolve with exit code. */
function spawnWait(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: "ignore" });
    proc.on("close", (code: number | null) => resolve(code ?? 1));
    proc.on("error", () => resolve(1));
  });
}

/** Record audio from the default microphone to a WAV file. Returns true on success. */
async function recordAudio(durationSecs: number, log: (s: string) => void): Promise<boolean> {
  const dur = String(durationSecs);

  // Try sox first (most common on Linux/macOS when SoX is installed)
  const soxCode = await spawnWait("sox", [
    "-d", "-r", "16000", "-c", "1", "-b", "16", TEMP_AUDIO_IN, "trim", "0", dur,
  ]);
  if (soxCode === 0) return true;

  // Try ffmpeg with ALSA (Linux)
  const ffAlsaCode = await spawnWait("ffmpeg", [
    "-y", "-f", "alsa", "-i", "default", "-t", dur, TEMP_AUDIO_IN,
  ]);
  if (ffAlsaCode === 0) return true;

  // Try ffmpeg with AVFoundation (macOS)
  const ffAvCode = await spawnWait("ffmpeg", [
    "-y", "-f", "avfoundation", "-i", ":0", "-t", dur, TEMP_AUDIO_IN,
  ]);
  if (ffAvCode === 0) return true;

  log(
    "Error: no audio recorder found. Install sox (recommended) or ffmpeg:\n" +
      "  macOS:  brew install sox\n" +
      "  Linux:  sudo apt install sox   OR   sudo apt install ffmpeg",
  );
  return false;
}

/** Play an audio file using the first available system player. */
async function playAudio(audioPath: string): Promise<void> {
  // sox play
  if ((await spawnWait("sox", [audioPath, "-d"])) === 0) return;
  // ffplay
  if ((await spawnWait("ffplay", ["-nodisp", "-autoexit", audioPath])) === 0) return;
  // afplay (macOS)
  if ((await spawnWait("afplay", [audioPath])) === 0) return;
  // aplay (Linux ALSA)
  await spawnWait("aplay", [audioPath]);
}

/** Wait for the user to press Enter. */
function waitForEnter(prompt: string): Promise<void> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

export async function voiceCommand(opts: VoiceOpts, runtime: RuntimeEnv): Promise<void> {
  const cfg = loadConfig();
  const ttsConfig = resolveTtsConfig(cfg);
  // Use the OpenAI key from TTS config or fall back to env var
  const openAiKey: string =
    ttsConfig.openai.apiKey ?? process.env.OPENAI_API_KEY ?? "";

  const duration = opts.duration ?? 5;
  const agentId = opts.agent;

  if (!openAiKey) {
    runtime.error(
      "No OpenAI API key found. Set one via:\n" +
        "  clawdbot config set tts.openai.apiKey <key>\n" +
        "  OR export OPENAI_API_KEY=<key>",
    );
    return;
  }

  runtime.log("Voice mode active. Press Ctrl+C to quit.");
  runtime.log(`Recording duration: ${duration}s per turn.\n`);

  // Clean up temp file on exit
  let running = true;
  const cleanup = () => {
    running = false;
    try { unlinkSync(TEMP_AUDIO_IN); } catch { /* ignore */ }
  };
  process.on("SIGINT", () => { cleanup(); process.exit(0); });

  let noPlayerWarned = false;

  while (running) {
    await waitForEnter("[ Press Enter to start recording... ]");
    if (!running) break;

    runtime.log(`Recording for ${duration}s — speak now...`);
    const recorded = await recordAudio(duration, (msg) => runtime.error(msg));
    if (!recorded) break;

    // — Transcribe —
    let transcript: string;
    try {
      const buf = readFileSync(TEMP_AUDIO_IN);
      const result = await transcribeOpenAiCompatibleAudio({
        buffer: buf,
        fileName: "voice.wav",
        mime: "audio/wav",
        apiKey: openAiKey,
        timeoutMs: TIMEOUT_MS,
      });
      transcript = result.text.trim();
    } catch (err) {
      runtime.error(`Transcription failed: ${String(err)}`);
      continue;
    }

    if (!transcript) {
      runtime.log("(Nothing heard — try again)");
      continue;
    }

    runtime.log(`\nYou: ${transcript}\n`);

    // — Send to agent —
    let replyText: string | undefined;
    try {
      const agentOpts = {
        message: transcript,
        agent: agentId,
        local: opts.local ?? false,
        json: false,
      };

      // Capture the response text by temporarily overriding log
      const lines: string[] = [];
      const capturingRuntime: RuntimeEnv = {
        ...runtime,
        log: (msg: string) => lines.push(msg),
      };

      await agentCliCommand(agentOpts, capturingRuntime);
      replyText = lines.join("\n").trim();
    } catch (err) {
      runtime.error(`Agent error: ${String(err)}`);
      continue;
    }

    if (!replyText) {
      runtime.log("(No reply from agent)");
      continue;
    }

    runtime.log(`\nAgent: ${replyText}\n`);

    // — TTS playback —
    if (!opts.noTts) {
      try {
        const ttsResult = await textToSpeech({ text: replyText, cfg, channel: "voice" });
        if (ttsResult.success && ttsResult.audioPath) {
          await playAudio(ttsResult.audioPath);
        } else if (!noPlayerWarned) {
          runtime.log("(Audio playback unavailable — continuing in text-only mode)");
          noPlayerWarned = true;
        }
      } catch {
        // TTS errors are non-fatal; response was already printed
      }
    }
  }
}

import fs from "node:fs/promises";
import path from "node:path";

import { resolveDefaultAgentId, resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import { ensureAgentWorkspace } from "../agents/workspace.js";
import { loadConfig, writeConfigFile } from "../config/config.js";
import { logConfigUpdated } from "../config/logging.js";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { shortenHomePath } from "../utils.js";
import { createClackPrompter } from "../wizard/clack-prompter.js";
import { WizardCancelledError } from "../wizard/prompts.js";
import { GOOGLE_GEMINI_DEFAULT_MODEL } from "./google-gemini-model-default.js";
import { OPENAI_CODEX_DEFAULT_MODEL } from "./openai-codex-model-default.js";

const ANTHROPIC_OPUS_MODEL = "anthropic/claude-opus-4-6";
const ANTHROPIC_SONNET_MODEL = "anthropic/claude-sonnet-4-6";
const OPENROUTER_GROK_MODEL = "openrouter/x-ai/grok-3-beta";

const GOALS_FILENAME = "GOALS.md";
const TASKS_FILENAME = "TASKS.md";

const GOALS_TEMPLATE = `# Goals

<!-- Fill in your goals below. The AI reads this during overnight heartbeat runs. -->
<!-- Be specific: the more detail you provide, the better the AI can help. -->

## My Big Goals
-

## What I'm Building Right Now
-

## Things I Want the AI to Research
-

## Things I Want the AI to Build (while I sleep)
-

## How to Prioritize
<!-- High / Medium / Low, or order by number -->
-
`;

const TASKS_TEMPLATE = `# Task Board

<!-- The AI updates this file during heartbeat runs. -->
<!-- Items are added, worked on, and completed here. -->

## In Progress
-

## Pending
-

## Completed
-

## Questions for You
<!-- The AI will add questions here when it needs your input -->
-
`;

// Proactive HEARTBEAT.md content for overnight AI operation
const HEARTBEAT_AI_CONTENT = `# Overnight Tasks

<!-- The AI runs on its own schedule. Add tasks here for autonomous work. -->
<!-- Reply HEARTBEAT_OK when nothing needs attention. -->

Read GOALS.md for context on what matters most. Then:
1. Check TASKS.md for pending items — work on the highest priority one
2. Research or build anything that moves the goals forward
3. Update TASKS.md: mark completed items, add progress notes
4. If you have questions, add them to TASKS.md under "## Questions for You"
5. Keep replies concise — summarize what you did or why you're idle
`;

type BrainModel = "opus" | "sonnet" | "custom";
type CodeModel = "codex" | "gpt4o" | "skip";
type SearchModel = "gemini" | "skip";
type SocialModel = "grok" | "skip";

export type AiSetupOptions = {
  nonInteractive?: boolean;
};

async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

async function writeFileIfMissing(filePath: string, content: string): Promise<boolean> {
  try {
    await fs.writeFile(filePath, content, { encoding: "utf-8", flag: "wx" });
    return true;
  } catch (err) {
    const anyErr = err as { code?: string };
    if (anyErr.code === "EEXIST") return false;
    throw err;
  }
}

export async function aiSetupCommand(
  _opts: AiSetupOptions = {},
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const prompter = createClackPrompter();

  try {
    await prompter.intro("Clawdbot AI Brain Setup");

    const cfg = await loadConfig();
    const agentId = resolveDefaultAgentId(cfg);
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);

    await prompter.note(
      [
        `Agent:     ${agentId}`,
        `Workspace: ${shortenHomePath(workspaceDir)}`,
      ].join("\n"),
      "Current config",
    );

    // Step 1: Brain model (primary reasoning)
    const brainChoice = await prompter.select<BrainModel>({
      message: "Brain model — primary reasoning and planning",
      options: [
        {
          value: "opus",
          label: "Claude Opus 4.6 (Recommended)",
          hint: "Best for complex reasoning and autonomous work",
        },
        {
          value: "sonnet",
          label: "Claude Sonnet 4.6",
          hint: "Faster, good balance of speed and capability",
        },
        { value: "custom", label: "Custom model", hint: "Enter a provider/model string manually" },
      ],
      initialValue: "opus",
    });

    let brainModel: string;
    if (brainChoice === "custom") {
      brainModel = await prompter.text({
        message: "Enter brain model (e.g. anthropic/claude-opus-4-6)",
        placeholder: ANTHROPIC_OPUS_MODEL,
        validate: (v) => (v.trim() ? undefined : "Model is required"),
      });
    } else {
      brainModel = brainChoice === "opus" ? ANTHROPIC_OPUS_MODEL : ANTHROPIC_SONNET_MODEL;
    }

    // Step 2: Code model (optional — used for coding sub-tasks)
    const codeChoice = await prompter.select<CodeModel>({
      message: "Code model — for autonomous coding tasks (optional)",
      options: [
        {
          value: "codex",
          label: "OpenAI Codex CLI (Recommended)",
          hint: "gpt-5.2 via Codex CLI OAuth",
        },
        { value: "gpt4o", label: "OpenAI GPT-4o", hint: "Via OpenAI API key" },
        { value: "skip", label: "Skip", hint: "Use the brain model for coding too" },
      ],
      initialValue: "codex",
    });

    const codeModel = codeChoice === "skip" ? null : codeChoice === "codex" ? OPENAI_CODEX_DEFAULT_MODEL : "openai/gpt-4o";

    // Step 3: Search model (optional — for research tasks)
    const searchChoice = await prompter.select<SearchModel>({
      message: "Search model — for research and web-aware tasks (optional)",
      options: [
        {
          value: "gemini",
          label: "Google Gemini 3 Pro (Recommended)",
          hint: "Natively web-aware, great for research",
        },
        { value: "skip", label: "Skip", hint: "Use brain model for search too" },
      ],
      initialValue: "gemini",
    });

    const searchModel = searchChoice === "skip" ? null : GOOGLE_GEMINI_DEFAULT_MODEL;

    // Step 4: Social/trend research model (optional)
    const socialChoice = await prompter.select<SocialModel>({
      message: "Social/trend model — xAI Grok via OpenRouter (optional)",
      options: [
        {
          value: "grok",
          label: "xAI Grok 3 Beta via OpenRouter",
          hint: "Real-time social and trend research",
        },
        { value: "skip", label: "Skip" },
      ],
      initialValue: "skip",
    });

    const socialModel = socialChoice === "skip" ? null : OPENROUTER_GROK_MODEL;

    // Step 5: Proactive overnight mode
    const enableHeartbeat = await prompter.confirm({
      message: "Enable proactive overnight mode? (AI works while you sleep)",
      initialValue: true,
    });

    let heartbeatEvery = "8h";
    let heartbeatStart = "22:00";
    let heartbeatEnd = "08:00";

    if (enableHeartbeat) {
      const scheduleChoice = await prompter.select<string>({
        message: "Overnight schedule",
        options: [
          {
            value: "8h-overnight",
            label: "Every 8 hours, active 10pm–8am (Recommended)",
            hint: "Checks in ~once overnight",
          },
          {
            value: "2h-overnight",
            label: "Every 2 hours, active 10pm–8am",
            hint: "More frequent overnight checks",
          },
          { value: "30m-always", label: "Every 30 minutes, always on", hint: "Continuous mode" },
          { value: "custom", label: "Custom schedule" },
        ],
        initialValue: "8h-overnight",
      });

      if (scheduleChoice === "2h-overnight") {
        heartbeatEvery = "2h";
      } else if (scheduleChoice === "30m-always") {
        heartbeatEvery = "30m";
        heartbeatStart = "00:00";
        heartbeatEnd = "24:00";
      } else if (scheduleChoice === "custom") {
        heartbeatEvery = await prompter.text({
          message: "Heartbeat interval (e.g. 1h, 30m, 4h)",
          initialValue: "8h",
          validate: (v) => (v.trim() ? undefined : "Interval is required"),
        });
        heartbeatStart = await prompter.text({
          message: "Active hours start (HH:MM, 24h)",
          initialValue: "22:00",
        });
        heartbeatEnd = await prompter.text({
          message: "Active hours end (HH:MM, 24h)",
          initialValue: "08:00",
        });
      }
    }

    // Build updated config
    let nextCfg = cfg;

    // Set brain as primary model
    const existingModel = cfg.agents?.defaults?.model;
    nextCfg = {
      ...nextCfg,
      agents: {
        ...nextCfg.agents,
        defaults: {
          ...nextCfg.agents?.defaults,
          model:
            existingModel && typeof existingModel === "object"
              ? { ...existingModel, primary: brainModel }
              : { primary: brainModel },
        },
      },
    };

    // Set code model as subagents default (if chosen)
    if (codeModel) {
      nextCfg = {
        ...nextCfg,
        agents: {
          ...nextCfg.agents,
          defaults: {
            ...nextCfg.agents?.defaults,
            subagents: {
              ...nextCfg.agents?.defaults?.subagents,
              model: codeModel,
            },
          },
        },
      };
    }

    // Add search + social models as model catalog aliases (if chosen)
    const additionalModels: Record<string, object> = {};
    if (searchModel) {
      additionalModels["search"] = { alias: searchModel };
    }
    if (socialModel) {
      additionalModels["social"] = { alias: socialModel };
    }
    if (Object.keys(additionalModels).length > 0) {
      nextCfg = {
        ...nextCfg,
        agents: {
          ...nextCfg.agents,
          defaults: {
            ...nextCfg.agents?.defaults,
            models: {
              ...nextCfg.agents?.defaults?.models,
              ...additionalModels,
            },
          },
        },
      };
    }

    // Configure heartbeat
    if (enableHeartbeat) {
      const isAlwaysOn = heartbeatStart === "00:00" && heartbeatEnd === "24:00";
      nextCfg = {
        ...nextCfg,
        agents: {
          ...nextCfg.agents,
          defaults: {
            ...nextCfg.agents?.defaults,
            heartbeat: {
              every: heartbeatEvery,
              ...(isAlwaysOn
                ? {}
                : {
                    activeHours: {
                      start: heartbeatStart,
                      end: heartbeatEnd,
                      timezone: "user",
                    },
                  }),
            },
          },
        },
      };
    }

    // Save config
    await writeConfigFile(nextCfg);
    logConfigUpdated(runtime);

    // Ensure workspace and create AI-specific files
    await ensureAgentWorkspace({ dir: workspaceDir, ensureBootstrapFiles: true });

    const goalsPath = path.join(workspaceDir, GOALS_FILENAME);
    const tasksPath = path.join(workspaceDir, TASKS_FILENAME);
    const heartbeatPath = path.join(workspaceDir, "HEARTBEAT.md");

    const goalsCreated = await writeFileIfMissing(goalsPath, GOALS_TEMPLATE);
    const tasksCreated = await writeFileIfMissing(tasksPath, TASKS_TEMPLATE);

    // Update HEARTBEAT.md: append proactive instructions if not already present
    const existingHeartbeat = await readFileSafe(heartbeatPath);
    if (existingHeartbeat !== null && !existingHeartbeat.includes("TASKS.md")) {
      const updated = existingHeartbeat.trimEnd() + "\n\n" + HEARTBEAT_AI_CONTENT;
      await fs.writeFile(heartbeatPath, updated, "utf-8");
    } else if (existingHeartbeat === null) {
      await writeFileIfMissing(heartbeatPath, HEARTBEAT_AI_CONTENT);
    }

    // Build summary
    const lines: string[] = [];
    lines.push(`Brain model:  ${brainModel}`);
    if (codeModel) lines.push(`Code model:   ${codeModel}`);
    if (searchModel) lines.push(`Search model: ${searchModel}`);
    if (socialModel) lines.push(`Social model: ${socialModel}`);
    if (enableHeartbeat) {
      lines.push(`Heartbeat:    every ${heartbeatEvery} (${heartbeatStart}–${heartbeatEnd})`);
    }
    if (goalsCreated) lines.push(`Created:      ${shortenHomePath(goalsPath)}`);
    if (tasksCreated) lines.push(`Created:      ${shortenHomePath(tasksPath)}`);

    await prompter.note(lines.join("\n"), "AI brain configured");
    await prompter.outro(
      `Setup complete! Fill in ${shortenHomePath(goalsPath)} to give the AI your goals.`,
    );
  } catch (err) {
    if (err instanceof WizardCancelledError) {
      runtime.log("Setup cancelled.");
      return;
    }
    throw err;
  }
}

export async function aiGoalsCommand(
  _opts: Record<string, unknown> = {},
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const cfg = await loadConfig();
  const agentId = resolveDefaultAgentId(cfg);
  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
  const goalsPath = path.join(workspaceDir, GOALS_FILENAME);
  const content = await readFileSafe(goalsPath);
  if (!content) {
    runtime.log(
      `No goals file found at ${shortenHomePath(goalsPath)}. Run \`clawdbot ai setup\` first.`,
    );
    return;
  }
  runtime.log(content.trim());
}

export async function aiBoardCommand(
  _opts: Record<string, unknown> = {},
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const cfg = await loadConfig();
  const agentId = resolveDefaultAgentId(cfg);
  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);

  const tasksPath = path.join(workspaceDir, TASKS_FILENAME);
  const heartbeatPath = path.join(workspaceDir, "HEARTBEAT.md");

  const tasks = await readFileSafe(tasksPath);
  const heartbeat = await readFileSafe(heartbeatPath);

  if (!tasks && !heartbeat) {
    runtime.log(
      `No task board found at ${shortenHomePath(workspaceDir)}. Run \`clawdbot ai setup\` first.`,
    );
    return;
  }

  if (tasks) {
    runtime.log(`=== ${shortenHomePath(tasksPath)} ===`);
    runtime.log(tasks.trim());
    runtime.log("");
  }
  if (heartbeat) {
    runtime.log(`=== ${shortenHomePath(heartbeatPath)} ===`);
    runtime.log(heartbeat.trim());
  }
}

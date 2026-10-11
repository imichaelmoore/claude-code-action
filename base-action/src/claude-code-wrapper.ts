import * as core from "@actions/core";
import { spawn } from "child_process";
import type { ChildProcessWithoutNullStreams } from "child_process";
import { once } from "events";
import { accessSync, constants, existsSync, realpathSync, statSync } from "fs";
import { isAbsolute, sep } from "path";
import { setTimeout as sleep } from "timers/promises";
import type {
  SpawnOptions,
  SpawnedProcess,
} from "@anthropic-ai/claude-agent-sdk";
import { redactSecrets } from "./redact-secrets";

const INPUT_NAME = "path_to_claude_code_wrapper";

// How much of the wrapper's stderr is kept for the log in case the session fails
const STDERR_TAIL_MAX_CHARS = 4096;

// Printed in front of every stderr line, so that nothing written inside the
// wrapper can reach the step's log as a line beginning with "::", which the
// runner would read as a workflow command.
const STDERR_LINE_PREFIX = "[claude stderr] ";

// How long after the wrapper's end the rest of its stderr may take to arrive.
// It is bounded because a stray grandchild can keep the pipe open indefinitely.
const STDERR_DRAIN_GRACE_MS = 200;

/**
 * Validate the path_to_claude_code_wrapper input.
 * Returns the wrapper's resolved path, or undefined when the input is not set.
 */
export function validateClaudeCodeWrapper(
  wrapper: string | undefined,
  customExecutable: string | undefined,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (!wrapper) {
    return undefined;
  }

  if (platform === "win32") {
    throw new Error(`${INPUT_NAME} is not supported on Windows runners.`);
  }

  // The value is not echoed: it would put the control characters into the log
  if (/[\x00-\x1f\x7f]/.test(wrapper)) {
    throw new Error(
      `${INPUT_NAME} contains control characters, which is not allowed (a YAML block scalar adds a newline).`,
    );
  }

  if (!isAbsolute(wrapper)) {
    throw new Error(
      `${INPUT_NAME} must be an absolute path, but got "${wrapper}". Build it from a context such as \${{ runner.temp }}.`,
    );
  }

  // Links are followed once, here, and the result is what gets started, so that
  // changing a link later cannot change the program.
  let resolved: string | undefined;
  try {
    resolved = realpathSync(wrapper);
    accessSync(resolved, constants.X_OK);
    // A directory passes the execute check
    if (!statSync(resolved).isFile()) {
      resolved = undefined;
    }
  } catch {
    resolved = undefined;
  }
  if (!resolved) {
    throw new Error(
      `${INPUT_NAME} must point to an existing executable file, but "${wrapper}" is not one. Create it, with chmod +x, in a step before this one.`,
    );
  }

  // Whoever controls the checked-out branch controls the files in the
  // workspace, and on a pull request the action itself may switch the checkout
  // to the author's branch between this check and the start of the wrapper.
  const workspace = process.env.GITHUB_WORKSPACE;
  if (
    workspace &&
    existsSync(workspace) &&
    resolved.startsWith(realpathSync(workspace) + sep)
  ) {
    throw new Error(
      `${INPUT_NAME} must not point into the workspace, because it runs with this step's credentials outside any sandbox. Write or copy the wrapper to \${{ runner.temp }} in a step before this one.`,
    );
  }

  // A wrapper will often change directory before it starts the command
  if (customExecutable && !isAbsolute(customExecutable)) {
    throw new Error(
      `path_to_claude_code_executable must be an absolute path when ${INPUT_NAME} is set.`,
    );
  }

  return resolved;
}

export type ClaudeCodeWrapper = {
  /** For the Agent SDK's spawnClaudeCodeProcess option */
  spawn: (options: SpawnOptions) => SpawnedProcess;
  /** Print the end of the wrapper's stderr. For a session that failed. */
  logStderrTail: () => Promise<void>;
};

/**
 * Start the session as `<wrapper> <command> <args...>`, where command and args
 * are what the SDK would have started itself. No shell is involved, so nothing
 * needs quoting. Arguments and environment can hold tokens and are never logged.
 *
 * With a custom spawn function the SDK never sees the child's stderr, so this
 * drains it and keeps the end of it for logStderrTail().
 */
export function createClaudeCodeWrapper(wrapper: string): ClaudeCodeWrapper {
  let stderrTail = "";
  let stderrTruncated = false;
  let stderrClosed: Promise<unknown> | undefined;

  const launchFailure = (error: unknown) =>
    `${INPUT_NAME} (${wrapper}) could not be started: ${error instanceof Error ? error.message : error}. If it is a script, check that its first line is a valid #! line.`;

  return {
    spawn: ({ command, args, cwd, env, signal }) => {
      console.log(`Starting Claude Code through wrapper: ${wrapper}`);

      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(wrapper, [command, ...args], {
          cwd,
          env,
          signal,
          // stderr is piped rather than inherited: inheriting would bypass
          // show_full_output and hand the session a raw descriptor onto the log.
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (error) {
        // Bun reports some failures, a missing #! line among them, by throwing
        throw new Error(launchFailure(error));
      }

      // The others arrive as an event, which the SDK takes for a failure to
      // start pathToClaudeCodeExecutable, blaming that file.
      child.once("error", (error) => {
        if (child.pid === undefined) {
          core.error(launchFailure(error));
        }
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderrTail += chunk;
        if (stderrTail.length > STDERR_TAIL_MAX_CHARS) {
          stderrTail = stderrTail.slice(-STDERR_TAIL_MAX_CHARS);
          stderrTruncated = true;
        }
      });
      child.stderr.on("error", () => {});
      stderrClosed = once(child.stderr, "close");
      // Do not let a stderr that a grandchild still holds keep the action alive
      child.once("exit", () => {
        setTimeout(() => child.stderr.destroy(), STDERR_DRAIN_GRACE_MS).unref();
      });

      return child;
    },

    logStderrTail: async () => {
      // The SDK reports a failed exit at once, before stderr has been read out
      await Promise.race([stderrClosed, sleep(STDERR_DRAIN_GRACE_MS)]);
      const lines = redactSecrets(
        // The first word was cut off, and may be the rest of a credential
        stderrTruncated ? stderrTail.replace(/^\S+/, "") : stderrTail,
      )
        // The runner also reads the older "##[command]" form, anywhere in a line
        .replaceAll("##[", "## [")
        .split(/[\r\n]+/)
        .filter(Boolean);
      if (lines.length === 0) {
        return;
      }
      console.error(`Last output of ${INPUT_NAME} (${wrapper}) on stderr:`);
      if (stderrTruncated) {
        console.error(`${STDERR_LINE_PREFIX}(earlier output omitted)`);
      }
      for (const line of lines) {
        console.error(`${STDERR_LINE_PREFIX}${line}`);
      }
    },
  };
}

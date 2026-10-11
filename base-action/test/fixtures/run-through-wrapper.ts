#!/usr/bin/env bun

// Started as a process of its own by claude-code-wrapper.test.ts, so that it
// gets the real Agent SDK whatever other test files have mocked.
// Usage: bun run run-through-wrapper.ts <prompt file> <wrapper>

import { runClaude } from "../../src/run-claude";

const [promptPath, wrapper] = process.argv.slice(2);

try {
  await runClaude(promptPath!, {
    pathToClaudeCodeExecutable: "/nonexistent/claude",
    pathToClaudeCodeWrapper: wrapper,
    claudeArgs: `--append-system-prompt "two words and a 'quote'"`,
  });
  console.log("RESOLVED");
} catch (error) {
  console.log(`REJECTED: ${error}`);
  // Leave at once, as index.ts does: whatever is to reach the log must already
  // have been printed.
  process.exit(1);
}

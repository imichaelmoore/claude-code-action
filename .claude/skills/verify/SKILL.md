---
name: verify
description: Verify a change to this action by running src/entrypoints/run.ts against a simulated GitHub event in a throwaway repo.
---

# Verifying changes to the action

The surface is `src/entrypoints/run.ts` running inside a workflow step. Drive it
locally with a fake event, a fake origin, and a stub Claude executable that
records the working tree at the moment the CLI would start.

## Recipe

1. In a `mktemp -d` directory, set `HOME` to a subdirectory so git config and
   `~/.claude/settings.json` stay isolated.
2. Create a bare `origin.git`, push the base branch, push the head branch, then
   clone it and check out the head commit detached (what `actions/checkout`
   does).
3. `configureGitAuth` rewrites `origin` to
   `https://x-access-token:<token>@github.com/<owner>/<repo>.git`, so route it
   back to the fake origin:
   `git config --global url."file://$T/origin.git".insteadOf "https://x-access-token:faketoken@github.com/test-owner/test-repo.git"`
4. Write the event payload to a JSON file and a stub executable that dumps
   `.claude/settings.json`, `.mcp.json`, `CLAUDE.md`, `.claude-pr/` and
   `git status` to a log, then exits 1.
5. `touch $T/output` (`@actions/core` refuses a missing `GITHUB_OUTPUT`), then
   from the checkout run:

```bash
env -i PATH="$PATH" HOME="$HOME" \
  GITHUB_EVENT_NAME=<event> GITHUB_EVENT_PATH=$T/event.json \
  GITHUB_REPOSITORY=test-owner/test-repo GITHUB_ACTOR=<actor> \
  GITHUB_RUN_ID=1 GITHUB_SHA=<sha> GITHUB_REF=<ref> GITHUB_REF_NAME=<name> \
  GITHUB_ACTION_PATH=<repo> GITHUB_OUTPUT=$T/output RUNNER_TEMP=$T/runner \
  PROMPT="..." OVERRIDE_GITHUB_TOKEN=faketoken ANTHROPIC_API_KEY=fake \
  PATH_TO_CLAUDE_CODE_EXECUTABLE=$T/stub-claude \
  bun run <repo>/src/entrypoints/run.ts
```

`OVERRIDE_GITHUB_TOKEN` skips the OIDC exchange. The run ends with "Claude Code
process exited with code 1" from the stub; everything before that line, plus
the stub's log, is the evidence.

## Gotchas

- Any path that calls the GitHub API (write-permission checks, the Users API in
  `checkHumanActor`) fails with "Bad credentials" on the fake token. Pick an
  event and actor that avoid it, or treat reaching that call as the observation.
- To compare against the base, `git worktree add` `origin/main` elsewhere and
  symlink `node_modules` into it.

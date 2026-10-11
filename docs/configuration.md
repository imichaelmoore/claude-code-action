# Advanced Configuration

## Using Custom MCP Configuration

You can add custom MCP (Model Context Protocol) servers to extend Claude's capabilities using the `--mcp-config` flag in `claude_args`. These servers merge with the built-in GitHub MCP servers.

### Basic Example: Adding a Sequential Thinking Server

```yaml
- uses: anthropics/claude-code-action@v1
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    claude_args: |
      --mcp-config '{"mcpServers": {"sequential-thinking": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]}}}'
      --allowedTools mcp__sequential-thinking__sequentialthinking
    # ... other inputs
```

### Passing Secrets to MCP Servers

For MCP servers that require sensitive information like API keys or tokens, you can create a configuration file with GitHub Secrets:

```yaml
- name: Create MCP Config
  run: |
    cat > /tmp/mcp-config.json << 'EOF'
    {
      "mcpServers": {
        "custom-api-server": {
          "command": "npx",
          "args": ["-y", "@example/api-server"],
          "env": {
            "API_KEY": "${{ secrets.CUSTOM_API_KEY }}",
            "BASE_URL": "https://api.example.com"
          }
        }
      }
    }
    EOF

- uses: anthropics/claude-code-action@v1
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    claude_args: |
      --mcp-config /tmp/mcp-config.json
    # ... other inputs
```

### Using Python MCP Servers with uv

For Python-based MCP servers managed with `uv`, you need to specify the directory containing your server:

```yaml
- name: Create MCP Config for Python Server
  run: |
    cat > /tmp/mcp-config.json << 'EOF'
    {
      "mcpServers": {
        "my-python-server": {
          "type": "stdio",
          "command": "uv",
          "args": [
            "--directory",
            "${{ github.workspace }}/path/to/server/",
            "run",
            "server_file.py"
          ]
        }
      }
    }
    EOF

- uses: anthropics/claude-code-action@v1
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    claude_args: |
      --mcp-config /tmp/mcp-config.json
      --allowedTools my-python-server__<tool_name>  # Replace <tool_name> with your server's tool names
    # ... other inputs
```

For example, if your Python MCP server is at `mcp_servers/weather.py`, you would use:

```yaml
"args":
  ["--directory", "${{ github.workspace }}/mcp_servers/", "run", "weather.py"]
```

### Multiple MCP Servers

You can add multiple MCP servers by using multiple `--mcp-config` flags:

```yaml
- uses: anthropics/claude-code-action@v1
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    claude_args: |
      --mcp-config /tmp/config1.json
      --mcp-config /tmp/config2.json
      --mcp-config '{"mcpServers": {"inline-server": {"command": "npx", "args": ["@example/server"]}}}'
    # ... other inputs
```

**Important**:

- Always use GitHub Secrets (`${{ secrets.SECRET_NAME }}`) for sensitive values like API keys, tokens, or passwords. Never hardcode secrets directly in the workflow file.
- Your custom servers will override any built-in servers with the same name.
- The `claude_args` supports multiple `--mcp-config` flags that will be merged together.

## Additional Permissions for CI/CD Integration

The `additional_permissions` input allows Claude to access GitHub Actions workflow information when you grant the necessary permissions. This is particularly useful for analyzing CI/CD failures and debugging workflow issues.

### Enabling GitHub Actions Access

To allow Claude to view workflow run results, job logs, and CI status:

1. **Grant the necessary permission to your GitHub token**:

   - When using the default `GITHUB_TOKEN`, add the `actions: read` permission to your workflow:

   ```yaml
   permissions:
     contents: write
     pull-requests: write
     issues: write
     actions: read # Add this line
   ```

2. **Configure the action with additional permissions**:

   ```yaml
   - uses: anthropics/claude-code-action@v1
     with:
       anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
       additional_permissions: |
         actions: read
       # ... other inputs
   ```

3. **Claude will automatically get access to CI/CD tools**:
   When you enable `actions: read`, Claude can use the following MCP tools:
   - `mcp__github_ci__get_ci_status` - View workflow run statuses
   - `mcp__github_ci__get_workflow_run_details` - Get detailed workflow information
   - `mcp__github_ci__download_job_log` - Download and analyze job logs

### Example: Debugging Failed CI Runs

```yaml
name: Claude CI Helper
on:
  issue_comment:
    types: [created]

permissions:
  contents: write
  pull-requests: write
  issues: write
  actions: read # Required for CI access

jobs:
  claude-ci-helper:
    runs-on: ubuntu-latest
    steps:
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          additional_permissions: |
            actions: read
          # Now Claude can respond to "@claude why did the CI fail?"
```

**Important Notes**:

- The GitHub token must have the corresponding permission in your workflow
- If the permission is missing, Claude will warn you and suggest adding it
- The following additional permissions can be requested beyond the defaults:
  - `actions: read`
  - `checks: read`
  - `discussions: read` or `discussions: write`
  - `workflows: read` or `workflows: write`
- Standard permissions (`contents: write`, `pull_requests: write`, `issues: write`) are always included and do not need to be specified

## Custom Environment Variables

You can pass custom environment variables to Claude Code execution using the `settings` input. This is useful for CI/test setups that require specific environment variables:

```yaml
- uses: anthropics/claude-code-action@v1
  with:
    settings: |
      {
        "env": {
          "NODE_ENV": "test",
          "CI": "true",
          "DATABASE_URL": "postgres://test:test@localhost:5432/test_db"
        }
      }
    # ... other inputs
```

These environment variables will be available to Claude Code during execution, allowing it to run tests, build processes, or other commands that depend on specific environment configurations.

## Limiting Conversation Turns

You can limit the number of back-and-forth exchanges Claude can have during task execution using the `claude_args` input. This is useful for:

- Controlling costs by preventing runaway conversations
- Setting time boundaries for automated workflows
- Ensuring predictable behavior in CI/CD pipelines

```yaml
- uses: anthropics/claude-code-action@v1
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    claude_args: |
      --max-turns 5  # Limit to 5 conversation turns
    # ... other inputs
```

When the turn limit is reached, Claude will stop execution gracefully. Choose a value that gives Claude enough turns to complete typical tasks while preventing excessive usage.

## Custom Tools

By default, Claude only has access to:

- File operations (reading, committing, editing files, read-only git commands)
- Comment management (creating/updating comments)
- Basic GitHub operations

Claude does **not** have access to execute arbitrary Bash commands by default. If you want Claude to run specific commands (e.g., npm install, npm test), you must explicitly allow them using the `claude_args` configuration:

**Note**: If your repository has a `.mcp.json` file in the root directory, Claude will automatically detect and use the MCP server tools defined there. However, these tools still need to be explicitly allowed.

```yaml
- uses: anthropics/claude-code-action@v1
  with:
    claude_args: |
      --allowedTools "Bash(npm install),Bash(npm run test),Edit,Replace,NotebookEditCell"
      --disallowedTools "TaskOutput,KillTask"
    # ... other inputs
```

**Note**: The base GitHub tools are always included. Use `--allowedTools` to add additional tools (including specific Bash commands), and `--disallowedTools` to prevent specific tools from being used.

## Custom Model

Specify a Claude model using `claude_args`:

```yaml
- uses: anthropics/claude-code-action@v1
  with:
    claude_args: |
      --model claude-4-0-sonnet-20250805
    # ... other inputs
```

For provider-specific models:

```yaml
# AWS Bedrock
- uses: anthropics/claude-code-action@v1
  with:
    use_bedrock: "true"
    claude_args: |
      --model anthropic.claude-4-0-sonnet-20250805-v1:0
    # ... other inputs

# Google Vertex AI
- uses: anthropics/claude-code-action@v1
  with:
    use_vertex: "true"
    claude_args: |
      --model claude-4-0-sonnet@20250805
    # ... other inputs
```

### 1M context models through an API gateway

When `ANTHROPIC_BASE_URL` points to an Anthropic-compatible API gateway,
Claude Code may not be able to verify that the gateway supports a model's native
1M context window and can budget the session at 200K instead. Append the
`[1m]` selector to explicitly use the 1M context window for supported models,
including Claude Opus 5 and Claude Sonnet 5:

```yaml
- uses: anthropics/claude-code-action@v1
  with:
    claude_args: |
      --model "claude-opus-5[1m]"
    # ... other inputs
```

Use the same selector when setting a model through `ANTHROPIC_MODEL` or another
Claude Code model environment variable. The selector is resolved by Claude Code
before requests are sent to the provider. The action's sanitized result output
includes each model's resolved
`contextWindow` and `maxOutputTokens` under `modelUsage`, so these limits are
visible without enabling `show_full_output`.

## Claude Code Settings

You can provide Claude Code settings to customize behavior such as model selection, environment variables, permissions, and hooks. Settings can be provided either as a JSON string or a path to a settings file.

### Option 1: Settings File

```yaml
- uses: anthropics/claude-code-action@v1
  with:
    settings: "path/to/settings.json"
    # ... other inputs
```

### Option 2: Inline Settings

```yaml
- uses: anthropics/claude-code-action@v1
  with:
    settings: |
      {
        "model": "claude-opus-4-1-20250805",
        "env": {
          "DEBUG": "true",
          "API_URL": "https://api.example.com"
        },
        "permissions": {
          "allow": ["Bash", "Read"],
          "deny": ["WebFetch"]
        },
        "hooks": {
          "PreToolUse": [{
            "matcher": "Bash",
            "hooks": [{
              "type": "command",
              "command": "echo Running bash command..."
            }]
          }]
        }
      }
    # ... other inputs
```

The settings support all Claude Code settings options including:

- `model`: Override the default model
- `env`: Environment variables for the session
- `permissions`: Tool usage permissions
- `hooks`: Pre/post tool execution hooks
- And more...

For a complete list of available settings and their descriptions, see the [Claude Code settings documentation](https://docs.anthropic.com/en/docs/claude-code/settings).

**Notes**:

- The `enableAllProjectMcpServers` setting is always set to `true` by this action to ensure MCP servers work correctly.
- The `claude_args` input provides direct access to Claude Code CLI arguments and takes precedence over settings.
- We recommend using `claude_args` for simple configurations and `settings` for complex configurations with hooks and environment variables.

## Migration from Deprecated Inputs

Many individual input parameters have been consolidated into `claude_args` or `settings`. Here's how to migrate:

| Old Input             | New Approach                                                    |
| --------------------- | --------------------------------------------------------------- |
| `allowed_tools`       | Use `claude_args: "--allowedTools Tool1,Tool2"`                 |
| `disallowed_tools`    | Use `claude_args: "--disallowedTools Tool1,Tool2"`              |
| `max_turns`           | Use `claude_args: "--max-turns 10"`                             |
| `model`               | Use `claude_args: "--model claude-4-0-sonnet-20250805"`         |
| `claude_env`          | Use `settings` with `"env"` object                              |
| `custom_instructions` | Use `claude_args: "--append-system-prompt 'Your instructions'"` |
| `mcp_config`          | Use `claude_args: "--mcp-config '{...}'"`                       |
| `direct_prompt`       | Use `prompt` input instead                                      |
| `override_prompt`     | Use `prompt` with GitHub context variables                      |

## Custom Executables for Specialized Environments

For specialized environments like Nix, custom container setups, or other package management systems where the default installation doesn't work, you can provide your own executables:

### Custom Claude Code Executable

Use `path_to_claude_code_executable` to provide your own Claude Code binary instead of using the automatically installed version:

```yaml
- uses: anthropics/claude-code-action@v1
  with:
    path_to_claude_code_executable: "/path/to/custom/claude"
    # ... other inputs
```

### Custom Bun Executable

Use `path_to_bun_executable` to provide your own Bun runtime instead of the default installation:

```yaml
- uses: anthropics/claude-code-action@v1
  with:
    path_to_bun_executable: "/path/to/custom/bun"
    # ... other inputs
```

**Important**: Using incompatible versions may cause the action to fail. Ensure your custom executables are compatible with the action's requirements.

## Running Claude Code Inside a Sandbox (Launch Wrapper)

Set `path_to_claude_code_wrapper` to the absolute path of an executable that you provide, and the action starts the Claude Code session through it. The action installs Claude Code exactly as it always does and then runs

```
<wrapper> <command> <args...>
```

where `<command> <args...>` is, unchanged and in order, the command line the action would otherwise have started itself. A wrapper whose last line is `exec srt --settings FILE -- "$@"` therefore puts the whole Claude Code process inside [sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime) (`srt`). The action knows nothing about `srt` or any other sandbox, and the same input serves any other launcher.

```yaml
- uses: anthropics/claude-code-action@v1
  with:
    path_to_claude_code_wrapper: ${{ runner.temp }}/wrapper.sh
    # ... other inputs
```

The value is one path, not a command line. It is never split on spaces and never given to a shell. If your launcher needs arguments, put them in a short script and name the script. The path must be absolute, the file must exist and be executable when the action starts, and it must lie outside the workspace (symbolic links are followed once, at that moment, and the file they lead to is what is started); otherwise the step fails at once, on every run, with a message that says what is wrong. A wrapper that is a script needs a `#!` line, because no shell is there to interpret it. The input is not supported on Windows runners.

**How it differs from `path_to_claude_code_executable`.** That input replaces Claude Code: the action installs nothing, adds the executable's folder to `PATH`, and uses the executable for plugin installation as well. This input starts whichever Claude Code is in use. Installation stays as it is, the wrapper's folder is added to neither `PATH` nor `GITHUB_PATH`, and `claude` on `PATH` remains the real program. The two inputs can be combined, in which case the wrapper starts the custom executable, and `path_to_claude_code_executable` must then be an absolute path too.

**How it differs from Claude Code's other isolation features.** Claude Code's own [`sandbox` setting](https://docs.claude.com/en/docs/claude-code/sandboxing) covers the commands its Bash tool runs, not the Claude Code process itself. The subprocess isolation that the action switches on with `allowed_non_write_users` likewise concerns the processes Claude Code starts. A wrapper encloses Claude Code and everything below it.

### What Is Wrapped and What Is Not

| What                                                                                                  | Wrapped?            | Why                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The Claude Code session                                                                               | Yes                 | It is the point of the feature.                                                                                                                                                        |
| Everything Claude Code starts: tools, hooks and MCP servers, including the action's own `bun` servers | Yes, as descendants | They are children of the wrapped process. A sandbox must therefore allow what they need.                                                                                               |
| `claude plugin marketplace add` and `claude plugin install`                                           | No                  | They run before the session, fetch from the network and write under `~/.claude`. A sandbox tight enough for a session would break them. What they install comes from inputs you wrote. |
| Installing Claude Code                                                                                | No                  | It happens before there is anything to wrap.                                                                                                                                           |
| The action's own process and the job's other steps                                                    | No                  | They are the action. Its process holds the GitHub token and, with workload identity federation, keeps refreshing the identity token for as long as the session runs.                   |

### What a Wrapper May Rely On and Must Do

- **Arguments.** `"$@"` is the command line to start: `$1` is the program and the rest are its arguments. Usually `$1` is the absolute path of the Claude Code the action installed. With a custom executable that is a `.js` or `.ts` file, `$1` is the runtime (`bun`) and the file comes second, so end the wrapper in `exec "$@"` or an equivalent and do not assume that `$1` is Claude Code. Treat the arguments as opaque and as secret, and do not print them: they can hold the GitHub token.
- **Environment.** The wrapper receives the environment the action built for the session: the Claude API credential, in this action also `GITHUB_TOKEN`, `GH_TOKEN`, `OVERRIDE_GITHUB_TOKEN` and `DEFAULT_WORKFLOW_TOKEN`, and whatever the runner and your workflow put there. The wrapper is the place to `unset` what the session should not see.
- **Standard streams.** stdin and stdout are the action's channel to Claude Code, which carries one JSON message per line. The wrapper reads nothing from stdin and writes nothing to stdout. Diagnostics go to stderr. The action keeps the last 4,096 characters of stderr. If the session ends without a result message from Claude Code, for instance because the sandbox could not start, it prints them with well-known credential formats redacted and each line behind the prefix `[claude stderr] `. Otherwise stderr does not reach the log.
- **Working directory.** The wrapper starts where the session would have started: the workspace, or `CLAUDE_WORKING_DIR` in the base action. Claude Code treats its working directory as the project, so a wrapper that changes directory has to change back before it starts the command.
- **Ending.** Best is to `exec` the command. A wrapper that stays alive as a parent must pass on `SIGTERM` and `SIGINT` and exit with the child's status, because signals reach the wrapper's process alone. When the session is over the action closes stdin, sends `SIGTERM` 2 seconds later and `SIGKILL` 5 seconds after that. If the action's own process finishes first, `SIGTERM` comes at once and nothing waits, so a wrapper cannot count on time for clean-up.
- **Exit status.** Success is judged from the result message Claude Code sends. The wrapper's exit status matters only when it exits before that message has arrived.
- **Argument size.** The prompt and the system prompt travel over stdin, so the command line is short unless `claude_args`, an inline `--mcp-config` or a `--json-schema` is long. Linux limits a single argument to 128 KiB, and a launcher that folds all arguments into one string, as `srt` does, has that limit for the sum of them.
- **Trust.** The wrapper runs with the step's full environment before any sandbox exists. It must come from a place you control: written by an earlier step into `$RUNNER_TEMP`, or baked into the runner's image. It must not be a file in a checkout of a pull request's head, which the author of that pull request controls. For that reason the action refuses a path inside the workspace: whoever controls the checked-out branch controls the file, and when `@claude` is mentioned on a pull request the action itself checks out that pull request's branch before it starts the wrapper. To use a wrapper that is kept in a repository you trust, copy it to `$RUNNER_TEMP` in a step that runs while the trusted branch is checked out.

### Example: sandbox-runtime (srt)

This is a complete job for agent mode with an API key on a GitHub-hosted Ubuntu runner. Paste it, see it work, and then tighten the settings.

```yaml
jobs:
  claude:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write # for the action's GitHub App token, as in the other examples
    steps:
      - uses: actions/checkout@v6

      - name: Set up sandbox-runtime
        run: |
          sudo apt-get update -qq
          sudo apt-get install -y --no-install-recommends bubblewrap socat ripgrep
          # Ubuntu 24.04 and later: see "The kernel setting" below.
          if [ -f /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]; then
            sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
          fi

          S="$RUNNER_TEMP/sandbox"
          npm install --global --prefix "$S/srt" --ignore-scripts \
            @anthropic-ai/sandbox-runtime@0.0.75

          # srt skips paths that do not exist when it starts, so create them now.
          mkdir -p "$S/empty" "$S/tmp" "$HOME/.claude"
          [ -f "$HOME/.claude.json" ] || echo '{}' > "$HOME/.claude.json"

          jq -n --arg workspace "$GITHUB_WORKSPACE" --arg home "$HOME" --arg s "$S" '{
            network: { allowedDomains: ["api.anthropic.com"], deniedDomains: [] },
            filesystem: {
              denyRead: [],
              allowWrite: [$workspace, "\($home)/.claude", "\($home)/.claude.json", "\($s)/tmp"],
              denyWrite: []
            }
          }' > "$S/settings.json"

          cat > "$S/claude-in-srt.sh" <<'EOF'
          #!/bin/sh
          # Starts "$@", which is Claude Code and its arguments, inside sandbox-runtime.
          S="$RUNNER_TEMP/sandbox"
          project=$PWD
          # srt hands its whole environment to the command: drop what the session should not see.
          unset ACTIONS_RUNTIME_TOKEN DEFAULT_WORKFLOW_TOKEN GH_TOKEN GITHUB_TOKEN OVERRIDE_GITHUB_TOKEN
          # srt points TMPDIR inside the sandbox at this folder, which the settings make writable.
          export CLAUDE_CODE_TMPDIR="$S/tmp"
          # Launch srt from an empty folder, so that its placeholder files do not appear in the checkout.
          cd "$S/empty" || exit 1
          exec "$S/srt/bin/srt" --settings "$S/settings.json" -- \
            sh -c 'cd "$1" && shift && exec "$@"' sh "$project" "$@"
          EOF
          chmod +x "$S/claude-in-srt.sh"

      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          prompt: "Summarize what this repository does in README-SUMMARY.md"
          claude_args: "--permission-mode acceptEdits"
          path_to_claude_code_wrapper: ${{ runner.temp }}/sandbox/claude-in-srt.sh
```

The statements about `srt` in the rest of this section hold as of version 0.0.75.

- **How srt is called.** The form is `srt --settings FILE -- COMMAND ARGS...`. The `--` is not optional here: `srt` has options of its own named `--settings`, `--debug`, `--control-fd`, `-d`, `-s` and `-c`, and Claude Code's arguments include flags with the same names. A settings file that was named explicitly and cannot be loaded stops `srt` with an error; it does not fall back to defaults.
- **Pin the version.** `srt` describes itself as a beta research preview whose configuration format may change. If you move to a newer version, check the points below against it.
- **System packages.** On Linux, `srt` needs `bubblewrap`, `socat` and `ripgrep`, and Node 20.11 or newer. This action does not set up Node. The base action does: it puts Node 18 ahead of the runner's own for the rest of the job unless the `NODE_VERSION` environment variable says otherwise, and `srt` starts through `#!/usr/bin/env node`. With the base action, set `NODE_VERSION: "22.x"` or call `srt` with a Node of your choosing.
- **The kernel setting.** Ubuntu 24.04 and later enable `kernel.apparmor_restrict_unprivileged_userns`, under which an unprivileged user namespace loses its capabilities, and both bubblewrap and `srt`'s seccomp helper need them. Setting it to 0 needs `sudo` and switches that hardening off for every process on the machine until it reboots. A GitHub-hosted runner is thrown away after the job. On a self-hosted runner it is a lasting change to a shared machine, and the alternative that `srt`'s README describes, an AppArmor profile that grants `userns` to the programs concerned, is the better choice.
- **The network list.** A session on the Claude API uses `api.anthropic.com` for model calls, for the safety check of `--permission-mode auto` and, with workload identity federation, for the token exchange. Claude Code also tries to send telemetry to other hosts; the sandbox refuses those, and the session is not affected. Bedrock, Vertex AI and Foundry need their own model hosts, and possibly sign-in hosts that Claude Code contacts during the session, so the list depends on your provider.
- **What the session must be able to write.** The workspace, if Claude is to edit files. `~/.claude`, which holds session records, settings and plugins. `~/.claude.json`. A temporary folder: `srt` sets `TMPDIR` for the command to `$CLAUDE_CODE_TMPDIR`, else `$CLAUDE_TMPDIR`, else `/tmp/claude`, and that last default is writable only if it exists when `srt` starts. With workload identity federation also `$RUNNER_TEMP/claude-workload-identity`: the action writes the identity token and a profile there and refreshes the token every four minutes, and Claude Code keeps its cache of the exchanged credential there. The session has to be able to read the folder. It completes without write access too, but then nothing is cached, and GitHub's identity token can be exchanged only once. The action creates that folder before it starts the wrapper, so it exists when `srt` starts.
- **What the session must be able to read.** By default `srt` lets the command read everything the user can read, so the example needs no read rules. If you hide folders with `denyRead`, give back with `allowRead` whatever the session needs that no write rule already covers: Claude Code's own installation under `~/.local`, `srt`'s own installation (its seccomp helper is run inside the sandbox by absolute path), the folder `srt` was launched from, and the federation folder.

### Caveats

About the boundary, whichever sandbox you use:

- The sandbox covers the session and its descendants. It does not cover the action's own process, which runs beside the session for as long as it lasts and holds the GitHub token; nor the plugin installation calls; nor any later step of the job. Files the session wrote in the workspace are still there when later steps run, so a later step that executes something from the workspace executes it outside the sandbox.
- Taking the token's variables out of the environment does not remove the token from the session altogether. It is also in the `--mcp-config` argument whenever one of the action's MCP servers is configured, and in the checkout's `origin` URL in `.git/config`. With `allowed_non_write_users` a credential helper reads `GH_TOKEN` instead.
- The action's MCP servers, `git push` and `gh` run inside the sandbox, because Claude Code starts them. Tag mode therefore needs at least `api.github.com` and `github.com` allowed, read access to Bun and to the action's own folder (`$GITHUB_ACTION_PATH`), the token left in place, and write access to what those servers write outside the workspace: `/tmp/inline-comments-buffer.jsonl`, which a later step of the action reads on the host to post inline comments, and `$RUNNER_TEMP/github-ci-logs`, where the CI server saves downloaded logs. The Docker-based `github` MCP server needs the Docker socket, which `srt` blocks by default, and opening it would undo the sandbox.
- An allow list of one host does not close the network. By default `srt`'s proxy decides by host name and port and does not look inside the connection (an experimental `network.tlsTerminate` setting can); its README names domain fronting and warns about broad hosts. Whatever the allowed host's API lets a client do, the session can do.

About `srt` in particular:

- It hands its whole environment to the command. Unset variables in the wrapper, or use the `credentials` block of its settings.
- Its built-in protection of certain names (`.gitconfig`, `.mcp.json`, `.claude/commands`, `.git/hooks`, `.git/config` and others, listed in its README under "Mandatory Deny Paths") is tied to the folder it is launched from. For a protected name that does not exist and lies inside an `allowWrite` path, it mounts `/dev/null` or an empty folder in its place, which leaves an empty file or folder on the host until the command ends. If `srt` is launched from the checkout, these show up as untracked files in `git status`. Hence the example launches `srt` from an empty folder and changes directory inside. The price is that the built-in protection then does not cover the checkout, so add `denyWrite` entries for whatever in it you care about.
- A folder hidden with `denyRead` becomes an empty, writable, in-memory folder inside the sandbox. Writing there succeeds and the data is gone afterwards, so a missing write rule can look like success.
- An `allowWrite`, `allowRead` or `denyRead` path that does not exist when `srt` starts is skipped, and Linux supports no glob patterns. `srt` reports a skipped path only when `SRT_DEBUG` is set or `--debug` is given. Create folders first, use absolute literal paths, and run once with `SRT_DEBUG=true` while setting up.
- `~/.claude.json` is a single file, which the sandbox mounts in place, and a program that saves by writing a new file and renaming it over the old one cannot replace a mount point. In a trial with Claude Code 2.1.289 the file was left as it was and the session carried on regardless. Do not count on changes to that file surviving the session.
- `srt`'s seccomp helper could not start when `srt` was run as root in a container. GitHub-hosted runners run steps as an unprivileged user, where it starts.

Whether Claude Code's own bubblewrap-based features (its `sandbox` setting and the subprocess isolation mentioned above) work when Claude Code is itself inside `srt` has not been established.

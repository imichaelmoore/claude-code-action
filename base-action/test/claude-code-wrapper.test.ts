#!/usr/bin/env bun

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as core from "@actions/core";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  createClaudeCodeWrapper,
  validateClaudeCodeWrapper,
} from "../src/claude-code-wrapper";

let tempDir: string | undefined;

async function makeTempDir(): Promise<string> {
  // realpath, because $PWD in a child is the resolved path (macOS links /tmp)
  tempDir = await realpath(await mkdtemp(join(tmpdir(), "claude-wrapper-")));
  return tempDir;
}

async function makeWrapper(dir: string, script = "#!/bin/sh\n") {
  const path = join(dir, "wrapper.sh");
  await writeFile(path, script);
  await chmod(path, 0o755);
  return path;
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("validateClaudeCodeWrapper", () => {
  test("should treat an empty or missing value as off", () => {
    expect(validateClaudeCodeWrapper("", undefined)).toBeUndefined();
    expect(validateClaudeCodeWrapper(undefined, undefined)).toBeUndefined();
    expect(validateClaudeCodeWrapper("", "relative/claude")).toBeUndefined();
    expect(validateClaudeCodeWrapper("", undefined, "win32")).toBeUndefined();
  });

  test("should accept an executable file and a link to one", async () => {
    const dir = await makeTempDir();
    const wrapper = await makeWrapper(dir);
    const link = join(dir, "link");
    await symlink(wrapper, link);

    expect(validateClaudeCodeWrapper(wrapper, "")).toBe(wrapper);
    // The link is followed now, so that changing it later changes nothing
    expect(validateClaudeCodeWrapper(link, undefined)).toBe(wrapper);
  });

  test("should refuse any value on Windows", async () => {
    const wrapper = await makeWrapper(await makeTempDir());
    expect(() =>
      validateClaudeCodeWrapper(wrapper, undefined, "win32"),
    ).toThrow("path_to_claude_code_wrapper is not supported on Windows");
  });

  test("should refuse control characters without echoing the value", async () => {
    const wrapper = await makeWrapper(await makeTempDir());
    expect(() => validateClaudeCodeWrapper(`${wrapper}\n`, undefined)).toThrow(
      /^path_to_claude_code_wrapper contains control characters[^/]*$/,
    );
  });

  test("should refuse a relative path", () => {
    expect(() => validateClaudeCodeWrapper("./wrapper.sh", undefined)).toThrow(
      "path_to_claude_code_wrapper must be an absolute path",
    );
  });

  test("should refuse a missing file, a folder and a file without the execute bit", async () => {
    const dir = await makeTempDir();
    const notExecutable = join(dir, "plain.sh");
    await writeFile(notExecutable, "#!/bin/sh\n");

    for (const path of [join(dir, "missing.sh"), dir, notExecutable]) {
      expect(() => validateClaudeCodeWrapper(path, undefined)).toThrow(
        "path_to_claude_code_wrapper must point to an existing executable file",
      );
    }
  });

  test("should refuse a wrapper inside the workspace, links followed", async () => {
    const originalWorkspace = process.env.GITHUB_WORKSPACE;
    try {
      const dir = await makeTempDir();
      const workspace = join(dir, "workspace");
      await mkdir(workspace);
      await mkdir(join(dir, "workspace-sibling"));
      process.env.GITHUB_WORKSPACE = workspace;
      const inside = await makeWrapper(workspace);
      const link = join(dir, "link");
      await symlink(inside, link);
      const sibling = await makeWrapper(join(dir, "workspace-sibling"));
      const linkInside = join(workspace, "link");
      await symlink(sibling, linkInside);

      for (const path of [inside, link]) {
        expect(() => validateClaudeCodeWrapper(path, undefined)).toThrow(
          "path_to_claude_code_wrapper must not point into the workspace",
        );
      }
      expect(validateClaudeCodeWrapper(sibling, undefined)).toBe(sibling);
      // Harmless: what will be started is the file outside, not the link
      expect(validateClaudeCodeWrapper(linkInside, undefined)).toBe(sibling);
    } finally {
      if (originalWorkspace === undefined) {
        delete process.env.GITHUB_WORKSPACE;
      } else {
        process.env.GITHUB_WORKSPACE = originalWorkspace;
      }
    }
  });

  test("should refuse a relative custom executable beside a wrapper", async () => {
    const wrapper = await makeWrapper(await makeTempDir());
    expect(() => validateClaudeCodeWrapper(wrapper, "bin/claude")).toThrow(
      "path_to_claude_code_executable must be an absolute path when path_to_claude_code_wrapper is set",
    );
    expect(validateClaudeCodeWrapper(wrapper, "/opt/claude")).toBe(wrapper);
  });
});

describe("createClaudeCodeWrapper", () => {
  test("should name the input when the wrapper cannot be started", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = spyOn(core, "error").mockImplementation(() => {});
    try {
      const path = await makeWrapper(
        await makeTempDir(),
        "#!/nonexistent/interpreter\n",
      );
      const wrapper = createClaudeCodeWrapper(path);
      const child = wrapper.spawn({
        command: "/x/claude",
        args: [],
        env: {},
        signal: new AbortController().signal,
      });
      await new Promise((resolve) => child.once("error", resolve));
      await wrapper.logStderrTail();

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0]![0]).toStartWith(
        `path_to_claude_code_wrapper (${path}) could not be started: `,
      );
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

// These start the real Agent SDK with a real process in the wrapper's place, so
// that an SDK bump that changes what the hook receives, or when, is noticed.
// They need neither a network nor Claude Code.
describe("wrapper contract with the real Agent SDK", () => {
  const fixture = join(import.meta.dir, "fixtures", "run-through-wrapper.ts");

  const resultMessage =
    '{"type":"result","subtype":"success","is_error":false,"num_turns":1,"result":"ok","session_id":"s","duration_ms":1,"duration_api_ms":1,"total_cost_usd":0}';

  async function runFixture(wrapperScript: string) {
    const dir = await makeTempDir();
    const cwd = join(dir, "project dir");
    await mkdir(cwd);
    const promptPath = join(dir, "prompt.txt");
    await writeFile(promptPath, "test prompt");
    const wrapper = await makeWrapper(dir, wrapperScript);
    const recordPath = join(dir, "record");

    const result = Bun.spawnSync(
      [process.execPath, "run", fixture, promptPath, wrapper],
      {
        cwd,
        env: {
          ...process.env,
          RUNNER_TEMP: dir,
          WRAPPER_TEST_RECORD: recordPath,
          WRAPPER_TEST_VARIABLE: "from the action",
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: "must not reach the wrapper",
        },
        stdout: "pipe",
        stderr: "pipe",
        timeout: 30_000,
      },
    );
    const stderrLines = result.stderr.toString().split("\n");
    return {
      cwd,
      recordPath,
      exitCode: result.exitCode,
      stdout: result.stdout.toString(),
      stderrLines,
      tail: stderrLines.filter((line) => line.startsWith("[claude stderr] ")),
    };
  }

  test("should hand the wrapper the SDK's command line, directory and environment", async () => {
    const run = await runFixture(`#!/bin/sh
{
  printf '%s\\n' "$PWD"
  printf '%s\\n' "$WRAPPER_TEST_VARIABLE"
  printf '%s\\n' "\${ACTIONS_ID_TOKEN_REQUEST_TOKEN-unset}"
  printf '%s\\n' "$@"
} > "$WRAPPER_TEST_RECORD"
exit 3
`);

    expect(run.stdout).toContain("Starting Claude Code through wrapper: ");
    expect(run.stdout).toMatch(/REJECTED: .*exited with code 3/);
    expect(run.exitCode).toBe(1);

    const record = (await readFile(run.recordPath, "utf-8")).split("\n");
    expect(record.slice(0, 6)).toEqual([
      run.cwd,
      "from the action",
      "unset",
      "/nonexistent/claude",
      "--output-format",
      "stream-json",
    ]);
    // An argument with spaces and quotes arrives whole
    expect(record).toContain("two words and a 'quote'");
  });

  test("should log why the wrapper failed, with commands defused and credentials redacted", async () => {
    const run = await runFixture(`#!/bin/sh
echo boom >&2
echo "::error::boom" >&2
echo "x ##[set-output name=a]b" >&2
echo "token ghp_${"a".repeat(36)}" >&2
exit 3
`);

    expect(run.tail).toEqual([
      "[claude stderr] boom",
      "[claude stderr] ::error::boom",
      "[claude stderr] x ## [set-output name=a]b",
      "[claude stderr] token [REDACTED_GITHUB_TOKEN]",
    ]);
    expect(run.stderrLines.some((line) => line.startsWith("::"))).toBe(false);
  });

  test("should survive a wrapper that writes a great deal to stderr", async () => {
    const run = await runFixture(`#!/bin/sh
i=0
while [ $i -lt 16384 ]; do
  echo "line $i 012345678901234567890123456789012345678901234567890123"
  i=$((i+1))
done >&2
echo "the reason" >&2
exit 3
`);

    expect(run.stdout).toContain("exited with code 3");
    expect(run.tail[0]).toBe("[claude stderr] (earlier output omitted)");
    expect(run.tail.at(-1)).toBe("[claude stderr] the reason");
    expect(run.tail.join("\n").length).toBeLessThan(6000);
  });

  test("should not print the rest of a credential that the bound cut in two", async () => {
    const run = await runFixture(`#!/bin/sh
printf 'ghp_${"a".repeat(36)}${".".repeat(4066)} end' >&2
exit 3
`);

    expect(run.tail).toEqual([
      "[claude stderr] (earlier output omitted)",
      "[claude stderr]  end",
    ]);
  });

  test("should not wait for a stray process that keeps stderr open", async () => {
    const stray = "sleep 20 < /dev/null > /dev/null &";
    const start = Date.now();
    const failed = await runFixture(`#!/bin/sh
echo "the reason" >&2
${stray}
exit 3
`);
    // Here nothing calls process.exit(), so an open pipe would hold the process
    const succeeded = await runFixture(`#!/bin/sh
${stray}
echo '${resultMessage}'
`);

    expect(failed.tail).toEqual(["[claude stderr] the reason"]);
    expect(succeeded.stdout).toContain("RESOLVED");
    expect(Date.now() - start).toBeLessThan(10_000);
  }, 60_000);

  test("should judge the session by its result message, not by how the wrapper ends", async () => {
    const run = await runFixture(`#!/bin/sh
echo noise >&2
echo '${resultMessage}'
cat > /dev/null
exit 1
`);

    expect(run.stdout).toContain("RESOLVED");
    expect(run.exitCode).toBe(0);
    expect(run.stderrLines.join("\n")).not.toContain("noise");
  });

  test("should log why a wrapper ended cleanly without a session", async () => {
    const run = await runFixture(`#!/bin/sh
echo "forgot to start the command" >&2
exit 0
`);

    expect(run.stdout).toContain("REJECTED: ");
    expect(run.tail).toEqual(["[claude stderr] forgot to start the command"]);
  });
});

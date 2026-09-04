import type { ExecResult, ProcessRunner } from "../process-runner";

interface ScriptedResponse {
  command: string;
  result: ExecResult;
  /** Lines delivered via onStdout before the result resolves. */
  stdoutLines?: string[];
  /** Lines delivered via onStderr before the result resolves. */
  stderrLines?: string[];
}

/**
 * A scripted fake for the ProcessRunner seam.
 * Responses are consumed from a queue in arrival order per command name.
 * Any unscripted command throws ENOENT (simulating a missing binary).
 */
export function createFakeRunner(responses: ScriptedResponse[]): ProcessRunner {
  const queue = [...responses];

  return {
    async exec(command, _args, options) {
      const idx = queue.findIndex((r) => r.command === command);
      if (idx === -1) {
        throw Object.assign(new Error(`spawn ${command} ENOENT`), {
          code: "ENOENT",
        });
      }

      const [response] = queue.splice(idx, 1);
      const entry = response!;

      if (entry.stdoutLines && options?.onStdout) {
        for (const line of entry.stdoutLines) {
          options.onStdout(line);
        }
      }

      if (entry.stderrLines && options?.onStderr) {
        for (const line of entry.stderrLines) {
          options.onStderr(line);
        }
      }

      return entry.result;
    },
  };
}

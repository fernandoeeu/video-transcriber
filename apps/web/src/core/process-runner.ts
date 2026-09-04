import { spawn } from "node:child_process";

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Single test seam for all CLI invocations (yt-dlp, whisper-cli, ffmpeg).
 * Production: spawns a real child process.
 * Tests: substitute a scripted fake.
 */
export interface ProcessRunner {
  exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult>;
}

export function createProcessRunner(): ProcessRunner {
  return {
    exec(command, args, options = {}) {
      return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
          cwd: options.cwd,
          env: options.env ? { ...process.env, ...options.env } : undefined,
        });

        const stdoutChunks: string[] = [];
        const stderrChunks: string[] = [];

        child.stdout.on("data", (data: Buffer) => {
          const text = data.toString();
          stdoutChunks.push(text);
          if (options.onStdout) {
            for (const line of text.split("\n").filter(Boolean)) {
              options.onStdout(line);
            }
          }
        });

        child.stderr.on("data", (data: Buffer) => {
          const text = data.toString();
          stderrChunks.push(text);
          if (options.onStderr) {
            for (const line of text.split("\n").filter(Boolean)) {
              options.onStderr(line);
            }
          }
        });

        child.on("error", reject);

        child.on("close", (code) => {
          resolve({
            exitCode: code ?? 1,
            stdout: stdoutChunks.join(""),
            stderr: stderrChunks.join(""),
          });
        });
      });
    },
  };
}

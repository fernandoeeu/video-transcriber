import { existsSync } from "node:fs";
import type { ProcessRunner } from "./process-runner";

export interface Dependency {
  name: string;
  status: "ok" | "missing";
  version?: string;
  installHint: string;
}

export interface DependencyReport {
  ok: boolean;
  dependencies: Dependency[];
}

interface CliDependency {
  name: string;
  command: string;
  versionArgs: string[];
  parseVersion: (stdout: string, stderr: string) => string;
  installHint: string;
}

const CLI_DEPENDENCIES: CliDependency[] = [
  {
    name: "yt-dlp",
    command: "yt-dlp",
    versionArgs: ["--version"],
    parseVersion: (stdout) => stdout.trim(),
    installHint: "brew install yt-dlp",
  },
  {
    name: "whisper-cli",
    command: "whisper-cli",
    versionArgs: ["--version"],
    parseVersion: (stdout) => {
      // whisper-cli prints "whisper.cpp version: X.Y.Z" on stdout;
      // stderr carries noisy backend-loading lines we ignore.
      const match = stdout.match(/whisper\.cpp\s+(?:version[:\s]*)?v?([\d.]+)/i);
      return match?.[1] ?? "unknown";
    },
    installHint: "brew install whisper-cpp",
  },
  {
    name: "ffmpeg",
    command: "ffmpeg",
    versionArgs: ["-version"],
    parseVersion: (stdout) => {
      const match = stdout.match(/ffmpeg version (\S+)/);
      return match?.[1] ?? "unknown";
    },
    installHint: "brew install ffmpeg",
  },
];

const MODEL_PATH = "data/models/ggml-large-v3-turbo.bin";
const MODEL_INSTALL_HINT =
  "Download the model: whisper-cli --model large-v3-turbo --download-model";

export async function checkDependencies(
  runner: ProcessRunner,
  projectRoot: string,
): Promise<DependencyReport> {
  const results = await Promise.all(CLI_DEPENDENCIES.map((dep) => checkCli(runner, dep)));

  results.push(checkModelFile(projectRoot));

  return {
    ok: results.every((d) => d.status === "ok"),
    dependencies: results,
  };
}

async function checkCli(runner: ProcessRunner, dep: CliDependency): Promise<Dependency> {
  try {
    const result = await runner.exec(dep.command, dep.versionArgs);
    if (result.exitCode === 0 || result.stdout.trim() || result.stderr.trim()) {
      return {
        name: dep.name,
        status: "ok",
        version: dep.parseVersion(result.stdout, result.stderr),
        installHint: dep.installHint,
      };
    }
    return { name: dep.name, status: "missing", installHint: dep.installHint };
  } catch {
    return { name: dep.name, status: "missing", installHint: dep.installHint };
  }
}

function checkModelFile(projectRoot: string): Dependency {
  const fullPath = `${projectRoot}/${MODEL_PATH}`;
  if (existsSync(fullPath)) {
    return {
      name: "whisper model (large-v3-turbo)",
      status: "ok",
      installHint: MODEL_INSTALL_HINT,
    };
  }
  return {
    name: "whisper model (large-v3-turbo)",
    status: "missing",
    installHint: MODEL_INSTALL_HINT,
  };
}

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkDependencies } from "../dependencies";
import { createFakeRunner } from "./fake-process-runner";

describe("checkDependencies", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "vt-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("reports all dependencies as ok when every tool is present and the model file exists", async () => {
    // Create model file in temp project root
    const modelDir = join(tempDir, "data", "models");
    mkdirSync(modelDir, { recursive: true });
    writeFileSync(join(modelDir, "ggml-large-v3-turbo.bin"), "fake-model");

    const runner = createFakeRunner([
      {
        command: "yt-dlp",
        result: { exitCode: 0, stdout: "2026.07.04\n", stderr: "" },
      },
      {
        command: "whisper-cli",
        result: {
          exitCode: 0,
          stdout: "whisper.cpp version: 1.9.1\n",
          stderr:
            "load_backend: loaded BLAS backend from /opt/homebrew/Cellar/ggml/0.17.0/libexec/libggml-blas.so\n",
        },
      },
      {
        command: "ffmpeg",
        result: {
          exitCode: 0,
          stdout: "ffmpeg version 7.1.1 Copyright (c) 2000-2025\n",
          stderr: "",
        },
      },
    ]);

    const report = await checkDependencies(runner, tempDir);

    expect(report.ok).toBe(true);
    expect(report.dependencies).toHaveLength(4);

    const ytdlp = report.dependencies.find((d) => d.name === "yt-dlp");
    expect(ytdlp?.status).toBe("ok");
    expect(ytdlp?.version).toBe("2026.07.04");

    const whisper = report.dependencies.find((d) => d.name === "whisper-cli");
    expect(whisper?.status).toBe("ok");
    expect(whisper?.version).toBe("1.9.1");

    const ffmpeg = report.dependencies.find((d) => d.name === "ffmpeg");
    expect(ffmpeg?.status).toBe("ok");
    expect(ffmpeg?.version).toBe("7.1.1");

    const model = report.dependencies.find((d) => d.name.includes("whisper model"));
    expect(model?.status).toBe("ok");
  });

  it("reports missing CLIs and missing model file", async () => {
    // No model file in temp dir, and only ffmpeg available
    const runner = createFakeRunner([
      {
        command: "ffmpeg",
        result: {
          exitCode: 0,
          stdout: "ffmpeg version 7.1.1 Copyright (c) 2000-2025\n",
          stderr: "",
        },
      },
      // yt-dlp and whisper-cli not scripted → ENOENT
    ]);

    const report = await checkDependencies(runner, tempDir);

    expect(report.ok).toBe(false);

    const ytdlp = report.dependencies.find((d) => d.name === "yt-dlp");
    expect(ytdlp?.status).toBe("missing");
    expect(ytdlp?.installHint).toBe("brew install yt-dlp");

    const whisper = report.dependencies.find((d) => d.name === "whisper-cli");
    expect(whisper?.status).toBe("missing");
    expect(whisper?.installHint).toBe("brew install whisper-cpp");

    const ffmpeg = report.dependencies.find((d) => d.name === "ffmpeg");
    expect(ffmpeg?.status).toBe("ok");

    const model = report.dependencies.find((d) => d.name.includes("whisper model"));
    expect(model?.status).toBe("missing");
    expect(model?.installHint).toContain("download");
  });

  it("reports a single missing dependency among otherwise-present ones", async () => {
    // Model file exists but whisper-cli is missing
    const modelDir = join(tempDir, "data", "models");
    mkdirSync(modelDir, { recursive: true });
    writeFileSync(join(modelDir, "ggml-large-v3-turbo.bin"), "fake-model");

    const runner = createFakeRunner([
      {
        command: "yt-dlp",
        result: { exitCode: 0, stdout: "2026.07.04\n", stderr: "" },
      },
      // whisper-cli missing
      {
        command: "ffmpeg",
        result: {
          exitCode: 0,
          stdout: "ffmpeg version 7.1.1 Copyright (c) 2000-2025\n",
          stderr: "",
        },
      },
    ]);

    const report = await checkDependencies(runner, tempDir);

    expect(report.ok).toBe(false);

    const missing = report.dependencies.filter((d) => d.status === "missing");
    expect(missing).toHaveLength(1);
    expect(missing[0]?.name).toBe("whisper-cli");
  });
});

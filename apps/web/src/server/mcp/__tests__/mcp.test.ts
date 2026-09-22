import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import * as schema from "@video-transcriber/db/schema";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeRunner } from "../../../core/__tests__/fake-process-runner";
import { createTestDb } from "../../../core/__tests__/test-db";
import { createTranscriptionQueue } from "../../../core/transcription";
import { createVideoTranscriberMcpServer } from "../create-server";
import { handleMcpRequest } from "../http";

const SAMPLE_METADATA = {
  title: "How to Build a Transcriber",
  duration: 754,
  channel: "Dev Channel",
  webpage_url: "https://www.youtube.com/watch?v=abc123",
};

const EXPECTED_TOOLS = [
  "preview_video",
  "list_videos",
  "get_video",
  "download_video",
  "redownload_video",
  "delete_video",
  "transcribe_video",
  "get_transcription",
  "list_transcriptions",
  "get_latest_transcription",
  "export_transcription_txt",
  "export_transcription_srt",
  "get_dependencies",
  "get_settings",
  "update_download_folder",
  "reset_download_folder",
] as const;

function parseToolJson(result: unknown) {
  if (
    !result ||
    typeof result !== "object" ||
    !("content" in result) ||
    !Array.isArray(result.content)
  ) {
    throw new Error("MCP tool result is missing content");
  }
  const block = result.content[0];
  if (
    !block ||
    typeof block !== "object" ||
    !("type" in block) ||
    block.type !== "text" ||
    !("text" in block) ||
    typeof block.text !== "string"
  ) {
    throw new Error("MCP tool result is missing text content");
  }
  return JSON.parse(block.text) as unknown;
}

async function readJsonRpc(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();
  if (contentType.includes("application/json")) {
    return JSON.parse(body) as Record<string, unknown>;
  }

  const dataLine = body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("data:"));
  if (!dataLine) {
    throw new Error(`No JSON-RPC payload in MCP response: ${body}`);
  }
  return JSON.parse(dataLine.slice("data:".length).trim()) as Record<string, unknown>;
}

describe("MCP tools", () => {
  let tempDir: string;
  let mediaDir: string;
  let db: LibSQLDatabase<typeof schema>;
  let client: Client | undefined;
  let server: McpServer | undefined;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "vt-mcp-test-"));
    mediaDir = join(tempDir, "media");
    const testDb = createTestDb(join(tempDir, "test.db"));
    db = testDb.db;
    await testDb.applySchema();
  });

  afterEach(async () => {
    await client?.close();
    await server?.close();
    client = undefined;
    server = undefined;
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function connect(runner = createFakeRunner([])) {
    const queue = createTranscriptionQueue();
    server = createVideoTranscriberMcpServer({
      db,
      runner,
      getQueue: async () => queue,
      getMediaDir: async () => mediaDir,
      defaultMediaDir: mediaDir,
      projectRoot: tempDir,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "mcp-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return { client };
  }

  async function waitForStatus(videoId: number, status: string) {
    // Background yt-dlp work is real async I/O (libsql), not a timer.
    await vi.waitFor(async () => {
      const video = parseToolJson(
        await client!.callTool({ name: "get_video", arguments: { videoId } }),
      );
      expect(video).toMatchObject({ status });
    });
  }

  it("advertises every download and transcription action", async () => {
    const { client: mcp } = await connect();
    const listed = await mcp.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([...EXPECTED_TOOLS]);
  });

  it("previews, downloads, transcribes, exports, and deletes a video", async () => {
    const url = "https://www.youtube.com/watch?v=abc123";
    const audioFile = join(mediaDir, "1", "audio.opus");
    const destLine = `[ExtractAudio] Destination: ${audioFile}`;
    const runner = createFakeRunner([
      {
        command: "yt-dlp",
        result: { exitCode: 0, stdout: JSON.stringify(SAMPLE_METADATA), stderr: "" },
      },
      {
        command: "yt-dlp",
        result: { exitCode: 0, stdout: "", stderr: destLine },
        stderrLines: [destLine],
      },
      {
        command: "yt-dlp",
        result: { exitCode: 0, stdout: "", stderr: destLine },
        stderrLines: [destLine],
      },
    ]);
    const { client: mcp } = await connect(runner);

    const preview = parseToolJson(
      await mcp.callTool({ name: "preview_video", arguments: { url } }),
    ) as { ok: boolean; video: { id: number; title: string; status: string } };
    expect(preview.ok).toBe(true);
    expect(preview.video.title).toBe("How to Build a Transcriber");
    expect(preview.video.status).toBe("ready_to_download");
    const videoId = preview.video.id;

    const listed = parseToolJson(
      await mcp.callTool({ name: "list_videos", arguments: {} }),
    ) as Array<{
      id: number;
    }>;
    expect(listed.map((video) => video.id)).toEqual([videoId]);

    const fetched = parseToolJson(
      await mcp.callTool({ name: "get_video", arguments: { videoId } }),
    ) as { id: number; title: string };
    expect(fetched.id).toBe(videoId);
    expect(fetched.title).toBe("How to Build a Transcriber");

    const downloading = parseToolJson(
      await mcp.callTool({ name: "download_video", arguments: { videoId } }),
    ) as { status: string };
    expect(downloading.status).toBe("downloading");
    await waitForStatus(videoId, "downloaded");

    const redownloading = parseToolJson(
      await mcp.callTool({ name: "redownload_video", arguments: { videoId } }),
    ) as { status: string };
    expect(redownloading.status).toBe("downloading");
    await waitForStatus(videoId, "downloaded");

    const transcribe = parseToolJson(
      await mcp.callTool({ name: "transcribe_video", arguments: { videoId } }),
    ) as { ok: boolean; transcription: { id: number; status: string } };
    expect(transcribe.ok).toBe(true);
    expect(transcribe.transcription.status).toBe("queued");
    const transcriptionId = transcribe.transcription.id;

    const withQueue = parseToolJson(
      await mcp.callTool({ name: "get_transcription", arguments: { transcriptionId } }),
    ) as { id: number; queuePosition: number | null };
    expect(withQueue.id).toBe(transcriptionId);
    expect(withQueue.queuePosition).toBe(1);

    const history = parseToolJson(
      await mcp.callTool({ name: "list_transcriptions", arguments: { videoId } }),
    ) as Array<{ id: number }>;
    expect(history.map((row) => row.id)).toEqual([transcriptionId]);

    const latest = parseToolJson(
      await mcp.callTool({ name: "get_latest_transcription", arguments: { videoId } }),
    ) as { id: number };
    expect(latest.id).toBe(transcriptionId);

    const completed = await db
      .insert(schema.transcriptions)
      .values({
        videoId,
        status: "completed",
        engine: "whisper.cpp",
        model: "large-v3-turbo",
        language: "en",
        segments: JSON.stringify([
          { start: 0, end: 1.5, text: "Hello" },
          { start: 1.5, end: 3, text: "world" },
        ]),
      })
      .returning();
    const completedId = completed[0]!.id;

    const txt = parseToolJson(
      await mcp.callTool({
        name: "export_transcription_txt",
        arguments: { transcriptionId: completedId },
      }),
    ) as { ok: boolean; content: string };
    expect(txt).toEqual({ ok: true, content: "Hello world" });

    const srt = parseToolJson(
      await mcp.callTool({
        name: "export_transcription_srt",
        arguments: { transcriptionId: completedId },
      }),
    ) as { ok: boolean; content: string };
    expect(srt.ok).toBe(true);
    expect(srt.content).toContain("Hello");
    expect(srt.content).toContain("00:00:00,000 --> 00:00:01,500");

    const missingExport = parseToolJson(
      await mcp.callTool({ name: "export_transcription_txt", arguments: { transcriptionId } }),
    ) as { ok: boolean; error: string };
    expect(missingExport.ok).toBe(false);

    const deleted = parseToolJson(
      await mcp.callTool({ name: "delete_video", arguments: { videoId } }),
    ) as { ok: boolean };
    expect(deleted.ok).toBe(true);
    expect(
      parseToolJson(await mcp.callTool({ name: "get_video", arguments: { videoId } })),
    ).toBeNull();
  });

  it("reads and updates the download folder", async () => {
    const { client: mcp } = await connect();
    const customDir = join(tempDir, "custom-downloads");

    const initial = parseToolJson(await mcp.callTool({ name: "get_settings", arguments: {} })) as {
      downloadFolder: string;
      defaultDownloadFolder: string;
    };
    expect(initial.downloadFolder).toBe(mediaDir);
    expect(initial.defaultDownloadFolder).toBe(mediaDir);

    const updated = parseToolJson(
      await mcp.callTool({ name: "update_download_folder", arguments: { folder: customDir } }),
    ) as { downloadFolder: string };
    expect(updated.downloadFolder).toBe(customDir);

    const reset = parseToolJson(
      await mcp.callTool({ name: "reset_download_folder", arguments: {} }),
    ) as { downloadFolder: string };
    expect(reset.downloadFolder).toBe(mediaDir);
  });

  it("reports missing download and transcription binaries", async () => {
    const { client: mcp } = await connect();
    const report = parseToolJson(
      await mcp.callTool({ name: "get_dependencies", arguments: {} }),
    ) as { ok: boolean; dependencies: Array<{ name: string; status: string }> };
    expect(report.ok).toBe(false);
    expect(report.dependencies.map((dep) => dep.name)).toEqual([
      "yt-dlp",
      "whisper-cli",
      "ffmpeg",
      "whisper model (large-v3-turbo)",
    ]);
    expect(report.dependencies.every((dep) => dep.status === "missing")).toBe(true);
  });
});

describe("MCP Streamable HTTP", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "vt-mcp-http-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("is stateless: POST initialize has no session id, GET and DELETE are 405", async () => {
    const testDb = createTestDb(join(tempDir, "test.db"));
    await testDb.applySchema();
    const server = createVideoTranscriberMcpServer({
      db: testDb.db,
      runner: createFakeRunner([]),
      getQueue: async () => createTranscriptionQueue(),
      getMediaDir: async () => tempDir,
      defaultMediaDir: tempDir,
      projectRoot: tempDir,
    });

    const initialize = await handleMcpRequest(
      new Request("http://localhost:3001/mcp", {
        method: "POST",
        headers: {
          host: "localhost:3001",
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: LATEST_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "mcp-http-test", version: "1.0.0" },
          },
        }),
      }),
      () => server,
    );

    expect(initialize.status).toBe(200);
    expect(initialize.headers.get("mcp-session-id")).toBeNull();
    const payload = await readJsonRpc(initialize);
    expect(payload.id).toBe(1);
    expect(payload).toHaveProperty("result");

    const get = await handleMcpRequest(
      new Request("http://localhost:3001/mcp", { method: "GET" }),
      () => server,
    );
    expect(get.status).toBe(405);
    expect(await get.json()).toEqual({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });

    const del = await handleMcpRequest(
      new Request("http://localhost:3001/mcp", { method: "DELETE" }),
      () => server,
    );
    expect(del.status).toBe(405);

    await server.close();
  });

  it("rejects non-loopback Host and Origin headers (DNS rebinding)", async () => {
    const testDb = createTestDb(join(tempDir, "test.db"));
    await testDb.applySchema();
    const createServer = () =>
      createVideoTranscriberMcpServer({
        db: testDb.db,
        runner: createFakeRunner([]),
        getQueue: async () => createTranscriptionQueue(),
        getMediaDir: async () => tempDir,
        defaultMediaDir: tempDir,
        projectRoot: tempDir,
      });
    const listTools = (headers: Record<string, string>, url = "http://localhost:3001/mcp") =>
      handleMcpRequest(
        new Request(url, {
          method: "POST",
          headers: {
            accept: "application/json, text/event-stream",
            "content-type": "application/json",
            ...headers,
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        }),
        createServer,
      );

    const rebound = await listTools({ host: "attacker.example:3001" });
    expect(rebound.status).toBe(403);
    expect(await rebound.json()).toMatchObject({
      error: { code: -32000, message: "Invalid Host header: attacker.example:3001" },
    });

    const crossOrigin = await listTools({
      host: "localhost:3001",
      origin: "http://attacker.example",
    });
    expect(crossOrigin.status).toBe(403);
    expect(await crossOrigin.json()).toMatchObject({
      error: { code: -32000, message: "Invalid Origin header: http://attacker.example" },
    });

    const local = await listTools({ host: "127.0.0.1:3001", origin: "http://127.0.0.1:3001" });
    expect(local.status).toBe(200);
    const payload = await readJsonRpc(local);
    expect(payload).toHaveProperty("result.tools");

    const otherPort = await listTools(
      { host: "localhost:3002", origin: "http://localhost:3002" },
      "http://localhost:3002/mcp",
    );
    expect(otherPort.status).toBe(200);
    expect(await readJsonRpc(otherPort)).toHaveProperty("result.tools");

    const reboundOtherPort = await listTools(
      { host: "attacker.example:3002" },
      "http://attacker.example:3002/mcp",
    );
    expect(reboundOtherPort.status).toBe(403);
  });
});

# Contributing

Thank you for contributing to video-transcriber. This is a local, single-user app: paste a video URL, download its audio with `yt-dlp`, and transcribe it with a local Whisper engine. Code, comments, and documentation are written in English.

## Prerequisites

- [Bun](https://bun.sh) **1.3.14**, matching the `packageManager` field in the root `package.json`
- These binaries on your `PATH` (checked by the app at runtime):
  - `yt-dlp`
  - `ffmpeg`
  - `whisper-cli` (the local Whisper engine)
- The Whisper model file at `data/models/ggml-large-v3-turbo.bin`. Download it with
  `whisper-cli --model large-v3-turbo --download-model`. See
  [Prerequisites](README.md#prerequisites) in the README for the details.

## Setup

From the repository root:

```bash
bun install
```

Copy `.env.example` to `.env`, then apply the database schema:

```bash
bun run db:push
```

## Development

```bash
bun run dev
```

The web app listens on [http://localhost:3001](http://localhost:3001).

## Tests

```bash
bun x vp test --run
```

## Checks

`bun run check` runs format, lint, and TypeScript checks. `bun run lint` runs lint alone:

```bash
bun run check
bun run lint
```

## Conventions

- Keep commits small and focused on one change.
- One subject per pull request.
- Tests must pass before you open or update a pull request.
- Write code, comments, and docs in English.

## Issues and pull requests

Open issues and pull requests with the templates under [`.github/`](.github/).

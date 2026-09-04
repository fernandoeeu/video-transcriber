# Video Transcriber

A local single-user app: paste a video URL, download its audio with yt-dlp, and transcribe it on your machine with Whisper.

## What it does

1. Paste a video URL. The app calls `yt-dlp --dump-json` to fetch title, duration, and channel, then stores a **Video** (the source the URL points to). Duplicate URLs reuse the existing Video.
2. Download. `yt-dlp -x` extracts the audio track into the configured download folder (default `data/media/<video-id>/`).
3. Transcribe. A FIFO queue (one run at a time) converts that audio with `ffmpeg` to 16 kHz mono WAV, then runs `whisper-cli` with the `large-v3-turbo` model. Language is auto-detected. The engine recorded on success is `whisper.cpp`.
4. Library. Videos and their **Transcriptions** accumulate in a local SQLite database. A new transcription never overwrites an earlier one; each run stores engine, model, language, date, and source audio path.

Some Vimeo URLs are embed-only: yt-dlp then needs the URL of the page that embeds the video.

## Privacy

The app runs on your machine for a single local user. There is no account, no hosted backend, and no upload of audio or transcription text to a cloud service. yt-dlp still contacts the origin site to fetch the audio track.

## Prerequisites

- **bun 1.3.14** (`packageManager` in the root `package.json`)
- These binaries on `PATH`. The app checks that each command runs; it does not pin a minimum version:
  - `yt-dlp` (`yt-dlp --version`) — `brew install yt-dlp`
  - `whisper-cli` from whisper.cpp (`whisper-cli --version`) — `brew install whisper-cpp`
  - `ffmpeg` (`ffmpeg -version`) — `brew install ffmpeg`
- Whisper model file at `data/models/ggml-large-v3-turbo.bin`. Download with:

  ```bash
  whisper-cli --model large-v3-turbo --download-model
  ```

  The app’s dependency check looks for that path under the repo root. Place or copy the downloaded file there if the CLI writes it somewhere else.

## Setup

```bash
bun install
cp .env.example apps/web/.env
bun run db:push
bun run dev
```

Open [http://localhost:3001](http://localhost:3001). The Vite server port is `3001` (`apps/web/vite.config.ts`).

`.env` must live at `apps/web/.env`. `packages/db/drizzle.config.ts` loads that path for `db:*` commands. The web env schema (`packages/env/src/server.ts`) uses `dotenv/config`, which reads a `.env` in the process working directory — keep the file under `apps/web` so it matches drizzle-kit. A `.env` at the repo root is not what the database tooling reads.

## Configuration

### Environment variables

Defined in `packages/env/src/server.ts`. Copy `.env.example` to `apps/web/.env`.

| Variable       | Required | Purpose                                                                                                                                                     |
| -------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` | yes      | libsql/SQLite URL for the app and Drizzle. Local example: `file:../../local.db` (repo-root `local.db` when the process cwd is `apps/web` or `packages/db`). |
| `CORS_ORIGIN`  | yes      | Origin URL the env schema requires. Local example: `http://localhost:3001`.                                                                                 |
| `NODE_ENV`     | no       | `development` \| `production` \| `test`. Defaults to `development`.                                                                                         |

`packages/env/src/web.ts` declares no `VITE_*` client variables.

`SKIP_ENV_VALIDATION` is not in the schema. If set, both env modules skip Zod validation.

### Settings stored in the database

The download folder is a `settings` row with key `download_folder` (`apps/web/src/core/settings.ts`). When unset, audio goes to `<repo>/data/media`. Changing the folder does not move files already on disk; delete uses the Video’s stored audio path, not the current setting.

## Scripts

Root `package.json`:

| Script                | Command                                                                              |
| --------------------- | ------------------------------------------------------------------------------------ |
| `bun run dev`         | Start every workspace `dev` script (`vp run -r dev`)                                 |
| `bun run dev:web`     | Start only the web app                                                               |
| `bun run build`       | Build every workspace package                                                        |
| `bun run check-types` | Typecheck every workspace package                                                    |
| `bun run check`       | Vite+ format/lint checks, then workspace typechecks                                  |
| `bun run lint`        | Vite+ lint                                                                           |
| `bun run format`      | Vite+ format                                                                         |
| `bun run staged`      | Vite+ checks on staged files                                                         |
| `bun run hooks:setup` | Install Vite+ git hooks (`vp config`)                                                |
| `bun run db:push`     | Push the Drizzle schema (`packages/db`)                                              |
| `bun run db:generate` | Generate Drizzle migrations                                                          |
| `bun run db:migrate`  | Run Drizzle migrations                                                               |
| `bun run db:studio`   | Open Drizzle Studio                                                                  |
| `bun run db:local`    | `turso dev --db-file local.db` (optional; a `file:` `DATABASE_URL` does not need it) |

There is no `test` script. Run tests with:

```bash
bun x vp test --run
```

`apps/web` also defines `dev`, `build`, and `serve` (`vp preview`). `packages/ui` defines `check-types`. `packages/db` defines the `db:*` scripts the root aliases call. `packages/env` and `packages/config` define no scripts.

## Project structure

```
apps/web          # Product: React + TanStack Start on Vite+
packages/ui       # Shared UI primitives and styles
packages/db       # Drizzle schema, migrations, libsql client
packages/env      # Server and web env schemas
packages/config   # Shared TypeScript config
```

## Export formats

Completed transcriptions export as:

- **`.txt`** — plain text (`segmentsToPlainText`)
- **`.srt`** — SubRip (`segmentsToSrt`)

## Legal notice

You are responsible for complying with each site’s terms of use and with the copyright of any content you download. This tool grants no rights over third-party content.

## License

MIT. See [LICENSE](LICENSE). Third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Scaffolded with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack).

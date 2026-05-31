# indigestion — Spec

> A self-hosted DVD ripping and library management service that produces clean, metadata-rich MKV files in Jellyfin-compatible folder structures.

---

## Overview

indigestion is a Bun-based web service that orchestrates the full DVD → Jellyfin pipeline:

1. Detect a disc (or accept a `VIDEO_TS` folder path)
2. Parse IFO structure via `lsdvd` to identify titles, streams, and chapters
3. Classify titles (main feature / episodes / extras) from IFO data — no heuristics
4. Search TMDB for metadata, user confirms match
5. Build a rip manifest (which titles, which tracks to keep)
6. Execute rip via `makemkvcon`
7. Embed metadata into MKVs via `mkvpropedit`
8. Place files into Jellyfin folder structure
9. Trigger Jellyfin library scan via API

---

## System Dependencies

| Tool | Purpose | Install |
|------|---------|---------|
| `lsdvd` | IFO parsing, title/stream/chapter info | `brew install lsdvd` / nixpkgs |
| `makemkvcon` | Disc ripping | MakeMKV download |
| `mkvtoolnix` | MKV metadata embedding, chapter setting | `brew install mkvtoolnix` / nixpkgs |
| `HandBrakeCLI` | Secondary scan / validation | `brew install handbrake` / nixpkgs |
| `libdvdcss` | CSS decryption for encrypted discs | `brew install libdvdcss` / nixpkgs |

---

## Project Structure

```
indigestion/
├── src/
│   ├── index.ts              # Bun HTTP server, route definitions
│   ├── disc/
│   │   ├── detect.ts         # Disc/folder detection, device polling
│   │   │                     # wraps ifo-parse analyzeDisc()
│   ├── metadata/
│   │   ├── tmdb.ts           # TMDB search + fetch (movies + TV)
│   │   └── types.ts          # TMDBMovie, TMDBShow, TMDBSeason types
│   ├── rip/
│   │   ├── manifest.ts       # Build rip manifest from disc + metadata
│   │   ├── makemkv.ts        # makemkvcon runner + progress parsing
│   │   ├── embed.ts          # mkvpropedit metadata + chapter embedding
│   │   └── place.ts          # Output folder structure + file placement
│   ├── jellyfin/
│   │   └── scan.ts           # Jellyfin API library scan trigger
│   ├── queue/
│   │   ├── queue.ts          # In-memory job queue
│   │   └── types.ts          # Job, JobStatus types
│   └── config.ts             # Config loading (env / config file)
├── frontend/
│   ├── index.html
│   └── src/
│       ├── App.tsx
│       ├── pages/
│       │   ├── Disc.tsx      # Current disc, title list, classification review
│       │   ├── Metadata.tsx  # TMDB search + confirm
│       │   ├── Tracks.tsx    # Per-title track selection (audio, subtitles)
│       │   ├── Queue.tsx     # Rip progress, job list
│       │   └── History.tsx   # Past rips
│       └── components/
│           ├── TitleRow.tsx
│           ├── TrackBadge.tsx
│           └── ProgressBar.tsx
├── spec.md
├── package.json
└── .env.example
```

---

## Configuration

Via environment variables or a `indigestion.toml` config file:

```toml
[disc]
device = "/dev/sr0"          # Linux default; /dev/disk2 on macOS
poll_interval_ms = 2000

[output]
movies_root = "/media/movies"
tv_root = "/media/tv"

[tmdb]
api_key = ""

[jellyfin]
url = "http://localhost:8096"
api_key = ""
library_ids = []             # Empty = scan all libraries

[rip]
default_audio_languages = ["eng"]
default_subtitle_languages = ["eng"]
keep_all_audio = false
```

---

## Module Specs

### `disc/types.ts`

```typescript
export type StreamType = "video" | "audio" | "subtitle"

export interface VideoStream {
  type: "video"
  ix: number
  format: string        // "MPEG2", "H264", etc.
  width: number
  height: number
  fps: number
}

export interface AudioStream {
  type: "audio"
  ix: number
  langCode: string      // ISO 639-1, e.g. "en"
  language: string      // "English"
  format: string        // "AC3", "DTS", etc.
  channels: number      // 2, 6, etc.
  frequency: number     // 48000, etc.
}

export interface SubtitleStream {
  type: "subtitle"
  ix: number
  langCode: string
  language: string
  format: string        // "Vobsub"
}

export type Stream = VideoStream | AudioStream | SubtitleStream

export interface Chapter {
  ix: number
  startTime: number     // seconds
}

export type TitleType =
  | "main_feature"      // IFO one-sequential PGC
  | "episode"           // multiple sequential titles on TV disc
  | "featurette"
  | "behind_the_scenes"
  | "deleted_scenes"
  | "interview"
  | "trailer"
  | "unknown"

export interface Title {
  ix: number            // 1-based, matches lsdvd output
  vtsIx: number         // VTS number from IFO
  pgcIx: number         // PGC index within VTS
  titleType: number     // raw IFO title_type field
  length: number        // seconds
  chapters: Chapter[]
  streams: Stream[]
  // set by classifier
  classification: TitleType
  classificationConfidence: "ifo" | "inferred"
}

export interface DiscInfo {
  device: string        // /dev/sr0 or path to VIDEO_TS folder
  discTitle: string     // from lsdvd, e.g. "THE_MATRIX"
  titles: Title[]
  lsdvdRaw: string      // raw XML for debugging
}
```

### `disc/ifo-parse` (external library)

The disc parsing and classification layer is extracted into a standalone npm library. See **[ifo-parse-spec.md](./ifo-parse-spec.md)** for the full spec.

`ifo-parse` is consumed by indigestion's `disc/` module and provides:
- `analyzeDisc(source)` — runs libdvdread via FFI shim, returns typed `DiscInfo`
- `classifyTitles(disc)` — IFO-grounded classification, no heuristics
- `mainFeature`, `episodes`, `extras` — convenience accessors

The `disc/` module in indigestion wraps `ifo-parse` and adds disc change detection (device polling / udev).

### `disc/detect.ts`

Responsibilities:
- Poll device path (Linux: `/dev/sr0`, macOS: `/dev/disk2`) for disc insertion
- Accept `INDIGESTION_SOURCE` env override pointing to a `VIDEO_TS` folder (dev mode)
- On disc ready: call `analyzeDisc(source)` from `ifo-parse`, emit disc event
- On disc eject: clear current disc state
- Expose `watchDisc(source: string, onInsert, onEject): () => void`

### `disc/classify.ts`

Uses **IFO `title_type` field** as primary signal — no duration heuristics:

```
title_type = 1 (0x01) → one_sequential_pgc
  if only one such title on disc → "main_feature"
  if multiple → "episode" (TV disc)

title_type = 2 (0x02) → non_sequential
  → check disc title + position for sub-classification
  → default "featurette", user can override in UI

title_type = 3 (0x03) → multi_angle
  → "main_feature" (alternate angles)

title_type = 0 → menu/utility title
  → exclude from rip manifest entirely
```

Sub-classification of extras (when title_type = 2) uses disc label keywords as a secondary signal:
- disc title contains "BONUS", "SPECIAL", "EXTRA" → all non-seq titles → "featurette"
- Otherwise expose in UI for user to label individually

Expose:
- `classifyTitles(disc: DiscInfo): DiscInfo` — returns disc with `classification` set on each title
- `isMenuTitle(title: Title): boolean`
- `isEpisodeDisc(disc: DiscInfo): boolean`

### `metadata/tmdb.ts`

Responsibilities:
- `searchMovies(query: string, year?: number): Promise<TMDBMovie[]>`
- `searchShows(query: string): Promise<TMDBShow[]>`
- `getMovieDetails(id: number): Promise<TMDBMovieDetails>`
- `getShowDetails(id: number): Promise<TMDBShowDetails>`
- `getSeasonDetails(showId: number, season: number): Promise<TMDBSeasonDetails>`

Episode matching for TV discs:
- Given a confirmed show + season number, fetch all episode titles/descriptions from TMDB
- Match in order to classified episode titles from IFO
- User reviews/overrides assignments in UI

### `rip/manifest.ts`

Builds a `RipManifest` from a confirmed `DiscInfo` + TMDB match + user track selections:

```typescript
export interface TrackSelection {
  titleIx: number
  keepAudio: number[]       // stream ix list
  keepSubtitles: number[]   // stream ix list
}

export interface RipJob {
  titleIx: number
  classification: TitleType
  outputPath: string        // full resolved path
  trackSelection: TrackSelection
  mkvTags: MKVTags
  chapters: Chapter[]
}

export interface RipManifest {
  source: string
  jobs: RipJob[]
  totalTitles: number
}
```

`buildManifest(disc, tmdbMatch, trackSelections, config): RipManifest`

Output path resolution:
```
Movie:
  {movies_root}/{Title} ({Year})/{Title} ({Year}).mkv

Movie extra:
  {movies_root}/{Title} ({Year})/{jellyfin_folder}/{name}.mkv
  jellyfin_folder: "featurettes" | "behind the scenes" | "deleted scenes" | "interviews" | "trailers"

TV episode:
  {tv_root}/{Show Name}/Season {NN}/{Show Name} S{NN}E{NN} - {Episode Title}.mkv

TV extra:
  {tv_root}/{Show Name}/Season {NN}/extras/{name}.mkv
```

### `rip/makemkv.ts`

- `ripTitle(source: string, titleIx: number, outputDir: string): AsyncGenerator<RipProgress>`
- Runs `makemkvcon -r mkv <source> <titleIx> <outputDir>`
- Parses `PRGV:` lines for progress (current, total, max)
- Parses `MSG:` lines for status/errors
- Yields `RipProgress` events consumed by queue + SSE stream to frontend

```typescript
export interface RipProgress {
  titleIx: number
  percent: number
  currentOperation: string
  bytesWritten?: number
  error?: string
}
```

### `rip/embed.ts`

After rip, before placement:
- `embedMetadata(mkvPath: string, tags: MKVTags): Promise<void>`
  - Uses `mkvpropedit` to set title, date, description, TMDB ID tag
- `embedChapters(mkvPath: string, chapters: Chapter[]): Promise<void>`
  - Generates OGM-format chapter file, passes to `mkvpropedit --chapters`
- `selectTracks(mkvPath: string, selection: TrackSelection): Promise<void>`
  - Uses `mkvmerge` to output new MKV with only selected audio/subtitle tracks

```typescript
export interface MKVTags {
  title: string
  year?: number
  description?: string
  tmdbId?: number
  season?: number
  episode?: number
  episodeTitle?: string
}
```

### `rip/place.ts`

- `placeFile(tempPath: string, job: RipJob): Promise<string>`
  - Creates output directory if needed
  - Moves file from temp rip location to final path
  - Returns final path

### `jellyfin/scan.ts`

- `triggerScan(config: JellyfinConfig, libraryIds?: string[]): Promise<void>`
  - POST `/Library/Refresh` or per-library `/Items/{id}/Refresh`
  - Auth via `X-Emby-Token` header

### `queue/queue.ts`

Simple in-memory job queue (no persistence needed for v1):

```typescript
export type JobStatus = "pending" | "ripping" | "embedding" | "placing" | "done" | "error"

export interface Job {
  id: string
  manifest: RipJob
  status: JobStatus
  progress: RipProgress | null
  error?: string
  startedAt?: Date
  completedAt?: Date
  outputPath?: string
}
```

- `enqueue(jobs: RipJob[]): Job[]`
- `getJobs(): Job[]`
- `getJob(id: string): Job | undefined`
- Jobs execute sequentially (one rip at a time — disc drive constraint)
- Progress updates emitted via SSE endpoint

---

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/disc` | Current disc info (DiscInfo or null) |
| `POST` | `/api/disc/analyze` | Re-analyze current disc / analyze folder path |
| `GET` | `/api/metadata/search/movie` | `?q=&year=` → TMDBMovie[] |
| `GET` | `/api/metadata/search/tv` | `?q=` → TMDBShow[] |
| `GET` | `/api/metadata/movie/:id` | TMDBMovieDetails |
| `GET` | `/api/metadata/tv/:id/season/:n` | TMDBSeasonDetails |
| `POST` | `/api/manifest` | Build manifest from body, returns RipManifest |
| `POST` | `/api/queue` | Enqueue a RipManifest |
| `GET` | `/api/queue` | All jobs |
| `GET` | `/api/queue/events` | SSE stream of job progress |
| `DELETE` | `/api/queue/:id` | Cancel pending job |
| `GET` | `/api/history` | Completed jobs |
| `GET` | `/api/config` | Current config (sanitized, no keys) |

---

## Frontend Pages

### Disc Page (`/`)
- Shows disc detection status (polling `/api/disc`)
- Title list with classification badges (Main Feature / Episode / Featurette / etc.)
- User can re-classify any title via dropdown
- Duration, chapter count, stream summary per title
- "Choose Metadata →" CTA once titles look right

### Metadata Page (`/metadata`)
- Search box pre-filled with disc title (cleaned)
- Toggle: Movie / TV Show
- Results grid (poster, title, year, overview snippet)
- On TV match: season selector, episode assignment table (IFO episode order ↔ TMDB episode titles)
- "Review Tracks →" CTA

### Tracks Page (`/tracks`)
- Per-title expandable section
- Audio tracks: checkbox per track, shows language + format + channels
- Subtitle tracks: checkbox per track, shows language
- Smart defaults applied from config (e.g. keep English audio + English subs)
- Output path preview per title (resolves from manifest logic)
- "Start Ripping →" button → POST /api/queue

### Queue Page (`/queue`)
- Active job with large progress bar + current operation label
- Pending jobs list
- Completed jobs with output paths
- SSE-driven, no polling

### History Page (`/history`)
- Table of past rips: title, type, output path, date, duration taken
- Link to open output folder (if accessible)

---

## Development Workflow

```bash
# Install deps
bun install

# Dev (backend + frontend with HMR)
bun run dev

# Test disc parsing against a VIDEO_TS folder
bun run src/disc/lsdvd.ts -- /path/to/VIDEO_TS

# Test classification
bun run src/disc/classify.ts -- /path/to/VIDEO_TS

# Run tests
bun test
```

### macOS Dev Setup

```bash
brew install lsdvd mkvtoolnix handbrake libdvdcss
# MakeMKV: download from makemkv.com, grab beta key from forum

# Point at a VIDEO_TS folder instead of a device
INDIGESTION_SOURCE=/path/to/VIDEO_TS bun run dev
```

### NixOS Production Setup

Add to `terebithia` flake:
- `lsdvd`, `mkvtoolnix`, `handbrake-cli`, `libdvdcss`, `makemkv` from nixpkgs
- NixOS service module using `mkService` pattern
- Caddy reverse proxy at e.g. `indigestion.dunkirk.sh` (internal only)
- agenix secrets for TMDB key + Jellyfin key
- Output dirs bind-mounted from Jellyfin media paths

---

## Implementation Order

1. `ifo-parse` library — see [ifo-parse-spec.md](./ifo-parse-spec.md); build and publish first
2. `disc/detect.ts` — device polling, wraps `ifo-parse`
3. `metadata/tmdb.ts` — TMDB client
4. `rip/manifest.ts` — manifest builder
5. `rip/makemkv.ts` — rip runner + progress parser
6. `rip/embed.ts` — mkvpropedit wrapper
7. `rip/place.ts` — file placement
8. `queue/queue.ts` — job queue
9. `index.ts` — HTTP server + all routes
10. `jellyfin/scan.ts` — scan trigger
11. Frontend — Disc → Metadata → Tracks → Queue pages

---

## Out of Scope (v1)

- Blu-ray support
- Multi-drive parallel ripping
- Transcoding (output is lossless MKV; Jellyfin handles transcoding)
- Subtitle OCR (VobSub → SRT conversion)
- Persistent job history (in-memory only)
- Authentication (internal homelab service, Caddy handles network access)
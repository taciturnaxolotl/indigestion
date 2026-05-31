# ifo-parse — Spec

> A fat TypeScript library for parsing DVD IFO files via `libdvdread` FFI. No `lsdvd` dependency — reads disc structure directly from the C library.

Published to npm as `ifo-parse`.

---

## Overview

`ifo-parse` provides typed access to DVD IFO structure — title tables, program chains, audio/subtitle streams, chapter data, and title classification — by binding directly to `libdvdread` via a thin C shim and Bun FFI.

The shim handles all C struct traversal and serializes to JSON. The TypeScript layer parses that JSON into typed objects and provides classification utilities.

---

## System Dependencies

| Dependency | Purpose | Install |
|-----------|---------|---------|
| `libdvdread` | DVD IFO reading | `brew install libdvdread` / nixpkgs `libdvdread` |
| `libdvdcss` | CSS decryption for encrypted discs | `brew install libdvdcss` / nixpkgs |
| C compiler | Building the shim (dev only) | `clang` / `gcc` |

Consumers need `libdvdread` installed. The compiled shim is bundled in `prebuilds/` per platform — no compilation required at install time.

---

## Architecture

### Why a C Shim

`libdvdread` exposes complex nested C structs with bitfields and packed layouts. Describing these directly in `bun:ffi` is brittle and breaks across libdvdread versions. Instead, a thin C shim (`ifo_shim.c`) calls libdvdread, traverses the structs, and returns a single heap-allocated JSON string. The TypeScript layer FFIs into the shim only — it owns the ABI boundary.

```
TypeScript (parse + classify)
    ↕ bun:ffi
ifo_shim.so / ifo_shim.dylib    ← we own this ABI
    ↕ libdvdread API
libdvdread.so / libdvdread.dylib ← system library
    ↕
DVD disc / VIDEO_TS folder
```

### Shim Interface

The shim exposes exactly two symbols:

```c
// Returns heap-allocated JSON string describing the full disc.
// Returns NULL on error (path not found, not a DVD, etc.)
char *ifo_parse_disc(const char *path);

// Must be called to free the returned string.
void ifo_parse_free(char *ptr);
```

JSON over FFI avoids all struct layout complexity on the JS side. Performance is acceptable since `analyzeDisc` runs once at disc-insert time, not in a hot loop.

---

## Project Structure

```
ifo-parse/
├── src/
│   ├── index.ts          # public API exports
│   ├── ffi.ts            # bun:ffi bindings, shimPath resolution
│   ├── parse.ts          # shim JSON → DiscInfo
│   ├── classify.ts       # IFO-grounded title classification
│   └── types.ts          # all exported types
├── shim/
│   ├── ifo_shim.c        # C shim against libdvdread
│   ├── ifo_shim.h        # exported symbols
│   └── build.sh          # compile to .so / .dylib
├── prebuilds/
│   ├── linux-arm64/
│   │   └── ifo_shim.so   # terebithia (aarch64)
│   ├── linux-x64/
│   │   └── ifo_shim.so
│   └── darwin-arm64/
│       └── ifo_shim.dylib
├── test/
│   ├── fixtures/
│   │   ├── movie.json         # captured shim output, real movie disc
│   │   ├── tv_season.json     # TV season disc
│   │   └── special_edition.json
│   └── parse.test.ts
├── package.json
├── tsconfig.json
└── README.md
```

---

## Types (`src/types.ts`)

```typescript
export type StreamType = "video" | "audio" | "subtitle"

export interface VideoStream {
  type: "video"
  format: string          // "MPEG2" | "MPEG4" | "H264"
  width: number
  height: number
  fps: number             // 25 | 29.97
  aspectRatio: string     // "4:3" | "16:9"
}

export interface AudioStream {
  type: "audio"
  ix: number              // 0-based stream index
  langCode: string        // ISO 639-1, e.g. "en"
  language: string        // "English"
  format: string          // "AC3" | "DTS" | "LPCM" | "MPEG"
  channels: number        // 2 | 6 | 8
  sampleRate: number      // Hz, typically 48000
  quantization: number    // bits, typically 16 | 20 | 24
}

export interface SubtitleStream {
  type: "subtitle"
  ix: number
  langCode: string
  language: string
  format: string          // "VobSub"
}

export type Stream = VideoStream | AudioStream | SubtitleStream

export interface Chapter {
  ix: number              // 1-based
  startTime: number       // seconds (float)
  duration: number        // seconds (float)
  startSector: number     // VOB sector address
}

// Raw IFO title_type values from tt_srpt
export type IFOTitleType =
  | 0   // menu / utility — never rip
  | 1   // one_sequential_pgc — main feature or episode
  | 2   // non_sequential — extras, bonus content
  | 3   // multi_angle — alternate angle feature

export type TitleType =
  | "main_feature"
  | "episode"
  | "featurette"
  | "behind_the_scenes"
  | "deleted_scenes"
  | "interview"
  | "trailer"
  | "menu"
  | "unknown"

export type ClassificationConfidence =
  | "ifo"        // grounded directly in IFO title_type field
  | "inferred"   // sub-classification of non_sequential titles

export interface Title {
  ix: number              // 1-based, matches makemkvcon title index
  vtsIx: number           // VTS number (1..n)
  pgcIx: number           // PGC index within VTS (0-based)
  ifoTitleType: IFOTitleType
  angleCount: number      // number of angles (usually 1)
  length: number          // seconds (float)
  chapters: Chapter[]
  video: VideoStream
  audio: AudioStream[]
  subtitles: SubtitleStream[]
  // set by classifyTitles()
  classification: TitleType
  classificationConfidence: ClassificationConfidence
}

export interface DiscInfo {
  source: string          // device path or VIDEO_TS folder path
  discTitle: string       // e.g. "THE_MATRIX" from disc label
  titles: Title[]
}
```

---

## C Shim (`shim/ifo_shim.c`)

Reads the full disc structure and serializes to JSON. Key libdvdread calls:

```c
#include <dvdread/ifo_read.h>
#include <dvdread/dvd_reader.h>

char *ifo_parse_disc(const char *path) {
  dvd_reader_t *dvd = DVDOpen(path);
  ifo_handle_t *vmg = ifoOpen(dvd, 0);       // VIDEO_TS.IFO

  tt_srpt_t *tt_srpt = vmg->tt_srpt;         // top-level title table
  int n_titles = tt_srpt->nr_of_srpts;

  // For each title:
  //   title_info_t *ti = &tt_srpt->title[i]
  //   ti->title_set_nr  → VTS index
  //   ti->title_type    → IFOTitleType (0/1/2/3)
  //   ti->nr_of_angles  → angle count
  //   ti->nr_of_ptts    → chapter count

  // Open VTS IFO for streams + PGC data:
  //   ifo_handle_t *vts = ifoOpen(dvd, ti->title_set_nr)
  //   vts->vtsi_mat->vts_video_attr  → VideoStream fields
  //   vts->vtsi_mat->vts_audio_att[n] → AudioStream fields
  //   vts->vtsi_mat->vts_subp_att[n] → SubtitleStream fields
  //   vts->vts_pgcit->pgci_srp[pgc_ix].pgc → pgc_t*
  //     pgc->cell_playback[n] → Chapter sectors + duration

  // Serialize everything to JSON, return heap string
}
```

IFO struct fields mapped to JSON:

| IFO field | JSON key | Notes |
|-----------|----------|-------|
| `tt_srpt->title[i].title_type` | `ifoTitleType` | 0/1/2/3 |
| `tt_srpt->title[i].title_set_nr` | `vtsIx` | |
| `tt_srpt->title[i].nr_of_angles` | `angleCount` | |
| `vtsi_mat->vts_audio_att[n].lang_code` | `langCode` | packed 2-byte ISO |
| `vtsi_mat->vts_audio_att[n].audio_format` | `format` | 0=AC3,2=MPEG,3=LPCM,4=DTS |
| `vtsi_mat->vts_audio_att[n].channels` | `channels` | value + 1 |
| `vtsi_mat->vts_video_attr.picture_size` | `width`/`height` | enum → pixels |
| `vtsi_mat->vts_video_attr.video_format` | `fps` | 0=NTSC(29.97),1=PAL(25) |
| `cell_playback[n].playback_time` | `duration` | BCD time → seconds |
| `cell_playback[n].first_sector` | `startSector` | |

### Build

```bash
# macOS
clang -shared -fPIC -o prebuilds/darwin-arm64/ifo_shim.dylib \
  shim/ifo_shim.c -ldvdread

# Linux
gcc -shared -fPIC -o prebuilds/linux-arm64/ifo_shim.so \
  shim/ifo_shim.c -ldvdread
```

---

## FFI Bindings (`src/ffi.ts`)

```typescript
import { dlopen, FFIType, ptr, toArrayBuffer } from "bun:ffi"
import { join } from "path"

function shimPath(): string {
  const platform = process.platform        // "darwin" | "linux"
  const arch = process.arch                // "arm64" | "x64"
  const ext = platform === "darwin" ? "dylib" : "so"
  const name = `ifo_shim.${ext}`
  return join(import.meta.dir, "..", "prebuilds", `${platform}-${arch}`, name)
}

const lib = dlopen(shimPath(), {
  ifo_parse_disc: {
    args: [FFIType.cstring],
    returns: FFIType.ptr,
  },
  ifo_parse_free: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
})

export function parseDiscRaw(source: string): string {
  const ptr = lib.symbols.ifo_parse_disc(source)
  if (!ptr) throw new Error(`ifo_parse_disc returned null for: ${source}`)

  // Read null-terminated string from pointer
  const buf = new Uint8Array(toArrayBuffer(ptr, 0, 65536)) // max 64KB JSON
  const end = buf.indexOf(0)
  const json = new TextDecoder().decode(buf.subarray(0, end))

  lib.symbols.ifo_parse_free(ptr)
  return json
}
```

---

## Parser (`src/parse.ts`)

```typescript
import { parseDiscRaw } from "./ffi"
import type { DiscInfo } from "./types"

// Parses shim JSON output into typed DiscInfo.
// Exported separately so it can be tested against fixture JSON
// without needing the FFI / libdvdread installed.
export function parseShimJson(json: string, source: string): DiscInfo {
  const raw = JSON.parse(json)
  // map raw → DiscInfo, Title[], Stream[], Chapter[]
  // normalize lang_code packed ints → ISO string
  // normalize BCD durations → seconds
  // normalize video enum → width/height/fps
}

export async function analyzeDiscRaw(source: string): Promise<DiscInfo> {
  const json = parseDiscRaw(source)
  return parseShimJson(json, source)
}
```

---

## Classification (`src/classify.ts`)

Uses **IFO `ifoTitleType` field** as primary signal. No duration heuristics.

### Rules

```
ifoTitleType = 0 → "menu"
  Skip entirely in rip manifests.

ifoTitleType = 1 (one_sequential_pgc)
  count of type-1 titles = 1  → "main_feature"
  count of type-1 titles > 1  → "episode" (TV disc)
  confidence: "ifo"

ifoTitleType = 2 (non_sequential)
  → sub-classify as extras
  confidence: "inferred" (expose to user for override)
  default: "featurette"
  disc label keywords (case-insensitive):
    "BEHIND"  → "behind_the_scenes"
    "DELETED" → "deleted_scenes"
    "INTERVIE"→ "interview"
    "TRAILER" → "trailer"

ifoTitleType = 3 (multi_angle)
  → "main_feature"
  confidence: "ifo"
```

### Exports

```typescript
// Mutates classification + classificationConfidence on each title.
// Returns new DiscInfo (titles array is new, Title objects are new).
export function classifyTitles(disc: DiscInfo): DiscInfo

export function isEpisodeDisc(disc: DiscInfo): boolean
export function mainFeature(disc: DiscInfo): Title | undefined
export function episodes(disc: DiscInfo): Title[]
export function extras(disc: DiscInfo): Title[]
export function menuTitles(disc: DiscInfo): Title[]
```

---

## Public API (`src/index.ts`)

```typescript
// Core
export async function analyzeDisc(source: string): Promise<DiscInfo>
// source: "/dev/sr0" | "/dev/disk2" | "/path/to/VIDEO_TS"
// Calls parseDiscRaw → parseShimJson → classifyTitles

// Classification (also applied automatically by analyzeDisc)
export { classifyTitles, isEpisodeDisc, mainFeature, episodes, extras, menuTitles }
  from "./classify"

// Parser (useful for testing against fixture JSON without FFI)
export { parseShimJson } from "./parse"

// Types
export type {
  DiscInfo, Title, Chapter,
  VideoStream, AudioStream, SubtitleStream, Stream,
  TitleType, IFOTitleType, ClassificationConfidence,
} from "./types"

// Utilities
export function formatDuration(seconds: number): string
// 8177.1 → "2:16:17"

export function titleTypeLabel(t: TitleType): string
// "main_feature" → "Main Feature", "behind_the_scenes" → "Behind the Scenes"

export function audioFormatLabel(format: string, channels: number): string
// "AC3", 6 → "AC3 5.1"
```

---

## Testing Strategy

Tests run against **fixture JSON files** — captured shim output from real discs — so the full test suite runs without `libdvdread` installed (e.g. in CI, or before the shim is compiled).

```typescript
// test/parse.test.ts
import { describe, test, expect } from "bun:test"
import { parseShimJson } from "../src/parse"
import { classifyTitles, mainFeature, isEpisodeDisc } from "../src/classify"
import movieFixture from "./fixtures/movie.json"
import tvFixture from "./fixtures/tv_season.json"

describe("movie disc", () => {
  const disc = classifyTitles(parseShimJson(JSON.stringify(movieFixture), "/fixture"))

  test("identifies main feature", () => {
    expect(mainFeature(disc)?.classification).toBe("main_feature")
  })

  test("main feature has correct duration", () => {
    expect(mainFeature(disc)?.length).toBeGreaterThan(3600)
  })

  test("extras are classified as featurettes", () => {
    // ...
  })
})

describe("tv season disc", () => {
  test("isEpisodeDisc is true", () => {
    // ...
  })

  test("all type-1 titles classified as episodes", () => {
    // ...
  })
})
```

Fixtures are captured once from real discs using a dev script:

```bash
bun run shim/capture-fixture.ts /dev/sr0 > test/fixtures/movie.json
```

---

## Implementation Order

1. `types.ts` — all types, no dependencies
2. `shim/ifo_shim.c` + `build.sh` — compile, verify raw JSON output against a real disc
3. `src/parse.ts` — `parseShimJson`, tested against captured fixture
4. `src/ffi.ts` — `parseDiscRaw`, wires shim → parse
5. `src/classify.ts` — classification logic, unit tested
6. `src/index.ts` — public API + utility functions
7. `prebuilds/` — compile for linux-arm64, linux-x64, darwin-arm64

---

## Package Config

```json
{
  "name": "ifo-parse",
  "version": "0.1.0",
  "description": "Parse DVD IFO files via libdvdread FFI",
  "module": "src/index.ts",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "files": [
    "src/",
    "prebuilds/",
    "shim/ifo_shim.h"
  ],
  "keywords": ["dvd", "ifo", "libdvdread", "mkv", "rip"],
  "peerDependencies": {
    "bun": ">=1.0.0"
  },
  "devDependencies": {
    "@types/bun": "latest"
  }
}
```

---

## Out of Scope (v1)

- Blu-ray (libbluray) — different library, different structure
- Writing / modifying IFO files
- VOB demuxing or video stream access
- Node.js compatibility (Bun FFI only; N-API addon is a future path)
- Windows support
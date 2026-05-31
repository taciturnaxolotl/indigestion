# ifo-parse

A fat TypeScript library for parsing DVD IFO files via `libdvdread` FFI.

## System Dependencies

- `libdvdread` for DVD IFO reading (`brew install libdvdread` / nixpkgs)
- `libdvdcss` for CSS decryption for encrypted discs (`brew install libdvdcss` / nixpkgs)
- C compiler

## Installation

```bash
bun install ifo-parse
```

## Usage

```typescript
import { analyzeDisc, mainFeature, episodes, extras } from "ifo-parse"

// Analyze a disc from device path or VIDEO_TS folder
const disc = analyzeDisc("/dev/sr0")

console.log(`Disc: ${disc.discTitle}`)
console.log(`Titles: ${disc.titles.length}`)

// Access classified titles
const feature = mainFeature(disc)
const eps = episodes(disc)
const ext = extras(disc)

for (const title of disc.titles) {
  console.log(`Title ${title.ix}: ${title.classification} (${title.length}s)`)
}
```

## Architecture

The library uses a thin C shim (`ifo_shim.c`) that calls libdvdread and serializes the full disc structure to JSON using [cJSON](https://github.com/DaveGamble/cJSON). The TypeScript layer FFIs into the shim via `bun:ffi`, parses the JSON into typed objects, and provides classification utilities.

Prebuilt shim binaries are bundled in `prebuilds/` per platform — no compilation required at install time.

### Third-Party Dependencies

The C shim bundles [cJSON](https://github.com/DaveGamble/cJSON) (MIT license) for JSON serialization. See `shim/cJSON_LICENSE` for the full license text.

## API

### `analyzeDisc(source: string): DiscInfo`

Analyzes a DVD disc or VIDEO_TS folder and returns typed disc information with classified titles.

### Classification Utilities

- `classifyTitles(disc: DiscInfo): DiscInfo` — Classify all titles based on IFO data
- `isMenuTitle(title: Title): boolean` — Check if a title is a menu/utility title
- `isEpisodeDisc(disc: DiscInfo): boolean` — Check if disc contains multiple episodes
- `mainFeature(disc: DiscInfo): Title | undefined` — Get the main feature title
- `episodes(disc: DiscInfo): Title[]` — Get all episode titles
- `extras(disc: DiscInfo): Title[]` — Get all extra/bonus titles

## Building from Source

```bash
# Install dependencies
bun install

# Build the C shim (requires libdvdread)
bun run build:shim

# Build TypeScript
bun run build

# Run tests
bun test
```

<p align="center">
    <img src="https://raw.githubusercontent.com/taciturnaxolotl/carriage/main/.github/images/line-break.svg" />
</p>

<p align="center">
    <i><code>&copy; 2026-present <a href="https://dunkirk.sh">Kieran Klukas</a></code></i>
</p>

<p align="center">
    <a href="https://tangled.org/dunkirk.sh/indigestion/blob/main/LICENSE.md"><img src="https://img.shields.io/static/v1.svg?style=for-the-badge&label=License&message=MIT&logoColor=d9e0ee&colorA=363a4f&colorB=b7bdf8"/></a>
</p>

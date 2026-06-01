#!/bin/bash
set -e

# Platform detection logic must match platforms.json
# When adding a new platform, update both this file and platforms.json

# Detect platform
PLATFORM=$(uname -s)
ARCH=$(uname -m)

if [ "$PLATFORM" = "Darwin" ]; then
  if [ "$ARCH" = "arm64" ]; then
    TARGET_DIR="../prebuilds/darwin-arm64"
  else
    TARGET_DIR="../prebuilds/darwin-x64"
  fi
  EXT=".dylib"
  FLAGS="-dynamiclib"
elif [ "$PLATFORM" = "Linux" ]; then
  if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
    TARGET_DIR="../prebuilds/linux-arm64"
  else
    TARGET_DIR="../prebuilds/linux-x64"
  fi
  EXT=".so"
  FLAGS="-shared -fPIC"
else
  echo "Unsupported platform: $PLATFORM"
  exit 1
fi

mkdir -p "$TARGET_DIR"

echo "Building ifo_shim for $PLATFORM $ARCH..."

# Detect Homebrew prefix
if [ "$PLATFORM" = "Darwin" ]; then
  BREW_PREFIX=$(brew --prefix)
  INCLUDE_FLAGS="-I${BREW_PREFIX}/include"
  LIB_FLAGS="-L${BREW_PREFIX}/lib"
else
  INCLUDE_FLAGS=""
  LIB_FLAGS=""
fi

gcc $FLAGS $INCLUDE_FLAGS $LIB_FLAGS -o "$TARGET_DIR/ifo_shim$EXT" "$(dirname "$0")/ifo_shim.c" "$(dirname "$0")/cJSON.c" -ldvdread -lm

echo "Built $TARGET_DIR/ifo_shim$EXT"

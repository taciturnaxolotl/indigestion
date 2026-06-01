import { dlopen, CString, ptr } from "bun:ffi"
import path from "path"
import platforms from "../platforms.json"

// Platform detection logic must match shim/build.sh
// When adding a new platform, update both this file and shim/build.sh

// Resolve the shim library path based on platform
function getShimPath(): string {
  const platform = process.platform
  const arch = process.arch
  const key = `${platform}-${arch}` as keyof typeof platforms
  
  const config = platforms[key]
  if (!config) {
    throw new Error(`Unsupported platform: ${platform} ${arch}`)
  }

  return path.join(__dirname, "..", "prebuilds", config.dir, `ifo_shim${config.ext}`)
}

const shimPath = getShimPath()

// Load the shim library
const { symbols } = dlopen(shimPath, {
  ifo_parse_disc: {
    args: ["cstring"],
    returns: "pointer",
  },
  ifo_parse_free: {
    args: ["pointer"],
    returns: "void",
  },
})

export function parseDisc(source: string): string | null {
  const result = symbols.ifo_parse_disc(source)
  
  if (result === null || result === 0) {
    return null
  }

  // Read the C string
  const cstr = new CString(result)
  const json = cstr.toString()

  // Free the allocated memory
  symbols.ifo_parse_free(ptr(result))

  return json
}

import { dlopen, CString, ptr } from "bun:ffi"
import path from "path"

// Resolve the shim library path based on platform
function getShimPath(): string {
  const platform = process.platform
  const arch = process.arch

  let dir: string
  if (platform === "darwin") {
    if (arch === "arm64") {
      dir = "darwin-arm64"
    } else {
      dir = "darwin-x64"
    }
  } else if (platform === "linux") {
    if (arch === "arm64" || arch === "aarch64") {
      dir = "linux-arm64"
    } else {
      dir = "linux-x64"
    }
  } else {
    throw new Error(`Unsupported platform: ${platform} ${arch}`)
  }

  const ext = platform === "darwin" ? ".dylib" : ".so"
  return path.join(__dirname, "..", "prebuilds", dir, `ifo_shim${ext}`)
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

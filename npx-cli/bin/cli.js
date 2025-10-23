#!/usr/bin/env node

const { execSync, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

// Detect true CPU arch on macOS (handles Rosetta)
function getUnderlyingArch() {
  const platform = process.platform;
  const nodeArch = process.arch;

  if (platform !== "darwin") {
    return nodeArch;
  }

  // If Node itself is arm64, we’re natively on Apple silicon
  if (nodeArch === "arm64") {
    return "arm64";
  }

  // Otherwise check for Rosetta translation
  try {
    const translated = execSync("sysctl -in sysctl.proc_translated", {
      encoding: "utf8",
    }).trim();
    if (translated === "1") {
      return "arm64";
    }
  } catch {
    // sysctl key not present → assume true Intel
  }

  return "x64";
}

const platform = process.platform;
const arch = getUnderlyingArch();

// Map to our build target names
function getPlatformDir() {
  if (platform === "linux" && arch === "x64") return "linux-x64";
  if (platform === "linux" && arch === "arm64") return "linux-arm64";
  if (platform === "win32" && arch === "x64") return "windows-x64";
  if (platform === "win32" && arch === "arm64") return "windows-arm64";
  if (platform === "darwin" && arch === "x64") return "macos-x64";
  if (platform === "darwin" && arch === "arm64") return "macos-arm64";

  console.error(`❌ Unsupported platform: ${platform}-${arch}`);
  console.error("Supported platforms:");
  console.error("  - Linux x64");
  console.error("  - Linux ARM64");
  console.error("  - Windows x64");
  console.error("  - Windows ARM64");
  console.error("  - macOS x64 (Intel)");
  console.error("  - macOS ARM64 (Apple Silicon)");
  process.exit(1);
}

function getBinaryName(base) {
  return platform === "win32" ? `${base}.exe` : base;
}

const platformDir = getPlatformDir();
const extractDir = path.join(__dirname, "..", "dist", platformDir);
const isMcpMode = process.argv.includes("--mcp") || process.argv.includes("--mcp-advanced");
const isAdvancedMode = process.argv.includes("--mcp-advanced");

// ensure output dir
fs.mkdirSync(extractDir, { recursive: true });

function extractAndRun(baseName, launch) {
  const binName = getBinaryName(baseName);
  const binPath = path.join(extractDir, binName);
  const zipName = `${baseName}.zip`;
  const zipPath = path.join(extractDir, zipName);

  // clean old binary
  if (fs.existsSync(binPath)) fs.unlinkSync(binPath);
  if (!fs.existsSync(zipPath)) {
    console.error(`❌ ${zipName} not found at: ${zipPath}`);
    console.error(`Current platform: ${platform}-${arch} (${platformDir})`);
    process.exit(1);
  }

  // extract
  const unzipCmd =
    platform === "win32"
      ? `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force"`
      : `unzip -qq -o "${zipPath}" -d "${extractDir}"`;
  execSync(unzipCmd, { stdio: "inherit" });

  // perms & launch
  if (platform !== "win32") {
    try {
      fs.chmodSync(binPath, 0o755);
    } catch { }
  }
  return launch(binPath);
}

if (isMcpMode) {
  extractAndRun("automagik-forge-mcp", (bin) => {
    const env = { ...process.env };
    const args = isAdvancedMode ? ["--advanced"] : [];
    const proc = spawn(bin, args, { stdio: "inherit", env });
    proc.on("exit", (c) => process.exit(c || 0));
    proc.on("error", (e) => {
      console.error("❌ MCP server error:", e.message);
      process.exit(1);
    });
    process.on("SIGINT", () => {
      console.log("\n🛑 Shutting down MCP server...");
      proc.kill("SIGINT");
    });
    process.on("SIGTERM", () => proc.kill("SIGTERM"));
  });
} else {
  console.log(`📦 Extracting automagik-forge...`);
  extractAndRun("automagik-forge", (bin) => {
    console.log(`🚀 Launching automagik-forge...`);
    // Load .env from current working directory (best-effort), then set defaults
    const env = { ...process.env };
    try {
      const dotenvPath = path.join(process.cwd(), ".env");
      if (fs.existsSync(dotenvPath)) {
        const raw = fs.readFileSync(dotenvPath, "utf8");
        for (const line of raw.split(/\r?\n/)) {
          if (!line || /^\s*#/.test(line)) continue;
          const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
          if (!m) continue;
          const key = m[1];
          let val = m[2];
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          // Only set if not already provided in the process environment
          if (env[key] === undefined) env[key] = val;
        }
        console.log(`🔧 Loaded environment from .env in ${process.cwd()}`);
      }
    } catch (e) {
      console.warn(`⚠️  Failed to load .env: ${e.message}`);
    }
    
    // Set default environment variables if not already set
    if (!env.BACKEND_PORT && !env.PORT) {
      env.BACKEND_PORT = "8887";
    }
    
    if (platform === "win32") {
      execSync(`"${bin}"`, { stdio: "inherit", env });
    } else {
      execSync(`"${bin}"`, { stdio: "inherit", env });
    }
  });
}

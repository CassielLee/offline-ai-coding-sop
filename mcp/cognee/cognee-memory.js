import { spawn } from "node:child_process"
import { existsSync, readFileSync, appendFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = join(__dirname, "..", "opencode.json")
const HELPER_PATH = join(__dirname, "cognee-memory-helper.py")
const LOG_PATH = join(__dirname, "cognee-memory.log")

const DEFAULT_OPTIONS = {
  enabled: true,
  dataset: "main_dataset",
  topK: 5,
  maxRecallChars: 4000,
  maxSavedChars: 6000,
  timeoutMs: 120000,
  memorySessionPrefix: "opencode-cognee-memory",
  saveAssistantText: true,
}

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{16,}/g,
  /(api[_-]?key|token|password|secret)\s*[:=]\s*[^\s]+/gi,
  /Bearer\s+[A-Za-z0-9._-]+/g,
]

function log(level, message, extra = {}) {
  const entry = { time: new Date().toISOString(), level, message, ...extra }
  appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n", "utf8")
}

function readCogneeConfig() {
  const raw = readFileSync(CONFIG_PATH, "utf8")
  const config = JSON.parse(raw)
  const cognee = config?.mcp?.cognee
  if (!cognee?.environment) {
    throw new Error("mcp.cognee.environment not found in opencode.json")
  }
  return {
    cwd: cognee.cwd || process.cwd(),
    python: join(cognee.cwd || "D:\\AI-Coding\\cognee-mcp-runtime", ".venv313", "Scripts", "python.exe"),
    env: cognee.environment,
  }
}

function sanitizeSessionID(value) {
  return String(value || "global").replace(/[^A-Za-z0-9_.:-]+/g, "_").slice(0, 180)
}

function memorySessionID(ctx, input, options) {
  const projectKey = ctx.project?.id || ctx.project?.name || ctx.directory || "global"
  return `${options.memorySessionPrefix}:${sanitizeSessionID(projectKey)}`
}

function textFromParts(parts) {
  return parts
    .filter((part) => part && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim()
}

function redactSecrets(text) {
  let result = text
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]")
  }
  return result
}

function truncate(text, maxChars) {
  if (text.length <= maxChars) return text
  return `${text.slice(0, Math.max(0, maxChars - 20))}\n[truncated]`
}

function parseJsonOutput(stdout) {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index])
    } catch {}
  }
  throw new Error(`helper did not return JSON: ${stdout.slice(0, 500)}`)
}

function callHelper(config, options, payload) {
  return new Promise((resolve, reject) => {
    if (!existsSync(config.python)) {
      reject(new Error(`Python not found: ${config.python}`))
      return
    }
    const child = spawn(config.python, [HELPER_PATH], {
      cwd: config.cwd,
      env: { ...process.env, ...config.env },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`Cognee helper timed out after ${options.timeoutMs}ms`))
    }, options.timeoutMs)
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    child.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`Cognee helper exited ${code}: ${stderr.slice(-1000)}`))
        return
      }
      try {
        resolve(parseJsonOutput(stdout))
      } catch (error) {
        reject(error)
      }
    })
    child.stdin.end(JSON.stringify(payload))
  })
}

function buildRecallBlock(text) {
  const clean = text.trim()
  if (!clean) return ""
  return [
    "<cognee_recalled_memory>",
    "The following memory was automatically recalled for this turn. Use it only when relevant.",
    clean,
    "</cognee_recalled_memory>",
  ].join("\n")
}

function buildTurnMemory({ sessionID, userText, assistantText, directory }) {
  const lines = [
    `OpenCode automatic memory. session=${sessionID}`,
    `project_directory=${directory}`,
    "User request:",
    userText,
  ]
  if (assistantText) {
    lines.push("Assistant result:", assistantText)
  }
  return lines.join("\n")
}

export const CogneeMemoryPlugin = async (ctx, pluginOptions = {}) => {
  const options = { ...DEFAULT_OPTIONS, ...pluginOptions }
  if (!options.enabled) return {}

  const config = readCogneeConfig()
  const pendingTurns = new Map()

  log("info", "Cognee memory plugin initialized", {
    project: ctx.project?.name,
    directory: ctx.directory,
    helper: HELPER_PATH,
  })

  return {
    "chat.message": async (input, output) => {
      const userText = redactSecrets(textFromParts(output.parts))
      if (!userText) return

      const sessionID = memorySessionID(ctx, input, options)
      pendingTurns.set(input.sessionID, { userText, assistantText: "", savedKey: "" })

      try {
        const result = await callHelper(config, options, {
          action: "recall",
          query: userText,
          dataset: options.dataset,
          top_k: options.topK,
          session_id: sessionID,
        })
        if (!result.ok) {
          log("warn", "Cognee recall failed", { error: result.error })
          return
        }
        const block = buildRecallBlock(truncate(String(result.text || ""), options.maxRecallChars))
        if (block) {
          output.parts.unshift({ type: "text", text: block })
          log("info", "Cognee recall injected", { session: input.sessionID, chars: block.length })
        }
      } catch (error) {
        log("warn", "Cognee recall exception", { error: String(error) })
      }
    },

    "experimental.text.complete": async (input, output) => {
      if (!options.saveAssistantText) return
      const pending = pendingTurns.get(input.sessionID)
      if (!pending || typeof output.text !== "string") return
      pending.assistantText = truncate(redactSecrets(output.text), options.maxSavedChars)
    },

    event: async ({ event }) => {
      if (event.type !== "session.idle") return
      const sessionID = event.properties?.sessionID || event.properties?.session?.id
      if (!sessionID) return
      const pending = pendingTurns.get(sessionID)
      if (!pending) return

      const memoryText = truncate(
        buildTurnMemory({
          sessionID,
          userText: pending.userText,
          assistantText: pending.assistantText,
          directory: ctx.directory,
        }),
        options.maxSavedChars,
      )
      const saveKey = `${pending.userText}\n${pending.assistantText}`
      if (pending.savedKey === saveKey) return

      callHelper(config, options, {
        action: "remember",
        data: memoryText,
        dataset: options.dataset,
        session_id: memorySessionID(ctx, { sessionID }, options),
      })
        .then((result) => {
          if (!result.ok) {
            log("warn", "Cognee remember failed", { error: result.error })
            return
          }
          pending.savedKey = saveKey
          log("info", "Cognee memory saved", { session: sessionID, chars: memoryText.length })
        })
        .catch((error) => {
          log("warn", "Cognee remember exception", { error: String(error) })
        })
    },
  }
}

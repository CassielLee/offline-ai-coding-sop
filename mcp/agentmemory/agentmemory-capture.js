import { appendFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const API = process.env.AGENTMEMORY_URL || "http://localhost:3111"
const SECRET = process.env.AGENTMEMORY_SECRET || ""
const LOG_PATH = join(__dirname, "agentmemory-capture.log")

const INSTRUCTIONS = `<agentmemory-instructions>
You have access to persistent cross-session memory through agentmemory MCP tools.
Use agentmemory_memory_save when the user asks you to remember something, or when a durable project decision, workflow, bug, or preference should be available in future sessions.
Use agentmemory_memory_smart_search or agentmemory_memory_recall when the user asks what happened before, asks whether you remember something, or when past context would materially improve the answer.
Use agentmemory_memory_lesson_save for reusable lessons, and agentmemory_memory_lesson_recall before decisions where past lessons may apply.
Always inspect tool results before presenting recalled memory.
</agentmemory-instructions>`

const injectedSessions = new Set()
let activeSessionId = null
let projectPath = null

function log(level, message, extra = {}) {
  const entry = { time: new Date().toISOString(), level, message, ...extra }
  appendFileSync(LOG_PATH, `${JSON.stringify(entry)}\n`, "utf8")
}

function headers() {
  const result = { "Content-Type": "application/json" }
  if (SECRET) result.Authorization = `Bearer ${SECRET}`
  return result
}

async function post(path, body, timeoutMs = 5000) {
  try {
    const response = await fetch(`${API}/agentmemory${path}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) {
      log("warn", "agentmemory request failed", { path, status: response.status })
      return null
    }
    const text = await response.text()
    if (!text) return {}
    return JSON.parse(text)
  } catch (error) {
    log("warn", "agentmemory request exception", { path, error: String(error) })
    return null
  }
}

async function observe(sessionId, hookType, data) {
  if (!sessionId) return
  await post("/observe", {
    hookType,
    sessionId,
    project: projectPath,
    cwd: projectPath,
    timestamp: new Date().toISOString(),
    data,
  })
}

function textFromParts(parts) {
  if (!Array.isArray(parts)) return ""
  return parts
    .filter((part) => part && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim()
    .slice(0, 8000)
}

function sessionIdFrom(input) {
  return input?.sessionID || activeSessionId
}

export const AgentmemoryCapturePlugin = async (ctx) => {
  projectPath = ctx.worktree || ctx.directory || ctx.project?.id || process.cwd()
  log("info", "agentmemory plugin initialized", { project: ctx.project?.name, directory: ctx.directory })

  return {
    event: async ({ event }) => {
      const type = event?.type
      const props = event?.properties || {}

      if (type === "session.created") {
        const info = props.info || {}
        activeSessionId = info.id || props.sessionID || null
        if (!activeSessionId) return
        injectedSessions.delete(activeSessionId)
        await post("/session/start", {
          sessionId: activeSessionId,
          title: info.title || null,
          parentID: info.parentID || null,
          project: projectPath,
          cwd: projectPath,
        })
        return
      }

      if (type === "session.status") {
        const sid = props.sessionID || activeSessionId
        const status = props.status || {}
        if (status.type === "idle") await post("/summarize", { sessionId: sid })
        await observe(sid, "session_status", { status_type: status.type || "unknown" })
        return
      }

      if (type === "session.deleted") {
        const sid = props.info?.id || props.sessionID || activeSessionId
        await post("/session/end", { sessionId: sid })
        if (sid === activeSessionId) activeSessionId = null
        if (sid) injectedSessions.delete(sid)
        return
      }

      if (type === "todo.updated") {
        const sid = props.sessionID || activeSessionId
        const todos = Array.isArray(props.todos) ? props.todos.slice(0, 100) : []
        await observe(sid, "task_update", { todos })
        return
      }

      if (type === "command.executed") {
        await observe(props.sessionID || activeSessionId, "command_executed", {
          name: props.name || "",
          arguments: props.arguments || "",
        })
      }
    },

    "chat.message": async (input, output) => {
      const sid = sessionIdFrom(input)
      const prompt = textFromParts(output?.parts)
      if (!sid || !prompt) return
      await observe(sid, "prompt_submit", {
        agent: input?.agent || null,
        model: input?.model || null,
        prompt,
      })
    },

    "experimental.chat.system.transform": async (input, output) => {
      const sid = sessionIdFrom(input)
      if (!sid || injectedSessions.has(sid) || !Array.isArray(output?.system)) return
      output.system.push(INSTRUCTIONS)
      const context = await post("/context", { sessionId: sid, project: projectPath })
      if (typeof context?.context === "string" && context.context.length > 0) {
        output.system.push(context.context)
      }
      injectedSessions.add(sid)
    },

    config: async (input) => {
      await observe(activeSessionId, "config_loaded", {
        model: input?.model || null,
        providers: input?.provider && typeof input.provider === "object" ? Object.keys(input.provider) : [],
        mcp_servers: input?.mcp && typeof input.mcp === "object" ? Object.keys(input.mcp) : [],
      })
    },
  }
}

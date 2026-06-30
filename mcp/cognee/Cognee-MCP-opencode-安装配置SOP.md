# Cognee MCP 在 opencode 中的安装配置 SOP

本文记录在 Windows + opencode 环境中安装、配置、验证 Cognee MCP 的标准流程。目标场景是不使用 Docker，使用 pip/venv 安装，目标电脑 Python 固定为 3.13，并接入 OpenAI-compatible 的内网或代理大模型接口。

本文所有终端命令均使用 bash 风格。若在 Windows 上执行，建议使用 Git Bash、MSYS2 Bash、WSL Bash，或把命令转换为 PowerShell 等价命令。

## 1. 适用范围

适用于以下场景：

- Windows 电脑上使用 opencode。
- 没有 Docker 环境。
- 目标电脑 Python 为 3.13。
- 使用 Python + pip 安装 `cognee-mcp`。
- LLM 和 embedding 由内网模型服务或 OpenAI-compatible 网关提供。
- 需要让 opencode 通过 MCP 调用 Cognee 的记忆能力。

## 2. 路径约定

Windows 实际路径：

```text
D:\AI-Coding\cognee-mcp-runtime
C:\Users\<用户名>\.config\opencode\opencode.json
```

在 Git Bash 中可写为：

```text
/d/AI-Coding/cognee-mcp-runtime
/c/Users/<用户名>/.config/opencode/opencode.json
```

后续命令使用 bash 路径；opencode 配置文件中的 `command` 仍使用 Windows 路径，因为 opencode 运行在 Windows 环境中。

## 3. 前置检查

检查 opencode：

```bash
opencode --version
```

检查 Python 3.13：

```bash
python --version
python -m pip --version
```

期望 Python 主版本为 3.13：

```text
Python 3.13.x
```

如果系统默认 `python` 不是 3.13，应改用实际的 Python 3.13 绝对路径创建虚拟环境。

## 4. 创建安装目录

建议不要装到业务项目目录，也不要装到系统 Python。示例目录：

```bash
mkdir -p /d/AI-Coding/cognee-mcp-runtime
cd /d/AI-Coding/cognee-mcp-runtime
```

## 5. 创建 Python 3.13 虚拟环境

如果 `python` 已指向 Python 3.13：

```bash
python -m venv .venv313
```

如果需要指定 Python 3.13 绝对路径，例如本机实际路径：

```bash
"/c/Users/<用户名>/AppData/Roaming/uv/python/cpython-3.13.14-windows-x86_64-none/python.exe" -m venv /d/AI-Coding/cognee-mcp-runtime/.venv313
```

虚拟环境用于隔离依赖，避免污染系统 Python。后续 opencode 会直接启动虚拟环境里的 `cognee-mcp.exe`。

## 6. 安装 cognee-mcp

进入安装目录：

```bash
cd /d/AI-Coding/cognee-mcp-runtime
```

升级基础安装工具：

```bash
./.venv313/Scripts/python.exe -m pip install -U pip setuptools wheel
```

安装 Cognee MCP：

```bash
./.venv313/Scripts/python.exe -m pip install cognee-mcp
```

验证安装：

```bash
./.venv313/Scripts/python.exe -m pip show cognee-mcp
test -f ./.venv313/Scripts/cognee-mcp.exe && echo "cognee-mcp exists"
```

期望结果：

```text
Name: cognee-mcp
Version: 0.5.4
cognee-mcp exists
```

## 7. 准备数据目录

不要让 Cognee 把数据库写进 `site-packages`。单独准备数据目录：

```bash
mkdir -p /d/AI-Coding/cognee-mcp-runtime/data
mkdir -p /d/AI-Coding/cognee-mcp-runtime/system
```

## 8. 配置 opencode MCP

opencode 用户级配置通常位于：

```text
C:\Users\<用户名>\.config\opencode\opencode.json
```

在配置中增加 `mcp.cognee`。如果已有其他 `mcp` 配置，不要覆盖，合并 `cognee` 条目即可：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "cognee": {
      "type": "local",
      "cwd": "D:\\AI-Coding\\cognee-mcp-runtime",
      "command": [
        "D:\\AI-Coding\\cognee-mcp-runtime\\.venv313\\Scripts\\cognee-mcp.exe"
      ],
      "enabled": true,
      "timeout": 120000,
      "environment": {
        "DB_PROVIDER": "sqlite",
        "GRAPH_DATABASE_PROVIDER": "kuzu",
        "VECTOR_DB_PROVIDER": "lancedb",
        "DATA_ROOT_DIRECTORY": "D:\\AI-Coding\\cognee-mcp-runtime\\data",
        "SYSTEM_ROOT_DIRECTORY": "D:\\AI-Coding\\cognee-mcp-runtime\\system",
        "ENABLE_BACKEND_ACCESS_CONTROL": "False",
        "REQUIRE_AUTHENTICATION": "False",
        "COGNEE_SKIP_CONNECTION_TEST": "true",
        "GRAPH_DATABASE_SUBPROCESS_ENABLED": "False",
        "VECTOR_DB_SUBPROCESS_ENABLED": "False",

        "LLM_PROVIDER": "openai",
        "LLM_MODEL": "gpt-5.5",
        "LLM_ENDPOINT": "https://www.yyapi.cloud/v1",
        "LLM_API_KEY": "<你的 API Key>",

        "EMBEDDING_PROVIDER": "openai",
        "EMBEDDING_MODEL": "openai/text-embedding-3-large",
        "EMBEDDING_ENDPOINT": "https://www.yyapi.cloud/v1",
        "EMBEDDING_API_KEY": "<你的 API Key>",
        "EMBEDDING_DIMENSIONS": "3072"
      }
    }
  }
}
```

说明：

- `COGNEE_SKIP_CONNECTION_TEST=true` 用于跳过 Cognee 启动前的 LLM/embedding 连接测试。某些 OpenAI-compatible 网关普通 chat 可用，但 structured-output 测试会被拦截，导致启动或写入阶段超时。
- `GRAPH_DATABASE_SUBPROCESS_ENABLED=False` 和 `VECTOR_DB_SUBPROCESS_ENABLED=False` 用于规避 Windows 上 Kuzu/Ladybug worker subprocess 初始化慢、残留锁、文件锁冲突等问题。
- `ENABLE_BACKEND_ACCESS_CONTROL=False` 和 `REQUIRE_AUTHENTICATION=False` 适合本地单用户场景。
- `EMBEDDING_DIMENSIONS` 必须和 embedding 模型实际维度一致。`text-embedding-3-large` 通常是 3072。

## 9. 重启 opencode 并确认连接

修改配置后重启 opencode，然后执行：

```bash
opencode mcp list
```

期望看到：

```text
✓ cognee connected
```

## 10. 基础可用性测试

### 10.1 测试 session memory

在 opencode 中输入：

```text
use cognee remember 这是一条 session 测试记忆：代号 session-cognee-test，颜色 cyan。
```

再输入：

```text
use cognee recall session-cognee-test 的颜色是什么？
```

如果能召回 `cyan`，说明 MCP 工具调用链路是通的。

### 10.2 测试永久知识图谱记忆

在 opencode 中输入：

```text
use cognee remember 这是一条永久知识图谱测试记忆：代号 permanent-cognee-test，颜色 cyan。
```

再输入：

```text
use cognee recall permanent-cognee-test 的颜色是什么？
```

如果能召回 `cyan`，说明 LLM、embedding、图数据库、向量库都已跑通。

## 11. 自动保存和自动提取记忆

仅配置 MCP 后，Cognee 工具会出现在 opencode 中，但不会天然做到“每次对话自动保存、每次回答前自动提取”。若要每轮自动执行，需要使用 opencode plugin/hook。

当前电脑已实现并验证全局插件方案。

### 11.1 插件文件

插件目录：

```text
C:\Users\<用户名>\.config\opencode\plugins
```

当前电脑已创建：

```text
C:\Users\cassi\.config\opencode\plugins\cognee-memory.js
C:\Users\cassi\.config\opencode\plugins\cognee-memory-helper.py
C:\Users\cassi\.config\opencode\package.json
```

本 SOP 所在目录也附带了一份可复制版本：

```text
D:\agent辅助编程学习资料\mcp配置教程\cognee-memory.js
D:\agent辅助编程学习资料\mcp配置教程\cognee-memory-helper.py
D:\agent辅助编程学习资料\mcp配置教程\opencode-package.json
```

迁移到其他电脑时，把 `cognee-memory.js` 和 `cognee-memory-helper.py` 复制到目标电脑的 opencode plugins 目录，把 `opencode-package.json` 的内容合并进目标电脑的 `C:\Users\<用户名>\.config\opencode\package.json`。

`package.json` 需要包含 ESM 标记：

```json
{
  "type": "module",
  "dependencies": {
    "@opencode-ai/plugin": "1.4.6"
  }
}
```

### 11.2 Hook 行为

插件使用 opencode 官方 plugin API：

```text
chat.message
experimental.text.complete
event: session.idle
```

每轮行为：

- `chat.message`：读取当前用户输入，调用 Cognee session recall，自动把命中的记忆插入本轮上下文。
- `experimental.text.complete`：收集本轮 assistant 最终文本。
- `session.idle`：当本轮结束后，自动把 user request + assistant result 写入 Cognee session cache。

Recall 不是全量注入。插件会用本轮用户输入作为 query，只注入 Cognee session recall 返回的匹配结果，默认 `topK=5`，并且总注入内容默认截断到 `4000` 字符。如果没有匹配结果，则不插入记忆块。

当前默认使用 session cache，因此筛选方式是关键词命中排序，不是向量语义检索。永久知识图谱和 embedding 可用后，可以把插件扩展为图谱/向量召回。

自动注入的记忆块格式：

```text
<cognee_recalled_memory>
The following memory was automatically recalled for this turn. Use it only when relevant.
...
</cognee_recalled_memory>
```

### 11.3 为什么默认使用 session cache

当前 yyapi 普通 chat 请求可用，但 Cognee 永久知识图谱写入需要 structured output，实测会被网关拦截：

```text
OpenAIException - Your request was blocked.
```

因此插件默认使用 Cognee session cache：

- 不触发永久图谱的 LLM structured-output 抽取。
- 不触发 embedding 和 Kuzu 图谱写入。
- 避免和已经由 opencode 启动的 `cognee-mcp.exe` 抢 Kuzu 文件锁。
- 能实现每轮自动保存、每轮自动 recall。

如果后续换成支持 JSON schema/tool-call/structured-output 的模型网关，可以再扩展插件，把 `remember` 从 session cache 切换到永久图谱写入。

### 11.4 验证命令

检查 helper 语法：

```bash
"/d/AI-Coding/cognee-mcp-runtime/.venv313/Scripts/python.exe" -m py_compile "/c/Users/<用户名>/.config/opencode/plugins/cognee-memory-helper.py"
```

检查插件能被 Node 加载：

```bash
node -e "await import('file:///C:/Users/<用户名>/.config/opencode/plugins/cognee-memory.js'); console.log('plugin import ok')"
```

检查 opencode 启动后 Cognee MCP 仍连接：

```bash
opencode mcp list
```

期望看到：

```text
✓ cognee connected
```

当前电脑已验证的 smoke 结果：

```text
Cognee memory saved
Cognee recall injected
```

插件日志位置：

```text
C:\Users\cassi\.config\opencode\plugins\cognee-memory.log
```

### 11.5 回滚方式

如果插件导致 opencode 启动变慢或需要临时关闭自动记忆，移动或删除插件文件即可：

```bash
mkdir -p /c/Users/<用户名>/.config/opencode/plugins.disabled
mv /c/Users/<用户名>/.config/opencode/plugins/cognee-memory.js /c/Users/<用户名>/.config/opencode/plugins.disabled/
mv /c/Users/<用户名>/.config/opencode/plugins/cognee-memory-helper.py /c/Users/<用户名>/.config/opencode/plugins.disabled/
```

然后重启 opencode。

## 12. 永久记忆依赖说明

Cognee 的永久知识图谱需要两类模型接口：

```text
Chat/LLM 模型：用于实体抽取、关系抽取、摘要、图谱构建。
Embedding 模型：用于文本块、实体、关系的向量化检索。
```

永久记忆链路大致如下：

```text
原始文本
  -> 分块
  -> embedding 向量化
  -> LLM 结构化抽取实体/关系/摘要
  -> 写入 Kuzu/Ladybug 图数据库
  -> 写入 LanceDB 向量库
```

所以仅有普通 chat 模型不够，还需要 embedding 接口。

## 13. Structured Output 兼容性说明

Cognee 不是只发普通 chat/completions 请求。它通过 `instructor + litellm` 使用 structured output，让模型按 schema 返回 JSON 或 tool-call 风格结果。

普通 chat：

```json
{
  "model": "gpt-5.5",
  "messages": [
    { "role": "user", "content": "hello" }
  ]
}
```

structured output 可能包含：

```json
{
  "model": "gpt-5.5",
  "messages": [...],
  "response_format": {
    "type": "json_object"
  }
}
```

或更严格的 JSON schema / tool-call 结构。

常见兼容性问题：

- 普通 `/chat/completions` 返回 200，但 structured output 被网关拦截。
- 网关不支持 `response_format=json_object`。
- 网关不支持 JSON schema structured outputs。
- 网关不支持 tool/function calling。
- 模型名格式不匹配，例如 `openai/gpt-5.5` 与 `gpt-5.5`。

实际测试中，普通 yyapi chat 请求可返回 200，但 Cognee structured-output 请求返回：

```text
OpenAIException - Your request was blocked.
```

这说明 MCP 和 API key/baseURL 不一定有问题，问题可能在模型网关对 structured-output 的兼容性。

## 14. 如果内网模型只支持普通 chat

可以在内网模型前面封装一个 OpenAI-compatible proxy：

```text
Cognee structured request
  -> 代理解析 response_format / tools / schema
  -> 转换成“必须只输出 JSON”的 prompt
  -> 调普通 chat 接口
  -> 校验 JSON/schema
  -> 失败自动重试或修复
  -> 包装成 OpenAI-compatible 响应
```

最低可用能力：

- 支持 `response_format=json_object`。
- 将 schema 注入 system prompt。
- 提取 JSON。
- JSON parse 校验。
- schema 校验。
- 失败自动重试。

这不是服务端强约束 structured output，只是 prompt + 校验 + 重试，稳定性取决于模型遵循格式的能力。

## 15. 常见故障排查

### 15.1 `LLM connection test timed out after 30s`

含义：Cognee 的连接测试超时。

处理：

```jsonc
"COGNEE_SKIP_CONNECTION_TEST": "true"
```

重启 opencode 后再测。

### 15.2 `OpenAIException - Your request was blocked`

含义：普通 chat 可能可用，但 structured-output 请求被模型网关拦截。

处理方向：

- 换支持 JSON/schema/tool-call 的模型。
- 换支持 OpenAI structured output 的网关。
- 自建 proxy，把 structured-output 请求转成普通 chat + JSON 校验。

### 15.3 `Could not set lock on file ... cognee_graph_kuzu`

含义：Kuzu/Ladybug 图数据库文件被另一个进程占用。

查看相关进程：

```bash
wmic process where "name='python.exe' or name='cognee-mcp.exe'" get ProcessId,ParentProcessId,Name,CommandLine
```

如果看到父进程已经不存在的 Python worker，可以停止孤儿进程：

```bash
taskkill //PID <PID> //F
```

不要随意停止当前 opencode 正在使用的 `cognee-mcp.exe`，除非准备重启 opencode。

### 15.4 `Subprocess init timed out after 60s`

含义：Cognee 的图数据库或向量数据库 worker subprocess 初始化超时。

处理：

```jsonc
"GRAPH_DATABASE_SUBPROCESS_ENABLED": "False",
"VECTOR_DB_SUBPROCESS_ENABLED": "False"
```

修改后重启 opencode。

### 15.5 embedding 相关错误

检查：

```jsonc
"EMBEDDING_MODEL": "openai/text-embedding-3-large",
"EMBEDDING_DIMENSIONS": "3072"
```

如果内网 embedding 模型不是 3072 维，必须改成实际维度。

## 16. 离线部署建议

完全离线部署时，需要在同系统、同 Python 3.13 环境的联网机器上提前打包 wheels：

```bash
python -m pip wheel -w /d/wheels cognee-mcp
```

离线机器安装：

```bash
python -m pip install --no-index --find-links /d/wheels cognee-mcp
```

注意：

- Windows/Python 版本要一致，否则二进制 wheel 可能不可用。
- Cognee 依赖较多，包含 `lancedb`、`ladybug`、`pylance`、`unstructured`、`spacy`、`pyarrow` 等，离线包必须完整。
- 如果使用本地或内网 embedding/LLM，不需要公网模型服务。

## 17. 当前实测结论

在本机实测结果：

- `cognee-mcp` 安装成功。
- opencode 能显示 `cognee connected`。
- session memory 写入和召回成功。
- 全局 opencode plugin 已实现并验证：每轮 `chat.message` 自动 recall，`session.idle` 自动保存本轮摘要。
- 最新 smoke 日志显示 `Cognee memory saved` 和 `Cognee recall injected`。
- 普通 yyapi `/models` 和 `/chat/completions` 请求返回 200。
- 永久知识图谱写入进入 Cognee pipeline 后，LLM structured-output 请求被 yyapi 返回 `Your request was blocked`。

因此当前环境的 MCP 接入和每轮自动 session memory 已可用，但永久知识图谱完整可用还依赖一个支持 Cognee structured-output 请求的 LLM 网关或模型。

# Windows 本地运行指南（pi-agent-loop）

## 前置
- Node 22+（官方安装包即可）
- 本目录已包含 node_modules（在 WSL/Linux 下安装的）。Windows 下建议重装原生依赖：
    rmdir /s /q node_modules  (或 rm -rf node_modules)
    npm install

## 凭据
在同目录创建 credentials.json（或在 ~/.config/pi-agent-loop/credentials.json），格式：
{
  "glm":    { "base_url": "https://nanshanyougui.xyz/v1", "api_key": "<你的GLM中转key>" },
  "gemini": { "base_url": "http://127.0.0.1:8045/v1",     "api_key": "sk-antigravity" }
}
注意：base_url 只写到 /v1（代码会自动拼接 /responses 或 /chat/completions，多写会 404）。
Windows 下 Gemini 代理在 127.0.0.1:8045 直连即可（无需容器网关地址）。

## 运行
    npm run build   （如需）
    node bin/pi-agent-loop.mjs doctor
    node bin/pi-agent-loop.mjs run --workspace ./test-workspace --task "你的任务"
    node bin/pi-agent-loop.mjs tui
    node bin/pi-agent-loop.mjs rpc

## 已知修复
- proper-lockfile 的 ESM 导入已改为 import * as lockfile（jiti interopDefault:false 下默认导入为 undefined）
- credentials.json 中 GLM base_url 不得出现双重 /v1

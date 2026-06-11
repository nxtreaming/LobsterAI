# 实时语音输入设计文档

## 1. 概述

### 1.1 背景

现有语音输入使用短 ASR：renderer 录完整段音频，编码为 16 kHz、16-bit、单声道 WAV 后，通过主进程 IPC 调用 `POST /api/asr/recognize`，服务端一次性返回识别文本。

服务端已新增实时 ASR 接口：客户端先调用 `POST /api/asr/realtime/sessions` 创建一次性 WebSocket ticket，再连接 `/api/asr/realtime/ws?ticket=...` 流式发送 WAV/PCM 音频并接收滚动识别结果。

### 1.2 目标

- 保留现有短 ASR 能力。
- 新增实时 ASR，作为默认语音输入模式。
- 在设置页允许用户切换“实时识别”和“一次性录入”。
- 登录态、额度耗尽、限流、音频格式错误、服务不可用等错误提示复用现有 ASR 错误码映射。
- 实时模式允许长时间听写，单次上限跟随服务端 `maxSessionSeconds`。

## 2. 用户场景

### 场景 1: 默认实时语音输入

**Given** 用户已登录并使用默认设置。
**When** 用户点击 Cowork 输入框的语音按钮开始说话。
**Then** 应用创建实时 ASR 会话，边录音边更新输入框中的识别文本。

### 场景 2: 停止实时语音输入

**Given** 用户正在实时语音输入。
**When** 用户再次点击语音按钮。
**Then** 应用发送结束标记，等待短时间内的最终识别结果，并将最终文本保留在输入框中。

### 场景 3: 切回一次性录入

**Given** 用户在设置页选择“一次性录入”。
**When** 用户使用语音输入。
**Then** 应用沿用原短 ASR 流程，停止录音后上传完整 WAV 并追加识别文本。

## 3. 功能需求

### FR-1: 语音输入模式配置

配置项保存到全局 `app_config.voiceInput.recognitionMode`，可选值为 `realtime` 和 `short`，默认 `realtime`。

### FR-2: 实时会话创建

主进程新增 ASR IPC channel 调用 `POST /api/asr/realtime/sessions`。该请求必须复用现有 `fetchWithAuth()`，以获得 accessToken 注入和 401 被动刷新。

### FR-3: 实时音频流

renderer 使用麦克风采集单声道音频，重采样到 16 kHz，转换为 PCM 16-bit。第一帧发送合成 WAV header 与首段 PCM，后续帧发送 PCM 数据。WAV header 长度字段使用流式占位值。

客户端发送的单个 WebSocket binary message 不应超过服务端建议的帧大小：`16000 * 2 * chunkIntervalMillis / 1000` 字节，默认 `chunkIntervalMillis=200` 时为 6400 字节。第一帧需要把 WAV header 计入该上限，避免触发 WebSocket 1009（message too big）关闭。

### FR-4: 滚动识别结果合并

实时 ASR 的 `recognition.text` 是滚动修正文本，不是 append-only 增量。客户端应按 `raw.result[*].seg_id` 保存每段最新句子，并用 `partial=false` 判断稳定结果。输入框展示应替换当前语音输入片段，而不是逐条追加。

### FR-5: 错误处理

HTTP 创建会话失败、WebSocket `error` 消息、连接异常、麦克风权限异常都应映射到用户可理解的提示。服务端返回的 ASR 错误码继续使用现有提示文案。

## 4. 实现方案

### 4.1 类型与 IPC

- 在 `src/shared/asr/constants.ts` 增加实时会话 request/result 类型、实时事件类型和 IPC channel。
- 在 `src/main/ipcHandlers/asr/handlers.ts` 注册 `asr:realtime:createSession`。
- 在 preload 和 renderer 类型声明中暴露 `window.electron.asr.createRealtimeSession()`。

### 4.2 renderer 语音模块

在 `src/renderer/services/voiceInput/` 下继续按职责拆分：

- `realtimeAudioRecorder.ts`：负责麦克风采集、重采样、PCM chunk 输出。
- `realtimeAsrClient.ts`：负责创建会话、WebSocket 生命周期、发送音频、合并识别结果。
- `wavEncoder.ts`：复用并补充 WAV header 与 PCM 16-bit 编码工具。

### 4.3 Cowork 输入框

`useCoworkVoiceInput` 根据配置选择短 ASR 或实时 ASR。实时模式开始时记录输入框原始内容，后续识别结果只替换本次语音输入片段；停止后固化最终文本。

### 4.4 设置页

在“通用”设置中新增语音输入模式选择。保存时写入全局配置，取消时不持久化。

## 5. 边界情况

| 场景 | 处理方式 |
|------|---------|
| 未登录 | 沿用现有登录提示 |
| 麦克风不可用或被拒绝 | 沿用现有麦克风错误提示 |
| 实时会话创建返回 401 | `fetchWithAuth()` 先刷新 token 并重试一次；仍失败则提示登录 |
| 每日额度耗尽 | 服务端返回 `41404`，提示今日额度已用完 |
| 上游限流或并发超限 | 服务端返回 `41406`，提示服务繁忙 |
| WebSocket 中途断开 | 停止录音，保留已识别文本，并提示语音输入失败 |
| 没有识别到文本 | 停止后提示未识别到有效语音 |

## 6. 涉及文件

- `src/shared/asr/constants.ts`
- `src/main/ipcHandlers/asr/handlers.ts`
- `src/main/preload.ts`
- `src/renderer/types/electron.d.ts`
- `src/renderer/config.ts`
- `src/renderer/services/config.ts`
- `src/renderer/services/voiceInput/*`
- `src/renderer/components/cowork/voiceInput/*`
- `src/renderer/components/Settings.tsx`
- `src/renderer/services/i18n.ts`

## 7. 验收标准

- 默认配置下，语音输入走实时 ASR。
- 设置页可切换实时 ASR 和一次性录入，保存后生效。
- 实时 ASR 不重复追加滚动识别文本。
- 短 ASR 原有行为保持可用。
- 登录态、额度耗尽、限流、服务异常等错误有明确提示。
- TypeScript 编译和 ESLint 对相关文件通过。

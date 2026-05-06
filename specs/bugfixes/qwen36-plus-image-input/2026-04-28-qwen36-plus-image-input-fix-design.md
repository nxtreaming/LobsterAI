# qwen3.6 Plus 图像输入能力修复 Spec

## 问题描述

部分用户在 Cowork 中选择 `qwen3.6-plus` / `qwen3.6-plus-YoudaoInner` 后发送图片，LLM 回复“看不到图片”。从日志看，图片并不是上传失败，而是在 OpenClaw gateway 进入 LLM 前被提前丢弃。

需要满足以下要求：

1. `lobsterai-server/qwen3.6-plus-YoudaoInner` 支持图片输入时，OpenClaw 配置必须写出 `input: ['text', 'image']`
2. `qwen-portal/qwen3.6-plus` 支持图片输入时，不能因为本地配置里的过期 `supportsImage:false` 被降级为文本模型
3. 自定义供应商中的已知视觉模型，例如 `custom_0/qwen3.6-plus`，也应获得正确的图片能力
4. 服务端模型列表更新后，OpenClaw gateway 必须能拿到最新模型能力
5. 修复不能把已知纯文本模型错误升级成视觉模型
6. 即使 `openclaw.json` 已经写对，OpenClaw runtime 的 model catalog / 发图前能力预检也不能因为 provider alias 或 catalog miss 再把图片丢弃

## 核心结论

**这不是 qwen3.6 Plus 模型本身不支持图片，而是 LobsterAI 写给 OpenClaw 的模型能力元数据不可靠。**

OpenClaw gateway 依据 `openclaw.json` 中的 `models.providers[*].models[*].input` 判断模型是否支持图片。如果该字段是 `['text']`，gateway 会在请求进入 LLM 前丢弃图片。

**2026-05-06 补充结论：第一次修复只覆盖了 LobsterAI 写配置的链路，还不够。** 最新日志显示，当前 `openclaw.json` 已经包含 `qwen3.6-plus` / `qwen3.6-plus-YoudaoInner` 的 `input: ['text', 'image']`，但 OpenClaw gateway 仍输出：

```
parseMessageWithAttachments: 1 attachment(s) dropped — model does not support images
provider=lobsterai-server model=qwen3.6-plus-YoudaoInner
promptImages=0
```

这说明图片不是在 LobsterAI 侧上传或配置写入阶段丢失，而是在 OpenClaw runtime 的 `resolveGatewayModelSupportsImages()` 预检阶段被判定为不支持图片。根因是 OpenClaw 当前版本的 model catalog 可能没有包含显式配置的 provider model，且 provider 比较使用精确字符串；`qwen-portal` 与 OpenClaw 原生 `qwen` 没有归一化到同一 provider，catalog miss 后函数直接返回 `false`。

| 场景 | 错误表现 | 根因 |
|---|---|---|
| `lobsterai-server/qwen3.6-plus-YoudaoInner` | 模型不在 provider 注册表里，图片被丢弃 | `lobsterai-server` 只注册默认模型，未合并服务端全量模型 |
| `qwen-portal/qwen3.6-plus` | 模型存在，但 `input` 被写成 `['text']` | 本地 provider config 中 `supportsImage:false` 覆盖了真实能力 |
| `custom_0/qwen3.6-plus` | 自定义供应商同名视觉模型可能被当作文本模型 | 自定义模型只信任用户保存的 `supportsImage` |
| `openclaw.json` 已写出 `input: ['text', 'image']`，但 gateway 仍丢图 | `parseMessageWithAttachments` 继续提示 model does not support images | OpenClaw model catalog 未合并显式配置模型，且 `qwen-portal` / `qwen` provider alias 未归一化；catalog miss 直接降级为不支持图片 |

---

## 总体架构

```
ProviderRegistry
  → known model capability index
  → resolveModelSupportsImage(providerName, modelId, configuredSupportsImage)

Renderer ConfigService
  → load stored providers
  → normalize models with ProviderRegistry

Settings.tsx
  → add/edit/import/export provider models
  → normalize supportsImage before saving or exposing models

Main claudeSettings.ts
  → resolveRawApiConfig()
  → resolveAllEnabledProviderConfigs()
  → normalize provider model capabilities

OpenClawConfigSync
  → buildProviderSelection()
  → final capability guard
  → write openclaw.json models[].input

OpenClaw gateway
  → loadModelCatalog()
  → merge explicit models.providers entries
  → normalize provider aliases such as qwen-portal → qwen
  → resolveGatewayModelSupportsImages()
  → fallback to current OpenClaw config when catalog misses or is stale
  → parseMessageWithAttachments()
  → keep or drop image attachments based on models[].input
```

### 设计原则

1. **能力判断集中到 ProviderRegistry。** 内置 provider 的默认模型列表是已知模型能力的单一来源。
2. **最终写配置前再兜底。** 即使某条调用路径传入了过期 `supportsImage:false`，`buildProviderSelection()` 仍会重新解析能力。
3. **服务端模型按全量列表合并。** `lobsterai-server` 不再只注册当前默认模型。
4. **已知纯文本模型不被误升级。** 如果 provider registry 明确某模型不支持图片，用户配置里的 `supportsImage:true` 也会被纠正。
5. **未知模型尊重用户配置。** 对 registry 不认识的模型，用户勾选“支持图像输入”仍然有效。
6. **OpenClaw runtime 不能只信 catalog。** 发图前能力预检必须使用 provider alias 归一化，并在 catalog miss 或 catalog 过期时回退到当前 `openclaw.json`。

---

## 详细流程分析

### qwen-portal 模型能力解析

```
Stored app_config.providers.qwen.models
  → qwen3.6-plus may be saved as supportsImage:false
  → ConfigService / Settings / claudeSettings normalize models
  → ProviderRegistry.resolveModelSupportsImage('qwen', 'qwen3.6-plus', false)
  → ProviderRegistry finds qwen default model supportsImage:true
  → buildProviderSelection() writes input: ['text', 'image']
```

### 自定义供应商模型能力解析

```
Stored app_config.providers.custom_0.models
  → qwen3.6-plus may be saved as supportsImage:false
  → ProviderRegistry.resolveModelSupportsImage('custom_0', 'qwen3.6-plus', false)
  → no provider-specific definition
  → known model index finds qwen3.6-plus supportsImage:true
  → buildProviderSelection() writes input: ['text', 'image']
```

### lobsterai-server 模型能力解析

```
auth:getModels
  → GET /api/models/available
  → updateServerModelMetadata(all server models)
  → syncOpenClawConfig({ reason: 'server-models-updated', restartGatewayIfRunning: false })
  → openclawConfigSync merges all server models into lobsterai-server provider
  → qwen3.6-plus-YoudaoInner writes input: ['text', 'image']
  → running gateway receives config by hot reload; no hard restart on model refresh
```

### OpenClaw runtime 图像能力预检

```
chat.send
  → receives imageAttachments
  → resolves session model provider/model
  → resolveGatewayModelSupportsImages({ provider, model })
  → loadModelCatalog()
  → find catalog entry by normalized provider + exact model id
  → if catalog says image: keep images
  → if catalog misses or says text-only: fallback to openclaw.json models.providers[*].models[*].input
  → parseMessageWithAttachments({ supportsImages })
```

OpenClaw 的 model catalog 缓存是 runtime 内部的模型目录快照，不等同于 LobsterAI 设置页的 provider 表。它由 Pi `ModelRegistry`、provider plugin 补充项和显式 `openclaw.json.models.providers` 合并而来，并会被 gateway 的 `models.list` 和 `resolveGatewayModelSupportsImages()` 使用。此前显式配置模型没有可靠进入 catalog，导致 `qwen3.6-plus` 即使已经在 `openclaw.json` 中声明支持图片，仍可能在预检阶段被当成不支持图片。

---

## OpenClaw 配置生成

### 正确配置形态

`qwen-portal/qwen3.6-plus`：

```json
{
  "models": {
    "providers": {
      "qwen-portal": {
        "models": [
          {
            "id": "qwen3.6-plus",
            "api": "openai-completions",
            "input": ["text", "image"]
          }
        ]
      }
    }
  }
}
```

`lobsterai-server/qwen3.6-plus-YoudaoInner`：

```json
{
  "models": {
    "providers": {
      "lobsterai-server": {
        "baseUrl": "http://127.0.0.1:<proxyPort>/v1",
        "models": [
          {
            "id": "qwen3.6-plus-YoudaoInner",
            "api": "openai-completions",
            "input": ["text", "image"]
          }
        ]
      }
    }
  }
}
```

### 能力解析规则

```typescript
ProviderRegistry.resolveModelSupportsImage(
  providerName,
  modelId,
  configuredSupportsImage,
)
```

优先级：

1. provider-specific known model capability
2. configured `supportsImage:true`
3. global known model capability
4. configured value or `false`

该优先级保证：

| 输入 | 输出 |
|---|---|
| `qwen/qwen3.6-plus`, configured `false` | `true` |
| `qwen/qwen3-coder-plus`, configured `true` | `false` |
| `custom_0/qwen3.6-plus`, configured `false` | `true` |
| `custom_0/unknown-model`, configured `true` | `true` |
| `custom_0/unknown-model`, configured `false` | `false` |

---

## 关键问题与修复

### 问题 1：lobsterai-server 只注册默认模型

#### 现象

```
[gateway] parseMessageWithAttachments: 1 attachment(s) dropped — model does not support images
provider=lobsterai-server model=qwen3.6-plus-YoudaoInner
promptImages=0
```

`openclaw.json` 中只有：

```typescript
'lobsterai-server': {
  models: [
    { id: 'qwen3.5-plus-YoudaoInner', input: ['text', 'image'] }
  ]
}
```

#### 根因

`tryLobsteraiServerFallback()` 先构造了只包含默认模型的 provider。`openclawConfigSync` 后续看到 `lobsterai-server` provider 已存在，就跳过了服务端全量模型合并。

#### 修复

1. `tryLobsteraiServerFallback()` 使用缓存的服务端全量模型构造 fallback provider
2. `openclawConfigSync` 对 `lobsterai-server.models` 做 upsert，而不是 `if exists then skip`
3. `auth:getModels` 更新模型能力后只触发热更新，不因为服务端模型列表变化硬重启 gateway

### 问题 2：qwen provider 中 qwen3.6-plus 被保存成非视觉模型

#### 现象

4 月 26 日日志中出现：

```typescript
providerName: 'qwen',
models: [
  { id: 'qwen3.6-plus', supportsImage: false }
]
```

随后 OpenClaw 配置变成：

```typescript
{
  id: 'qwen3.6-plus',
  input: ['text']
}
```

发送图片时 gateway 丢弃附件：

```
parseMessageWithAttachments: 1 attachment(s) dropped — model does not support images
provider=qwen-portal model=qwen3.6-plus
promptImages=0
```

#### 根因

本地 provider config 是可编辑、可导入、可迁移的数据，历史版本或用户操作可能把已知视觉模型保存成 `supportsImage:false`。OpenClaw 配置生成此前完全信任该字段。

#### 修复

1. `ProviderRegistry` 建立已知模型能力索引
2. `claudeSettings` 在读取 provider 模型时修正能力
3. `ConfigService` 和 `Settings` 在加载、保存、导入、导出时修正能力
4. `buildProviderSelection()` 在最终生成 `input` 前再次修正能力

### 问题 3：自定义供应商同名视觉模型也可能失效

#### 现象

如果用户在 `custom_0` 中添加 `qwen3.6-plus`，但未勾选“支持图像输入”或导入了旧配置，OpenClaw 会写出：

```typescript
custom_0: {
  models: [
    { id: 'qwen3.6-plus', input: ['text'] }
  ]
}
```

#### 根因

自定义 provider 没有 provider-specific 默认模型列表，只能依赖用户保存的 `supportsImage`。但很多自定义 provider 实际代理的是已知模型。

#### 修复

`ProviderRegistry` 增加 global known model capability index。若 provider 不认识，但 model id 是已知视觉模型，例如 `qwen3.6-plus`、`gpt-5.4`、`gemini-3-pro-preview`，则自动修正为支持图片。

### 问题 4：OpenClaw catalog / preflight 仍可能丢弃图片

#### 现象

2026-05-06 日志中，LobsterAI 侧已经确认：

```
chat.send imageAttachments diagnosis: { hasImageAttachments: true, imageAttachmentsCount: 1 }
provider=lobsterai-server model=qwen3.6-plus-YoudaoInner
```

同时本地 `openclaw.json` 已包含：

```typescript
models.providers['lobsterai-server'].models[] = {
  id: 'qwen3.6-plus-YoudaoInner',
  input: ['text', 'image']
}
```

但 OpenClaw gateway 仍然输出：

```
parseMessageWithAttachments: 1 attachment(s) dropped — model does not support images
promptImages=0
```

#### 根因

OpenClaw 当前版本的 `resolveGatewayModelSupportsImages()` 有三处问题：

1. 只查 model catalog，catalog miss 时直接返回 `false`
2. provider 使用精确字符串比较，`qwen-portal` 与 OpenClaw 原生 `qwen` 无法匹配
3. model catalog 没有可靠合并 `openclaw.json.models.providers` 里的显式配置模型

因此第一次修复写对配置后，仍可能被 OpenClaw runtime 的二次能力判断覆盖成“不支持图片”。

#### 修复

新增 OpenClaw 版本补丁：

```text
scripts/patches/v2026.4.14/openclaw-qwen-vision-catalog-fallback.patch
```

补丁内容：

1. `normalizeProviderId()` 增加 `qwen-portal -> qwen` alias
2. `loadModelCatalog()` 合并 `config.models.providers[*].models[*]` 显式配置模型
3. catalog 去重使用 normalized provider + model id，避免 `qwen` 和 `qwen-portal` 重复
4. `resolveGatewayModelSupportsImages()` 用 normalized provider 查 catalog
5. catalog miss、catalog text-only 但 config 声明 image、catalog 加载失败时，回退读取当前 OpenClaw config 的 `input`
6. 增加 OpenClaw 单测覆盖：
   - `qwen-portal` alias 匹配 `qwen`
   - 显式配置模型进入 catalog
   - 自定义 / catalog miss 的视觉模型保留图片能力
   - 显式 text-only 模型不会被误升级

---

## 涉及文件清单

| 文件 | 角色 |
|------|------|
| `src/shared/providers/constants.ts` | ProviderRegistry 增加模型能力索引和 `resolveModelSupportsImage()` |
| `src/shared/providers/constants.test.ts` | 覆盖 qwen 和 custom provider 的能力修正规则 |
| `src/main/libs/claudeSettings.ts` | 主进程读取 app_config 时修正 provider 模型能力；server fallback 暴露全量模型 |
| `src/main/libs/openclawConfigSync.ts` | OpenClaw provider model upsert；写 `models[].input` 前最终修正能力 |
| `src/main/libs/openclawConfigSync.runtime.test.ts` | 回归测试 qwen、custom、lobsterai-server 的视觉能力配置 |
| `src/main/main.ts` | `auth:getModels` 后同步模型能力，但不强制 gateway restart |
| `src/renderer/services/config.ts` | 加载和迁移本地 provider config 时修正模型能力 |
| `src/renderer/components/Settings.tsx` | 设置页新增/编辑/导入/导出模型时修正模型能力 |
| `scripts/patches/v2026.4.14/openclaw-qwen-vision-catalog-fallback.patch` | OpenClaw runtime 补丁：provider alias、catalog 合并显式配置模型、发图前能力预检回退当前 config |

---

## 验证方法

### 自动化验证

```bash
npm test -- openclawConfigSync providers/constants
npm run build
git diff --check
```

2026-05-06 OpenClaw runtime 补丁验证：

```bash
git apply --check --ignore-whitespace scripts/patches/v2026.4.14/openclaw-qwen-vision-catalog-fallback.patch
npm test -- openclawConfigSync.runtime -t Qwen
npm test -- openclawConfigSync.runtime -t "merges all server"
git diff --check
```

说明：`npm test -- openclawConfigSync.runtime` 全量运行当前会被既有测试桩问题阻塞，错误为 `this.getPopoInstances is not a function`，与 qwen 图像输入修复无关。

### 日志验证

修复后，发送图片给 qwen3.6 Plus 时应看到：

```
chat.send imageAttachments diagnosis: { hasImageAttachments: true, imageAttachmentsCount: 1 }
```

并且不再出现：

```
parseMessageWithAttachments: 1 attachment(s) dropped — model does not support images
```

OpenClaw pre-prompt 诊断应包含：

```
provider=qwen-portal/qwen3.6-plus promptImages=1
```

或：

```
provider=lobsterai-server/qwen3.6-plus-YoudaoInner promptImages=1
```

### 回归验证

| 场景 | 预期 |
|------|------|
| `qwen/qwen3.6-plus` 本地配置为 `supportsImage:false` | OpenClaw 写出 `input: ['text', 'image']` |
| `qwen/qwen3-coder-plus` 本地配置为 `supportsImage:true` | OpenClaw 写出 `input: ['text']` |
| `custom_0/qwen3.6-plus` 本地配置为 `supportsImage:false` | OpenClaw 写出 `input: ['text', 'image']` |
| `custom_0/unknown-model` 本地配置为 `supportsImage:true` | OpenClaw 写出 `input: ['text', 'image']` |
| `custom_0/unknown-model` 本地配置为 `supportsImage:false` | OpenClaw 写出 `input: ['text']` |
| `lobsterai-server` 服务端返回多个模型 | OpenClaw provider 包含全部服务端模型 |
| `auth:getModels` 更新了模型能力 | OpenClaw 配置更新，gateway 不因模型列表刷新硬重启 |
| `qwen-portal/qwen3.6-plus` 在 catalog 中只有 `qwen/qwen3.6-plus` | OpenClaw 通过 provider alias 匹配，保留图片 |
| `lobsterai-server/qwen3.6-plus-YoudaoInner` 没进入 catalog 但 config 声明 image | `resolveGatewayModelSupportsImages()` 回退 config，保留图片 |
| catalog miss 且 config 声明 `input: ['text']` | 仍按纯文本模型处理，不误升级 |

---

## 已知边界

1. 全局已知模型能力依赖 `ProviderRegistry` 中的默认模型列表。新模型上线后，需要把模型 ID 和 `supportsImage` 加入 registry。
2. 对未知模型，系统不会猜测能力，仍尊重用户配置。
3. 如果真实模型能力与同名内置模型不同，例如某个自定义 endpoint 用同名模型但禁用了视觉能力，当前策略会按已知模型能力修正为支持图片。
4. `auth:getModels` 失败时，`lobsterai-server` 只能使用已有缓存或当前模型兜底，无法自动发现新服务端模型。
5. `auth:getModels` 可能在普通对话完成后被调用用于刷新额度和模型状态，因此不能把模型列表变化当作硬重启信号。
6. `openclaw-qwen-vision-catalog-fallback.patch` 是针对 OpenClaw `v2026.4.14` 的版本补丁；升级 OpenClaw 后需要重新确认 upstream 是否已包含等价修复，或重新生成 patch。
7. 补丁落地后，需要重新应用 OpenClaw patches 并重建/替换 bundled runtime，正在运行的旧 runtime 不会自动获得源码补丁。

---

## 后续优化建议

1. 在设置页显示“能力来自内置模型定义”或“能力来自用户配置”，减少用户对复选框被自动修正的困惑。
2. 将服务端模型能力持久化成本地快照，启动阶段先用快照预热，再异步刷新 `/api/models/available`。
3. 给 `ProviderRegistry` 增加更细的 model alias 规则，例如 `qwen3.6-plus-YoudaoInner` 与 `qwen3.6-plus` 的关系。
4. 在 OpenClaw 配置同步日志中单独输出模型能力修正摘要，例如 `corrected qwen/qwen3.6-plus supportsImage false -> true`。
5. 为设置页导入 provider 配置增加单元测试，覆盖旧配置中视觉模型 `supportsImage:false` 的修复。

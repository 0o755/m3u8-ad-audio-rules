# m3u8 Ad Audio Rules

公开的音频广告指纹规则仓库。当前公开规则协议为 Probe SDK `schemaVersion: 1`，稳定发布文件只有：

```text
rules.json
```

规则由采集器提交，经过 Probe SDK 同合同校验、重复过滤和跳转终点冲突检查后，才会合并进入公开规则文件。规则文件中存在的规则默认参与广告匹配。

## 规则地址

GitHub Raw：

```text
https://raw.githubusercontent.com/0o755/m3u8-ad-audio-rules/main/rules.json
```

Cloudflare Worker：

```text
https://m3u8-ad-audio-rules-sync.ccfork.workers.dev/rules.json
```

## 自动处理

采集器把本地 `rules.json` 提交到 Worker，Worker 写入 `submissions/`。GitHub Actions 自动运行 `tools/merge-submissions.mjs`：

- 严格校验 Probe SDK schema v1、算法参数、指纹相位和哈希格式；
- 相同规则跳过，不重复增加；
- 同 ID 内容不同的规则拒绝覆盖；
- 指纹前缀相同但跳转终点冲突的规则拒绝合并；
- 合并成功后递增 revision；
- 已处理内容归档到 `archive/submissions/`；
- 无法校验的内容归档到 `rejected/submissions/`，并保存失败原因。

仓库只维护一个公开 `rules.json`，不要求 SDK 或采集器使用第二个规则文件。

## 项目

- SDK：https://github.com/0o755/m3u8-ad-audio-probe
- 采集器：https://github.com/0o755/m3u8-ad-audio-collector

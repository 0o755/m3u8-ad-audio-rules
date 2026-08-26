# Cloudflare Worker 接口合同

Worker 需要保留你自己的页面和鉴权实现，并提供下面两个公开接口。

## 规则读取

```text
GET /rules.json
```

Worker 从 GitHub 仓库读取：

```text
https://raw.githubusercontent.com/0o755/m3u8-ad-audio-rules/main/rules.json
```

响应必须原样返回 `application/json`，不要转换协议、删除字段或生成第二个规则文件。建议缓存 300 秒。

## 采集器提交

```text
POST /v1/submissions
Content-Type: application/json
```

请求体：

```json
{
  "document": {
    "schemaVersion": 3,
    "revision": 1,
    "algorithm": {
      "id": "spectral-sequence-v3",
      "sampleRate": 16000,
      "windowMs": 512,
      "hopMs": 256,
      "bandCount": 16
    },
    "rules": []
  },
  "source": "collector",
  "clientVersion": "collector"
}
```

Worker 不直接改写 `rules.json`。它应使用 GitHub App 安装令牌，把 `document` 原文写入：

```text
submissions/<sha256>.json
```

成功返回 `202`，重复提交可返回 `200`；规则校验、去重、冲突过滤和合并由 GitHub Actions 处理。

Worker 不得把 GitHub App 私钥、Installation Token 或其他 Secret 返回给采集器。

/*
 * 规则服务 Worker：提供公开状态页、规则仓库统计和后续提交接口入口。
 * 页面默认显示 0，仓库读取成功后由 /api/status 更新统计。
 */
const DEFAULTS = Object.freeze({
  owner: "0o755",
  repo: "m3u8-ad-audio-rules",
  branch: "main",
  rulesUrl: "https://raw.githubusercontent.com/0o755/m3u8-ad-audio-rules/main/rules.json",
  sdkUrl: "https://github.com/0o755/m3u8-ad-audio-probe",
  collectorUrl: "https://github.com/0o755/m3u8-ad-audio-collector",
  collectorReleasesUrl: "https://github.com/0o755/m3u8-ad-audio-collector/releases",
  rulesRepoUrl: "https://github.com/0o755/m3u8-ad-audio-rules"
});
const ZERO_STATUS = Object.freeze({
  totalRules: 0,
  pendingRules: 0,
  submissions: 0,
  revision: 0,
  updatedAt: null
});
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }
      if (url.pathname === "/api/status" || url.pathname === "/v1/status") {
        return jsonResponse(await readStatus(env));
      }
      if (url.pathname === "/rules.json") {
        return await proxyRulesJson(env);
      }
      if (url.pathname === "/v1/health") {
        return jsonResponse({ ok: true, service: "m3u8-ad-audio-rules" });
      }
      if (url.pathname === "/v1/submissions") {
        if (request.method !== "POST") {
          return jsonResponse({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
        }
        return jsonResponse({
          ok: false,
          error: "SUBMISSION_NOT_CONFIGURED",
          message: "规则接收接口尚未部署，当前页面仅提供仓库状态读取。"
        }, 501);
      }
      if (request.method !== "GET" || !["/", ""].includes(url.pathname)) {
        return new Response("Not Found", { status: 404, headers: corsHeaders() });
      }
      return new Response(renderPage(env), {
        headers: {
          "content-type": "text/html; charset=UTF-8",
          "cache-control": "public, max-age=60",
          ...corsHeaders()
        }
      });
    } catch(err) {
      return jsonResponse({ok:false,error:"INTERNAL_ERROR",message:err.message},500);
    }
  }
};
function config(env) {
  return {
    owner: env.GITHUB_OWNER || DEFAULTS.owner,
    repo: env.GITHUB_REPO || DEFAULTS.repo,
    branch: env.GITHUB_BRANCH || DEFAULTS.branch,
    rulesUrl: env.RULES_URL || DEFAULTS.rulesUrl,
    sdkUrl: env.SDK_REPOSITORY_URL || DEFAULTS.sdkUrl,
    collectorUrl: env.COLLECTOR_REPOSITORY_URL || DEFAULTS.collectorUrl,
    collectorReleasesUrl: env.COLLECTOR_RELEASES_URL || DEFAULTS.collectorReleasesUrl,
    rulesRepoUrl: env.RULES_REPOSITORY_URL || DEFAULTS.rulesRepoUrl
  };
}
async function readStatus(env) {
  const result = { ...ZERO_STATUS };
  const settings = config(env);
  try {
    const rulesResponse = await fetch(settings.rulesUrl, {
      headers: { accept: "application/json" }
    });
    if (rulesResponse.ok) {
      const document = await rulesResponse.json();
      if (document && Array.isArray(document.rules)) {
        result.totalRules = document.rules.length;
        result.revision = Number.isSafeInteger(document.revision) ? document.revision : 0;
      }
    }
  } catch {
    // 页面统计失败时保留安全的 0，不影响规则仓库和 Worker 可用性。
  }
  try {
    const tree = await githubJson(
      `https://api.github.com/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repo)}/git/trees/${encodeURIComponent(settings.branch)}?recursive=1`,
      env
    );
    const paths = Array.isArray(tree.tree) ? tree.tree.map(item => item.path || "") : [];
    result.pendingRules = paths.filter(path => path.startsWith("candidates/") && isDataFile(path)).length;
    result.submissions = paths.filter(path => path.startsWith("submissions/") && isDataFile(path)).length;
  } catch {
    // GitHub API 不可用时保留已读取的规则数量，其余统计为 0。
  }
  result.updatedAt = new Date().toISOString();
  return result;
}

async function proxyRulesJson(env) {
  const settings = config(env);
  try {
    const response = await fetch(settings.rulesUrl, {
      headers: { accept: "application/json" },
      cf: { cacheTtl: 300, cacheEverything: true }
    });
    if (!response.ok) {
      return new Response("rules.json 暂时无法读取", {
        status: 502,
        headers: { "content-type": "text/plain; charset=UTF-8", ...corsHeaders() }
      });
    }
    const headers = {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*"
    };
    const etag = response.headers.get("etag");
    if (etag) headers.etag = etag;
    return new Response(response.body, { status: 200, headers });
  } catch {
    return new Response("rules.json 暂时无法读取", {
      status: 502,
      headers: { "content-type": "text/plain; charset=UTF-8", ...corsHeaders() }
    });
  }
}
function isDataFile(path) {
  return /\.(json|jsonl|ndjson)$/i.test(path) && !path.endsWith("/");
}
async function githubJson(url, env) {
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "m3u8-ad-audio-rules-sync"
  };
  if (env.GITHUB_READ_TOKEN) {
    headers.authorization = `Bearer ${env.GITHUB_READ_TOKEN}`;
  }
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`GitHub API ${response.status}`);
  return response.json();
}
function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store",
      ...corsHeaders()
    }
  });
}
function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  };
}
function renderPage(env) {
  const settings = config(env);
  const links = JSON.stringify({
    sdk: settings.sdkUrl,
    collector: settings.collectorUrl,
    releases: settings.collectorReleasesUrl,
    rules: settings.rulesRepoUrl,
    rawRules: settings.rulesUrl
  }).replace(/</g, "\\u003c");
  // 多套分发链接
  const ruleSources = [
    {name:"GitHub Raw", url:"https://raw.githubusercontent.com/0o755/m3u8-ad-audio-rules/main/rules.json"},
    {name:"jsDelivr CDN", url:"https://cdn.jsdelivr.net/gh/0o755/m3u8-ad-audio-rules@main/rules.json"},
    {name:"Cloudflare Worker", url:"https://m3u8-ad-audio-rules-sync.ccfork.workers.dev/rules.json"}
  ];
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>m3u8 Ad Audio Rules</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    :root {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif;
      color-scheme: light;
      --bg: #f7f8fa;
      --card-bg: #ffffff;
      --text-main: #1f2329;
      --text-secondary: #5e6673;
      --border: #e1e4e8;
      --accent: #2b54a7;
      --code-bg:#f1f3f6;
    }
    body {
      background-color: var(--bg);
      color: var(--text-main);
      line-height: 1.6;
    }
    .container {
      max-width: 960px;
      margin: 0 auto;
      padding: 40px 20px;
    }
    /* 头部区域 */
    .page-header {
      margin-bottom: 48px;
    }
    .page-header h1 {
      font-size: 32px;
      font-weight: 700;
      margin-bottom: 12px;
    }
    .page-header p {
      font-size: 16px;
      color: var(--text-secondary);
      max-width: 640px;
    }
    /* 统计卡片区域，自适应自动换行 */
    .stat-wrap {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 48px;
    }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 24px;
    }
    .stat-card .num {
      font-size: 40px;
      font-weight: 700;
      margin-bottom: 8px;
      color: var(--accent);
    }
    .stat-card .desc {
      font-size: 14px;
      color: var(--text-secondary);
    }
    /* 区块通用 */
    .section-block {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 28px;
      margin-bottom: 32px;
    }

    /* 标题+按钮同一行布局 */
    .section-title-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      flex-wrap: wrap;
      gap: 12px;
    }
    .section-title-row h2 {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 0;
    }
    .open-modal-btn {
      padding: 9px 16px;
      background-color: var(--accent);
      color: #ffffff;
      border: none;
      border-radius: 7px;
      font-size: 14px;
      cursor: pointer;
      white-space: nowrap;
    }
    .open-modal-btn:hover {
      opacity: 0.92;
    }

    /* 代码块复制组件 */
    .code-block-wrap {
      margin-bottom:14px;
    }
    .code-label {
      font-size:14px;
      color:var(--text-secondary);
      margin-bottom:6px;
    }
    .code-row {
      display:flex;
      align-items:stretch;
      background-color:var(--code-bg);
      border-radius:6px;
      border:1px solid var(--border);
    }
    .code-text {
      flex:1;
      padding:12px 14px;
      font-family: ui-monospace,Menlo,Consolas,monospace;
      font-size:13px;
      word-break:break-all;
      overflow-x:auto;
    }
    .copy-btn {
      padding:0 16px;
      border:none;
      background:#dde2eb;
      cursor:pointer;
      font-size:13px;
      white-space:nowrap;
      border-left:1px solid var(--border);
      border-radius:0 6px 6px 0;
    }
    .copy-btn:active {
      background:#c9cdd8;
    }

    /* 弹窗模态框 */
    .modal-mask{
      position:fixed;
      inset:0;
      background:rgba(0,0,0,0.55);
      display:none;
      align-items:center;
      justify-content:center;
      z-index:999;
      padding:16px;
    }
    .modal-wrap{
      width:100%;
      max-width:720px;
      max-height:85vh;
      background:#fff;
      border-radius:12px;
      display:flex;
      flex-direction:column;
      overflow:hidden;
    }
    .modal-header{
      display:flex;
      justify-content:space-between;
      align-items:center;
      padding:18px 24px;
      border-bottom:1px solid var(--border);
    }
    .modal-title{
      font-size:18px;
      font-weight:600;
    }
    .modal-close{
      border:none;
      background:transparent;
      font-size:22px;
      cursor:pointer;
      color:#666;
      padding:0 6px;
    }
    .modal-content-inner{
      padding:24px;
      overflow-y:auto;
    }

    /* 项目链接列表 */
    .link-list {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .link-item a {
      display: block;
      padding: 14px 16px;
      border: 1px solid var(--border);
      border-radius: 8px;
      text-decoration: none;
      color: var(--text-main);
      transition: 0.15s ease;
    }
    .link-item a:hover {
      border-color: var(--accent);
      background-color: #f3f7ff;
    }
    .link-item .title {
      font-weight: 500;
    }
    .link-item .subdesc {
      font-size:13px;
      color: var(--text-secondary);
    }
    /* API接口展示 */
    .api-item {
      margin-bottom:16px;
      padding:14px;
      background-color:#f7f8fa;
      border-radius:6px;
    }
    .api-path {
      font-family: monospace;
      font-size:15px;
      font-weight:600;
    }
    .api-desc {
      font-size:14px;
      color:var(--text-secondary);
      margin-top:4px;
    }
    /* 页脚 */
    footer {
      margin-top:60px;
      padding-top:24px;
      border-top:1px solid var(--border);
      font-size:14px;
      color:var(--text-secondary);
    }
  </style>
</head>
<body>
<div class="container">
  <header class="page-header">
    <h1>m3u8 Ad Audio Rules</h1>
    <p>开放的音频广告指纹规则服务。规则由采集器产生，经校验后发布，供广告过滤SDK调用。本页面展示仓库实时统计，同时对外提供HTTP接口。</p>
  </header>
  <!-- 统计卡片 -->
  <div class="stat-wrap">
    <div class="stat-card">
      <div class="num" id="totalRules">0</div>
      <div class="desc">当前生效规则数量</div>
    </div>
    <div class="stat-card">
      <div class="num" id="pendingRules">0</div>
      <div class="desc">待确认候选规则</div>
    </div>
    <div class="stat-card">
      <div class="num" id="submissions">0</div>
      <div class="desc">累计用户提交条目</div>
    </div>
    <div class="stat-card">
      <div class="num" id="revision">0</div>
      <div class="desc">规则集版本号</div>
    </div>
  </div>
  <!-- 规则下载链接代码块区域 -->
  <div class="section-block">
    <h2>rules.json 规则地址</h2>
    <p style="margin-bottom:18px;font-size:14px;color:var(--text-secondary)">国内访问不稳定时，优先尝试 jsDelivr CDN 分发链接，点击复制按钮快速拷贝地址。</p>
    ${ruleSources.map((item,idx)=>`
    <div class="code-block-wrap">
      <div class="code-label">${item.name}</div>
      <div class="code-row">
        <div class="code-text" id="codeText${idx}">${item.url}</div>
        <button class="copy-btn" data-target="codeText${idx}">复制</button>
      </div>
    </div>
    `).join('')}
  </div>

  <!-- API文档区块 -->
  <div class="section-block">
    <h2>服务接口</h2>
    <div class="api-item">
      <div class="api-path">GET /api/status</div>
      <div class="api-desc">获取规则仓库统计数据，兼容别名 /v1/status</div>
    </div>
    <div class="api-item">
      <div class="api-path">GET /v1/health</div>
      <div class="api-desc">服务健康检测接口</div>
    </div>
    <div class="api-item">
      <div class="api-path">POST /v1/submissions</div>
      <div class="api-desc">提交接收接口</div>
    </div>
  </div>

  <!-- 相关项目资源，按钮放在标题右侧 -->
  <div class="section-block">
    <div class="section-title-row">
      <h2>相关项目资源</h2>
      <button class="open-modal-btn" id="openModalBtn">自动采集实现指引</button>
    </div>
    <div class="link-list">
      <div class="link-item">
        <a id="sdkLink" href="#">
          <div class="title">广告过滤 SDK</div>
          <div class="subdesc">音频广告指纹检测工具库</div>
        </a>
      </div>
      <div class="link-item">
        <a id="collectorLink" href="#">
          <div class="title">指纹采集器</div>
          <div class="subdesc">用于采集音频样本生成指纹规则</div>
        </a>
      </div>
      <div class="link-item">
        <a id="releaseLink" href="#">
          <div class="title">采集器下载发布页</div>
          <div class="subdesc">获取各平台编译版本</div>
        </a>
      </div>
      <div class="link-item">
        <a id="rulesLink" href="#">
          <div class="title">规则仓库</div>
          <div class="subdesc">规则由用户推送，node自动校验过滤后合并</div>
        </a>
      </div>
    </div>
  </div>

  <footer>
    <div>状态数据：<span id="updatedAt">数据读取中</span></div>
    <div style="margin-top:6px;">本服务运行于 Cloudflare Worker，统计会定期刷新。</div>
  </footer>
</div>

<!-- 弹窗模态框 -->
<div class="modal-mask" id="modalMask">
  <div class="modal-wrap">
    <div class="modal-header">
      <div class="modal-title">音频指纹自动采集实现指引</div>
      <button class="modal-close" id="modalCloseBtn">×</button>
    </div>
    <div class="modal-content-inner">
      <p>如果你项目内部已经实现<strong>实时字幕</strong>、<strong>AI字幕</strong>相关能力，可以基于正则表达式做广告关键词识别；自动采集功能便可依托字幕关键字定位出的媒体时间轴，完成广告片段的自动提取。</p>
<p>该方案可靠性高，可以做到理论零误报。</p>
    </div>
  </div>
</div>

<script>
    const links = ${links};
    const linkMap = {
      sdkLink: links.sdk,
      collectorLink: links.collector,
      releaseLink: links.releases,
      rulesLink: links.rules,
      rawRulesLink: links.rawRules
    };
    for (const [id, href] of Object.entries(linkMap)) {
      const el = document.getElementById(id);
      if(el) el.href = href;
    }

    //复制按钮逻辑
    document.querySelectorAll('.copy-btn').forEach(btn=>{
      btn.addEventListener('click',async ()=>{
        const targetId = btn.getAttribute('data-target');
        const textEl = document.getElementById(targetId);
        const text = textEl.innerText;
        try{
          await navigator.clipboard.writeText(text);
          const oldText = btn.innerText;
          btn.innerText = "已复制";
          setTimeout(()=>{btn.innerText = oldText;},1200);
        }catch(e){
          alert("复制失败，请手动复制："+text);
        }
      })
    })

    //弹窗逻辑
    const modalMask = document.getElementById('modalMask');
    const openModalBtn = document.getElementById('openModalBtn');
    const modalCloseBtn = document.getElementById('modalCloseBtn');

    function openModal(){
      modalMask.style.display = 'flex';
    }
    function closeModal(){
      modalMask.style.display = 'none';
    }
    openModalBtn.addEventListener('click', openModal);
    modalCloseBtn.addEventListener('click', closeModal);
    //点击遮罩层关闭弹窗
    modalMask.addEventListener('click',(e)=>{
      if(e.target === modalMask) closeModal();
    });


    fetch('/api/status')
      .then(response => {
        if (!response.ok) throw new Error('fetch fail');
        return response.json();
      })
      .then(status => {
        const statIds = ['totalRules', 'pendingRules', 'submissions', 'revision'];
        statIds.forEach(id => {
          const dom = document.getElementById(id);
          if(dom) dom.textContent = String(status[id] ?? 0);
        });
        const updateDom = document.getElementById('updatedAt');
        if(status.updatedAt && updateDom) {
          updateDom.textContent = "刚刚完成读取";
        }
      })
      .catch(() => {
        const updateDom = document.getElementById('updatedAt');
        if(updateDom) updateDom.textContent = "暂时无法读取仓库状态";
      });
</script>
</body>
</html>`;
}

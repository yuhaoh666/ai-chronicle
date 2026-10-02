# AI 大事记 · 2022 → 2026

一个给**完全不懂技术和商业的普通人**看的 AI 编年史网站。

技术线（蓝）与社会商业线（橙）双线并行，顶部有一条可拖动的"AI 能力增长曲线"导航条，
每条事件都可以展开读它的来龙去脉，卡片里的任意一句话都能划选让 AI 解释。

**当前收录：98 条事件（技术线 55 / 社会线 43）、269 条术语解释，时间跨度 1956 → 2026 年 10 月。**

| 时期 | 条数 | 说明 |
| --- | --- | --- |
| AI 前史 1956–2021 | 8 | 只收改变方向的节点：达特茅斯会议、深蓝、AlexNet、AlphaGo、Transformer… |
| 2022 | 8 | InstructGPT、DALL·E 2、Stable Diffusion、ChatGPT 发布… |
| 2023 | 13 | GPT-4、LLaMA 泄露、AutoGPT、OpenAI 宫斗、欧盟 AI 法案… |
| **2024** | **23** | GPT-4o、o1 推理、Sora、Llama 3.1、欧盟法案生效、诺奖… |
| **2025** | **30** | DeepSeek-R1、GPT-5、Gemini 3、星际之门、英伟达 5 万亿… |
| **2026（至 10 月）** | **16** | Gemini 4 Argon、Claude Fable 5、全天候智能体、超级智能行政令… |

![首页：双线时间线与能力增长曲线](docs/preview-light.jpg)

![划词解释：选中任意一句话，让 AI 用外行语言讲清楚](docs/preview-panel.jpg)

<details>
<summary>深色主题（导航条右上角可一键切换）</summary>

![深色主题](docs/preview-dark.jpg)

</details>

---

## 一、怎么打开

### 推荐：用本地 HTTP 服务打开

```bash
cd "AI大事记网站搭建"
python3 -m http.server 8787
# 然后浏览器访问 http://127.0.0.1:8787/
```

**为什么推荐这个方式**：划词解释功能要 `fetch` 调用 AI 接口。用 `file://` 直接双击打开时，
浏览器会把它当成"无来源"的页面，多数 AI 接口会因此拒绝跨域请求。
用 `http://127.0.0.1` 打开就没有这个问题。

直接双击 `index.html` 也能看，只是划词解释会自动退化成**本地术语词典模式**（见第四节）。

---

## 二、网站有什么

| 功能 | 说明 |
| --- | --- |
| 顶部时间轴 | 一条代表"AI 能力增长"的渐变曲线。**可以拖动滑块**在整条时间线上快速移动，也可以点击年份跳转，还能用键盘 ←/→ 逐年前进 |
| 双线时间线 | 桌面端**技术线在左、社会线在右**，移动端自动变成单列；中间的光柱颜色从蓝渐变到橙 |
| 事件卡片 | 折叠时显示日期、线索、标题和三行摘要；展开后显示「这件事是什么」（三段式）→「来龙去脉」→「术语翻译机」→「后来发生了什么」→「时间线上的关联」→「信息来源」 |
| 搜索 | 支持多关键词（空格分隔，全部命中才显示）；会在正文里高亮命中的字；搜「开源」「芯片」「融资」都能用。按 `/` 直接跳到搜索框 |
| 线索筛选 | 全部 / 技术线 / 社会线 |
| 术语总表 | 页面底部，汇总全站所有术语解释，点任意一条会跳到第一次出现它的事件并高亮 |
| 划词解释 | 见第四节 |
| 主题切换 | 默认**浅色**；导航条右上角的 🌙/☀️ 按钮可切到深色，选择记在 localStorage |
| 响应式 | 820px 以下切换为移动端单列布局，所有交互都支持触屏（拖动、点按、划选） |

---

## 三、文件结构

```
AI大事记网站搭建/
├── index.html                    页面骨架
├── assets/
│   ├── css/main.css              全部样式（浅色/深色双主题、双线、响应式）
│   └── js/
│       ├── data/events.js        ← 自动生成的事件数据（勿手改）
│       ├── data/glossary.js      ← 自动生成的术语总表（勿手改）
│       ├── util.js               工具函数（日期格式化、三段式拆分、高亮…）
│       ├── timeline.js           时间线渲染与展开/折叠
│       ├── search.js             搜索、筛选、命中高亮
│       ├── explainer.js          划词 AI 解释（Shadow DOM 面板）
│       └── app.js                装配：渲染、导航条、搜索接线、术语表、主题
├── research/                     事实研究原始数据 + 规范化稿 + 校验报告
│   ├── 2022-2023.norm.json       前史 + 2022 + 2023（29 条）
│   ├── 2024.norm.json            2024（18 条）
│   ├── 2024-extra.norm.json      2024 补充（5 条）
│   ├── 2025h1.norm.json          2025 上半年（17 条）
│   ├── 2025h2.norm.json          2025 下半年（13 条）
│   ├── 2026.norm.json            2026 年 1–10 月（16 条）
│   ├── *.json                    对应的研究初稿（保留以备溯源）
│   └── report.md                 构建时自动生成的校验报告
├── tools/
│   ├── build-data.mjs            数据清洗/校验/合并
│   ├── probe.mjs                 零依赖无头 Chrome 探针（截图 + 断言 + 控制台报错）
│   ├── mock-ai-server.mjs        假的 OpenAI 兼容接口，用来端到端验证 AI 链路
│   ├── normalize-2025h1.py       一次性脚本：2025 上半年那批数据的规范化改写记录（保留以备溯源）
│   └── checks/
│       ├── interactions.js       66 项交互自检脚本
│       └── ai-path.js            21 项真实 HTTP 链路自检脚本
├── docs/                         README 用的预览图
├── LICENSE                       代码：MIT
├── LICENSE-CONTENT.md            文字内容：CC BY 4.0
├── .nojekyll                     让 GitHub Pages 跳过 Jekyll
└── README.md
```

技术上有意**不用任何框架和构建工具**：原生 ES5 风格脚本 + 全局命名空间，
双击就能跑，不需要 `npm install`。`package.json` 里只有几个便捷脚本，没有任何依赖：

```bash
npm run serve      # = python3 -m http.server 8787
npm run build      # = node tools/build-data.mjs
npm run check      # = 66 项浏览器交互自检
```

---

## 四、划词 AI 解释怎么用

### 操作流程

1. 在任意事件卡片里，用鼠标（或手指长按）**拖选一段文字**
2. 选区附近会浮出一个半透明的「✨ 解释」按钮
3. 点它，弹出一个可拖动的面板
4. 输入框里**已经预填了你选中的文字**，你可以在后面接着追问，比如
   `这跟之前有什么区别？`
5. 按 **Enter** 发送（Shift+Enter 换行）
6. 面板可以用标题栏拖动，点 ✕ 或按 Esc 关闭，关闭后不影响页面任何其他操作

选中文字**少于 3 个字不触发**；只在事件卡片内容区里生效，点页面其他地方会自动收起。

### 发给 AI 的提示词

严格按下面这个结构拼接（面板里点「查看发送给 AI 的提问」可以看到实际内容）：

```
以下是AI大事记网站中的一段内容：
【上下文】（出自事件《标题》，日期）选中文字所在的那一整段
【选中片段】用户选中的具体文字
【用户问题】用户的追问；没有追问时是「请解释这个片段」

请用完全不懂技术的人能理解的语言解释。如果涉及技术术语，先用一句生活化的类比说明，再展开。控制在 200 字以内。
```

三个设计要点：

- **必须传上下文**：光有「MoE」这三个字母，AI 不知道你指的是哪篇报道里的哪句话。
- **上下文与选中片段分开标注**：让 AI 分得清"用户想了解什么"和"这段话在讲什么"。
- **默认问题 + 允许追问**：输入框预填选中文字，用户往后追加的内容会被自动切出来作为【用户问题】，
  这样既保留了默认行为，又支持连续追问。

### 配置真正的 AI

面板右上角 **⚙** → 选一个预设（DeepSeek / OpenAI / 通义千问 / 智谱 / Kimi / 本地 Ollama / 自定义），
填入 **API Key** 保存即可。Key 只存在你自己浏览器的 `localStorage` 里，不会上传到任何第三方服务器。

**跨域（CORS）提示**：浏览器是直接向接口发请求的，如果接口不允许网页直连，会报
"无法连接到接口"。解决办法：
1. 用 `http://127.0.0.1` 而不是 `file://` 打开（最常见的原因）；
2. 换一个允许浏览器直连的接口；
3. 自建一个转发代理，把 Base URL 指向它。
   例如本地 Ollama 需要先设 `OLLAMA_ORIGINS=*` 再启动。

### 没配置接口时会怎样

自动退化为**本地术语词典模式**：它会在内置词典里查你划选的那句话中出现的术语，
给出卡片里已经写好的外行人解释，并如实标注「这是离线词典的答案」。

**它绝不会假装自己是 AI**——词典里查不到就直说查不到，并提示你两个办法。

---

## 五、内容与数据

### 数据流水线

```
research/*.json            研究员产出的事实条目（含来源链接）
        ↓  （内容规范化：三段式、字数合规）
research/*.norm.json       规范化稿
        ↓  node tools/build-data.mjs
assets/js/data/events.js   站点直接加载的数据
```

当前参与构建的文件（见 `tools/build-data.mjs` 的 `SOURCES`）：
`2022-2023` · `2024` · `2024-extra` · `2025h1` · `2025h2` · `2026`
（每个名字都会优先读同名 `.norm.json`，没有才退回 `.json`）

重新构建：

```bash
node tools/build-data.mjs
```

构建会同时做**严格校验**并把问题写进 `research/report.md`：

- `summary` 必须是 `发生了什么 → 为什么重要 → 对一般社会公众意味着什么` 三段，合计 ≤ 200 字
- `title` ≤ 20 字
- 每个 `concepts[].plain` 解释 80–150 字
- `background` 150–300 字、`impact` 100–200 字
- 必须有 `date`（YYYY-MM-DD）、`category`、至少一个 `concepts`、至少一个来源链接
- 同一日期+标题的重复条目会被自动剔除

### 每条事件的字段

| 字段 | 含义 |
| --- | --- |
| `date` | 精确到日 |
| `title` | 一句话标题，≤ 20 字 |
| `category` | `technical`（技术线）或 `social`（社会线） |
| `summary` | 三段式概述：发生了什么 → 为什么重要 → 对一般社会公众意味着什么 |
| `background` | 来龙去脉：在此之前发生了什么、什么导致了它 |
| `concepts` | `[{term, plain}]`，每个术语配一段给外行人的解释 |
| `impact` | 对后续发展的影响 |
| `connections` | 与时间线上其他事件的关联 |
| `sources` | 真实来源链接，卡片上可点 |
| `confidence` | 事实置信度，`low` 的条目会在卡片上打「日期待考」标记 |

### 关于事实准确性（请务必读）

- 2022–2024 的事件属于常识性史实，日期经过多来源交叉核对。
- **2025–2026 的事件完全在模型训练数据之外**，全部靠联网检索确认。
- ⚠️ **本项目的构建沙箱内 `web_fetch` 对所有外部域名均被拦截**
  （返回 `resolves to a non-public IP address`），因此研究阶段**只能依据搜索结果返回的
  标题、摘要和 URL 判断，没有逐字打开过任何一篇原文**。
- 2026 年段的高风险条目（Claude Fable 5、英伟达 130 亿美元收购 Hugging Face、
  Gemini 4 Argon、OpenAI「Dots」全天候智能体、亚马逊 500 亿美元投资 OpenAI、
  特朗普签令改称「超级智能」等）已由我独立二次检索复核为真实事件，
  来源见 [research/report.md](research/report.md) 与各卡片内的链接。
- 研究员主动舍弃了若干无法确证日期的事件（如「GPT-6 攻克哥德巴赫猜想」）——
  **宁可少而真，不要多而假**。
- 上线前建议对来源链接做一次可达性检查；`bloomberg.com`、`technologyreview.com`
  等可能需要订阅。

---

## 六、开发与自检

项目自带一个零依赖的无头 Chrome 探针，可以在真实浏览器里跑断言、抓控制台报错、截图：

```bash
# 先起服务
python3 -m http.server 8787 &

# 58 项交互自检（划词、面板、提示词拆解、搜索、拖动、术语表跳转、展开折叠、无障碍）
node tools/probe.mjs --url=http://127.0.0.1:8787/index.html \
  --eval-file=tools/checks/interactions.js --wait=1800 --full=false

# 21 项真实 HTTP 链路自检：起一个假的 AI 接口，验证「划词 → 提示词 → 网络请求 → 渲染回答」整条链路
node tools/mock-ai-server.mjs 8899 &
node tools/probe.mjs --url=http://127.0.0.1:8787/index.html --full=false \
  --pre-eval="localStorage.setItem('ai-chronicle.ai-settings', JSON.stringify({base:'http://127.0.0.1:8899/v1',model:'deepseek-chat',key:'sk-test',preset:'custom'}))" \
  --eval-file=tools/checks/ai-path.js
# 模拟接口会把收到的完整提示词打印到终端，可以直接肉眼核对拼接是否正确

# 桌面截图
node tools/probe.mjs --url=http://127.0.0.1:8787/index.html \
  --out=/tmp/shot.png --width=1440 --height=1000 --full=false

# 真机尺寸的移动端截图（用 CDP 覆盖设备指标，绕开无头 Chrome 最小窗宽）
node tools/probe.mjs --url=http://127.0.0.1:8787/index.html \
  --out=/tmp/mobile.png --width=390 --height=844 --mobile=true --full=false

# 自定义断言
node tools/probe.mjs --url=... --eval="return document.querySelectorAll('.event').length;"
```

`probe.mjs` 会在有控制台报错或断言抛异常时以非 0 退出，可以直接接进 CI。

### 想加一条事件

1. 在 `research/<年份>.json` 里按上面的字段加一条（或直接改 `research/*.norm.json`）；
2. 跑 `node tools/build-data.mjs`；
3. 刷新页面。搜索索引、术语总表、导航条刻度都会自动跟着更新。

---

## 七、设计说明

- **浅色为默认主题，深色可一键切回**：所有颜色都走 CSS 变量，`:root` 是浅色令牌，
  `:root[data-theme="dark"]` 是深色令牌，只换值不换结构。导航条右上角的 🌙/☀️ 按钮切换，
  选择存在 `localStorage`；首次访问会跟随系统的 `prefers-color-scheme`。
  为避免刷新时闪一下白或黑，`index.html` 的 `<head>` 里有一段内联脚本在首次绘制前就把主题定好。
  划词面板在 Shadow DOM 里，配色由 `.sr[data-theme="dark"]` 独立控制，跟着主页面一起切。
- **渐变光柱**：时间轴中轴的颜色从蓝（技术）渐变到橙（社会），
  顶部导航条上叠了一条按年份绘制的"能力增长曲线"，用示意指数表现 AI 能力的指数级爬升。
- **卡片动效**：悬浮时轻微上浮并改变边框辉光，展开用 `max-height` 过渡，尊重
  `prefers-reduced-motion`。
- **正文用系统无衬线字体，术语用等宽字体**，术语块单独用紫色区分，一眼能认出"这里在解释词"。
- **划词面板放在 Shadow DOM 里**：样式和事件与页面完全隔离，几千字的正文不会有任何样式渗透，
  面板也不会被页面的点击处理逻辑干扰。

---

## 八、发布到 GitHub

仓库根目录就是站点根目录，**不需要任何构建步骤**，上传即可运行。

### 1. 推上去

```bash
cd "AI大事记网站搭建"
git init -b main
git add -A
git commit -m "feat: AI 大事记 2022–2026 双线时间线网站"
git remote add origin git@github.com:yuhaoh666/ai-chronicle.git
git push -u origin main
```

### 2. 免费上线（GitHub Pages）

推完之后：仓库 **Settings → Pages → Build and deployment**
→ Source 选 `Deploy from a branch` → Branch 选 `main` / `(root)` → Save。

一分钟左右后访问 `https://yuhaoh666.github.io/ai-chronicle/` 即可。

仓库里已经放了 `.nojekyll`，避免 GitHub 的 Jekyll 处理后端误伤静态文件。

> 注意：GitHub Pages 是 HTTPS 的，站点里的划词 AI 解释要调用外部 AI 接口时，
> 接口必须支持跨域（CORS）。用不了的话，选择「本地术语词典」模式一样能跑，
> 或者自建一个转发代理（见第四节）。

---

## 九、作者与许可

**作者：黄宇浩 · 复旦大学未来信息创新学院**

本项目采用**双许可证**：

| 范围 | 许可证 | 说明 |
| --- | --- | --- |
| 代码（`index.html`、`assets/css/`、`assets/js/`、`tools/`） | [MIT](LICENSE) | 随便用，保留版权声明即可 |
| 文字内容（98 条事件、269 条术语解释、`research/` 数据、文档） | [CC BY 4.0](LICENSE-CONTENT.md) | 署名后可自由转载、改编，含商业用途 |

转载文字内容时请保留这样的署名：

> 黄宇浩（复旦大学未来信息创新学院），《AI 大事记》，https://github.com/yuhaoh666/ai-chronicle ，CC BY 4.0

本项目是**科普整理**，不是学术论文，也不构成投资或法律建议。
事件的事实性依据以每条卡片里列出的来源链接为准。如果发现日期或事实有误，
欢迎提 Issue 指正。

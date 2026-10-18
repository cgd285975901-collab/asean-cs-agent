# 东盟批量采购询价与议价 · 网页智能体实训

面向《智能客服实务》课程的跨境电商售前实训。学生用英文接待印尼雅加达批发商 Rizky，完成 20,000 只不锈钢饭盒的询价、报价、议价与 PI 推进；教师后台可回放全部对话、查看风险标记并导出 CSV。

## 功能

- **学生端**：HTTPS 网页、无需安装、中英双语界面、英文对话。
- **确定性买家引擎**：5 个议价阶段、价格底线、优惠券/样品/海外仓/账期/认证/私账等分支；同样的输入得到可解释的反应，不会编造价格或库存。
- **报价自检**：8 要素清单、报价计算器、一键插入英文报价。
- **风险标记**：低于底价、免运费、DDP、OA 60 天、虚假 SNI、私账、独家、违约金过度承诺等。
- **全程留痕**：服务端逐轮写入 JSONL，支持单会话 CSV 导出、班级汇总 CSV。
- **教师后台**：会话列表、时间、轮次、状态、预估分、风险标签、完整回放。
- **嵌入模式**：`/embed` 无顶栏，可直接 iframe 到课程平台；`frame-ancestors *` 已放开。

## 本地运行

要求 Node.js 20+，无第三方依赖。

```bash
cd webapp
node server.js
```

默认端口 `8792`。打开：

- 学生端：<http://localhost:8792/>
- 嵌入版：<http://localhost:8792/embed>
- 教师后台：<http://localhost:8792/admin?token=启动日志中的口令>

首次启动如果未设置 `ADMIN_TOKEN`，会生成一个随机口令并打印在控制台。

### 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `PORT` | 否 | 默认 `8792` |
| `HOST` | 否 | 默认 `0.0.0.0` |
| `ADMIN_TOKEN` | 建议 | 教师后台口令；生产必须设置 |
| `CLASS_CODE` | 否 | 班级访问码；设置后学生必须输入 |
| `PUBLIC_BASE_URL` | 否 | 生成分享链接用，如 `https://cs.example.edu.cn` |
| `DATA_DIR` | 否 | 数据目录，默认 `webapp/data` |

示例：

```bash
PORT=8792 ADMIN_TOKEN='change-me-please' CLASS_CODE='ASEAN2026' node server.js
```

## 部署成独立网址

### 方案 A：Render（最快，自动 HTTPS）

1. 把 `webapp` 目录推到 GitHub/GitLab。
2. 在 Render 新建 Blueprint，选择仓库；仓库根目录的 `render.yaml` 会创建 Web Service。
3. 设置 `ADMIN_TOKEN`（Render 可自动生成）和 `CLASS_CODE`。
4. 部署完成后得到 `https://<service>.onrender.com`。
5. 课程平台 iframe 使用 `https://<service>.onrender.com/embed?code=ASEAN2026`。

> Render 免费实例会休眠，课堂使用建议 Starter 或更高配置；首次访问冷启动约 30 秒。

### 方案 B：Docker / 学校服务器

```bash
docker build -t asean-cs-agent .
docker run -d --name asean-cs-agent \
  -p 8792:8792 \
  -e ADMIN_TOKEN='change-me-please' \
  -e CLASS_CODE='ASEAN2026' \
  -e PUBLIC_BASE_URL='https://cs.example.edu.cn' \
  -v $(pwd)/data:/app/data \
  asean-cs-agent
```

Nginx 反向代理 + HTTPS：

```nginx
server {
    listen 443 ssl;
    server_name cs.example.edu.cn;

    ssl_certificate     /etc/ssl/fullchain.pem;
    ssl_certificate_key /etc/ssl/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8792;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
    }
}
```

课程平台必须通过 **HTTPS** 访问，否则 iframe 会被浏览器拦截（混合内容）。

### 方案 C：内网临时使用

如果只是校内机房，可用 `http://服务器IP:8792`；但课程平台嵌入通常要求 HTTPS 域名，建议至少配置 Nginx + 证书。

## 嵌入课程平台

```html
<iframe
  src="https://cs.example.edu.cn/embed?code=ASEAN2026"
  width="100%"
  height="780"
  style="border:0;border-radius:16px;"
  allow="clipboard-write"
  title="东盟批量采购询价与议价实训">
</iframe>
```

- 建议高度 `720–820`，宽度至少 `900`；手机端自适应。
- 每个学生打开后填写姓名/班级开始，生成独立会话。
- 不要把 `?session=` 固定写进 iframe，否则所有学生共用同一会话。
- 如果平台支持，建议在新窗口也提供“全屏打开”链接，方便学生输入长句。

## 教师后台

- 入口：`/admin?token=<ADMIN_TOKEN>`
- 支持：会话列表、状态、轮次、风险标签、系统预估分、完整对话回放、单会话 CSV、班级汇总 CSV。
- 系统预估分是启发式，只用于快速定位；最终成绩请按教师用书中的五维评分表评定。
- 后台口令不要写进学生端页面或课程平台公开内容。

## 数据与隐私

- 数据文件：`webapp/data/sessions/<session-id>.jsonl`，逐轮追加，刷新不丢。
- 学号只存 SHA-256 前 16 位，不存明文；姓名/班级用于教师识别。
- 开聊前已提示“请勿输入真实手机号、邮箱、银行卡号”。
- 建议每学期结束后导出并归档，再清理 `data/sessions`；或挂载独立数据卷。
- 如需“只追加、不可改”的强审计，可把 JSONL 同步到对象存储/WORM 存储。

## 买家引擎说明

`engine.js` 是确定性状态机，优先保证：

1. 价格、库存、认证、账期不幻觉；
2. 同样的学生行为得到一致反馈，便于评分；
3. 所有风险标记可解释。

它不是大模型自由对话。这样设计是刻意的：课堂评分需要可复现，不能让模型每次把底价记成 2.30。若后续需要更自然的语言层，可在 `engine.js` 外层接一个 LLM 改写器，但商业状态与红线仍由本引擎控制。

## 测试

```bash
# 先启动服务
node server.js

# 另开终端
node test_scenarios.js
```

覆盖：正常守线、越权降价、免运费/ OA、虚假 SNI/私账、正确拒绝、中文提示。

## 目录

```
webapp/
├─ server.js            HTTP 服务、会话、日志、后台 API
├─ engine.js            买家状态机、报价解析、风险标记、评分
├─ public/
│  ├─ index.html        学生端
│  ├─ app.js            学生端交互
│  ├─ admin.html        教师后台
│  ├─ admin.js          后台交互
│  ├─ styles.css        全站样式
│  └─ favicon.svg
├─ data/sessions/       运行后生成
├─ Dockerfile
├─ render.yaml
├─ package.json
└─ test_scenarios.js
```

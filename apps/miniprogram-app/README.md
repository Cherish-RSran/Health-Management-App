# 家庭健康档案 · 微信小程序（云端版）

> 一句话定位：**带家人看病时，30 秒把事情说清楚。** 入口是子女代录（自查详细），产出是给医生看的提炼摘要。

本目录是「家庭健康档案」的 **微信小程序（云端版）**：前端 + 云函数后端 + 部署工具链。
同一套业务逻辑后续由脚本派生出安卓单机版（`../android-app`）。

---

## 一、技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 前端 | 原生微信小程序（WXML / WXSS / JS） | 无第三方 UI 框架，`libVersion 3.5.5` |
| 后端 | 微信云开发（云函数 + 云数据库 + 云存储） | Node.js 单函数多 action 分发 |
| 工具链 | Node.js 脚本（miniprogram-ci + @cloudbase/manager-node） | 部署 / 建库 / 常量同步 / 工程自检 |

---

## 二、环境配置

1. **Node.js 18 LTS 及以上** —— 仅工具链（部署/同步/自检）需要；运行小程序本身用微信开发者工具。
2. **微信开发者工具（稳定版）** —— 用于编译、预览、上传。
3. **微信小程序账号** —— 公众平台注册，拿到 **AppID**。
4. **微信云开发环境** —— 在开发者工具内开通云开发，拿到 **环境 ID（envId）**。
5. **部署凭据** —— 复制到 `deploy.config.json`，字段：`appid` / `envId` / `secretId` / `secretKey` / `encKey` / `privateKeyPath`。
   - 该文件已在 `.gitignore`，**切勿提交到仓库**。
   - `encKey` 一旦投产**不可更换**（换密钥 = 已加密的手机号 / 身份证永久解不开）。

---

## 三、目录结构

```
miniprogram-app/
├── miniprogram/            # ① 前端（原生 WXML/WXSS/JS）
│   ├── pages/              # 8 个页面：home / condition / family / me / person / record / summary / timeline
│   ├── utils/              # 纯函数层：constants / date / format / model / validate / api / guide / page
│   ├── app.js · app.json · app.wxss
│   └── project.config.json # 微信开发者工具工程配置（miniprogramRoot / cloudfunctionRoot）
├── cloudfunctions/api/     # ② 后端（Node.js 单函数多 action）
│   ├── index.js            # 入口：解析 action 并分发
│   ├── actions/            # 业务动作：auth / condition / family / home / me / person / record / summary / timeline
│   └── lib/                # 鉴权 / 审计 / 加密 / 查询 / 错误 + shared（由 ① 自动生成，勿手改）
├── scripts/                # 工具链
│   ├── deploy/             # 一键部署：db（建库）/ fn（传云函数）/ upload（上传小程序包）
│   ├── sync-shared.js      # ① 常量/纯函数 → ② lib/shared（生成物，勿手改）
│   └── check-project.js    # 工程结构自检
├── project.config.json     # 微信开发者工具配置
├── deploy.config.json      # 部署凭据（已在 .gitignore）
└── package.json            # 工具链脚本
```

---

## 四、运行与构建

### 4.1 开发预览（小程序本身）
用**微信开发者工具**「导入项目」，选择本目录作为工程根（这里存放 `project.config.json`）。
编译后即在模拟器 / 真机预览。前端逻辑改动即时热重载。

### 4.2 工具链（终端）
```bash
cd apps/miniprogram-app
npm install                       # 装工具链依赖
npm run sync                     # 同步常量 / 纯函数 ① → ②（改完云端逻辑必跑）
npm run check                    # 工程结构自检（页面四件套 / tabBar / utils 可加载）
```

### 4.3 部署到云端
```bash
npm run deploy:setup             # 向导式填写 deploy.config.json 凭据
npm run deploy:check             # 校验工具链与凭据（不改动任何资源）
npm run deploy -- --dry-run      # 预演（零改动，仅打印将执行的操作）
npm run deploy                   # 一键部署：建库 + 上传小程序包 + 传云函数
# 也可分步：
npm run deploy:db                # 仅建库 / 建索引
npm run deploy:fn                # 仅上传云函数
npm run deploy:upload           # 仅上传小程序前端包
```

> ⚠️ 改完云端小程序后，**务必先跑 `npm run sync`**，否则云函数端的共享模块会落后于前端源（曾发生过摘要逻辑落后导致把已愈慢性病误带进医生摘要的 bug）。

---

## 五、代码归属与同步规则（避免分叉）

安卓版不是重写，而是脚本从本云端版派生。核心同步关系：

1. **常量三处对齐**
   - 源：`miniprogram/utils/constants.js`（CommonJS，手写）
   - 派生：`cloudfunctions/api/lib/shared/constants.js`（`npm run sync` 生成，勿手改）
   - 派生：`../android-app/src/core/constants.js`（ESM 改写，供 Vite）
2. **纯函数层同一份**：`miniprogram/utils/{date,format,model,validate}.js` → 同步至 `cloudfunctions/api/lib/shared/`。
3. **业务逻辑同一份**：`cloudfunctions/api/actions/*` →（经 `../android-app/scripts/convert-server.js`）→ `../android-app/src/server/actions/*`。

---

## 六、红线与合规

- **去医疗化**：文案不出现「诊断 / 处方 / 建议服用」等医疗用语。
- **零推送**：提醒仅站内展示，不接订阅消息。
- **无 AI 诊断**：报告解读为人工标注，不生成自动诊断结论。
- **隐私**：手机号、身份证加密存储；附件私有，只发临时链接，不产生公开图片 URL。

---

## 七、已知口径

- 一期集合数 = **23**（含 `vital_sign` 体征指标）；预留 `exam_item` / `exam_item_dict` / `share_link`。
- 部署密钥（`deploy.config.json`）已在 `.gitignore`，切勿提交。

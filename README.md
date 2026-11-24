# 家庭健康档案 · 工作空间地图

> 一句话定位：**带家人看病时，30 秒把事情说清楚的东西。** 入口是子女代录（自查详细），产出是给医生看（提炼摘要）。
> 本仓库是 **monorepo**：同一套业务逻辑，派生出「微信小程序（云端）」与「安卓单机版（本机）」两个终端，外加部署工具链与交互原型。

---

## 一、目录结构

```
家庭健康档案小程序/
├── apps/
│   ├── miniprogram-app/        # 子项目①+② 微信小程序（云端版）：前端 + 云函数 + 部署工具链
│   │   ├── miniprogram/        #   ① 前端（原生 WXML/WXSS/JS）
│   │   ├── cloudfunctions/api/ #   ② 后端（Node.js 单函数多 action）
│   │   ├── scripts/            #   部署 / 建库 / 常量同步 / 工程自检（deploy/、sync-shared.js…）
│   │   ├── project.config.json #   微信开发者工具配置（miniprogramRoot / cloudfunctionRoot）
│   │   ├── deploy.config.json  #   部署密钥 ⚠️ 已在 .gitignore
│   │   └── package.json        #   工具链脚本（deploy / sync / check）
│   └── android-app/            # 子项目③ 安卓单机版（Capacitor 7 + Vue 3 + Vite 6，数据存本机）
│       ├── src/                #   Vue 页面 + 同份业务 action + 本地 IndexedDB 内核
│       ├── android/            #   Capacitor 原生安卓工程（AGP 8.7.2, SDK 35）
│       └── scripts/            #   convert-server.js / convert-styles.js / build-apk.js
├── demo/
│   └── index.html              # 子项目④ 单文件 HTML 交互原型（设计评审用，免构建）
├── docs/                       # 汇总文档：版本变更记录 + 开发过程及成果
└── README.md                   # 本文件
```

> 微信开发者工具请打开 `apps/miniprogram-app/` 作为工程根目录（那里是 `project.config.json` 所在）。

---

## 二、子项目一览（框架 / 职责 / 归属 / 构建）

| 子项目 | 框架 | 职责 | 代码归属关键点 | 构建 / 运行 |
|---|---|---|---|---|
| ① 小程序前端 | 原生微信小程序，`libVersion 3.5.5` | 8 个页面 + `form-sheet` 组件 + `utils` | `miniprogram/utils/constants.js` 是**常量源**（CommonJS） | 微信开发者工具编译 |
| ② 云函数后端 | 微信云开发 Node.js | 40+ action + 鉴权/审计/加密/查询 | `cloudfunctions/api/lib/shared/constants.js` 由 ① **自动生成** | `npm run deploy`（miniprogram-ci + cloudbase） |
| ③ 安卓单机版 | Capacitor 7 + Vue 3 + Vite 6 | 同份业务逻辑跑本机，数据存 IndexedDB 不联网 | `android-app/src/core/constants.js`（ESM 改写）；`src/server/actions/*` 由 ② 转换 | `npm run apk`（JDK17+/Android SDK） |
| ④ 交互 Demo | 单文件 HTML | 还原界面供设计评审 | `demo/index.html` | 浏览器直接打开 |

---

## 三、代码归属与同步规则（重要，避免分叉）

安卓版**不是重写**，而是脚本从云端版派生：

1. **业务逻辑同一份**：`cloudfunctions/api/actions/*` →（经 `android-app/scripts/convert-server.js`）→ `android-app/src/server/actions/*`。改了云端逻辑，重跑脚本即同步。
2. **常量三处必须对齐**：
   - 源：`apps/miniprogram-app/miniprogram/utils/constants.js`（CommonJS，`module.exports`）
   - 派生：`apps/miniprogram-app/cloudfunctions/api/lib/shared/constants.js`（**`node scripts/sync-shared.js` 生成，勿手改**）
   - 派生：`apps/android-app/src/core/constants.js`（ESM `export`，供 Vite）
3. **纯函数层同一份**：`miniprogram/utils/{date,format,model,validate}.js` → 同步至 `cloudfunctions/api/lib/shared/`。
4. **UI 同一份**：`miniprogram/app.wxss` →（经 `android-app/scripts/convert-styles.js`）→ `android-app/src/styles/base.css`（rpx → `calc(N*var(--rpx))`）。

> ⚠️ 改完云端小程序后，务必在 `apps/miniprogram-app/` 下跑 `node scripts/sync-shared.js`，否则 ②③ 会漂移（曾发生过云函数端摘要逻辑落后于小程序源、把已愈慢性病误带进医生摘要的 bug，已修复）。

---

## 四、已知口径（已对齐）

- **集合数量 = 23**（以 `ONE_PHASE_COLLECTIONS` 为准，含一期新增的 `vital_sign` 体征指标）；预留 3 个：`exam_item` / `exam_item_dict`（二期）、`share_link`（后期）。详见 `docs/开发过程及成果.md` §四。
- 安卓 `variables.gradle`：`compileSdk/targetSdk = 35`（README 已更正为 35）。

---

## 五、构建 / 部署命令速查

```bash
# —— 小程序（云端版）——
cd apps/miniprogram-app
npm install                       # 装工具链
npm run sync                      # 同步常量 / 纯函数 ① → ②
npm run check                     # 工程自检
npm run deploy:setup              # 填 deploy.config.json 凭据
npm run deploy -- --dry-run       # 预演（零改动）
npm run deploy                    # 一键部署（建库+上传+传云函数）

# —— 安卓（本机版）——
cd apps/android-app
npm install
npm run dev                       # 浏览器预览 127.0.0.1:5173
npm run gen:server                # 从 ② 同步业务 action
node scripts/convert-styles.js    # 从 app.wxss 同步样式
npm run apk                       # 一键打包 APK（前置 JDK17+ / Android SDK）
```

---

## 六、安全与密钥

- `deploy.config.json` 含 `appid / envId / secretId / secretKey / encKey`，**已在 `.gitignore`**（无锚点规则，嵌套位置同样生效），切勿提交。
- `encKey` 一旦投产**不可更换**（换密钥 = 已加密的手机号/身份证永久解不开）。
- 附件私有，只发临时链接，不产生公开图片 URL。

---

## 七、整理记录

- 将根目录 9 份规划/产品文档移入 `docs/`。
- **深度分组**：将云端小程序簇（`miniprogram/`、`cloudfunctions/`、`scripts/`、工程配置、`package.json`、工具链 `node_modules`）整体移入 `apps/miniprogram-app/`；安卓工程移入 `apps/android-app/`。所有内部路径均相对自身，迁移后自洽（`check-project` 通过、`sync --check` 通过）。
- 运行 `sync-shared.js` 消除 ①③ 与 ② 的共享模块分叉（含修复云函数端摘要逻辑落后于源的 bug）。
- 修正文档口径：集合数统一为 **23**；安卓 SDK 更正为 35。

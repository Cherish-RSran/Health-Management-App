# 家庭健康档案（Health Management App）

> **带家人看病时，30 秒把事情说清楚。**

一个面向家庭的轻量健康档案工具：平时由子女补记家人的病情、用药、就诊和检查，形成一条可回溯的时间线；就医时从同一份数据提炼出医生看得懂的摘要——把混乱的口述变成能快速说清的事实。

仓库包含两个可运行版本，业务逻辑同源：

| 版本 | 目录 | 说明 |
|---|---|---|
| 微信小程序（云端版） | [`apps/miniprogram-app`](apps/miniprogram-app) | 原生小程序 + 微信云开发，支持家庭共享 |
| 安卓单机版 | [`apps/android-app`](apps/android-app) | Capacitor + Vue 3，数据全部存本机，不联网 |

---

## 主要功能

- **病程时间线**：病情、就诊、检查、体检、疫苗、体征混排，支持徽标筛选与进行中置顶
- **补记模式**：可回溯任意历史日期；「实际发生时间」与「补录时间」分开保存，不扰乱时间线
- **长期用药**：记录剂量、时段、余量与续方日期，站内提示该买药了（**零推送**）
- **双视图**：自查视图保留全量细节，医生视图从同一份数据提炼摘要
- **家庭共享**：按成员授予 owner / edit / read / none 四档权限；代管档案需本人同意
- **报告要点**：附件仅供本人查看（临时链接），要点由人工标注，**不生成 AI 诊断**

一期明确不做：订阅消息推送、AI 症状推断 / 用药建议、服药打卡。

---

## 技术栈

| 层 | 技术 |
|---|---|
| 小程序前端 | 原生 WXML / WXSS / JS，libVersion 3.5.5 |
| 小程序后端 | 微信云开发：云函数（单函数多 action）+ 云数据库 + 云存储 |
| 安卓端 | Capacitor 7 + Vue 3 + Vite 6，IndexedDB 本地存储 |
| 部署工具 | miniprogram-ci + 云开发 CLI（Node.js 脚本） |
| 原型 | 单文件 HTML（[`demo/index.html`](demo/index.html)），浏览器直接打开 |

**同源策略**：安卓版不是重写。`scripts/convert-server.js` 把云端业务 action 转为 ESM，`scripts/convert-styles.js` 把小程序样式转为 CSS。改业务逻辑只改云端源，重跑脚本即可同步。

---

## 快速开始

### 微信小程序

```bash
cd apps/miniprogram-app
npm install
npm run sync                 # 同步共享常量与纯函数
npm run check                # 工程结构自检
npm run deploy:setup         # 配置 appid / envId / 密钥
npm run deploy -- --dry-run  # 预演，零改动
npm run deploy               # 建库 + 上传 + 部署云函数
```

用微信开发者工具打开 `apps/miniprogram-app/` 作为工程根目录。

> `deploy.config.json` 含凭据，已加入 `.gitignore`，需按向导本地生成。加密密钥 `encKey` 一旦投产不可更换，否则已加密数据永久无法解密。

### 安卓单机版

```bash
cd apps/android-app
npm install
npm run dev                       # 浏览器预览 127.0.0.1:5173
npm run gen:server                # 从云端同步业务 action
node scripts/convert-styles.js    # 从小程序样式同步 CSS
npm run apk                       # 打包 APK（需 JDK 17+ / Android SDK 35）
```

详细环境配置与目录说明见各子项目 README 与开发文档。

---

## 数据模型

一期 23 个集合，全部设为「仅管理端可读写」，前端不直连数据库，一律经云函数访问。核心约定：

- `timeline_event` 的 `occurred_at`（实际发生）与 `recorded_at`（补录时间）分离
- 长期用药表 `long_term_medicine` 与本次用药事件分表，绝不混用
- 权限判定走 `person_access`，不看角色字段
- 每张业务表带 `family_id`，且只信服务端反查结果
- 手机号、身份证、紧急联系人电话加密存储

完整字段定义与索引见 [`docs/开发过程及成果.md`](docs/开发过程及成果.md)。

---

## 合规红线

- 类目与文案去医疗化：不出现「问诊 / 诊断 / 处方 / 建议服用」
- 共享档案须归属人本人单独同意
- 附件私有，只发临时链接，不产生公开图片 URL
- 不接医院 HIS，不生成诊断结论

---

## 文档

- [`docs/开发过程及成果.md`](docs/开发过程及成果.md) — 产品设计、技术架构、数据模型、部署、验证与当前状态
- [`docs/版本变更记录.md`](docs/版本变更记录.md) — 产品版本与开发阶段变更
- [`apps/miniprogram-app/开发文档.md`](apps/miniprogram-app/开发文档.md) / [`apps/android-app/开发文档.md`](apps/android-app/开发文档.md) — 各端开发说明

---

## 状态

代码完成，双端构建通过。小程序云端版需完成主体注册与认证、云开发环境配置后才能部署；安卓版按上述命令即可本机打包。

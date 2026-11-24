# 家庭健康档案 · 安卓本机版

把微信小程序原样搬到安卓手机上，**所有数据存在手机本地，不联网、不上传**。

---

## 一、项目简介

家庭健康档案的安卓单机版（子项目③）。与云端小程序是**同一套业务逻辑**，区别只在运行环境与存储：

- 云端小程序：微信云开发（云数据库、openid 免登、可家庭共享）。
- 安卓版：本机 Capacitor WebView + IndexedDB，无后端、无网络，数据只在这台机器。

适合场景：不想把家人健康数据上传、只需本机记录与出示（带家人看病时把时间线 / 医生摘要亮给医生看）。

---

## 二、技术栈

| 层 | 技术 |
|---|---|
| 跨端框架 | Capacitor 7 + Vue 3 + Vite 6 |
| 前端 | Vue 3 单文件组件（`.vue`），`vue-router` 路由 |
| 本地存储 | IndexedDB（复刻云数据库同一套 API，业务无感切换） |
| 原生壳 | Android（AGP 8.7.2，compileSdk / targetSdk = 35） |

---

## 三、环境配置

### 3.1 仅做前端 / Web 预览（不需要打包 APK）
1. **Node.js 18 LTS 及以上** + npm。
2. 安装依赖：`npm install`。
3. 浏览器预览：`npm run dev`（http://127.0.0.1:5173）。

### 3.2 打包 APK（需要安卓原生环境）
1. **JDK 17+**（`java -version` 确认）。
2. **Android SDK**：Android Studio → Settings → Android SDK → 勾选 `Android SDK Platform 35` 与 `Android SDK Build-Tools 35` → Apply。
3. 脚本会自动查找 `ANDROID_HOME`、`~/AppData/Local/Android/Sdk` 等常见位置，找不到会给提示。

---

## 四、怎么跑（前端 / Web）

```bash
npm install          # 装依赖（仅需一次）
npm run dev          # 浏览器预览 http://127.0.0.1:5173
npm run build        # 产出 dist/（Web 包，也可被 Capacitor 打包进 APK）
npm run preview      # 本地静态预览 dist/
```

> 业务逻辑由小程序云函数转换而来。改了云端逻辑后，在本目录跑：
> `npm run gen:server`（同步业务 action）+ `node scripts/convert-styles.js`（同步样式）。

---

## 五、怎么打包 APK

### 一键（推荐）
```bash
npm run apk
```
脚本会自检 Java / Android SDK → 构建前端 → 同步安卓工程 → Gradle 打包，最后把 APK 复制到 `家庭健康档案-debug.apk`。

### 已踩过的两个坑（脚本自动处理，手动打包时留意）
1. **工程路径含中文**。本工程在「家庭健康档案小程序」目录下，AGP 8 默认会报 `Your project path contains non-ASCII characters`。已在 `android/gradle.properties` 加 `android.overridePathCheck=true` 解决。
2. **`services.gradle.org` 国内极慢**。卡在下载 Gradle 分发包时，改用镜像（如 `https://mirrors.cloud.tencent.com/gradle/`、`https://mirrors.huaweicloud.com/gradle/`）或手动放进 `~/.gradle/wrapper/dists/`。

### 手动
```bash
npm run build
npx cap sync android
cd android
gradlew.bat assembleDebug          # 调试包
gradlew.bat assembleRelease        # 正式包（需先配签名）
```
产物在 `android/app/build/outputs/apk/`。

### 装到手机
```bash
adb install -r 家庭健康档案-debug.apk
```

### 关于「联网」
APK 声明了 `INTERNET` 权限（Capacitor 默认，WebView 加载 `https://localhost` 本地源需要），**不是业务在用**。业务代码无任何网络调用，数据全走同机 IndexedDB——**开飞行模式 App 照常运行**。

---

## 六、数据存在哪、怎么保住

- 位置：App 私有目录下的 IndexedDB（`family_health_db`）。卸载 App 会一起清掉（安卓规则）。
- 备份：「我的 → 本机数据备份 → 导出备份到文件」，存成 JSON（可选密码，AES-GCM + PBKDF2）。
- 恢复：同入口「从备份文件恢复」，覆盖本机现有数据。⚠️ 换手机 / 清数据前先导出。
- 手机号、身份证加密存储；导出的 JSON 含密文，仍需妥善保管。

---

## 七、和小程序版的差异（都是单机带来的，不是功能阉割）

| 功能 | 安卓版 |
|---|---|
| 家庭共享 / 邀请码 / 成员审批 | 入口保留，但本机只有一个用户，不会出现待审批 |
| 档案权限（owner / edit / read / none） | 机制完整保留，本机用户对所有档案是 owner |
| 登录 | 无微信身份；可「跳过，仅本机使用」，或手机号 + 密码注册 |
| 附件上传 | 一期未做，不受影响 |
| 推送提醒 | 一期本就是站内展示，不受影响 |
| 敏感字段加密 | 云版 AES-256-GCM；浏览器无同步 AES，改 RC4 流密码 + 本机密钥，目的是避免明文落盘 |

---

## 八、样式和小程序一不一致？

分两类：**同源的（脚本转换，可验证一致）** 与 **微信原生控件（只能重写，观感接近）**。

### 同源：由 `node scripts/convert-styles.js` 从 wxss 转换
| 原文 | 转换后 |
|---|---|
| `28rpx` | `calc(28 * var(--rpx))`（`--rpx = 100vw / 750`） |
| `page { ... }` | `:root { ... }` |
| `view / text` | `*` |

### 必须重写：微信原生控件在 H5 里没有对应物
原生 tabBar / 导航栏 / `wx.showToast` / `<picker mode="date">` / `<scroll-view>` / 安全区 等，由 `App.vue` 自绘或换成 HTML 等价物（最明显差异：日期选择变成**系统日期选择器**）。

### 为安卓单独处理的三处
1. Android 15 edge-to-edge：启动时用 `@capacitor/status-bar` 关掉 overlay，WebView 回到状态栏下方。
2. 手势导航条：`env(safe-area-inset-bottom)` 多为 0，已叠加 rpx 保底。
3. 弹层层级：H5 tabBar 是页面内 fixed，`.mask` 抬到 tabBar 之上。

---

## 九、目录结构

```
android-app/
├── src/
│   ├── core/       纯函数 + 本地数据库(IndexedDB) + UI 中间层
│   ├── server/     业务逻辑（由小程序云函数转换而来，勿手改）
│   ├── pages/      9 个页面（.vue，含 Login 登录页）
│   ├── components/ 表单弹层、底部导航
│   └── styles/     由 wxss 转换而来（生成物）
├── scripts/        convert-server.js / convert-styles.js / build-apk.js
├── android/        Capacitor 生成的安卓工程
├── index.html      Vite 入口
└── package.json
```

---

## 十、红线与合规

- 去医疗化、零推送、无 AI 诊断（同云端版）。
- 数据全本机、不联网；备份文件含密文，妥善保管。

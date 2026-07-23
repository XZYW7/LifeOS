# LifeOS APK 构建指南

从源码到 Android APK 的完整流程。本仓库已完成 Capacitor 脚手架
（`app/capacitor.config.ts`、`app/android/`），只需补装 Android SDK 即可出包。

## 前置环境

| 工具 | 要求 | 说明 |
| --- | --- | --- |
| Node.js | ≥ 20 | 已在用 |
| JDK | 21 | 本工程 capacitor-android 模块编译目标为 Java 21（实测 JDK 17 报"无效的源发行版：21"） |
| Android Studio | 最新稳定版 | 主要用它装 SDK 和命令行工具 |
| Android SDK | Platform 35（或 `variables.gradle` 里的 `compileSdkVersion`）+ Build-Tools | 通过 SDK Manager 安装 |

### 安装步骤

1. 安装 Android Studio（默认全选即可，会带上 Android SDK、Platform-Tools、内置 JDK）。
2. 打开 Android Studio → **More Actions → SDK Manager**：
   - SDK Platforms：勾选 **Android 15 (API 35)**（或 `app/android/variables.gradle` 中的版本）；
   - SDK Tools：勾选 **Android SDK Build-Tools**、**Android SDK Command-line Tools**。
3. 配置环境变量（Windows 示例，按实际安装路径调整）：

   ```
   ANDROID_HOME = C:\Users\<你>\AppData\Local\Android\Sdk
   Path 追加  = %ANDROID_HOME%\platform-tools;%ANDROID_HOME%\cmdline-tools\latest\bin
   JAVA_HOME  = C:\Program Files\Android\Android Studio\jbr   （可选，Android Studio 内置 JDK）
   ```

4. 验证：新开终端执行 `adb --version` 有输出即可。

## 构建 APK

所有命令在 `app/` 目录下执行：

```bash
# 1. 构建前端（产出 app/dist）
npm run build

# 2. 把 dist 同步进 android 工程（每次改完前端都要重跑这两步）
npx cap sync android

# 3. 出 debug 包
cd android
./gradlew assembleDebug        # Windows cmd/PowerShell 用 gradlew.bat assembleDebug
```

产物路径：

```
app/android/app/build/outputs/apk/debug/app-debug.apk
```

把 APK 拷到手机安装即可（需允许「安装未知来源应用」）。也可以用
`npx cap open android` 在 Android Studio 里打开工程，点 Run 直接装到
USB 连接的手机或模拟器。

## 两种运行模式

### A. 打包资产模式（默认）

`capacitor.config.ts` 不设置 `server.url`，WebView 加载 APK 内置的 `dist/`。
前端没有同源后端，需在 App 的「手机访问」页（路由 `/access`）把后端地址填为
电脑局域网地址，如 `http://192.168.1.10:3456`（写入 localStorage
`lifeos-server-url`，`src/lib/api.ts` 的 `setServerUrl`）。留空则回退同源模式
（网页版/单端口部署不受影响）。

### B. 开发热更新模式

改 `capacitor.config.ts` 取消注释：

```ts
server: {
  url: 'http://<局域网IP>:3456',
  cleartext: true,
},
```

然后 `npx cap sync android` 并重装 APK。WebView 直接加载局域网服务器页面，
改前端代码即热更新。**正式出包前记得改回注释状态。**

## 常见问题

**1. `SDK location not found`**
在 `app/android/` 下新建 `local.properties`，写
`sdk.dir=C:\\Users\\<你>\\AppData\\Local\\Android\\Sdk`（注意反斜杠转义），
或确保 `ANDROID_HOME` 环境变量已配置且重开了终端。

**2. `Unsupported class file major version` / `无效的源发行版：21`**
本工程需要 JDK 21。设 `JAVA_HOME` 指向 JDK 21（工作区内已装好在 `toolchain\jdk`），或 Android Studio 较新版本的 `jbr`。在 `app/android/` 执行
`./gradlew --version` 可确认当前 JVM。

**3. APK 里页面白屏 / 请求失败**
- 打包资产模式下前端默认走同源 `/api`，APK 里没有后端 → 必须在 `/access` 页
  配置后端地址（见上文「运行模式 A」）。
- 确认后端监听的是 `0.0.0.0` 而不是 `127.0.0.1`，手机才能访问到。
- 手机与电脑在同一 WiFi；Windows 防火墙首次弹窗要放行 3456 端口。

**4. HTTP 明文请求被拦（cleartext not permitted）**
局域网后端是 http。脚手架已在 `capacitor.config.ts` 设置
`android.allowMixedContent: true`；若仍有拦截，检查
`android/app/src/main/AndroidManifest.xml` 是否含
`android:usesCleartextTraffic="true"`（`cap sync` 会按配置写入）。

**5. CORS**
后端已支持 CORS，APK WebView（origin 为 `https://localhost` /
`capacitor://localhost`）和手机浏览器跨源请求 `/api/*` 均可直连，无需前端代理。

**6. 局域网地址在哪看**
后端新增 `GET /api/access-info` 返回 `{ port, lanUrls }`；App 内
`/access` 页会以大字展示并支持点击复制。

**7. 每次改前端后 APK 内容没变**
打包资产模式必须重新 `npm run build && npx cap sync android` 再
`./gradlew assembleDebug`（cap sync 只是拷贝 dist，不会触发 vite build）。

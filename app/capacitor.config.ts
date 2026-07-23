import type { CapacitorConfig } from '@capacitor/cli';

/**
 * LifeOS Capacitor 配置
 * ─────────────────────────────────────────────────────────────
 * 默认（生产/APK）：不设置 server.url，WebView 直接加载打包进 APK 的
 * webDir（dist/）资产。此时前端通过 localStorage 的 lifeos-server-url
 * （见 src/lib/api.ts 的 setServerUrl）指向局域网后端，例如
 * http://192.168.1.10:3456 —— 在「手机访问」页（/access）可配置。
 *
 * 开发期热更新：取消下面 server 块的注释，把 url 指向本机局域网地址
 * （后端监听 0.0.0.0:3456），然后 `npx cap sync` 并重新安装 APK，
 * WebView 就会直接加载 dev/局域网服务器上的页面，改代码即热更新：
 *
 *   server: {
 *     url: 'http://<局域网IP>:3456',
 *     cleartext: true, // 允许 http（Android 默认禁 cleartext）
 *   },
 */
const config: CapacitorConfig = {
  appId: 'com.lifeos.app',
  appName: 'LifeOS',
  webDir: 'dist',
  // 开发期热更新示例（默认保持注释，打包资产模式）：
  // server: {
  //   url: 'http://192.168.1.10:3456',
  //   cleartext: true,
  // },
  android: {
    // 局域网后端一般是 http，允许明文流量（仅 http/https 混合场景需要）
    allowMixedContent: true,
  },
};

export default config;

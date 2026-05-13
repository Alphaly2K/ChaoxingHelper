# ChaoxingHelper

一个“动态二维码内容中继”项目：
- 发码端先本地解码二维码内容（URL/Token）
- 仅传输解码后的文本
- 接码端收到文本后重建二维码供扫码设备读取

这样可以显著降低视频传输带宽需求，并减少画质带来的识别失败。

## 架构

- `server.js`：Node.js 中继服务（HTTP + WebSocket）
- `public/sender.html`：发码端页面（摄像头识别 + 上传）
- `public/receiver.html`：接码端页面（接收内容 + 重建二维码）
- `public/index.html`：会话入口页

当前实现默认使用服务端中继（稳定性优先）。如后续验证局域网/公网 p2p 打洞质量稳定，可在现有协议上增加 WebRTC 数据通道。

## 快速开始

```bash
npm install
npm start
```

默认监听：`http://0.0.0.0:3000`

可选环境变量：
- `PORT`：端口（默认 `3000`）
- `HOST`：绑定地址（默认 `0.0.0.0`）

## 使用说明

1. 打开 `http://<server>:3000`
2. 生成会话号
3. 在“代拍者设备”打开 **发码端** 页面（`sender.html`）
4. 在“接码设备”打开 **接码端** 页面（`receiver.html`）
5. 两侧使用同一个会话号

### Android 支持

- 推荐 Chrome（Android 版本较新）
- 发码端依赖 `BarcodeDetector` 与摄像头权限
- 若设备浏览器不支持 `BarcodeDetector`，可在发码端使用“手动输入模式”粘贴二维码内容

## 协议（WebSocket）

连接：`/ws?session=<会话号>&role=sender|receiver`

- 发码端上传：
  ```json
  { "type": "qr_update", "content": "<二维码原始内容>" }
  ```
- 接码端接收：
  ```json
  { "type": "qr_update", "content": "<二维码原始内容>", "updatedAt": "<ISO 时间>" }
  ```

## 安全与限制

- 服务端仅做会话级转发，不做身份认证；建议在可信网络或加反向代理鉴权后使用
- `session` 为轻量会话标识，不是强安全令牌
- 建议部署在 HTTPS 下，移动端访问更稳定

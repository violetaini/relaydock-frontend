<div align="center">
  <img src="public/avatar.webp" alt="RelayDock" width="120" />

# **RelayDock Console**

[![Frontend CI](https://img.shields.io/github/actions/workflow/status/violetaini/relaydock-frontend/build.yml?branch=main&style=for-the-badge&label=BUILD)](https://github.com/violetaini/relaydock-frontend/actions/workflows/build.yml)
[![Node.js](https://img.shields.io/badge/Node.js-22-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/github/license/violetaini/relaydock-frontend?style=for-the-badge)](LICENSE)

RelayDock 多服务器 Xray 控制面板的 React Web 控制台。

[后端与安装](https://github.com/violetaini/relaydock-backend) · [问题反馈](https://github.com/violetaini/relaydock-frontend/issues) · [参与贡献](#参与贡献)
</div>

## 项目简介

RelayDock Console 是 [RelayDock Backend](https://github.com/violetaini/relaydock-backend) 的管理界面，面向多服务器节点运营、用户授权和订阅交付场景。前端通过同源 `/api` 与后端通信，正式版本由后端内嵌并作为一个服务发布，因此普通用户只需安装后端，无需单独部署前端。

## 主要功能

- 多服务器、节点、用户、套餐和订阅统一管理
- 按服务器向用户授权，并设置节点创建与使用期限
- VLESS、VMess、Trojan、Shadowsocks 等常见协议配置表单
- Reality、TLS、WebSocket、TCP 等传输与安全选项
- 节点限速、流量统计、测速和在线状态查看
- 证书、模板、规则、订阅文件与系统设置管理
- 响应式桌面/移动端界面、明暗主题与双因素认证流程

## 快速开始

### 安装完整面板

生产环境请直接安装 [RelayDock Backend](https://github.com/violetaini/relaydock-backend)。后端发行包已经包含本控制台，安装完成后即可通过浏览器使用。

### 本地开发

环境要求：

- Node.js 22
- npm 10 或更高版本
- 本地运行的 RelayDock Backend（需要调用真实 API 时）

```bash
git clone https://github.com/violetaini/relaydock-frontend.git
cd relaydock-frontend
npm ci
npm run dev
```

开发服务器默认监听 `0.0.0.0:5173`，并将 `/api` 请求代理到 `http://127.0.0.1:12889`。

## 测试与构建

提交前运行完整校验：

```bash
npm run typecheck
npm test
npm run build
```

生产构建输出到 `dist/`。端到端测试需要先安装 Playwright 浏览器，然后运行：

```bash
npx playwright install chromium
npm run test:e2e
```

设置 `PRODUCTION_BASE_URL` 后，端到端测试还会执行可选的生产环境冒烟检查。

## 嵌入后端

RelayDock Backend 使用 Go `embed` 提供前端静态文件。发布完整面板时：

1. 在本仓库运行 `npm ci && npm run build`。
2. 用 `dist/` 的内容替换后端仓库的 `internal/web/dist/`。
3. 在后端仓库执行测试并构建 Go 二进制。

前后端接口应使用匹配的版本；不要将来源不明的前端构建产物直接嵌入生产二进制。

## 项目结构

| 路径 | 用途 |
| --- | --- |
| `src/` | React 页面、组件、API 客户端与单元测试 |
| `e2e/` | Playwright 工作流、视觉和生产冒烟测试 |
| `public/` | 品牌图片与无需打包处理的静态资源 |
| `dist/` | Vite 生成的生产构建产物 |

## 参与贡献

欢迎通过 [Issues](https://github.com/violetaini/relaydock-frontend/issues) 报告问题或提出改进。提交 Pull Request 前，请确保类型检查、单元测试和生产构建均通过，并避免提交账号、令牌、私钥或真实订阅数据。

## 开源许可

本项目基于 [MIT License](LICENSE) 开源，并保留上游项目的版权与许可声明。

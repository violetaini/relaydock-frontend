<div align="center">
  <img src="public/avatar.webp" alt="RelayDock" width="120" />

# **RelayDock Console**

[![Frontend CI](https://img.shields.io/github/actions/workflow/status/violetaini/relaydock-frontend/build.yml?branch=main&style=for-the-badge&label=BUILD)](https://github.com/violetaini/relaydock-frontend/actions/workflows/build.yml)
[![Node.js](https://img.shields.io/badge/Node.js-22-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/github/license/violetaini/relaydock-frontend?style=for-the-badge)](LICENSE)

RelayDock 多服务器 Xray 控制面板的 React Web 控制台。

[主仓库与安装](https://github.com/violetaini/relaydock) · [项目状态与发布进展](https://github.com/violetaini/relaydock/blob/main/docs/project-status.md) · [问题反馈](https://github.com/violetaini/relaydock-frontend/issues) · [参与贡献](#参与贡献)
</div>

## 项目简介

RelayDock Console 是 [RelayDock](https://github.com/violetaini/relaydock) 主仓库的管理界面，面向多服务器节点运营、用户授权和订阅交付场景。前端通过同源 `/api` 与后端通信，正式版本由主仓库内嵌并作为一个服务发布，因此普通用户只需安装主仓库版本，无需单独部署前端。

当前正式产品版本为 [`v0.6.6`](https://github.com/violetaini/relaydock/releases/tag/v0.6.6)。该版本中的控制台产物与控制面、Agent 安装资产、到期守卫和测速组件由同一个产品发布清单约束，避免前端与后端单独更新后出现不兼容状态。

## 主要功能

- 多服务器、节点、用户、套餐和订阅统一管理
- 按服务器、有效期和具体协议组合向用户授权自助建点
- VLESS、VMess、Trojan、Shadowsocks 2022、Hysteria2、WireGuard 等协议配置
- Reality、TLS、WebSocket、gRPC、TCP 等传输与安全组合
- TCP/UDP 多跳隧道与 Tunnel（任意门）管理
- 节点测速，以及主控和受管服务器 Ookla Speedtest 线路测速
- DNS 凭据、证书、模板、路由规则、订阅文件与系统设置管理
- 项目名称、Logo、浏览器图标的后台配置；留空时使用 RelayDock 默认品牌
- 公开探针页的 WebSocket 实时状态、流量和速率展示，以及移动端和宽屏布局
- 服务器管理的实时状态通道与秒级轮询回退
- 响应式桌面/移动端界面、明暗主题与双因素认证流程

## 实时数据与发布兼容性

公开探针默认通过 `/api/public/probe-ws` 接收实时帧；连接不可用时，前端以约 1 秒间隔请求 `/api/public/probe-servers` 保留最新有效快照。控制台服务器管理同样优先使用实时通道，并在连接中断时以 1 秒轮询维持状态、流量、吞吐、心跳和服务信息。

品牌配置来自公开和管理员设置接口。项目名称、Logo 或浏览器图标未配置时，控制台使用内置 RelayDock 默认值，不会因为缺少自定义资源而影响登录页、公开探针页或浏览器标题。

正式网页发布包中含有 `relaydock-release.json`，其中记录 Release ID、后端提交和 API 协议。产品更新在切换后必须验证该文件；前端不得以单独、未校验的静态目录覆盖生产实例。完整的事务模型、生产验收和运维边界见主仓库的 [项目状态与发布进展](https://github.com/violetaini/relaydock/blob/main/docs/project-status.md)。

## 快速开始

### 安装完整面板

生产环境请直接安装 [RelayDock](https://github.com/violetaini/relaydock)。主仓库发行包已经包含本控制台，安装完成后即可通过浏览器使用。

```bash
curl -fsSL https://raw.githubusercontent.com/violetaini/relaydock/main/install.sh | sudo bash
```

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

前后端接口应使用匹配的版本；不要将来源不明的前端构建产物直接嵌入生产二进制。稳定版本发布时，后端工作流会将网页归档、版本元数据、发布清单和校验和一并生成，面板的一键更新据此原子更新整个产品包。

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

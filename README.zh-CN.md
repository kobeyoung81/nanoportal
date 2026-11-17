# nanoportal

控制台：一个外壳、一个源，每个模块的页面都在里面。

它是八个一级服务之一。它提供前端、拥有会话投影与智能体行，并承载其它模块贡献的面板。

## 它是什么

- **一个外壳。** 对话、智能体、作品库与管理页面，都以插件形式来自各自的模块；外壳决定挂在哪儿。
- **一个工作台。** 可拖拽、可缩放的 panel，按人记住布局，主题与语言跟随外壳。
- **自助页。** 你的账号、你的智能体、你的容器、你的文件。
- **会话投影。** 侧边栏需要的元数据 —— 可以从智能体卷里的正文重建。
- **正门。** nginx 提供静态资源，并把每个 API 前缀路由给拥有它的模块；只有这个端口对外发布。

## 它在哪

| | |
|---|---|
| 集合 | `portal_agents`、`portal_agent_groups`、`portal_sessions`、`portal_binding_preferences` |
| 端口 | 网络内 `80`，宿主机 `14403` —— 唯一对外的一个 |
| 贡献 | 外壳、插件注册表、路由表、设计系统 |
| 读取 | `nanoauth`（令牌）、`nanoadmin`（配置）、`nanobus`（消息），以及各模块自己的 API |

## 快速开始

```bash
# 后端
cd server && go build ./cmd/nanoportal
NANOPORTAL_MONGO_URI="mongodb://localhost:27017/nanosec" \
NANO_PORTAL_BUS_URL="http://localhost:9000" \
NANOSEC_ADMIN_URL="http://localhost:14404" \
NANOSEC_BUS_INTERNAL_TOKEN="…" \
  ./nanoportal

# 前端
cd web && npm install && npm run dev      # vite，代理到后端
```

部署时镜像会把前端构建好、后端跑在 `127.0.0.1:8080`、nginx 挡在前面，
于是 `/`、`/api/*`、`/plugins/*` 同一个源。

## 配置

| 变量 | 含义 |
|---|---|
| `NANOPORTAL_MONGO_URI` | 平台库（它的 `portal_` 前缀） |
| `NANO_PORTAL_BUS_URL` | 总线，收发消息与事件流 |
| `NANOSEC_ADMIN_URL` | 配置与目录 |
| `NANO_PORTAL_AUTH_URL` / `NANO_PORTAL_JWKS_URL` | 身份 |
| `NANOSEC_BUS_INTERNAL_TOKEN` | 所有内部面共用的密钥 |

## 设计决策

- **外壳管框架，模块管页面。** 模块发布插件清单与产物，外壳从 `/plugins/<id>/` 装载。
  加一个页面不需要重建控制台。
- **一个源。** 镜像里的 nginx 把每个 API 前缀路由给对应模块、挂载插件，浏览器从不访问第二个域 ——
  没有 CORS，也没有跨站 cookie。
- **投影可以丢掉。** `portal_sessions` 只放侧边栏需要的东西；错了就从智能体的正文重建，
  那才是权威。
- **智能体行在这里。** 一个智能体归谁、属于哪个组，是控制台的事 —— 别的模块来问，不读 `portal_*`。

## 文档

- [`docs/ARCHITECTURE.md`](https://gitee.com/kobeyoung81/nanosec/blob/master/docs/ARCHITECTURE.md) —— 平台与插件模型
- [`docs/MANAGEMENT_PORTAL_DESIGN.md`](https://gitee.com/kobeyoung81/nanosec/blob/master/docs/MANAGEMENT_PORTAL_DESIGN.md) —— 控制台的页面与角色
- [`docs/README.md`](https://gitee.com/kobeyoung81/nanosec/blob/master/docs/README.md) —— 全部文档索引

## 状态

随 `v0.1.0` 发布；本模块的版本钉在超仓的 `versions.lock` 里。

## 贡献与安全

开发与提交规则见
[`CONTRIBUTING.md`](https://gitee.com/kobeyoung81/nanosec/blob/master/CONTRIBUTING.md)；
漏洞请按
[`SECURITY.md`](https://gitee.com/kobeyoung81/nanosec/blob/master/SECURITY.md) 私下报告，
不要开公开 issue。

## 许可证

[AGPL-3.0](./LICENSE)。名称与标志另有说明 —— 见 [`NOTICE`](./NOTICE)。

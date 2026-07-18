# River Room 德州牌室

River Room 是一款响应式多人联机无限注德州扑克 PWA，支持真人实时对局、AI 补位、常规桌与单桌锦标赛，并提供二维码邀请、观战选座、账号体系、排行榜、牌谱和运营后台。

> 本项目中的筹码与积分仅用于娱乐，不支持购买、提现或兑换，也不涉及真实资金。

## 核心功能

- **多人实时牌局**：支持 2–9 人桌，通过 Socket.IO 同步牌桌状态、玩家行动和聊天消息。
- **多种房间类型**：支持公开房、私密邀请房、休闲房、排位房、常规桌和单桌淘汰赛。
- **二维码邀请**：房间成员可生成邀请二维码；扫码者完成游客认证或登录后自动进入房间观战。
- **观战与选座**：进入房间时默认观战，可点击空座加入下一手，满桌时仍可继续观看。
- **AI 牌友**：提供简单、普通、困难三档 AI，可由房主手动添加或在倒计时后自动补位。
- **完整牌局规则**：包含盲注、下注轮次、全押、边池、摊牌、超时托管、断线重连和筹码守恒。
- **玩家账号**：支持游客、注册登录、游客升级、头像、每日筹码奖励与账号安全设置。
- **竞技与记录**：提供排位积分、月度赛季排行榜、完整牌谱和个人历史战绩。
- **交流与管理**：内置实时聊天、消息举报、用户管理和运营参数配置。
- **响应式 PWA**：适配桌面和移动设备，可安装到主屏幕并支持自动更新。

## 技术栈

| 模块 | 技术 |
| --- | --- |
| Web | React 19、TypeScript、Vite、React Router、TanStack Query、Zustand |
| 实时通信 | Socket.IO |
| 服务端 | Node.js、Fastify、Zod |
| 数据存储 | SQLite、Drizzle ORM |
| 游戏引擎 | 独立 TypeScript 状态机与牌型计算模块 |
| PWA | Vite PWA、Workbox |
| 测试 | Vitest、Playwright |
| Monorepo | pnpm workspace |

## 快速开始

### 环境要求

- Node.js 22 或更高版本
- pnpm 11

项目当前已在 Node.js 24 上验证。

### 安装与初始化

```bash
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm db:seed
pnpm dev
```

开发服务启动后：

- Web：`http://localhost:5174`
- API 与 WebSocket：`http://localhost:3001`
- 局域网设备：`http://<电脑局域网 IP>:5174`

执行 `pnpm db:seed` 后可使用以下演示账号：

- `river@example.com` / `Poker123!`
- `button@example.com` / `Poker123!`

也可以直接输入昵称，以游客身份进入牌室。

## 使用二维码邀请

1. 创建或进入一个房间。
2. 点击房间顶部的“分享房间”。
3. 让好友扫描二维码，或复制邀请链接发送给好友。
4. 好友可先预览房间；完成游客认证、登录或注册后，会自动进入房间观战。
5. 房间有空位且规则允许时，好友可点击空座入座。

二维码内容是形如 `/invite/ABC123` 的邀请页面地址。局域网联调时，应先通过电脑的局域网 IP 打开 Web 页面再生成二维码；如果从 `localhost` 打开，手机无法访问二维码中的本机地址。

公网部署时建议在构建前配置：

```bash
VITE_PUBLIC_APP_URL=https://poker.example.com
```

该变量未设置时，邀请链接会使用当前浏览器的域名或 IP。

## 生产运行

```bash
pnpm build
pnpm start
```

默认访问地址为 `http://localhost:3001`。生产模式下，Fastify 会同时托管构建后的前端、REST API 和 Socket.IO 服务，并为 `/invite/:code` 等前端路由提供 SPA 回退。

生产部署建议：

- 使用 HTTPS 和可信域名，以支持跨设备访问与完整 PWA 能力。
- 将 `data/poker.db` 和自定义头像目录放入持久卷并纳入备份。
- 在构建前设置 `VITE_PUBLIC_APP_URL`，运行时设置正确的 `APP_ORIGIN`。
- 使用反向代理转发 HTTP 与 WebSocket，并保留原始 Host/Forwarded Host 信息。
- 服务升级或重启前通知牌桌玩家，因为进行中的房间和牌局状态保存在内存中。

## 项目结构

```text
apps/
├── web/                 React + Vite 响应式 PWA
└── server/              Fastify + Socket.IO 服务
packages/
├── contracts/           REST、WebSocket 协议与共享类型
└── game-engine/         牌型、下注状态机、边池结算与 AI
e2e/                     Playwright 桌面与移动端验收
data/                    SQLite 数据库和本地持久化数据
```

整体数据流：

```text
React PWA ── REST / Socket.IO ── Fastify Server
                                      ├── RoomManager ── Game Engine
                                      └── Persistence ── SQLite
```

牌局状态由服务端统一维护。客户端不会收到牌堆或其他玩家未公开的底牌；玩家动作包含手牌 ID、状态版本和幂等 ID，以减少重连或重复提交导致的状态错误。

进行中的房间保存在内存中；账号、筹码、已结算积分、牌谱和举报记录写入 SQLite。服务重启会终止未完成牌局，但不会删除已经持久化的数据。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 同时启动 Web 与服务端开发模式 |
| `pnpm build` | 构建 Web 与服务端生产产物 |
| `pnpm start` | 启动生产服务 |
| `pnpm typecheck` | 检查全部工作区 TypeScript 类型 |
| `pnpm test` | 运行单元测试与服务端集成测试 |
| `pnpm e2e` | 运行 Playwright 浏览器端到端测试 |
| `pnpm check` | 依次执行类型检查、测试和生产构建 |
| `pnpm db:migrate` | 执行 SQLite 数据库迁移 |
| `pnpm db:seed` | 写入演示账号和初始数据 |

## 环境变量

完整示例见 [`.env.example`](./.env.example)。

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PORT` | `3001` | Fastify 监听端口 |
| `HOST` | `0.0.0.0` | Fastify 监听地址 |
| `APP_ORIGIN` | `http://localhost:5174` | Web 来源与跨域校验地址 |
| `VITE_PUBLIC_APP_URL` | 当前浏览器来源 | 二维码固定使用的公网地址；修改后需重新构建前端 |
| `APP_TIMEZONE` | `Asia/Shanghai` | 赛季和服务端时间规则使用的时区 |
| `DATABASE_PATH` | `./data/poker.db` | SQLite 数据库路径 |
| `SESSION_DAYS` | `30` | 登录会话有效天数 |
| `TURN_TIMEOUT_MS` | `20000` | 真人玩家行动时限 |
| `AI_FILL_DELAY_MS` | `30000` | 自动补入 AI 前的等待时间 |
| `RECONNECT_GRACE_MS` | `90000` | 断线后保留玩家座位的时间 |
| `ADMIN_EMAILS` | — | 逗号分隔的管理员邮箱白名单 |
| `AVATAR_DIR` | `./data/avatars` | 自定义头像存储目录 |
| `MAX_SPECTATORS_PER_ROOM` | `50` | 单个房间最大观众数 |

## 主要游戏规则

- 公共和私密休闲房允许游客、AI 与自定义盲注，不计排位积分。
- 排位房必须公开，只允许正式账号真人入座，禁止 AI，并固定为 10/20 盲注和 100BB 起始筹码。
- 创建者自动入座，其他用户先以观战者身份进入；进行中的常规桌允许选座并从下一手参与。
- 单桌锦标赛使用 1,500 起始筹码，每 5 分钟升级盲注，不允许重买；开赛后新用户只能观战。
- 真人行动超时后自动过牌或弃牌；断线座位默认保留 90 秒。
- 排位常规桌按累计净赢大盲计算积分；锦标赛按最终名次计算积分，每月建立新赛季。
- 牌谱始终展示自己的底牌，仅展示对手在摊牌时公开的牌。

## 测试

运行完整工程检查：

```bash
pnpm check
```

首次运行浏览器测试前，需要安装 Chromium 及其系统依赖：

```bash
pnpm exec playwright install --with-deps chromium
pnpm e2e
```

测试覆盖牌型比较、A2345 顺子、全押跑牌、边池与筹码守恒、AI 合法动作、房间创建与加入、观战选座、二维码邀请、断线与重连、结算隐私、账号与头像、管理员流程、SQLite 迁移、积分落库，以及桌面和移动端核心流程。

## 项目边界

当前版本不包含真实支付、多桌锦标赛、私信或云端高可用。所有筹码、积分和排行榜数据仅作为娱乐功能使用。

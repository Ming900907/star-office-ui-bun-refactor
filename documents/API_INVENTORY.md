# API 清单（精简）

## 说明
- 目标：兼容现有前端/脚本，移除生图
- 资产编辑：先 `/assets/auth` 获取 session cookie

## 页面
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/` | 主页 |
| GET | `/join` | 访客加入页 |
| GET | `/invite` | 邀请页 |

## 核心状态 / Agent
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| GET | `/status` | 主 Agent 状态（可含 officeName） |
| GET | `/system-info` | 运行节点信息（openclaw 版本、CPU/内存指标、Node/Bun 版本） |
| GET | `/openclaw/skills` | OpenClaw 技能目录（读取服务端缓存；strict 模式下 degraded 缓存会失败） |
| GET | `/openclaw/usage` | OpenClaw 用量视图（读取服务端缓存；strict 模式下 degraded 缓存会失败） |
| POST | `/set_state` | 旧接口：设置主状态（默认关闭，走 skills） |
| GET | `/agents` | Agent 列表 |
| POST | `/join-agent` | 访客加入（自动批准；并发超限 429） |
| POST | `/agent-approve` | 访客批准（兼容） |
| POST | `/agent-reject` | 拒绝并移除 |
| POST | `/leave-agent` | 离开并释放 key（管理员或自助离开） |
| POST | `/agent-push` | 推送状态 |
| POST | `/openclaw/sync` | OpenClaw/Agent 主动触发 skills + usage CLI 同步并刷新缓存 |
| POST | `/agent-skills/list` | 列出 OpenClaw 可用技能 |
| POST | `/agent-skills/execute` | 以技能方式执行状态/装修能力 |
| GET | `/yesterday-memo` | 昨日小记 |

## 资产与自定义
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/assets/auth` | 资产编辑认证 |
| GET | `/assets/auth/status` | 认证状态 |
| GET | `/assets/list` | 资源列表 |
| GET | `/assets/template.zip` | 模板包 |
| GET | `/assets/positions` | 位置列表 |
| POST | `/assets/positions` | 写入位置 |
| GET | `/assets/defaults` | 默认位置 |
| POST | `/assets/defaults` | 写入默认 |
| POST | `/assets/upload` | 上传替换 |
| POST | `/assets/restore-default` | 恢复默认 |
| POST | `/assets/restore-prev` | 回退上一版 |
| POST | `/assets/restore-reference-background` | 恢复参考背景 |
| POST | `/assets/home-favorites/save-current` | 保存收藏 |
| GET | `/assets/home-favorites/list` | 收藏列表 |
| GET | `/assets/home-favorites/file/<filename>` | 收藏文件 |
| POST | `/assets/home-favorites/delete` | 删除收藏 |
| POST | `/assets/home-favorites/apply` | 应用收藏 |

## 生图相关（移除）
- `/assets/generate-rpg-background`
- `/assets/generate-rpg-background/poll`
- `/assets/restore-last-generated-background`
- `/config/gemini`

## Bun 差异备注（截至 2026-03-16）
- `/set_state`：非法 state 忽略且 200（与上游一致）
- `/yesterday-memo`：无文件时 200 + success=false（与上游一致）
- `/assets/template.zip`：已提供 `assets-replace-template.zip`
- `/assets/list`：宽高由纯 TS 解析补齐
- 启动初始化：`join-keys.json` 缺失时会回退 `join-keys.sample.json`
- `bootstrap:prod`：不再从 sample 文件初始化生产环境，改为写入生产安全默认值
- `/system-info`：新增设备指标输出（Linux/macOS 通用；Windows 下 `loadavg` 不具代表性）
- 新增 feature flags：`ENABLE_STATE_CONTROL`、`ENABLE_ASSET_DECORATION`、`ENABLE_AGENT_SKILLS_API`
- 默认策略：`/set_state` 与 `/assets/*` 下线（410），统一迁移到 `/agent-skills/execute`
- panel 数据链路：由 OpenClaw 调用 `/openclaw/sync`，服务端执行本机 CLI 并缓存，前端仅读取缓存
- 缓存字段：`syncedAt`、`stale`、`cacheAgeSeconds`、`degraded`、`warnings`
- 可选 strict 策略：`OPENCLAW_REQUIRE_HEALTHY_SOURCE=1` 时，skills/usage 降级不再视为可接受状态

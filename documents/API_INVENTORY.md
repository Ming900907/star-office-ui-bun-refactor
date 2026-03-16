# API 清单（精简）

## 说明
- 目标：兼容现有前端/脚本，移除生图
- 资产编辑：先 `/assets/auth` 获取 session cookie

## 页面
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/` | 主页 |
| GET | `/electron-standalone` | Electron 页面 |
| GET | `/join` | 访客加入页 |
| GET | `/invite` | 邀请页 |

## 核心状态 / Agent
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| GET | `/status` | 主 Agent 状态（可含 officeName） |
| GET | `/system-info` | 运行节点信息（openclaw 版本、CPU/内存指标、Node/Bun 版本） |
| POST | `/set_state` | 设置主状态（非法 state 忽略） |
| GET | `/agents` | Agent 列表 |
| POST | `/join-agent` | 访客加入（自动批准；并发超限 429） |
| POST | `/agent-approve` | 访客批准（兼容） |
| POST | `/agent-reject` | 拒绝并移除 |
| POST | `/leave-agent` | 离开并释放 key |
| POST | `/agent-push` | 推送状态 |
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
- `/system-info`：新增设备指标输出（Linux/macOS 通用；Windows 下 `loadavg` 不具代表性）

# 项目进度

## 当前阶段
生产化落地阶段（聚焦 Bun Web + OpenClaw sync/cache 集成）

## 里程碑进度
- 现状梳理与接口清单：已完成
- Bun 后端基础框架与文件存储层：已完成
- API 兼容实现（无生图）：已完成
- 前端入口处理：已完成
- OpenClaw 技能/用量面板改造：已完成
- OpenClaw sync/cache 链路：已完成
- 自动化部署引导（bootstrap）：已完成
- 收尾清理（含 Electron 代码移除）：已完成
- 项目文档生产化同步：已完成（2026-03-16）

## 最近更新（2026-03-16）
- 功能切换：默认下线 `/set_state` 与 `/assets/*`，改为 OpenClaw agent skills 接口（`/agent-skills/list`、`/agent-skills/execute`）
- 前端入口调整：将原“装修房间”区域切换为“OpenClaw 技能展示”抽屉（`/openclaw/skills`）
- 新增“用量追踪”入口：展示模型/渠道/token/成本（`/openclaw/usage`）
- 交互修正：`用量追踪` 按钮样式与技能按钮统一为像素风全宽按钮
- 生产链路改造：OpenClaw 通过 `POST /openclaw/sync` 推送本地采集的 skills/usage 到本地缓存
- 新增一键部署引导：`bun run bootstrap:prod`（自动配置 `.env`、初始化生产安全状态文件、执行最小验收）
- 完成端到端与手动回归（/health、/status、/agents、/join-agent、/agent-approve/reject/leave/push、/yesterday-memo、/assets/*、页面路由）
- 行为对齐：/set_state 非法 state 忽略且 200；/yesterday-memo 无文件 200+success=false；/leave-agent 在 reject 后 404 与上游一致
- 识别到仓库含 sample/测试用途文件，且 Bun 在 `join-keys.json` 缺失时会自动回退 `join-keys.sample.json`
- 状态脚本升级：`scripts/set-state.ts` 默认走 `/agent-skills/execute`
- 新增根级 `SKILL.md`（Bun 重构版），并补充 `.env.example`
- 访客推送脚本从 Python 迁移为 `frontend/office-agent-push.mjs`，文档已切换
- VPS OpenClaw 集成指引已整理：`documents/OPENCLAW_INTEGRATION.md`
- 交互增强：新增场景悬浮信息层（猫/机柜）
- 设备监控：新增 `GET /system-info`，前端在机柜区域展示 CPU 负载、内存占用、系统与运行时信息
- 版本策略：`openclaw` 版本号改为动态探测（`OPENCLAW_VERSION` -> `openclaw --version` -> `codex --version` -> `package.json` 回退）
- 交互修正：仅保留机柜区域展示机器信息，移除左下桌面显示器热区；猫信息绑定为沙发猫
- 代码持续推送远端：以 `main` 最新提交为准
- 新增严格模式策略：可通过 `OPENCLAW_REQUIRE_HEALTHY_SOURCE=1` 要求 skills/usage 缓存必须来自健康同步结果

## 是否可部署
- 后端与前端核心功能已可部署（不含生图）
- 生产环境已支持 OpenClaw sync/cache 模式（skills/usage）
- 推荐通过 `bun run bootstrap:prod` 完成部署初始化
- 若生产验收要求禁止降级，可启用 strict 模式

## 待办事项（下一步）
- 继续压缩 sample 文件在生产链路中的存在感，避免误读
- 生产 sync/cache 异常场景（未同步、CLI 失败、缓存过期）增强监控、告警与 strict 策略验证
- 回归验证与打包准备（Bun 服务范围）

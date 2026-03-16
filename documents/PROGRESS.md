# 项目进度

## 当前阶段
回归验证与收尾阶段（聚焦 Bun 服务交付）

## 里程碑进度
- 现状梳理与接口清单：已完成
- Bun 后端基础框架与文件存储层：已完成
- API 兼容实现（无生图）：已完成
- 前端入口处理：已完成
- Electron 启动方式调整：暂缓（本阶段不纳入）
- 回归验证与打包：进行中

## 最近更新（2026-03-16）
- 完成端到端与手动回归（/health、/status、/agents、/join-agent、/agent-approve/reject/leave/push、/yesterday-memo、/assets/*、页面路由）
- 行为对齐：/set_state 非法 state 忽略且 200；/yesterday-memo 无文件 200+success=false；/leave-agent 在 reject 后 404 与上游一致
- 补齐：/assets/template.zip 提示与模板包；/assets/list 图片宽高；join key 对齐 ocj_starteam01~08
- Electron 路线暂时放弃，当前阶段以 Bun Web 服务为唯一交付目标
- 识别到仓库含 sample/测试用途文件，且 Bun 在 `join-keys.json` 缺失时会自动回退 `join-keys.sample.json`
- 新增 Bun 版状态脚本 `scripts/set-state.ts` 与 `state:writing/syncing/error/idle` 快捷命令
- 新增根级 `SKILL.md`（Bun 重构版），并补充 `.env.example`
- 访客推送脚本从 Python 迁移为 `frontend/office-agent-push.mjs`，文档已切换
- VPS OpenClaw 集成指引已整理：`documents/OPENCLAW_INTEGRATION.md`

## 是否可部署
- 后端与前端核心功能已可部署（不含生图）
- Electron 壳不作为当前部署前置条件

## 待办事项（下一步）
- 清理与标注 sample/测试用途文件，避免生产环境误用
- 明确生产初始化流程（强制准备真实 `state.json`/`join-keys.json`）
- 回归验证与打包准备（Bun 服务范围）

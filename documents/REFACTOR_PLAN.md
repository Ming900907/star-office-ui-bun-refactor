# Bun 后端重构规划（精简）

## 目标
- Bun 重写后端，保持前端与 API 兼容
- 移除 Gemini 生图链路
- 统一切换到 OpenClaw 技能/用量面板

## 范围
- 后端服务（Bun）与 Web 前端联调
- 前端改造为 OpenClaw 技能 + 用量追踪入口
- 生产环境支持 OpenClaw 数据源多模式（upstream URL 或本机 CLI）

## 不做
- 不实现生图
- 不做 UI 大改
- 不恢复 Electron 开发线

## 里程碑
1. 现状梳理与接口清单
2. Bun 基础框架与存储层
3. API 兼容实现（无生图）
4. 前端入口处理
5. 回归验证与打包（Bun Web）
6. OpenClaw 技能/用量面板上线
7. 生产化清理（sample/测试数据隔离 + 自动 bootstrap）

## 关键任务
- 存储：state/agents/join-keys/asset-positions/defaults
- API：/status /agents /join-agent /agent-push /yesterday-memo /openclaw/skills /openclaw/usage /agent-skills/*
- 数据初始化：区分 sample 文件与生产文件，避免回退 sample 造成误接入
- 数据源接入：优先 `OPENCLAW_*_SOURCE_URL`，未配置时走本机 CLI
- 回归：主页面、技能面板、用量面板、多 Agent 状态链路

## 风险
- Bun 兼容性
- 文件并发写
- sample 数据误用于生产环境
- 上游 source 不可用导致技能/用量面板空白

## 交付物
- Bun 后端源码
- 接口清单与配置说明
- 最小回归 checklist
- 一键化部署引导脚本（`bootstrap:prod`）

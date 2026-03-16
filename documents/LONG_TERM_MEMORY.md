# 项目长期记忆（精简）

## 名称
Star-Office-UI Bun 后端重构

## 目的
- Bun 重写后端，保持前端/API 兼容
- 移除 Gemini 生图链路
- 统一为 OpenClaw 技能与用量追踪面板

## 约束
- 前端改动最小化
- 数据文件格式兼容
- API 路径与响应尽量一致
- 生产环境 skills/usage 必须由上游 source 提供

## 非目标
- 不实现生图
- 不做 UI 视觉重构
- 不推进 Electron 桌面壳能力

## 风险
- Bun 兼容性
- 文件并发写
- 上游 source API 不稳定

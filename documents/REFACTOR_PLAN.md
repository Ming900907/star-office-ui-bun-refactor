# Bun 后端重构规划（精简）

## 目标
- Bun 重写后端，保持前端与 API 兼容
- 移除 Gemini 生图链路

## 范围
- 后端服务（Bun）与 Web 前端联调
- 前端仅做生图入口禁用/提示

## 不做
- 不实现生图
- 不做 UI 大改
- 暂不推进 Electron 壳验收与打包

## 里程碑
1. 现状梳理与接口清单
2. Bun 基础框架与存储层
3. API 兼容实现（无生图）
4. 前端入口处理
5. 回归验证与打包（Bun Web）
6. 生产化清理（sample/测试数据隔离）

## 关键任务
- 存储：state/agents/join-keys/asset-positions/defaults
- API：/status /set_state /agents /join-agent /agent-push /yesterday-memo /assets*
- 数据初始化：区分 sample 文件与生产文件，避免回退 sample 造成误接入
- 回归：主页面、角色/房间配置、资产库与持久化

## 风险
- Bun 兼容性
- 文件并发写
- sample 数据误用于生产环境

## 交付物
- Bun 后端源码
- 接口清单与配置说明
- 最小回归 checklist

# 参与锐力对账开发

感谢参与维护。为了让前端、后端和产品讨论保持一致，请遵循以下约定。

## 开发流程

1. 从最新的 `main` 创建短生命周期分支，例如 `feature/task-pagination` 或 `fix/upload-error`。
2. 一个 Pull Request 只解决一个主题，避免混入无关格式化或重构。
3. 提交前运行：

   ```bash
   npm run lint
   npm test
   ```

4. 使用 Draft PR 提前共享尚未完成的方案；满足验收条件后再标记为 Ready for review。

## 前后端边界

前端只负责文件提交、状态轮询和数据展示，不实现 Excel 解析、匹配规则、金额计算或差异分类。

如果修改接口，请在同一个 PR 中同步更新：

- `lib/reconciliation-types.ts`
- `lib/reconciliation-api.ts`
- `docs/api-contract.yaml`
- `docs/backend-handoff.md`
- 相关测试

## Pull Request 说明

PR 描述至少包含：

- 修改了什么以及为什么修改
- 对用户、前端或后端的影响
- 如何验证
- 截图或预览链接（涉及视觉修改时）
- 兼容性或后续工作（如有）

请勿提交真实结算单、ERP 数据、`.env` 文件、访问令牌或其他敏感信息。

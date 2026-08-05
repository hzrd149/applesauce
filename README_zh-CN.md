# Applesauce

<!-- hy-mt2-i18n:start -->
[English](./README.md) | **中文** | [日本語](./README_ja.md) | [Español](./README_es.md)
<!-- hy-mt2-i18n:end -->


Applesauce是一组TypeScript库，旨在简化noStrudel Web客户端的构建工作，目前被[noStrudel](https://github.com/hzrd149/nostrudel)项目所采用。

完整的文档可在[文档页面](https://hzrd149.github.io/applesauce)上查看。

## 安装

```bash
# 使用npm
npm install applesauce-core
# 使用ppnm
pnpm install applesauce-core
# 使用yarn
yarn add applesauce-core
```

## 开发环境配置

克隆仓库：

```bash
git clone https://github.com/hzrd149/applesauce.git
cd applesauce
```

安装依赖项：

```bash
pnpm install
```

构建项目：

```bash
pnpm build
```

## 运行测试

该仓库的所有测试均使用[vitest](https://vitest.dev/)工具完成

```bash
# 运行所有测试
pnpm test
# 运行覆盖率测试
pnpm coverage
# 在开发模式下运行测试
pnpm vitest
```

## 运行文档系统

该仓库为TypeScript文档集成了[typedoc](https://typedoc.org/)工具，同时使用[vitepress](https://vitepress.dev/)作为文档站点

```bash
# 构建typedoc文档
pnpm typedoc
```

`apps/docs`目录是用于生成文档站点的包

```bash
cd apps/docs

# 启动vitepress开发模式
pnpm dev

# 构建vitepress
pnpm build
```

## React集成

`applesauce-react`包提供了多种钩子及提供者，便于在React组件中使用Applesauce功能，详情请参阅[文档](https://applesauce.build/react/getting-started.html)

## AI智能体（MCP服务器）

`applesauce-mcp`工具可通过Model Context Protocol，为AI智能体提供对Applesauce文档及代码示例的语义搜索功能。这有助于AI助手以正确的API使用方式和实际应用场景来构建Nostr应用程序。

**快速入门：**在您的AI驱动型IDE中（如OpenCode、Cursor、Claude Desktop等），连接到公共服务器`https://mcp.applesauce.build/mcp`即可开始使用。

[完整文档](https://applesauce.build/introduction/agents.html) | [源代码](https://github.com/hzrd149/applesauce-mcp)

## 贡献代码

1. 克隆该仓库
2. 创建新的功能分支：`git checkout -b feature/my-new-feature`
3. 安装依赖项：`pnpm install`
4. 进行代码修改
5. 运行测试：`pnpm test`
6. 构建项目：`pnpm build`
7. 格式化代码：`pnpm format`
8. 提交更改：`git commit -am '添加某些新功能'`
9. 将分支推送到远程仓库：`git push origin feature/my-new-feature`
10. 提交Pull Request

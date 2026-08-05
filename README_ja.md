# Applesauce

<!-- hy-mt2-i18n:start -->
[English](./README.md) | [中文](./README_zh-CN.md) | **日本語** | [Español](./README_es.md)
<!-- hy-mt2-i18n:end -->


Applesauceは、Nostrウェブクライアントの構築を容易にするためのTypeScriptライブラリ群であり、[noStrudel](https://github.com/hzrd149/nostrudel)で利用されています。

詳細なドキュメントは、[documentation](https://hzrd149.github.io/applesauce)サイトで確認できます。

## インストール

```bash
# npmを使用する場合
npm install applesauce-core
# pnpmを使用する場合
pnpm install applesauce-core
# yarnを使用する場合
yarn add applesauce-core
```

## 開発環境の準備

リポジトリをクローンします：

```bash
git clone https://github.com/hzrd149/applesauce.git
cd applesauce
```

依存関係をインストールします：

```bash
pnpm install
```

プロジェクトをビルドします：

```bash
pnpm build
```

## テストの実行

このリポジトリでは、すべてのテストに[Vitest](https://vitest.dev/)が使用されています。

```bash
# すべてのテストを実行
pnpm test
# コバージョンテストを実行
pnpm coverage
# デバッグモードでテストを実行
pnpm vitest
```

## ドキュメントの実行

このリポジトリでは、TypeScriptのドキュメント作成に[typedoc](https://typedoc.org/)、ドキュメントサイトの構築に[vitepress](https://vitepress.dev/)が設定されています。

```bash
# typedocをビルド
pnpm typedoc
```

`apps/docs`はドキュメントサイト用のパッケージです。

```bash
cd apps/docs

# vitepressのデバッグモードを起動
pnpm dev

# vitepressをビルド
pnpm build
```

## React

`applesauce-react`パッケージには、Reactコンポーネント内でApplesauceを利用するためのさまざまなフックやプロバイダが含まれています。[ドキュメント](https://applesauce.build/react/getting-started.html)

## AIエージェント（MCPサーバー）

`applesauce-mcp`ツールは、Model Context Protocolを通じてAIエージェント向けにApplesauceのドキュメントやコード例に対するセマンティック検索機能を提供します。これにより、AIアシスタントは正確なAPIの利用方法や実際の使い方を踏まえてNostrアプリケーションを構築できます。

**クイックスタート:** OpenCode、Cursor、Claude DesktopなどのAI対応IDEで、`https://mcp.applesauce.build/mcp`にあるパブリックサーバーに接続してください。

[全ドキュメント](https://applesauce.build/introduction/agents.html) | [ソースコード](https://github.com/hzrd149/applesauce-mcp)

## 貢献方法

1. リポジトリをフォークします
2. 自分専用の機能ブランチを作成します：`git checkout -b feature/my-new-feature`
3. 依存関係をインストールします：`pnpm install`
4. 変更を加えます
5. テストを実行します：`pnpm test`
6. プロジェクトをビルドします：`pnpm build`
7. コードをフォーマットします：`pnpm format`
8. 変更内容をコミットします：`git commit -am 'Add some feature'`
9. ブランチにプッシュします：`git push origin feature/my-new-feature`
10. プルリクエストを送信します

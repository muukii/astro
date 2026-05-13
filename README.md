# Astro Craft Blog

Craft documentsをデータソースにするAstroブログです。Astroの静的ビルド時にCraft APIからドキュメント一覧と本文ブロックを読み、`/`に記事一覧、`/posts/[slug]`に記事詳細を生成します。

## Setup

CraftのImagineタブでAPI connectionを作り、発行されたAPI URLを`.env`に設定します。

```sh
cp .env.example .env
```

```env
CRAFT_API_BASE_URL="https://connect.craft.do/links/YOUR_ID/api/v1"
CRAFT_COLLECTION_NAME="Posts"
SITE_TITLE="Craft Journal"
```

collection ID が分かっている場合は、名前解決を省略できます。

```env
CRAFT_COLLECTION_ID="collection-id"
```

ドキュメントを直接記事として扱いたい場合は、必要なものを1つ設定してください。

```env
CRAFT_FOLDER_ID="folder-id"
CRAFT_LOCATION="unsorted"
CRAFT_DOCUMENT_IDS="document-id-1,document-id-2"
```

## Commands

```sh
npm install
npm run dev
npm run build
npm run preview
```

## Content Mapping

- `GET /collections`で`Posts` collectionを探します。
- `GET /collections/{collectionId}/items?maxDepth=-1`で記事本文を取得します。
- collection itemの`title`を記事タイトルにします。
- propertyの`date`を公開日、`tags`をタグとして扱います。
- `hidden: true`の項目は一覧から除外します。
- 最初の通常テキストブロックを抜粋にします。
- CraftのMarkdownをHTMLへ変換し、サニタイズして表示します。

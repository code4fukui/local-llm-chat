# Local LLM Chat

WebLLM を使って、ブラウザ上でローカルLLMを動かすチャットアプリです。モデルキャッシュ、会話ログ、設定はブラウザの IndexedDB に保存します。

公開予定URL:

https://code4fukui.github.io/local-llm-chat/

リポジトリ:

https://github.com/code4fukui/local-llm-chat/

## 使い方

Chrome / Edge / Safari Technology Preview など WebGPU 対応ブラウザで公開URLを開きます。

1. 左側の `Preset` でモデルを選ぶ
2. `Load` を押してモデルを読み込む
3. 画面下の入力欄からチャットする

初回ロード時はモデルファイルをダウンロードするため時間がかかります。2回目以降は IndexedDB のキャッシュが使われます。

## ローカル開発

```sh
npm start
```

または:

```sh
python3 -m http.server 5173
```

その後、WebGPU 対応ブラウザで `http://localhost:5173` を開きます。

`index.html` は `bundle.js` を読み込みます。`main.js` を編集した後は、Deno で依存をまとめた `bundle.js` を再生成します。

```sh
npm run bundle
```

直接実行する場合:

```sh
deno bundle --allow-import main.js -o bundle.js
```

構文チェック:

```sh
npm run check
```

## モデルについて

デフォルトは WebLLM 事前定義モデルの `Qwen3-4B-q4f16_1-MLC` です。

このアプリは `@mlc-ai/web-llm` を使います。WebLLM は GGUF や Ollama の `gemma3:4b` タグをそのまま読むのではなく、MLC 形式に変換済みのモデルURLと対応する WebGPU WASM が必要です。

Gemma 3 1B の取得確認済みプリセットも残しています。WebLLM の公開バイナリ一覧では、`v0_2_84/base` に `gemma3-1b-it-q4f16_1_cs1k-webgpu.wasm` はありますが、`gemma-3-4b-it-q4f16_1-MLC` 用の事前ビルドWASMはありません。

`Gemma 3 4B needs WASM` プリセットには MLC 形式の重みURLだけを入れています。WebGPU で動かすには、MLC-LLM で自分の環境向けにビルドした対応 WASM を `WebGPU WASM` に指定してください。Ollama の `gemma3:4b` は使えません。

## 保存先

- モデルキャッシュ: WebLLM の `cacheBackend: "indexeddb"`
- チャット履歴: IndexedDB `local-llm-chat/messages`
- 設定: IndexedDB `local-llm-chat/settings`

データは使用中のブラウザ内に保存されます。別のブラウザや別の端末には引き継がれません。

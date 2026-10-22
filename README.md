# 花札 こいこい

ブラウザで遊べる一人用の花札（こいこい）です。スマホ縦持ちでも PC でも遊べます。

**▶ 遊ぶ: https://a-kaibu.github.io/hanafuda/**

## 特徴

- **CPU の強さを4段階から選べる**: 初級・中級・上級・達人。達人は見えない札の配置を何通りも想定して先読みします。
- **公平性を後から検証できる**: 山札は対局前にコミットメント（ハッシュ）で固定し、あなたの種も混ぜて決めます。CPU は Web Worker の中で公開情報だけを受け取って判断します。終局後に種を公開し、山札・全手・点数・CPU の判断を再計算して確認します。詳しくは [VERIFY.md](VERIFY.md)。
- **ルールと役をいつでも確認**: 本のアイコンから遊び方・役と点数・札一覧を見られます。札に「何月・何の札か」を表示するオプション付き。
- **演出**: 札の絵は Wikimedia Commons の伝統的な花札 SVG、効果音は Web Audio で合成（音声ファイルなし）。配る・めくる・取る・役・こいこいのアニメーション付き。
- ビルド不要の静的サイト（素の ES Modules）。

## ルール（初期設定）

| 役 | 点 |
|---|---|
| 五光 | 10 |
| 四光 | 8 |
| 雨四光 | 7 |
| 三光 | 5 |
| 花見で一杯 / 月見で一杯 | 5 |
| 猪鹿蝶 / 赤短 / 青短 | 5 |
| タネ（5枚〜） / タン（5枚〜） | 1 + 1枚ごとに1 |
| カス（10枚〜） | 1 + 1枚ごとに1 |
| 手四 / くっつき（手役） | 6 |

- 7点以上は2倍、相手のこいこい中にあがると2倍（それぞれ設定で切り替え可）
- 菊に盃はタネにもカスにも数える（設定で切り替え可）
- 3局 / 6局 / 12局から選べます

## 開発

```sh
python3 -m http.server   # http://localhost:8000 で起動
npm test                 # ルール・シャッフル・検証・CPU のテスト
node tools/verify.mjs log.json   # 保存した対局記録を検証
```

| ファイル | 役割 |
|---|---|
| `js/engine.js` | 1局の状態機械（純粋関数） |
| `js/yaku.js` | 役判定と得点 |
| `js/rng.js`, `js/sha256.js` | 決定的乱数・シャッフル・コミットメント |
| `js/match.js` | 試合進行・記録・検証 |
| `js/cpu.js`, `js/cpu-worker.js` | CPU の思考（Web Worker で隔離） |
| `js/ui.js`, `js/audio.js`, `css/style.css` | 画面・効果音 |
| `assets/cards/` | 札の画像と出典（CC BY-SA 4.0） |

## ライセンス

- コード: MIT（[LICENSE](LICENSE)）
- 札の絵（`assets/cards/`）: Louie Mantia、すけじょ、Spenĉjo 作、[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.ja)。出典の詳細は [assets/cards/CREDITS.md](assets/cards/CREDITS.md)

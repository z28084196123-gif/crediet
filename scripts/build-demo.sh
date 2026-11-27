#!/usr/bin/env bash
# 建置瀏覽器內示範版(PGlite),輸出到 dist-demo/
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf dist-demo
npx vite build --mode demo
# PGlite 的 .data 檔改成 gzip + base64 文字檔(Artifact 只提供常見網頁檔案類型)
gzip -9 -c node_modules/@electric-sql/pglite/dist/pglite.data | base64 -w0 > dist-demo/assets/pglite-data.gz.txt
rm -f dist-demo/assets/*.data
echo "✅ dist-demo 建置完成"

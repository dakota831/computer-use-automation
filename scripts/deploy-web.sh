#!/usr/bin/env bash
# Build the front end and publish it to the directory nginx actually serves.
#
# These were two manual steps for most of this project's life, and they drifted:
# a rebuilt bundle sat in dist-web while the live site kept serving an older
# hash, so "fixed and deployed" was true of the repository and false of the URL.
# One command, so the two cannot come apart again.
set -euo pipefail

cd "$(dirname "$0")/.."
WEB_ROOT="${DEX_WEB_ROOT:-/var/www/dex/app}"

npm run web:build

# --delete so a file that stops being built stops being served.
sudo rsync -a --delete dist-web/ "$WEB_ROOT/"
sudo chown -R www-data:www-data "$WEB_ROOT"

echo "deployed $(grep -o 'console-[A-Za-z0-9_-]*\.js' dist-web/index.html | head -1) -> $WEB_ROOT"

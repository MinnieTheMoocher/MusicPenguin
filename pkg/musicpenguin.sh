#!/bin/sh
APPDIR="/opt/musicpenguin"
exec "$APPDIR/node_modules/electron/dist/electron" "$APPDIR/main.js" "$@"

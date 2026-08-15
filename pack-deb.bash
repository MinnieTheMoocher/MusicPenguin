#!/usr/bin/env bash
set -euo pipefail
#cspell:ignore APPDIR BINDIR APPSDIR ICONDIR DEBDIR

# change into the folder where this script resides
cd "$(dirname "$0")"

die() {
    echo "Error:" "$@"
    exit 1
}

APP="musicpenguin"
VERSION=$(node -p "require('./package.json').version")
ARCH="amd64"
PKG_NAME="${APP}_${VERSION}_${ARCH}"
STAGING=$(mktemp -d)

[ -z "$(git status --porcelain)" ] || die "local git repo is dirty"
git clean -fdx

echo "Packaging ${APP} ${VERSION} ..."

rm -rf ./node_modules
npm ci
node node_modules/electron/install.js
npm run build
# Remove development-only dependencies while keeping runtime dependencies.
# We prune AFTER the build because the build needs esbuild and TypeScript.
npm prune --omit=dev

echo "Assembling ${PKG_NAME}.deb ..."

# ── /opt/musicpenguin/ ──────────────────────────────────────
APPDIR="${STAGING}/opt/${APP}"
mkdir -p "${APPDIR}"
cp main.js preload.js index.html style.css "${APPDIR}/"
cp -r dist "${APPDIR}/"
mkdir -p "${APPDIR}/res"
cp res/musicpenguin.png "${APPDIR}/res/"

# Copy complete runtime dependency tree
cp -a node_modules "${APPDIR}/"
# Electron Chromium sandbox helper must be root-owned and setuid.
chmod 4755 "${APPDIR}/node_modules/electron/dist/chrome-sandbox"

# ── /usr/bin/ ───────────────────────────────────────────────
BINDIR="${STAGING}/usr/bin"
mkdir -p "${BINDIR}"
cp pkg/musicpenguin.sh "${BINDIR}/${APP}"
chmod 755 "${BINDIR}/${APP}"

# ── /usr/share/applications/ ────────────────────────────────
APPSDIR="${STAGING}/usr/share/applications"
mkdir -p "${APPSDIR}"
cp pkg/musicpenguin.desktop "${APPSDIR}/${APP}.desktop"

# ── /usr/share/icons/ ───────────────────────────────────────
ICONDIR="${STAGING}/usr/share/icons/hicolor/256x256/apps"
mkdir -p "${ICONDIR}"
cp res/musicpenguin.png "${ICONDIR}/${APP}.png"

# ── DEBIAN/control ──────────────────────────────────────────
DEBDIR="${STAGING}/DEBIAN"
mkdir -p "${DEBDIR}"
cat > "${DEBDIR}/control" <<EOF
Package: ${APP}
Version: ${VERSION}
Section: sound
Priority: optional
Architecture: ${ARCH}
Depends: libgtk-3-0, libnss3, libxss1, libasound2t64 | libasound2
Recommends: vlc
Maintainer: MinnieTheMoocher <MinnieTheMoocher@users.noreply.github.com>
Homepage: https://github.com/MinnieTheMoocher/MusicPenguin
Description: MusicPenguin is a fast local-first music library and player for Linux.
EOF

# ── Build ───────────────────────────────────────────────────
chmod 644 "${DEBDIR}/control"

OUTPUT="${PKG_NAME}.deb"
dpkg-deb --root-owner-group --build "${STAGING}" "${OUTPUT}"

# verify
test -x "${APPDIR}/node_modules/electron/dist/electron"
test -f "${APPDIR}/node_modules/electron/dist/chrome-sandbox"
test -u "${APPDIR}/node_modules/electron/dist/chrome-sandbox"
test -f "${APPDIR}/node_modules/ieee754/package.json"

# Cleanup
rm -rf "${STAGING}"

echo ""
echo "Created: ${OUTPUT}"
echo "Size:    $(du -h "${OUTPUT}" | cut -f1)"
echo "Install: sudo dpkg -i ${OUTPUT}"
echo "Remove:  sudo dpkg -r ${APP}"

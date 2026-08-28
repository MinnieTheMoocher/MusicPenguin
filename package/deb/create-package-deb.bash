#!/usr/bin/env bash
set -euo pipefail
#cspell:ignore APPDIR BINDIR APPSDIR ICONDIR DEBDIR

# change into the folder where this script resides
cd "$(dirname "$0")"
# change into project root
cd ../..

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

echo "Assembling ${PKG_NAME}.deb ..."

# ── cleanup ──
rm -rf ./dist ./node_modules ./*.deb
npm ci
node node_modules/electron/install.js
npm run build
# Remove development-only dependencies while keeping runtime dependencies.
# We prune AFTER the build because the build needs esbuild and TypeScript.
npm prune --omit=dev

# Prune native modules built for OTHER platforms/architectures (this is an
# x86_64 GNU build). Some deps (e.g. @electron-internal/extract-zip) ship a
# prebuilt .node for every platform (darwin/win32/arm/musl/...); shipping them
# bloats the package and makes rpm's find-requires emit bogus dependencies
# (ld-linux-aarch64.so.1, ld-linux-armhf.so.3, libc.musl-*.so.1). Keep only
# the binding matching this x86_64-glibc build.
find node_modules -name '*.node' -type f \
    ! -name '*.linux-x64-gnu.node' -delete

# ── /opt/musicpenguin/ ──────────────────────────────────────
APPDIR="${STAGING}/opt/${APP}"
mkdir -p "${APPDIR}"
mkdir -p "${APPDIR}/src/renderer"
cp src/renderer/index.html src/renderer/style.css src/renderer/musicpenguin256.png "${APPDIR}/src/renderer/"
mkdir -p "${APPDIR}/src/preload"
cp src/preload/preload.js "${APPDIR}/src/preload/preload.js"
cp main.js package.json "${APPDIR}/"
cp -r dist "${APPDIR}/"

# Copy complete runtime dependency tree
cp -a node_modules "${APPDIR}/"
# Electron Chromium sandbox helper must be root-owned and setuid.
chmod 4755 "${APPDIR}/node_modules/electron/dist/chrome-sandbox"

# ── /usr/bin/ ───────────────────────────────────────────────
BINDIR="${STAGING}/usr/bin"
mkdir -p "${BINDIR}"
cp package/deb/${APP} "${BINDIR}/${APP}"
chmod 755 "${BINDIR}/${APP}"

# ── /usr/share/icons/ ───────────────────────────────────────
ICONS_BASE="${STAGING}/usr/share/icons/hicolor"
for size in 32 64 128 256; do
  mkdir -p "${ICONS_BASE}/${size}x${size}/apps"
  cp "package/common/${APP}${size}.png" "${ICONS_BASE}/${size}x${size}/apps/${APP}.png"
done

# ── /usr/share/applications/ ────────────────────────────────
APPSDIR="${STAGING}/usr/share/applications"
mkdir -p "${APPSDIR}"
cp package/deb/${APP}.desktop "${APPSDIR}/${APP}.desktop"

# ── DEBIAN/control ──────────────────────────────────────────
DEBDIR="${STAGING}/DEBIAN"
mkdir -p "${DEBDIR}"
cp package/deb/postinst "${DEBDIR}/postinst"
chmod 755 "${DEBDIR}/postinst"
cat > "${DEBDIR}/control" <<EOF
Package: ${APP}
Version: ${VERSION}
Section: sound
Priority: optional
Architecture: ${ARCH}
Depends: libgtk-3-0t64 | libgtk-3-0, libnss3, libasound2t64 | libasound2, libdbus-1-3, fonts-noto-color-emoji
Recommends: vlc
Maintainer: MusicPenguin@web.de
Homepage: https://github.com/MinnieTheMoocher/MusicPenguin
Description: MusicPenguin is a fast local-first music library and player.
EOF

# ── Build ───────────────────────────────────────────────────
chmod 644 "${DEBDIR}/control"

OUTPUT="${PKG_NAME}.deb"
dpkg-deb --root-owner-group --build -Z xz -z 9 "${STAGING}" "${OUTPUT}"

# Cleanup
rm -rf "${STAGING}"

echo ""
echo "Created: ${OUTPUT}"
echo "Size:    $(du -h "${OUTPUT}" | cut -f1)"
echo "Install: sudo dpkg -i ${OUTPUT}"
echo "Remove:  sudo dpkg -r ${APP}"

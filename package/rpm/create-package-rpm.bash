#!/usr/bin/env bash
set -euo pipefail
#cspell:ignore APPDIR BINDIR APPSDIR ICONDIR RPMROOT RPMBUILD BUILDROOT TOPDIR SOURCEDIR SPECS RPMARCH

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
RPMARCH="x86_64"
PKG_NAME="${APP}-${VERSION}-1.${RPMARCH}"
PROJECT_ROOT=$(pwd)
STAGING=$(mktemp -d)

[ -z "$(git status --porcelain)" ]  || die "local git repo is dirty"
command -v rpmbuild >/dev/null 2>&1 || die "rpmbuild not found (install package 'rpm-build')"

echo "Assembling ${PKG_NAME}.rpm ..."

# ── cleanup ──
rm -rf ./dist ./node_modules ./*.rpm
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

# ── RPM build tree (build dir is the live project root; no tar Source0) ──
RPMROOT="${STAGING}/rpmbuild"
mkdir -p "${RPMROOT}"/{BUILD,BUILDROOT,RPMS,SOURCES,SPECS,SRPMS}
cp package/rpm/${APP}.spec "${RPMROOT}/SPECS/${APP}.spec"
sed -i "s/__VERSION__/${VERSION}/g" "${RPMROOT}/SPECS/${APP}.spec"

# ── Build ───────────────────────────────────────────────────────
rpmbuild -bb \
    --define "_topdir ${RPMROOT}" \
    --define "_builddir ${PROJECT_ROOT}" \
    --define "_buildrootdir ${RPMROOT}/BUILDROOT" \
    --define "_rpmdir ${RPMROOT}/RPMS" \
    --define "_sourcedir ${RPMROOT}/SOURCES" \
    --define "_specdir ${RPMROOT}/SPECS" \
    --define "_srcrpmdir ${RPMROOT}/SRPMS" \
    "${RPMROOT}/SPECS/${APP}.spec"

RPMFILE=$(find "${RPMROOT}/RPMS" -name "${APP}-${VERSION}*.x86_64.rpm" | head -n1)
[ -n "${RPMFILE}" ] || die "rpmbuild produced no ${APP} package"
cp "${RPMFILE}" "${PROJECT_ROOT}/${PKG_NAME}.rpm"
OUTPUT="${PROJECT_ROOT}/${PKG_NAME}.rpm"

# Cleanup
rm -rf "${STAGING}"

echo ""
echo "Created: ${OUTPUT}"
echo "Size:    $(du -h "${OUTPUT}" | cut -f1)"
echo "Install: sudo dnf install ${OUTPUT}"
echo "Remove:  sudo dnf remove ${APP}"

Name:           musicpenguin
Version:        __VERSION__
Release:        1%{?dist}
Summary:        MusicPenguin is a fast local-first music library and player.

License:        MIT
URL:            https://github.com/MinnieTheMoocher/MusicPenguin
Source0:        %{name}-%{version}.tar.gz

BuildArch:      x86_64
Requires:       gtk3, nss, alsa-lib, dbus-libs, google-noto-coloremoji-fonts
Recommends:     vlc

# This is an x86_64-glibc build, yet some bundled native modules were linked
# for other platforms/architectures. Keep rpm's auto-generated "find-requires"
# from ever emitting dependencies on foreign dynamic linkers / libcs.
%global __requires_exclude ^(ld-linux-(aarch64|arm|armhf)\.so|ld-linux\.so\.2|libc\.musl-)

%description
MusicPenguin is a fast local-first music library and player.
This tool is aimed at people who prefer to keep their music independent
from online cloud storage, and instead prefer their collection on local
machines.

%prep
# Nothing to do: the project is built & pruned in-place by create-package-rpm.bash.

%build
# The application is pre-built & pruned by create-package-rpm.bash; nothing to build here.

%install
rm -rf %{buildroot}
APPDIR=%{buildroot}/opt/musicpenguin
mkdir -p "${APPDIR}/src/renderer" "${APPDIR}/src/preload"
cp -r src/renderer/designs "${APPDIR}/src/renderer/designs"
cp src/renderer/index.html src/renderer/musicpenguin256.png "${APPDIR}/src/renderer/"
cp src/preload/preload.js "${APPDIR}/src/preload/"
cp main.js package.json "${APPDIR}/"
cp -r dist "${APPDIR}/"
# Example custom designs, seeded into the user's design folder by %post.
cp -a package/designs "${APPDIR}/example-designs"
cp -a node_modules "${APPDIR}/"
chmod 4755 "${APPDIR}/node_modules/electron/dist/chrome-sandbox"

BINDIR=%{buildroot}/usr/bin
mkdir -p "${BINDIR}"
install -m 755 package/deb/musicpenguin "${BINDIR}/musicpenguin"

ICONS_BASE=%{buildroot}/usr/share/icons/hicolor
for size in 32 64 128 256; do
  mkdir -p "${ICONS_BASE}/${size}x${size}/apps"
  install -m 644 "package/musicpenguin${size}.png" "${ICONS_BASE}/${size}x${size}/apps/musicpenguin.png"
done

APPSDIR=%{buildroot}/usr/share/applications
mkdir -p "${APPSDIR}"
install -m 644 package/deb/musicpenguin.desktop "${APPSDIR}/musicpenguin.desktop"

%post
[ "${1:-1}" = "0" ] && exit 0
/usr/bin/gtk-update-icon-cache -f /usr/share/icons/hicolor 2>/dev/null || true
/usr/bin/update-desktop-database /usr/share/applications 2>/dev/null || true

# Seed the user's design folder with the example custom designs shipped by the
# package (see package/designs). Runs as root (dnf), so the
# installing user is taken from the sudo context, else the first human account.
ROOT_SRC="/opt/musicpenguin/example-designs"
if [ -d "$ROOT_SRC" ]; then
  if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
    TARGET_USER="$SUDO_USER"
    HOME_DIR=$(getent passwd "$SUDO_USER" 2>/dev/null | cut -d: -f6)
  elif [ "$(id -u)" = "0" ]; then
    TARGET_USER=$(getent passwd | awk -F: '$3>=1000 && $3<60000 {print $1; exit}')
    [ -n "$TARGET_USER" ] || exit 0
    HOME_DIR=$(getent passwd "$TARGET_USER" 2>/dev/null | cut -d: -f6)
  else
    TARGET_USER=$(id -un)
    HOME_DIR=$HOME
  fi
  if [ -n "$HOME_DIR" ] && [ -d "$HOME_DIR" ]; then
      DEST="$HOME_DIR/.config/musicpenguin/designs"
      mkdir -p "$DEST"
      for d in "$ROOT_SRC"/*/; do
        [ -d "$d" ] || continue
        name=$(basename "$d")
        if [ ! -d "$DEST/$name" ]; then
          cp -r "$d" "$DEST/$name"
          chmod -R u+rwX,go+rX "$DEST/$name" || true
          if [ "$(id -u)" = "0" ]; then
            chown -R "$TARGET_USER" "$DEST/$name" 2>/dev/null || true
          fi
        fi
      done
      if [ "$(id -u)" = "0" ]; then
        chown "$TARGET_USER" "$DEST" 2>/dev/null || true
      fi
    fi
  fi
fi

%postun
/usr/bin/gtk-update-icon-cache -f /usr/share/icons/hicolor 2>/dev/null || true
/usr/bin/update-desktop-database /usr/share/applications 2>/dev/null || true

%files
%defattr(-,root,root,-)
/opt/musicpenguin
/usr/bin/musicpenguin
/usr/share/icons/hicolor/32x32/apps/musicpenguin.png
/usr/share/icons/hicolor/64x64/apps/musicpenguin.png
/usr/share/icons/hicolor/128x128/apps/musicpenguin.png
/usr/share/icons/hicolor/256x256/apps/musicpenguin.png
/usr/share/applications/musicpenguin.desktop

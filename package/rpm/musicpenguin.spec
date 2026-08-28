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
cp src/renderer/index.html src/renderer/style.css src/renderer/musicpenguin256.png "${APPDIR}/src/renderer/"
cp src/preload/preload.js "${APPDIR}/src/preload/"
cp main.js package.json "${APPDIR}/"
cp -r dist "${APPDIR}/"
cp -a node_modules "${APPDIR}/"
chmod 4755 "${APPDIR}/node_modules/electron/dist/chrome-sandbox"

BINDIR=%{buildroot}/usr/bin
mkdir -p "${BINDIR}"
install -m 755 package/deb/musicpenguin "${BINDIR}/musicpenguin"

ICONS_BASE=%{buildroot}/usr/share/icons/hicolor
for size in 32 64 128 256; do
  mkdir -p "${ICONS_BASE}/${size}x${size}/apps"
  install -m 644 "package/common/musicpenguin${size}.png" "${ICONS_BASE}/${size}x${size}/apps/musicpenguin.png"
done

APPSDIR=%{buildroot}/usr/share/applications
mkdir -p "${APPSDIR}"
install -m 644 package/deb/musicpenguin.desktop "${APPSDIR}/musicpenguin.desktop"

%post
/usr/bin/gtk-update-icon-cache -f /usr/share/icons/hicolor 2>/dev/null || true
/usr/bin/update-desktop-database /usr/share/applications 2>/dev/null || true

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

#!/bin/bash
# Build the architecture-independent ipk without the OpenWrt SDK.
# Usage: tools/build-ipk.sh [output-dir]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(cd "${1:-$ROOT/..}" && pwd)"
VERSION="$(sed -n 's/^PKG_VERSION:=//p' "$ROOT/Makefile")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Same payload the Makefile assembles: root/, luasrc/ under the LuCI tree, compiled translations
mkdir -p "$WORK/data/usr/lib/lua/luci/i18n" "$WORK/control"
cp -R "$ROOT/root/." "$WORK/data/"
cp -R "$ROOT/luasrc/." "$WORK/data/usr/lib/lua/luci/"
find "$WORK/data/usr/lib/lua/luci" "$WORK/data/www" -type f \( -name '*.lua' -o -name '*.htm' \) \
	-exec sed -i '' "s|@OPENCLASH_VERSION@|$VERSION|g" {} + 2>/dev/null || true

# The checked-in po2lmo is a Linux binary, build one for the host
PO2LMO="$WORK/po2lmo"
cc -o "$PO2LMO" "$ROOT/tools/po2lmo/src/po2lmo.c" "$ROOT/tools/po2lmo/src/template_lmo.c"
for po in "$ROOT"/po/zh-cn/*.po; do
	"$PO2LMO" "$po" "$WORK/data/usr/lib/lua/luci/i18n/$(basename "${po%.po}").lmo"
done

# Maintainer scripts come from the Makefile so the SDK and this script stay in step
section() {
	sed -n "/^define Package\/\$(PKG_NAME)\/$1\$/,/^endef\$/p" "$ROOT/Makefile" | sed '1d;$d' | sed 's/\$\$/$/g'
}
section preinst >"$WORK/control/preinst"
section postinst >"$WORK/control/postinst-pkg"
section prerm >"$WORK/control/prerm-pkg"
section postrm >"$WORK/control/postrm"
cat >"$WORK/control/postinst" <<'S'
#!/bin/sh
[ "${IPKG_NO_SCRIPT}" = "1" ] && exit 0
. ${IPKG_INSTROOT}/lib/functions.sh
default_postinst $0 $@
S
cat >"$WORK/control/prerm" <<'S'
#!/bin/sh
. ${IPKG_INSTROOT}/lib/functions.sh
default_prerm $0 $@
S
chmod 755 "$WORK"/control/*

INSTALLED_SIZE="$(du -sk "$WORK/data" | cut -f1)"
cat >"$WORK/control/control" <<S
Package: luci-app-openclash
Version: $VERSION
Depends: libc, bash, curl, ca-bundle, ip-full, ruby, ruby-yaml, kmod-tun, unzip
Section: opt
Maintainer: youtonghy
Architecture: all
Installed-Size: $((INSTALLED_SIZE * 1024))
Description:  A LuCI support for clash
S

export COPYFILE_DISABLE=1
(cd "$WORK/data" && tar --no-xattrs --uid 0 --gid 0 --numeric-owner -czf ../data.tar.gz .)
(cd "$WORK/control" && tar --no-xattrs --uid 0 --gid 0 --numeric-owner -czf ../control.tar.gz .)
echo 2.0 >"$WORK/debian-binary"
PKG="$OUT/luci-app-openclash_${VERSION}_all.ipk"
(cd "$WORK" && tar --no-xattrs --uid 0 --gid 0 --numeric-owner -czf "$PKG" ./debian-binary ./data.tar.gz ./control.tar.gz)
echo "$PKG"

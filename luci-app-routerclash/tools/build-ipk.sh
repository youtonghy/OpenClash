#!/bin/bash
# Build the architecture-independent ipk without the OpenWrt SDK.
# Usage: tools/build-ipk.sh [output-dir]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(cd "${1:-$ROOT/..}" && pwd)"
VERSION="$(sed -n 's/^PKG_VERSION:=//p' "$ROOT/Makefile")"
WORK="$(mktemp -d)"
# The web app is not committed, run `npm run build` in web/ first (CI downloads the build as an artifact)
if [ ! -f "$ROOT/root/www/luci-static/resources/routerclash/app/assets/app.js" ]; then
	echo "warning: the web app is not built, this package will have no UI (see web/README.md)" >&2
fi
trap 'rm -rf "$WORK"' EXIT

# Same payload the Makefile assembles: root/, luasrc/ under the LuCI tree, compiled translations
mkdir -p "$WORK/data/usr/lib/lua/luci/i18n" "$WORK/control"
cp -R "$ROOT/root/." "$WORK/data/"
cp -R "$ROOT/luasrc/." "$WORK/data/usr/lib/lua/luci/"

# Same permissions as Build/Prepare in the Makefile: the repository stores everything as 0644.
find "$WORK/data" -type d -exec chmod 755 {} +
find "$WORK/data" -type f -exec chmod 644 {} +
chmod 755 "$WORK/data/etc/init.d/routerclash"
chmod -R 755 "$WORK/data/usr/share/routerclash"

# perl -pi behaves the same on GNU and BSD, unlike sed -i
find "$WORK/data/usr/lib/lua/luci" "$WORK/data/www" -type f \( -name '*.lua' -o -name '*.htm' \) \
	-exec perl -pi -e "s|\@ROUTERCLASH_VERSION\@|$VERSION|g" {} +
if grep -rq '@ROUTERCLASH_VERSION@' "$WORK/data/usr/lib/lua/luci"; then
	echo "version token left in the payload" >&2
	exit 1
fi

# The checked-in po2lmo is a Linux binary, build one for the host
PO2LMO="$WORK/po2lmo"
${CC:-cc} -o "$PO2LMO" "$ROOT/tools/po2lmo/src/po2lmo.c" "$ROOT/tools/po2lmo/src/template_lmo.c"
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
Package: luci-app-routerclash
Version: $VERSION
Depends: libc, bash, curl, ca-bundle, ip-full, ruby, ruby-yaml, kmod-tun, unzip
Conflicts: luci-app-openclash
Section: opt
Maintainer: youtonghy
Architecture: all
Installed-Size: $((INSTALLED_SIZE * 1024))
Description:  RouterClash, a LuCI app for the mihomo core
S

export COPYFILE_DISABLE=1
# GNU tar and bsdtar spell root ownership differently
if tar --version 2>/dev/null | grep -q 'GNU tar'; then
	OWNER=(--owner=0 --group=0 --numeric-owner)
else
	OWNER=(--uid 0 --gid 0 --numeric-owner)
fi
(cd "$WORK/data" && tar --no-xattrs "${OWNER[@]}" -czf ../data.tar.gz .)
(cd "$WORK/control" && tar --no-xattrs "${OWNER[@]}" -czf ../control.tar.gz .)
echo 2.0 >"$WORK/debian-binary"
PKG="$OUT/luci-app-routerclash_${VERSION}_all.ipk"
(cd "$WORK" && tar --no-xattrs "${OWNER[@]}" -czf "$PKG" ./debian-binary ./data.tar.gz ./control.tar.gz)
echo "$PKG"

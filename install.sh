#!/bin/sh
# One-click installer for RouterClash (luci-app-routerclash) on OpenWrt.
#
#   wget -qO- https://github.com/youtonghy/RouterClash/releases/latest/download/install.sh | sh
#
# Options (as arguments with `sh -s -- <options>`, or as environment variables):
#   -v, --version <tag>   install this release instead of the latest   (ROUTERCLASH_VERSION)
#   -p, --proxy <prefix>  prefix for GitHub download links, for example
#                         https://ghfast.top/                          (GH_PROXY)
#   --skip-deps           do not install dependencies                  (SKIP_DEPS=1)

REPO="${ROUTERCLASH_REPO:-youtonghy/RouterClash}"
VERSION="${ROUTERCLASH_VERSION:-latest}"
PROXY="${GH_PROXY:-}"
SKIP_DEPS="${SKIP_DEPS:-0}"

info() { printf '\033[32m[RouterClash]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[RouterClash]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[31m[RouterClash]\033[0m %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
	case "$1" in
		-v|--version) [ -n "$2" ] || die "$1 needs a value"; VERSION="$2"; shift 2 ;;
		-p|--proxy) [ -n "$2" ] || die "$1 needs a value"; PROXY="$2"; shift 2 ;;
		--skip-deps) SKIP_DEPS=1; shift ;;
		-h|--help) echo "usage: install.sh [-v <tag>] [-p <github-proxy-prefix>] [--skip-deps]"; exit 0 ;;
		*) die "unknown option: $1" ;;
	esac
done

[ "$(id -u)" = "0" ] || die "run this as root"
[ -f /etc/openwrt_release ] || die "this does not look like OpenWrt (/etc/openwrt_release is missing)"

if command -v apk >/dev/null 2>&1 && [ -d /etc/apk ]; then
	PM=apk
elif command -v opkg >/dev/null 2>&1; then
	PM=opkg
else
	die "neither apk nor opkg was found"
fi

# Required: DEPENDS in the Makefile. Recommended: its `config ... default y` entries.
DEPS="bash curl ca-bundle ip-full ruby ruby-yaml kmod-tun unzip luci-base luci-compat"
if [ -x /sbin/fw4 ]; then
	FW=fw4
	RECOMMENDS="kmod-inet-diag kmod-nft-tproxy"
else
	FW=fw3
	RECOMMENDS="kmod-inet-diag kmod-ipt-nat iptables-mod-tproxy iptables-mod-extra ipset"
fi

info "package manager: $PM, firewall: $FW"

pkg_update() {
	if [ "$PM" = "apk" ]; then
		apk update
	else
		opkg update
	fi
}

pkg_add() {
	if [ "$PM" = "apk" ]; then
		apk add "$@"
	else
		opkg install "$@"
	fi
}

# opkg install upgrades packages that are already there (luci-base, ca-bundle...),
# so only pass the missing ones
missing() {
	if [ "$PM" = "apk" ]; then
		for p in "$@"; do apk info -e "$p" >/dev/null 2>&1 || echo "$p"; done
	else
		installed="$(opkg list-installed | awk '{print $1}')"
		for p in "$@"; do echo "$installed" | grep -qx "$p" || echo "$p"; done
	fi
}

if [ "$SKIP_DEPS" != "1" ]; then
	# shellcheck disable=SC2086
	NEED="$(missing $DEPS | tr '\n' ' ')"
	# shellcheck disable=SC2086
	NEED_REC="$(missing $RECOMMENDS | tr '\n' ' ')"
	if [ -n "${NEED}${NEED_REC}" ]; then
		info "updating package lists"
		if ! pkg_update; then
			msg="updating package lists failed, check the network and the package feeds (if RouterClash is running with a broken proxy, stop it first)"
			[ -n "$NEED" ] && die "$msg"
			warn "$msg"
			NEED_REC=""
		fi
	fi
	if [ -n "$NEED" ]; then
		info "installing dependencies: $NEED"
		# shellcheck disable=SC2086
		pkg_add $NEED || die "installing dependencies failed"
	else
		info "dependencies already installed"
	fi
	for p in $NEED_REC; do
		pkg_add "$p" >/dev/null 2>&1 || warn "could not install $p, some features may not work"
	done
fi

# curl comes with the dependencies; uclient-fetch (wget) is the fallback with --skip-deps
fetch() {
	if command -v curl >/dev/null 2>&1; then
		curl -fsSL --retry 3 --connect-timeout 15 -o "$2" "$1"
	else
		wget -q -T 15 -O "$2" "$1"
	fi
}

if [ "$VERSION" = "latest" ]; then
	BASE="https://github.com/$REPO/releases/latest/download"
else
	case "$VERSION" in v*) ;; *) VERSION="v$VERSION" ;; esac
	BASE="https://github.com/$REPO/releases/download/$VERSION"
fi
BASE="$PROXY$BASE"

TMP="$(mktemp -d /tmp/routerclash.XXXXXX)" || die "cannot create a temporary directory"
trap 'rm -rf "$TMP"' EXIT INT TERM

info "fetching the release index ($VERSION)"
fetch "$BASE/sha256sums.txt" "$TMP/sha256sums.txt" || die "cannot download $BASE/sha256sums.txt"

if [ "$PM" = "apk" ]; then
	PKG="$(awk '{sub(/^\*/, "", $2)} $2 ~ /^luci-app-routerclash-.*\.apk$/ {print $2; exit}' "$TMP/sha256sums.txt")"
else
	PKG="$(awk '{sub(/^\*/, "", $2)} $2 ~ /^luci-app-routerclash_.*\.ipk$/ {print $2; exit}' "$TMP/sha256sums.txt")"
fi
[ -n "$PKG" ] || die "release $VERSION has no package for $PM"

info "downloading $PKG"
fetch "$BASE/$PKG" "$TMP/$PKG" || die "cannot download $BASE/$PKG"
(cd "$TMP" && grep " \*\{0,1\}$PKG\$" sha256sums.txt | sha256sum -c - >/dev/null) || die "checksum mismatch for $PKG"

# RouterClash replaces OpenClash (the packages conflict). Keep a copy of its settings and data
# where the new package's uci-defaults picks them up, then remove the old package.
if [ -z "$(missing luci-app-openclash)" ]; then
	info "migrating from luci-app-openclash"
	if [ -f /etc/config/openclash ] && [ ! -f /etc/.openclash-upgrade/config ]; then
		rm -rf /etc/.openclash-upgrade
		mkdir -p /etc/.openclash-upgrade || die "cannot create /etc/.openclash-upgrade"
		cp -f /etc/config/openclash /etc/.openclash-upgrade/config || die "cannot back up /etc/config/openclash"
		[ ! -d /etc/openclash ] || cp -rf /etc/openclash /etc/.openclash-upgrade/openclash || die "cannot back up /etc/openclash"
		[ ! -d /usr/share/openclash/ui ] || cp -rf /usr/share/openclash/ui /etc/.openclash-upgrade/ui || warn "cannot back up the dashboards"
	fi
	[ -x /etc/init.d/openclash ] && /etc/init.d/openclash stop >/dev/null 2>&1
	if [ "$PM" = "apk" ]; then
		apk del luci-app-openclash || die "removing luci-app-openclash failed, its data is kept in /etc/.openclash-upgrade"
	else
		opkg remove luci-app-openclash || die "removing luci-app-openclash failed, its data is kept in /etc/.openclash-upgrade"
	fi
fi

info "installing $PKG"
if [ "$PM" = "apk" ]; then
	apk add --allow-untrusted --force-overwrite "$TMP/$PKG" || die "installing $PKG failed"
else
	opkg install "$TMP/$PKG" || die "installing $PKG failed"
fi

rm -rf /tmp/luci-indexcache /tmp/luci-indexcache.* /tmp/luci-modulecache >/dev/null 2>&1

LAN_IP="$(uci -q get network.lan.ipaddr | cut -d/ -f1)"
info "done. Open http://${LAN_IP:-<router-ip>}/cgi-bin/luci/admin/services/routerclash"
info "the mihomo core is downloaded from the page on first use"

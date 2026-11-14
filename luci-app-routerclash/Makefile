include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-routerclash
PKG_VERSION:=0.49.002
PKG_MAINTAINER:=youtonghy <https://github.com/youtonghy/RouterClash>

PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)

include $(INCLUDE_DIR)/package.mk

define Package/$(PKG_NAME)/config
	config PACKAGE_kmod-inet-diag
	default y if PACKAGE_$(PKG_NAME)

	config PACKAGE_kmod-nft-tproxy
	default y if PACKAGE_firewall4

	config PACKAGE_kmod-ipt-nat
	default y if ! PACKAGE_firewall4

	config PACKAGE_iptables-mod-tproxy
	default y if ! PACKAGE_firewall4

	config PACKAGE_iptables-mod-extra
	default y if ! PACKAGE_firewall4

	config PACKAGE_ipset
	default y if ! PACKAGE_firewall4
endef

# CONFLICTS: OpenClash uses the same ports, firewall marks and routing table;
# uci-defaults migrates its data when this package replaces it
define Package/$(PKG_NAME)
	CATEGORY:=LuCI
	SUBMENU:=3. Applications
	TITLE:=RouterClash, a LuCI app for the mihomo core
	PKGARCH:=all
	DEPENDS:=+bash +curl +ca-bundle +ip-full \
	+ruby +ruby-yaml +kmod-tun +unzip
	CONFLICTS:=luci-app-openclash
	MAINTAINER:=youtonghy
endef

define Package/$(PKG_NAME)/description
	RouterClash, a LuCI app for the mihomo core
endef

define Build/Prepare
	$(CP) $(CURDIR)/root $(PKG_BUILD_DIR)
	$(CP) $(CURDIR)/luasrc $(PKG_BUILD_DIR)
	# Replace the @ROUTERCLASH_VERSION@ token with the package version (browser asset cache keys).
	sed -i 's|@ROUTERCLASH_VERSION@|$(PKG_VERSION)|g' $(PKG_BUILD_DIR)/luasrc/routerclash.lua $(PKG_BUILD_DIR)/luasrc/view/routerclash/*.htm
	$(foreach po,$(wildcard ${CURDIR}/po/zh-cn/*.po), \
		po2lmo $(po) $(PKG_BUILD_DIR)/$(patsubst %.po,%.lmo,$(notdir $(po)));)
	chmod 0755 $(PKG_BUILD_DIR)/root/etc/init.d/routerclash
	chmod -R 0755 $(PKG_BUILD_DIR)/root/usr/share/routerclash/
	exit 0
endef

define Build/Configure
endef

define Build/Compile
endef

define Package/$(PKG_NAME)/conffiles
endef

define Package/$(PKG_NAME)/preinst
#!/bin/sh
	# keep the upgrade copy on flash, /etc/routerclash plus the dashboards do not fit in tmpfs on 512MB devices
	if [ -f "/etc/config/routerclash" ] && [ ! -d "/etc/.routerclash-upgrade" ]; then
		mkdir -p "/etc/.routerclash-upgrade" >/dev/null 2>&1
		cp -f "/etc/config/routerclash" "/etc/.routerclash-upgrade/config" >/dev/null 2>&1
		cp -rf "/etc/routerclash" "/etc/.routerclash-upgrade/routerclash" >/dev/null 2>&1
		cp -rf "/usr/share/routerclash/ui" "/etc/.routerclash-upgrade/ui" >/dev/null 2>&1
	fi
	exit 0
endef

define Package/$(PKG_NAME)/postinst
#!/bin/sh
	exit 0
endef

define Package/$(PKG_NAME)/prerm
#!/bin/sh
	[ -n "$(pidof clash)" ] && /etc/init.d/routerclash stop 2>/dev/null
	[ -x /usr/share/routerclash/routerclash_killswitch.sh ] && /usr/share/routerclash/routerclash_killswitch.sh off 2>/dev/null
	# keep the upgrade copy on flash, /etc/routerclash plus the dashboards do not fit in tmpfs on 512MB devices
	if [ -f "/etc/config/routerclash" ] && [ ! -d "/etc/.routerclash-upgrade" ]; then
		mkdir -p "/etc/.routerclash-upgrade" >/dev/null 2>&1
		cp -f "/etc/config/routerclash" "/etc/.routerclash-upgrade/config" >/dev/null 2>&1
		cp -rf "/etc/routerclash" "/etc/.routerclash-upgrade/routerclash" >/dev/null 2>&1
		cp -rf "/usr/share/routerclash/ui" "/etc/.routerclash-upgrade/ui" >/dev/null 2>&1
	fi
	exit 0
endef

define Package/$(PKG_NAME)/postrm
#!/bin/sh
	DEFAULT_DNSMASQ_CFGID="$$(uci -q show "dhcp.@dnsmasq[0]" | awk 'NR==1 {split($0, conf, /[.=]/); print conf[2]}' 2>/dev/null)"
	if [ -f "/tmp/etc/dnsmasq.conf.$DEFAULT_DNSMASQ_CFGID" ]; then
	   DNSMASQ_CONF_DIR="$$(awk -F '=' '/^conf-dir=/ {print $2}' "/tmp/etc/dnsmasq.conf.$DEFAULT_DNSMASQ_CFGID" 2>/dev/null)"
	else
	   DNSMASQ_CONF_DIR="/tmp/dnsmasq.d"
	fi
	DNSMASQ_CONF_DIR=$${DNSMASQ_CONF_DIR%*/}
	rm -rf /etc/routerclash >/dev/null 2>&1
	rm -rf /etc/config/routerclash >/dev/null 2>&1
	rm -rf /tmp/routerclash.log >/dev/null 2>&1
	rm -rf /tmp/routerclash_start.log >/dev/null 2>&1
	rm -rf /tmp/routerclash.change >/dev/null 2>&1
	rm -rf /usr/share/routerclash >/dev/null 2>&1
	rm -rf /tmp/routerclash_version_history.json >/dev/null 2>&1
	rm -rf /tmp/routerclash_cdn_info.json >/dev/null 2>&1
	rm -rf /tmp/routerclash_tpl_cache >/dev/null 2>&1
	rm -rf ${DNSMASQ_CONF_DIR}/dnsmasq_routerclash_custom_domain.conf >/dev/null 2>&1
	rm -rf ${DNSMASQ_CONF_DIR}/dnsmasq_routerclash_chnroute_pass.conf >/dev/null 2>&1
	rm -rf ${DNSMASQ_CONF_DIR}/dnsmasq_routerclash_chnroute6_pass.conf >/dev/null 2>&1
	rm -rf /tmp/etc/routerclash >/dev/null 2>&1
	rm -rf /tmp/routerclash_announcement >/dev/null 2>&1
	rm -rf /www/luci-static/resources/routerclash >/dev/null 2>&1
	rm -f /etc/nginx/conf.d/routerclash.conf >/dev/null 2>&1
	rm -f /etc/nginx/conf.d/routerclash.locations >/dev/null 2>&1
	rm -f /etc/nginx/gl-conf.d/routerclash.conf >/dev/null 2>&1
	[ -x /etc/init.d/nginx ] && /etc/init.d/nginx reload >/dev/null 2>&1
	uci -q delete firewall.routerclash
	uci -q delete firewall.routerclash_ks
	uci -q commit firewall
	[ -f "/etc/config/ucitrack" ] && {
	uci -q delete ucitrack.@routerclash[-1]
	uci -q commit ucitrack
	}
	rm -rf /tmp/luci-indexcache /tmp/luci-indexcache.* /var/luci-indexcache /var/luci-indexcache.* >/dev/null 2>&1
	rm -rf /tmp/luci-modulecache /var/luci-modulecache >/dev/null 2>&1
	exit 0
endef

define Package/$(PKG_NAME)/install
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/i18n
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/*.*.lmo $(1)/usr/lib/lua/luci/i18n/
	$(CP) $(PKG_BUILD_DIR)/root/* $(1)/
	$(CP) $(PKG_BUILD_DIR)/luasrc/* $(1)/usr/lib/lua/luci/
endef

$(eval $(call BuildPackage,$(PKG_NAME)))

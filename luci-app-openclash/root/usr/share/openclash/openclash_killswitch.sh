#!/bin/sh
# Kill switch: while OpenClash should be proxying but cannot, LAN clients get no direct route out.
#
# Two layers, neither needs a running process:
#  - route guard: a blackhole fallback in the policy table. When the core dies and utun vanishes,
#    marked packets hit it immediately instead of falling through to the main table.
#  - forward block: an own chain or table rejecting LAN traffic to the internet. It covers the time
#    the proxy rules are not installed: boot, restarts, a core that will not start.
#
# Also runs without arguments as a firewall include, so the block exists before the WAN is up.
# The router's own traffic, the LAN admin pages and VPN interfaces are never touched.

STATE=/var/run/openclash_ks.state
TABLE=354
FWMARK=0x162
GUARD_METRIC=4096
# not named "openclash...": revert_firewall removes every rule matching that word
CHAIN=oc_killswitch
NFT_TABLE=oc_killswitch

V4_PRIVATE="0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16 224.0.0.0/4 240.0.0.0/4"
V6_PRIVATE="::1/128 fc00::/7 fe80::/10 ff00::/8"
# Tunnels the user brought up themselves are not a direct leak.
VPN_IFACES="wg tailscale tun ovpn"

conf() { uci -q get "openclash.config.$1"; }
state() { cat "$STATE" 2>/dev/null; }
set_state() { mkdir -p /var/run; echo "$1" >"$STATE"; }
armed() { [ "$(conf enable)" = "1" ] && [ "$(conf kill_switch)" != "0" ]; }
core_alive() { pidof clash >/dev/null 2>&1; }

lan_ifaces() {
	echo "br-+"
	for dev in "$(conf lan_interface_name)" "$(uci -q get network.lan.device)" "$(uci -q get network.lan.ifname)"; do
		case "$dev" in
			""|0|br-*|*" "*) ;;
			*) echo "$dev" ;;
		esac
	done
}

guard_on() {
	ip rule 2>/dev/null | grep -q "fwmark $FWMARK" && ip route replace blackhole default table $TABLE metric $GUARD_METRIC 2>/dev/null
	ip -6 rule 2>/dev/null | grep -q "fwmark $FWMARK" && ip -6 route replace blackhole default table $TABLE metric $GUARD_METRIC 2>/dev/null
	return 0
}

guard_off() {
	ip route del blackhole default table $TABLE metric $GUARD_METRIC 2>/dev/null
	ip -6 route del blackhole default table $TABLE metric $GUARD_METRIC 2>/dev/null
	return 0
}

# ---- iptables (fw3)

ipt_exempt() { # <iptables|ip6tables> <is_v6>
	local cmd="$1" v6="$2" item mode
	mode="$(conf lan_ac_mode)"
	for item in $(conf wan_ac_black_ips); do
		ipt_family_match "$item" "$v6" && $cmd -w -A $CHAIN -d "$item" -j RETURN
	done
	if [ "$mode" = "1" ]; then
		# Only listed devices use the proxy, every other device is direct by design.
		for item in $(conf lan_ac_white_ips); do
			ipt_family_match "$item" "$v6" && ipt_reject "$cmd" -s "$item"
		done
		for item in $(conf lan_ac_white_macs); do
			ipt_reject "$cmd" -m mac --mac-source "$item"
		done
		return 1
	fi
	for item in $(conf lan_ac_black_ips); do
		ipt_family_match "$item" "$v6" && $cmd -w -A $CHAIN -s "$item" -j RETURN
	done
	for item in $(conf lan_ac_black_macs); do
		$cmd -w -A $CHAIN -m mac --mac-source "$item" -j RETURN
	done
	return 0
}

ipt_family_match() { # <address> <is_v6>
	case "$1" in
		*:*) [ "$2" = "1" ] ;;
		*) [ "$2" = "0" ] ;;
	esac
}

ipt_reject() { # <iptables|ip6tables> [match...]
	local cmd="$1"
	shift
	$cmd -w -A $CHAIN "$@" -p tcp -j REJECT --reject-with tcp-reset 2>/dev/null || $cmd -w -A $CHAIN "$@" -p tcp -j DROP
	$cmd -w -A $CHAIN "$@" -j REJECT 2>/dev/null || $cmd -w -A $CHAIN "$@" -j DROP
}

ipt_build() { # <iptables|ip6tables> <is_v6> <private ranges>
	local cmd="$1" v6="$2" ranges="$3" item lan
	$cmd -w -N $CHAIN 2>/dev/null
	$cmd -w -F $CHAIN || return 0
	$cmd -w -A $CHAIN -m conntrack --ctdir REPLY -j RETURN
	for item in $VPN_IFACES; do
		$cmd -w -A $CHAIN -o "$item+" -j RETURN
	done
	for item in $ranges; do
		$cmd -w -A $CHAIN -d "$item" -j RETURN
	done
	ipt_exempt "$cmd" "$v6" && ipt_reject "$cmd"
	# the chain is complete before traffic can reach it
	for lan in $(lan_ifaces); do
		$cmd -w -C FORWARD -i "$lan" -j $CHAIN 2>/dev/null || $cmd -w -I FORWARD 1 -i "$lan" -j $CHAIN
	done
}

ipt_remove() { # <iptables|ip6tables>
	local cmd="$1" rule
	$cmd -w -S FORWARD 2>/dev/null | grep -- "-j $CHAIN\$" | sed 's/^-A /-D /' | while read -r rule; do
		$cmd -w $rule
	done
	$cmd -w -F $CHAIN 2>/dev/null
	$cmd -w -X $CHAIN 2>/dev/null
}

# ---- nftables (fw4). An own table survives fw4 reloads.

nft_list() { # <items...>: joins arguments with commas
	local out="" item
	for item in "$@"; do
		out="${out:+$out, }$item"
	done
	echo "$out"
}

nft_build() {
	local file=/var/run/openclash_ks.nft lan item mode reject
	mode="$(conf lan_ac_mode)"
	reject="meta l4proto tcp reject with tcp reset
		reject"
	{
		echo "add table inet $NFT_TABLE"
		echo "delete table inet $NFT_TABLE"
		echo "table inet $NFT_TABLE {"
		echo "	chain forward {"
		echo "		type filter hook forward priority -5; policy accept;"
		for lan in $(lan_ifaces); do
			echo "		iifname \"$(echo "$lan" | sed 's/+$/*/')\" jump guard"
		done
		echo "	}"
		echo "	chain deny {"
		echo "		$reject"
		echo "	}"
		echo "	chain guard {"
		echo "		ct direction reply return"
		for item in $VPN_IFACES; do
			echo "		oifname \"$item*\" return"
		done
		echo "		ip daddr { $(nft_list $V4_PRIVATE) } return"
		echo "		ip6 daddr { $(nft_list $V6_PRIVATE) } return"
		for item in $(conf wan_ac_black_ips); do
			case "$item" in
				*:*) echo "		ip6 daddr $item return" ;;
				*) echo "		ip daddr $item return" ;;
			esac
		done
		if [ "$mode" = "1" ]; then
			for item in $(conf lan_ac_white_ips); do
				case "$item" in
					*:*) echo "		ip6 saddr $item jump deny" ;;
					*) echo "		ip saddr $item jump deny" ;;
				esac
			done
			for item in $(conf lan_ac_white_macs); do
				echo "		ether saddr $item jump deny"
			done
		else
			for item in $(conf lan_ac_black_ips); do
				case "$item" in
					*:*) echo "		ip6 saddr $item return" ;;
					*) echo "		ip saddr $item return" ;;
				esac
			done
			for item in $(conf lan_ac_black_macs); do
				echo "		ether saddr $item return"
			done
			echo "		jump deny"
		fi
		echo "	}"
		echo "}"
	} >"$file"
	nft -f "$file"
	rm -f "$file"
}

block_on() {
	if command -v fw4 >/dev/null 2>&1; then
		nft_build
	else
		ipt_build iptables 0 "$V4_PRIVATE"
		ipt_build ip6tables 1 "$V6_PRIVATE"
	fi
}

block_off() {
	if command -v fw4 >/dev/null 2>&1; then
		nft delete table inet $NFT_TABLE 2>/dev/null
	else
		ipt_remove iptables
		ipt_remove ip6tables
	fi
	return 0
}

block() {
	[ "$(state)" = "blocked" ] || logger -t openclash "kill switch: blocking direct LAN traffic"
	block_on
	set_state blocked
}

case "${1:-sync}" in
	hold)
		# about to take the proxy rules down on purpose
		if armed && [ "$(state)" != "bypass" ]; then
			block
		fi
		;;
	open)
		block_off
		set_state open
		if armed; then guard_on; else guard_off; fi
		;;
	release)
		block_off
		guard_off
		set_state released
		;;
	bypass)
		block_off
		set_state bypass
		logger -t openclash "kill switch: temporarily bypassed"
		;;
	resume)
		if ! armed; then
			exit 0
		elif core_alive; then
			block_off
			set_state open
			guard_on
		else
			block
		fi
		;;
	off)
		block_off
		guard_off
		rm -f "$STATE"
		;;
	status)
		state
		;;
	*)
		# firewall include and settings changes
		if armed; then
			case "$(state)" in
				open)
					block_off
					guard_on
					;;
				bypass|released)
					block_off
					;;
				*)
					block
					;;
			esac
		else
			block_off
			guard_off
			[ "$(state)" = "blocked" ] && set_state released
		fi
		;;
esac

exit 0

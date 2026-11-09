setfenv(1, require "luci.openclash.api.env")

local function each_line(path, fn)
	local file = io.open(path, "r")
	if not file then
		return
	end
	for line in file:lines() do
		fn(line)
	end
	file:close()
end

local function usable(name)
	return name and name ~= "" and name ~= "*"
end

local function each_value(value, fn)
	if type(value) == "table" then
		for _, item in ipairs(value) do
			fn(item)
		end
	elseif value then
		for item in value:gmatch("%S+") do
			fn(item)
		end
	end
end

-- Maps every address a LAN device uses to its name. Names set in the DHCP settings win over the
-- ones clients report, and the neighbour table carries a name to the device's other addresses.
function action_device_names()
	local names, name_of_mac, mac_of_ip = {}, {}, {}

	uci:foreach("dhcp", "host", function(host)
		if usable(host.name) then
			each_value(host.mac, function(mac) name_of_mac[mac:lower()] = host.name end)
			each_value(host.ip, function(ip) names[ip] = host.name end)
		end
	end)

	uci:foreach("dhcp", "dnsmasq", function(section)
		-- expiry mac-or-iaid address name client-id; DHCPv6 lines have an iaid in place of the mac
		each_line(section.leasefile or "/tmp/dhcp.leases", function(line)
			local mac, ip, name = line:match("^%d+%s+(%S+)%s+(%S+)%s+(%S+)")
			if usable(name) then
				names[ip] = names[ip] or name
				if not ip:find(":", 1, true) then
					mac = mac:lower()
					name_of_mac[mac] = name_of_mac[mac] or name
					mac_of_ip[ip] = mac
				end
			end
		end)
	end)

	-- odhcpd writes "address fqdn name" lines between its "#" state lines
	each_line(uci:get_first("dhcp", "odhcpd", "leasefile") or "/tmp/hosts/odhcpd", function(line)
		if line:sub(1, 1) ~= "#" then
			local ip, name = line:match("^(%S+)%s+%S+%s+(%S+)")
			if usable(name) then
				names[ip] = names[ip] or name
			end
		end
	end)

	for line in SYS.exec("ip neigh show 2>/dev/null"):gmatch("[^\n]+") do
		local ip, mac = line:match("^(%S+)%s.*%slladdr%s+(%S+)")
		if ip then
			mac_of_ip[ip] = mac:lower()
		end
	end

	-- an address named only by DHCPv6 still identifies the device behind its other addresses
	for ip, mac in pairs(mac_of_ip) do
		if names[ip] then
			name_of_mac[mac] = name_of_mac[mac] or names[ip]
		end
	end
	for ip, mac in pairs(mac_of_ip) do
		names[ip] = name_of_mac[mac] or names[ip]
	end

	HTTP.prepare_content("application/json")
	HTTP.write_json(names)
end

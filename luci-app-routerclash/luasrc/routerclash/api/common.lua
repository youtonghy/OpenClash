setfenv(1, require "luci.routerclash.api.env")

function is_running()
	return SYS.call("pidof clash >/dev/null") == 0
end

-- the procd instance state is the authority after an init.d restart, pidof can still
-- see a dying process; nil means ubus itself is unavailable
function service_running()
	local out = SYS.exec("ubus call service list '{\"name\":\"routerclash\"}' 2>/dev/null")
	if not out or out == "" then
		return nil
	end
	local ok, data = pcall(json.parse, out)
	if not ok or type(data) ~= "table" or type(data.routerclash) ~= "table" then
		return nil
	end
	local instances = data.routerclash.instances
	if type(instances) ~= "table" then
		return false
	end
	for _, inst in pairs(instances) do
		if type(inst) == "table" and inst.running == true then
			return true
		end
	end
	return false
end

function is_start()
	return process_status("/etc/init.d/routerclash")
end

function cn_port()
	return fs.uci_get_config("config", "cn_port") or "9090"
end

function mode()
	return fs.uci_get_config("config", "en_mode")
end

function daip()
	return fs.lanip()
end

function dase()
	return fs.uci_get_config("config", "dashboard_password")
end

function dashboard_forward_domain()
	return fs.uci_get_config("config", "dashboard_forward_domain")
end

function dashboard_forward_port()
	return fs.uci_get_config("config", "dashboard_forward_port")
end

function dashboard_forward_ssl()
	return fs.uci_get_config("config", "dashboard_forward_ssl") or 0
end

function dashboard_custom_url()
	return fs.uci_get_config("config", "dashboard_custom_url")
end

function dashboard_custom_clash_compatible()
	return fs.uci_get_config("config", "dashboard_custom_clash_compatible") or 0
end

function coremodel()
	local rel = fs.readfile("/etc/openwrt_release")
	if rel then
		local arch = rel:match("DISTRIB_ARCH='([^']+)'")
		if arch and arch ~= "" then
			return arch
		end
	end
	if opkg then
		local info = opkg.info("libc")
		if info and info["libc"] and info["libc"]["Architecture"] then
			return info["libc"]["Architecture"]
		end
	end
	if fs.pkg_type() == "opkg" then
		return fs.read_pkg_field("libc", "Architecture")
	else
		return fs.read_pkg_field("libc", "A")
	end
end

function check_core()
	if not fs.access(meta_core_path) then
		return "0"
	else
		return "1"
	end
end

function coremetacv()
	if not fs.access(meta_core_path) then
		return "0"
	end

	local st = nixio.fs.stat(meta_core_path)
	local key = st and (tostring(st.mtime) .. "-" .. tostring(st.size)) or ""

	local v = fs.cached_value("core_cv_cache", key, function()
		local out = SYS.exec(string.format("%s -v 2>/dev/null |awk -F ' ' '{print $3}' |head -1 |tr -d '\n'", meta_core_path))
		if not out or out == "" then return nil end
		return out
	end)

	return v or "0"
end

function release_branch()
	return fs.uci_get_config("config", "release_branch") or "master"
end

function corever()
	return fs.uci_get_config("config", "core_version") or "0"
end

function corelv()
	local core_meta_lv = ""
	local core_smart_enable = fs.uci_get_config("config", "smart_enable") or "0"
	local oix_token = fs.uci_get_config("config", "oix_token") or ""

	local cache = ov.fetch_version_history(release_branch(), false)
	if cache then
		if oix_token ~= "" then
			core_meta_lv = cache.oix_ver or ""
		elseif core_smart_enable == "1" then
			core_meta_lv = (cache.core_smart and cache.core_smart[1] and cache.core_smart[1].version) or ""
		else
			core_meta_lv = (cache.core_meta and cache.core_meta[1] and cache.core_meta[1].version) or ""
		end
	end

	if core_meta_lv and core_meta_lv ~= "" then
		return core_meta_lv
	end

	return "loading..."
end

function opcv()
	local v
	local info = opkg and opkg.info("luci-app-routerclash")
	if info and info["luci-app-routerclash"] and info["luci-app-routerclash"]["Version"] and info["luci-app-routerclash"]["Installed-Time"] then
		v = info["luci-app-routerclash"]["Version"]
	else
		v = fs.rc_version()
		if v == "0" then
			return "0"
		end
		if fs.pkg_type() ~= "opkg" then
			v = v:match("[%d%.]+") or ""
		end
	end
	if v and v ~= "" then
		return "v" .. v
	else
		return "0"
	end
end

function coreup()
	uci:set("routerclash", "config", "enable", "1")
	uci:commit("routerclash")
	return SYS.call("/usr/share/routerclash/routerclash_core.sh Meta >/dev/null 2>&1 &")
end

function config_name()
	local e,a={}
	for t,o in ipairs(fs.glob("/etc/routerclash/config/*"))do
		a=fs.stat(o)
		if a then
			e[t]={}
			e[t].name=fs.basename(o)
		end
	end
	return e
end

function config_path()
	local p = fs.uci_get_config("config", "config_path")
	return p and string.sub(p, CONFIG_PATH_PREFIX_LEN) or ""
end

function proc_cpu_count()
	local content = nixio.fs.readfile("/proc/cpuinfo")
	if not content then
		return "1"
	end
	local count = 0
	for line in content:gmatch("[^\n]+") do
		if line:match("^processor") then
			count = count + 1
		end
	end
	return count > 0 and tostring(count) or "1"
end

function proc_find_core_pid()
	local iter = nixio.fs.dir("/proc")
	if not iter then
		return nil
	end
	local pids = {}
	for entry in iter do
		if entry:match("^%d+$") then
			pids[#pids + 1] = tonumber(entry)
		end
	end
	table.sort(pids)
	for _, pid in ipairs(pids) do
		local cmdline = nixio.fs.readfile("/proc/" .. pid .. "/cmdline")
		if cmdline and cmdline:gsub("%z", " "):match("^[^ ]*clash") then
			return tostring(pid)
		end
	end
	return nil
end

function proc_core_cpu_percent(pid)
	if nixio.fs.access("/sys/fs/cgroup/cpuacct") then
		local dir = "/sys/fs/cgroup/cpuacct/routerclash"
		if not nixio.fs.access(dir) then
			SYS.exec("mkdir -p " .. dir .. " 2>/dev/null")
		end
		if nixio.fs.access(dir) then
			local f = io.open(dir .. "/cgroup.procs", "w")
			if f then
				f:write(pid, "\n")
				f:close()
				local usage_file = dir .. "/cpuacct.usage"
				local function read_usage()
					local raw = fs.readfile(usage_file)
					if not raw then
						return nil
					end
					return tonumber(raw:match("^(%d+)"))
				end
				local u1 = read_usage()
				if u1 then
					local up1 = tonumber((fs.readfile("/proc/uptime") or ""):match("^(%S+)"))
					nixio.nanosleep(0, 200000000)
					local u2 = read_usage()
					local up2 = tonumber((fs.readfile("/proc/uptime") or ""):match("^(%S+)"))
					if u2 and up1 and up2 and up2 > up1 then
						return (u2 - u1) / ((up2 - up1) * 1e9)
					end
				end
			end
		end
	end

	if nixio.fs.access("/sys/fs/cgroup/cgroup.controllers") then
		local cg = fs.readfile("/proc/" .. pid .. "/cgroup")
		if cg then
			local path = cg:match("0::([^\n]+)")
			if path and path ~= "/" and path ~= "" then
				local usage_file = "/sys/fs/cgroup" .. path .. "/cpu.stat"
				local function read_usage()
					local raw = fs.readfile(usage_file)
					if not raw then
						return nil
					end
					return tonumber(raw:match("usage_usec%s+(%d+)"))
				end
				local u1 = read_usage()
				if u1 then
					local up1 = tonumber((fs.readfile("/proc/uptime") or ""):match("^(%S+)"))
					nixio.nanosleep(0, 200000000)
					local u2 = read_usage()
					local up2 = tonumber((fs.readfile("/proc/uptime") or ""):match("^(%S+)"))
					if u2 and up1 and up2 and up2 > up1 then
						return (u2 - u1) / ((up2 - up1) * 1e6)
					end
				end
			end
		end
	end

	local function read_sample()
		local uptime = fs.readfile("/proc/uptime")
		local stat = fs.readfile("/proc/" .. pid .. "/stat")
		if not uptime or not stat then
			return nil
		end
		local up = tonumber(uptime:match("^(%S+)"))
		local last_bracket = 0
		for pos in stat:gmatch("()%)") do
			last_bracket = pos
		end
		if not up or up <= 0 or last_bracket == 0 then
			return nil
		end
		local fields = {}
		for field in stat:sub(last_bracket + 1):gmatch("%S+") do
			fields[#fields + 1] = field
		end
		local utime = tonumber(fields[12])
		local stime = tonumber(fields[13])
		if not utime or not stime then
			return nil
		end
		return up, utime + stime
	end

	local up1, total1 = read_sample()
	if not up1 then
		return nil
	end
	nixio.nanosleep(0, 200000000)
	local up2, total2 = read_sample()
	if not up2 then
		return nil
	end
	local elapsed = up2 - up1
	if elapsed <= 0 then
		return nil
	end
	return (total2 - total1) / elapsed
end

function is_safe_filename(filename)
	return filename and filename:match("^[%w%._%-]+$") and not filename:match("^%.")
end

function kill_process()
	local cmd = string.format("%s |grep -E 'routerclash|clash|mihomo' |grep -v grep |awk '{print $1}' |xargs -r kill -9 >/dev/null 2>&1", fs.ps_cmd())
	SYS.call(cmd)
end

function core_api_get(path)
	local ip = daip()
	local port = cn_port()
	local secret = dase() or ""
	if not ip or not port then
		return nil
	end

	local cmd = string.format('curl -sL -m 5 --retry 1 -H %s http://"%s":"%s"%s 2>/dev/null',
		UTIL.shellquote("Authorization: Bearer " .. secret), ip, port, path)
	local out = SYS.exec(cmd)
	if not out or out == "" then
		return nil
	end
	return out
end

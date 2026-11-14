setfenv(1, require "luci.routerclash.api.env")

function save_corever_branch()
	if HTTP.formvalue("core_ver") then
		uci:set("routerclash", "config", "core_version", HTTP.formvalue("core_ver"))
	end
	if HTTP.formvalue("release_branch") then
		uci:set("routerclash", "config", "release_branch", HTTP.formvalue("release_branch"))
	end
	if HTTP.formvalue("smart_enable") then
		uci:set("routerclash", "config", "smart_enable", HTTP.formvalue("smart_enable"))
	end
	uci:commit("routerclash")
	return "success"
end

function core_download()
	local download_url = HTTP.formvalue("download_url")
	if download_url and download_url ~= "" then
		if not download_url:match("^https?://[%w%-%._~:/%?#@!%$&%(%)%*%+,;=%%]+$") then
			HTTP.status(400, "Bad Request")
			return
		end
		SYS.call(string.format("bash /usr/share/routerclash/routerclash_core.sh Meta '%s' >/dev/null 2>&1 &", download_url))
	else
		SYS.call("bash /usr/share/routerclash/routerclash_core.sh Meta >/dev/null 2>&1 &")
	end

end

function action_remove_all_core()
	SYS.call("rm -rf /etc/routerclash/core/* >/dev/null 2>&1")
end

function action_save_corever_branch()
	HTTP.prepare_content("application/json")
	HTTP.write_json({
		save_corever_branch = save_corever_branch();
	})
end

function action_update()
	HTTP.prepare_content("application/json")
	HTTP.write_json({
		coremodel = coremodel(),
		corever = corever(),
		release_branch = release_branch(),
		pkg_type = fs.pkg_type(),
		coremetacv = coremetacv(),
		opcv = opcv(),
		github_address_mod = fs.uci_get_config("config", "github_address_mod") or "0",
		cdn_list = fs.cdn_list();
	})
end

function action_save_github_address_mod()
	local value = HTTP.formvalue("value") or ""
	uci:set("routerclash", "config", "github_address_mod", value)
	uci:commit("routerclash")
	HTTP.prepare_content("application/json")
	HTTP.write_json({
		success = true;
	})
end

function action_save_custom_addr()
	local addr = HTTP.formvalue("addr") or ""
	addr = addr:gsub("^%s+", ""):gsub("%s+$", "")
	local success = false
	if addr ~= "" and #addr <= 256 and addr:match("^https?://%S+$") then
		local list = {}
		local seen = {}
		local custom = uci:get("routerclash", "config", "github_addr_custom")
		if type(custom) == "table" then
			for _, v in ipairs(custom) do
				if v ~= "" and not seen[v] then
					seen[v] = true
					list[#list + 1] = v
				end
			end
		elseif type(custom) == "string" then
			for v in custom:gmatch("%S+") do
				if not seen[v] then
					seen[v] = true
					list[#list + 1] = v
				end
			end
		end
		if not seen[addr] then
			list[#list + 1] = addr
			uci:set_list("routerclash", "config", "github_addr_custom", list)
			uci:commit("routerclash")
		end
		success = true
	end
	HTTP.prepare_content("application/json")
	HTTP.write_json({
		success = success;
	})
end

function action_last_version()
	HTTP.prepare_content("application/json")
	HTTP.write_json({
		corelv = corelv();
	})
end

function action_check_core()
	HTTP.prepare_content("application/json")
	HTTP.write_json({
		core_status = check_core();
	})
end

function action_coreupdate()
	HTTP.prepare_content("application/json")
	HTTP.write_json({
		coreup = coreup();
	})
end

function action_version_history()
	local branch = HTTP.formvalue("branch") or "master"
	local force = HTTP.formvalue("force") == "1"
	local parsed = ov.fetch_version_history(branch, force)

	HTTP.prepare_content("text/plain; charset=utf-8")
	if parsed.plugin then
		for _, entry in ipairs(parsed.plugin) do
			entry.type = "plugin"
			write_padded(json.stringify(entry))
		end
	end
	if parsed.core_meta then
		for _, entry in ipairs(parsed.core_meta) do
			entry.type = "core_meta"
			write_padded(json.stringify(entry))
		end
	end
	if parsed.core_smart then
		for _, entry in ipairs(parsed.core_smart) do
			entry.type = "core_smart"
			write_padded(json.stringify(entry))
		end
	end
	local complete_line = {complete = true}
	if parsed.error then
		complete_line.error = parsed.error
	end
	write_padded(json.stringify(complete_line))
end

setfenv(1, require "luci.openclash.api.env")

function action_dashboard_type()
	local dashboard_type = fs.uci_get_config("config", "dashboard_type") or "Official"
	local yacd_type = fs.uci_get_config("config", "yacd_type") or "Official"
	local default_dashboard = fs.uci_get_config("config", "default_dashboard") or ""
	if not fs.isdirectory("/usr/share/openclash/ui/" .. default_dashboard) then
		default_dashboard = ""
	end
	HTTP.prepare_content("application/json")
	HTTP.write_json({
		dashboard_type = dashboard_type,
		yacd_type = yacd_type,
		yacd = fs.isdirectory("/usr/share/openclash/ui/yacd"),
		dashboard = fs.isdirectory("/usr/share/openclash/ui/dashboard"),
		metacubexd = fs.isdirectory("/usr/share/openclash/ui/metacubexd"),
		zashboard = fs.isdirectory("/usr/share/openclash/ui/zashboard"),
		default_dashboard = default_dashboard;
	})
end

function action_default_dashboard()
	local default_dashboard = HTTP.formvalue("name")
	if not default_dashboard or (default_dashboard ~= "Dashboard" and default_dashboard ~= "Yacd" and default_dashboard ~= "Metacubexd" and default_dashboard ~= "Zashboard") then
		HTTP.status(500, "Set Failed")
		return
	end
	if not fs.isdirectory("/usr/share/openclash/ui/" .. string.lower(default_dashboard)) then
		HTTP.status(500, "Set Failed")
		return
	end
	uci:set("openclash", "config", "default_dashboard", string.lower(default_dashboard))
	uci:commit("openclash")
	HTTP.prepare_content("application/json")
	HTTP.write_json({
		default_dashboard = default_dashboard;
	})
end

function action_switch_dashboard()
	local switch_name = HTTP.formvalue("name")
	local switch_type = HTTP.formvalue("type")
	local state = SYS.call(string.format('/usr/share/openclash/openclash_download_dashboard.sh "%s" "%s" >/dev/null 2>&1', switch_name, switch_type))
	if switch_name == "Dashboard" and tonumber(state) == 0 then
		if switch_type == "Official" then
			uci:set("openclash", "config", "dashboard_type", "Official")
			uci:commit("openclash")
		else
			uci:set("openclash", "config", "dashboard_type", "Meta")
			uci:commit("openclash")
		end
	elseif switch_name == "Yacd" and tonumber(state) == 0 then
		if switch_type == "Official" then
			uci:set("openclash", "config", "yacd_type", "Official")
			uci:commit("openclash")
		else
			uci:set("openclash", "config", "yacd_type", "Meta")
			uci:commit("openclash")
		end
	end
	HTTP.prepare_content("application/json")
	HTTP.write_json({
		download_state = state;
	})
end

function action_delete_dashboard()
	local delete_name = HTTP.formvalue("name")
	local delete_path = string.format("/usr/share/openclash/ui/%s", string.lower(delete_name))

	local panels = {
		"/usr/share/openclash/ui/dashboard",
		"/usr/share/openclash/ui/yacd",
		"/usr/share/openclash/ui/metacubexd",
		"/usr/share/openclash/ui/zashboard"
	}
	local existing_panels = 0
	for _, path in ipairs(panels) do
		if fs.isdirectory(path) then
			existing_panels = existing_panels + 1
		end
	end

	if existing_panels <= 1 then
		HTTP.prepare_content("application/json")
		HTTP.write_json({
			delete_state = 0,
			error = "Cannot delete the last remaining dashboard"
		})
		return
	end

	local state = SYS.call(string.format("rm -rf '%s' >/dev/null 2>&1", delete_path)) == 0 and 1 or 0
	if tonumber(state) == 1 then
		if delete_name == "Dashboard" then
			uci:set("openclash", "config", "dashboard_type", "Official")
			uci:commit("openclash")
		elseif delete_name == "Yacd" then
			uci:set("openclash", "config", "yacd_type", "Official")
			uci:commit("openclash")
		end
		if fs.uci_get_config("config", "default_dashboard") == string.lower(delete_name) then
			uci:set("openclash", "config", "default_dashboard", "")
			uci:commit("openclash")
		end
	end
	HTTP.prepare_content("application/json")
	HTTP.write_json({
		delete_state = state;
	})
end

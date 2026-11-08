-- Shared environment for the JSON API modules.
-- Handlers live in small modules loaded on first use, so a request only parses what it calls.
local handlers = {
	action_add_subscription = "config",
	action_backup = "backup",
	action_backup_ex_core = "backup",
	action_backup_only_config = "backup",
	action_backup_only_core = "backup",
	action_backup_only_proxy = "backup",
	action_backup_only_rule = "backup",
	action_check_core = "update",
	action_close_all_connection = "status",
	action_config_file_list = "config",
	action_config_file_read = "config",
	action_config_file_save = "config",
	action_config_name = "status",
	action_config_stats = "status",
	action_conn_status = "status",
	action_coreupdate = "update",
	action_dashboard_type = "dashboard",
	action_default_dashboard = "dashboard",
	action_del_log = "logs",
	action_del_start_log = "logs",
	action_delete_dashboard = "dashboard",
	action_diag_connection = "logs",
	action_diag_dns = "logs",
	action_flush_dns_cache = "status",
	action_gen_debug_logs = "logs",
	action_get_debug_logs = "logs",
	action_get_run_mode = "status",
	action_last_version = "update",
	action_log_level = "status",
	action_oc_action = "status",
	action_oc_settings = "status",
	action_op_mode = "status",
	action_overwrite_file_list = "overwrite",
	action_overwrite_subscribe_info = "overwrite",
	action_refresh_log = "logs",
	action_reload_firewall = "status",
	action_remove_all_core = "update",
	action_restore_backup = "config",
	action_restore_config = "config",
	action_rule_mode = "status",
	action_runtime_stats = "status",
	action_save_corever_branch = "update",
	action_save_custom_addr = "update",
	action_save_github_address_mod = "update",
	action_start = "logs",
	action_status = "status",
	action_switch_config = "config",
	action_switch_dashboard = "dashboard",
	action_switch_log = "status",
	action_switch_mode = "status",
	action_switch_oc_setting = "status",
	action_switch_rule_mode = "status",
	action_switch_run_mode = "status",
	action_theme_get = "status",
	action_theme_save = "status",
	action_toolbar_show = "status",
	action_toolbar_show_sys = "status",
	action_update = "update",
	action_update_config = "config",
	action_upload_config = "config",
	action_upload_overwrite = "overwrite",
	action_version_history = "update",
	check_core = "common",
	cn_port = "common",
	config_name = "common",
	config_path = "common",
	core_api_get = "common",
	core_download = "update",
	corelv = "common",
	coremetacv = "common",
	coremodel = "common",
	coreup = "common",
	corever = "common",
	create_file = "config",
	daip = "common",
	dase = "common",
	dashboard_custom_clash_compatible = "common",
	dashboard_custom_url = "common",
	dashboard_forward_domain = "common",
	dashboard_forward_port = "common",
	dashboard_forward_ssl = "common",
	delete_overwrite_file = "overwrite",
	is_running = "common",
	is_safe_filename = "common",
	is_start = "common",
	kill_process = "common",
	ltn12_popen = "backup",
	mode = "common",
	opcv = "common",
	proc_core_cpu_percent = "common",
	proc_cpu_count = "common",
	proc_find_core_pid = "common",
	process_status = "logs",
	release_branch = "common",
	rename_file = "config",
	save_corever_branch = "update",
	service_running = "common",
	stream_log_and_parse = "logs",
	trans_line = "logs",
	try_read = "logs",
	write_padded = "logs",
	custom_file_get = "settings",
	custom_file_save = "settings",
	settings_get = "settings",
	settings_set = "settings"
}

local env = {}

setmetatable(env, { __index = function(t, k)
	local mod = handlers[k]
	if mod then
		require("luci.openclash.api." .. mod)
		return rawget(t, k)
	end
	if k == "ov" then
		local v = dofile("/usr/share/openclash/openclash_version.lua")
		rawset(t, k, v)
		return v
	end
	return _G[k]
end })

env.SYS = require "luci.sys"
env.HTTP = require "luci.http"
env.DISP = require "luci.dispatcher"
env.UTIL = require "luci.util"
env.fs = require "luci.openclash"
env.json = require "luci.jsonc"
env.uci = require("luci.model.uci").cursor()
env.datatype = env.fs.datatype
env.device_name = env.uci:get("system", "@system[0]", "hostname")
env.device_arh = env.SYS.exec("uname -m |tr -d '\\n'")
if pcall(require, "luci.model.ipkg") then
	env.opkg = require "luci.model.ipkg"
end
env.meta_core_path = env.fs.uci_get_config("config", "small_flash_memory") ~= "1"
	and "/etc/openclash/core/clash_meta" or "/tmp/etc/openclash/core/clash_meta"
env.CONFIG_PATH_PREFIX = "/etc/openclash/config/"
env.CONFIG_PATH_PREFIX_LEN = #env.CONFIG_PATH_PREFIX + 1
env.write_padded_first = true
env.START_SCRIPT_PATTERNS = {
	["init"] = { "/etc/init.d/[o]penclash" },
	["openclash.sh"] = { "[o]penclash\\.sh", "/etc/init\\.d/[o]penclash" },
	["openclash_core.sh"] = { "[o]penclash_core\\.sh", "/etc/init\\.d/[o]penclash" },
}

-- Upload handlers register a file handler before reading the form, so the body must not be
-- parsed yet. The token comes in the query string and is checked before any upload starts.
function env.require_token()
	local token = (env.HTTP.getenv("QUERY_STRING") or ""):match("token=(%x+)")
	if token and token == env.DISP.context.authtoken then
		return true
	end
	env.HTTP.status(403, "Forbidden")
	env.HTTP.prepare_content("application/json")
	env.HTTP.write_json({ error = "invalid token" })
	return false
end

return env

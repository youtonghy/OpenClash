-- Handlers are resolved through the API environment, so loading this file stays cheap.
-- require is captured first: inside module() it would resolve through the metatable below.
local require = require

module("luci.controller.openclash", package.seeall)

setmetatable(getfenv(1), { __index = function(_, k)
	return require("luci.openclash.api.env")[k]
end })

function index()
	if not nixio.fs.access("/etc/config/openclash") then
		return
	end

	local page = entry({"admin", "services", "openclash"}, template("openclash/app"), _("RouterClash"), 50)
	page.dependent = true
	page.acl_depends = { "luci-app-openclash" }

	entry({"admin", "services", "openclash", "conn_status"}, call("action_conn_status")).leaf = true
	entry({"admin", "services", "openclash", "status"}, call("action_status")).leaf = true
	entry({"admin", "services", "openclash", "device_names"}, call("action_device_names")).leaf = true
	entry({"admin", "services", "openclash", "startlog"}, call("action_start")).leaf = true
	entry({"admin", "services", "openclash", "refresh_log"}, call("action_refresh_log")).leaf = true
	entry({"admin", "services", "openclash", "del_log"}, post("action_del_log")).leaf = true
	entry({"admin", "services", "openclash", "del_start_log"}, post("action_del_start_log")).leaf = true
	entry({"admin", "services", "openclash", "close_all_connection"}, post("action_close_all_connection")).leaf = true
	entry({"admin", "services", "openclash", "reload_firewall"}, post("action_reload_firewall")).leaf = true
	entry({"admin", "services", "openclash", "save_corever_branch"}, post("action_save_corever_branch")).leaf = true
	entry({"admin", "services", "openclash", "update"}, call("action_update")).leaf = true
	entry({"admin", "services", "openclash", "last_version"}, call("action_last_version")).leaf = true
	entry({"admin", "services", "openclash", "coreupdate"}, post("action_coreupdate")).leaf = true
	entry({"admin", "services", "openclash", "flush_dns_cache"}, post("action_flush_dns_cache")).leaf = true
	entry({"admin", "services", "openclash", "update_config"}, post("action_update_config")).leaf = true
	entry({"admin", "services", "openclash", "restore"}, post("action_restore_config")).leaf = true
	entry({"admin", "services", "openclash", "backup"}, call("action_backup")).leaf = true
	entry({"admin", "services", "openclash", "backup_ex_core"}, call("action_backup_ex_core")).leaf = true
	entry({"admin", "services", "openclash", "backup_only_core"}, call("action_backup_only_core")).leaf = true
	entry({"admin", "services", "openclash", "backup_only_config"}, call("action_backup_only_config")).leaf = true
	entry({"admin", "services", "openclash", "backup_only_rule"}, call("action_backup_only_rule")).leaf = true
	entry({"admin", "services", "openclash", "backup_only_proxy"}, call("action_backup_only_proxy")).leaf = true
	entry({"admin", "services", "openclash", "remove_all_core"}, post("action_remove_all_core")).leaf = true
	entry({"admin", "services", "openclash", "switch_mode"}, post("action_switch_mode")).leaf = true
	entry({"admin", "services", "openclash", "op_mode"}, call("action_op_mode")).leaf = true
	entry({"admin", "services", "openclash", "config_name"}, call("action_config_name")).leaf = true
	entry({"admin", "services", "openclash", "switch_config"}, post("action_switch_config")).leaf = true
	entry({"admin", "services", "openclash", "toolbar_show"}, call("action_toolbar_show")).leaf = true
	entry({"admin", "services", "openclash", "toolbar_show_sys"}, call("action_toolbar_show_sys")).leaf = true
	entry({"admin", "services", "openclash", "diag_connection"}, call("action_diag_connection")).leaf = true
	entry({"admin", "services", "openclash", "diag_dns"}, call("action_diag_dns")).leaf = true
	entry({"admin", "services", "openclash", "gen_debug_logs"}, post("action_gen_debug_logs")).leaf = true
	entry({"admin", "services", "openclash", "get_debug_logs"}, call("action_get_debug_logs")).leaf = true
	entry({"admin", "services", "openclash", "log_level"}, call("action_log_level")).leaf = true
	entry({"admin", "services", "openclash", "switch_log"}, post("action_switch_log")).leaf = true
	entry({"admin", "services", "openclash", "rule_mode"}, call("action_rule_mode")).leaf = true
	entry({"admin", "services", "openclash", "switch_rule_mode"}, post("action_switch_rule_mode")).leaf = true
	entry({"admin", "services", "openclash", "switch_run_mode"}, post("action_switch_run_mode")).leaf = true
	entry({"admin", "services", "openclash", "dashboard_type"}, call("action_dashboard_type")).leaf = true
	entry({"admin", "services", "openclash", "switch_dashboard"}, post("action_switch_dashboard")).leaf = true
	entry({"admin", "services", "openclash", "delete_dashboard"}, post("action_delete_dashboard")).leaf = true
	entry({"admin", "services", "openclash", "default_dashboard"}, post("action_default_dashboard")).leaf = true
	entry({"admin", "services", "openclash", "get_run_mode"}, call("action_get_run_mode")).leaf = true
	entry({"admin", "services", "openclash", "create_file"}, post("create_file")).leaf = true
	entry({"admin", "services", "openclash", "rename_file"}, post("rename_file")).leaf = true
	entry({"admin", "services", "openclash", "check_core"}, call("action_check_core")).leaf = true
	entry({"admin", "services", "openclash", "core_download"}, post("core_download")).leaf = true
	entry({"admin", "services", "openclash", "version_history"}, call("action_version_history")).leaf = true
	entry({"admin", "services", "openclash", "save_github_address_mod"}, post("action_save_github_address_mod")).leaf = true
	entry({"admin", "services", "openclash", "save_custom_addr"}, post("action_save_custom_addr")).leaf = true
	entry({"admin", "services", "openclash", "oc_settings"}, call("action_oc_settings")).leaf = true
	entry({"admin", "services", "openclash", "switch_oc_setting"}, post("action_switch_oc_setting")).leaf = true
	entry({"admin", "services", "openclash", "action"}, post("action_oc_action")).leaf = true
	entry({"admin", "services", "openclash", "config_file_list"}, call("action_config_file_list")).leaf = true
	entry({"admin", "services", "openclash", "config_file_read"}, call("action_config_file_read")).leaf = true
	entry({"admin", "services", "openclash", "config_file_save"}, call("action_config_file_save")).leaf = true
	entry({"admin", "services", "openclash", "upload_config"}, call("action_upload_config")).leaf = true
	entry({"admin", "services", "openclash", "restore_backup"}, call("action_restore_backup")).leaf = true
	entry({"admin", "services", "openclash", "add_subscription"}, post("action_add_subscription")).leaf = true
	entry({"admin", "services", "openclash", "config_stats"}, call("action_config_stats")).leaf = true
	entry({"admin", "services", "openclash", "runtime_stats"}, call("action_runtime_stats")).leaf = true
	entry({"admin", "services", "openclash", "upload_overwrite"}, call("action_upload_overwrite")).leaf = true
	entry({"admin", "services", "openclash", "overwrite_subscribe_info"}, call("action_overwrite_subscribe_info")).leaf = true
	entry({"admin", "services", "openclash", "overwrite_file_list"}, call("action_overwrite_file_list")).leaf = true
	entry({"admin", "services", "openclash", "delete_overwrite_file"}, post("delete_overwrite_file")).leaf = true
	entry({"admin", "services", "openclash", "theme_get"}, call("action_theme_get")).leaf = true
	entry({"admin", "services", "openclash", "theme_save"}, post("action_theme_save")).leaf = true
	entry({"admin", "services", "openclash", "kill_switch_action"}, post("kill_switch_action")).leaf = true
	entry({"admin", "services", "openclash", "settings_get"}, call("settings_get")).leaf = true
	entry({"admin", "services", "openclash", "settings_set"}, post("settings_set")).leaf = true
	entry({"admin", "services", "openclash", "custom_file_get"}, call("custom_file_get")).leaf = true
	entry({"admin", "services", "openclash", "custom_file_save"}, post("custom_file_save")).leaf = true
end

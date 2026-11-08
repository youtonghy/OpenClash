setfenv(1, require "luci.openclash.api.env")

function action_flush_dns_cache()
	local fake_ip_state = ""
	local dns_state = ""
	if is_running() then
		local daip = daip()
		local dase = dase() or ""
		local cn_port = cn_port()
		if daip and cn_port then
			fake_ip_state = SYS.exec(string.format('curl -sL -m 3 --retry 2 -H "Content-Type: application/json" -H "Authorization: Bearer %s" -XPOST http://"%s":"%s"/cache/fakeip/flush', dase, daip, cn_port))
			dns_state = SYS.exec(string.format('curl -sL -m 3 --retry 2 -H "Content-Type: application/json" -H "Authorization: Bearer %s" -XPOST http://"%s":"%s"/cache/dns/flush', dase, daip, cn_port))
		end
	end
	HTTP.prepare_content("application/json")
	HTTP.write_json({
		fakeip_flush = fake_ip_state;
		dns_flush = dns_state;
		flush_status = (fake_ip_state == "" and dns_state == "") and "" or (fake_ip_state ~= "" and fake_ip_state or dns_state);
	})
end

function action_rule_mode(internal)
	local mode
	if is_running() then
		local daip_val = daip()
		local dase_val = dase() or ""
		local cn_port_val = cn_port()
		if daip_val and cn_port_val then
			local info = json.parse(SYS.exec(string.format(
				'curl -sL -m 3 --retry 2 -H "Content-Type: application/json" -H "Authorization: Bearer %s" -XGET http://"%s":"%s"/configs',
				dase_val, daip_val, cn_port_val)))
			if info and info["mode"] then
				mode = info["mode"]
			end
		end
	end
	mode = mode or fs.uci_get_config("config", "proxy_mode") or "rule"
	if internal then return { mode = mode } end
	HTTP.prepare_content("application/json")
	HTTP.write_json({ mode = mode })
end

function action_switch_rule_mode()
	local mode, info
	local daip = daip()
	local dase = dase() or ""
	local cn_port = cn_port()
	mode = HTTP.formvalue("rule_mode")

	if not mode then
		HTTP.status(500, "Missing parameters")
		return
	end

	if is_running() then
		if not daip or not cn_port then HTTP.status(500, "Switch Failed") return end
		info = SYS.exec(string.format('curl -sL -m 3 --retry 2 -H "Content-Type: application/json" -H "Authorization: Bearer %s" -XPATCH http://"%s":"%s"/configs -d \'{\"mode\": \"%s\"}\'', dase, daip, cn_port, mode))
		if info ~= "" then
			HTTP.status(500, "Switch Failed")
		end
		HTTP.prepare_content("application/json")
		HTTP.write_json({
			info = info;
		})
	end
	uci:set("openclash", "config", "proxy_mode", mode)
	uci:set("openclash", "@overwrite[0]", "proxy_mode", mode)
	uci:commit("openclash")
end

function action_get_run_mode()
	if mode() then
		HTTP.prepare_content("application/json")
		HTTP.write_json({
			mode = mode();
		})
	else
		HTTP.status(500, "Get Failed")
		return
	end
end

function action_switch_run_mode()
	local mode, operation_mode
	mode = HTTP.formvalue("run_mode")
	operation_mode = fs.uci_get_config("config", "operation_mode")
	if operation_mode == "redir-host" then
		uci:set("openclash", "config", "en_mode", "redir-host"..mode)
		uci:set("openclash", "@overwrite[0]", "en_mode", "redir-host"..mode)
	elseif operation_mode == "fake-ip" then
		uci:set("openclash", "config", "en_mode", "fake-ip"..mode)
		uci:set("openclash", "@overwrite[0]", "en_mode", "fake-ip"..mode)
	end
	uci:commit("openclash")
	if is_running() then
		SYS.exec("/etc/init.d/openclash restart >/dev/null 2>&1")
	end
end

function action_log_level()
	local level, info
	if is_running() then
		local daip = daip()
		local dase = dase() or ""
		local cn_port = cn_port()
		if not daip or not cn_port then return end
		info = json.parse(SYS.exec(string.format('curl -sL -m 3 --retry 2 -H "Content-Type: application/json" -H "Authorization: Bearer %s" -XGET http://"%s":"%s"/configs', dase, daip, cn_port)))
		if info then
			level = info["log-level"]
		else
			level = fs.uci_get_config("config", "log_level") or "info"
		end
	else
		level = fs.uci_get_config("config", "log_level") or "info"
	end
	HTTP.prepare_content("application/json")
	HTTP.write_json({
		log_level = level;
	})
end

function action_switch_log()
	local level, info
	if is_running() then
		local daip = daip()
		local dase = dase() or ""
		local cn_port = cn_port()
		level = HTTP.formvalue("log_level")
		if not daip or not cn_port or not level then HTTP.status(500, "Switch Failed") return end
		info = SYS.exec(string.format('curl -sL -m 3 --retry 2 -H "Content-Type: application/json" -H "Authorization: Bearer %s" -XPATCH http://"%s":"%s"/configs -d \'{\"log-level\": \"%s\"}\'', dase, daip, cn_port, level))
		if info ~= "" then
			HTTP.status(500, "Switch Failed")
		end
	else
		HTTP.status(500, "Switch Failed")
	end
	HTTP.prepare_content("application/json")
	HTTP.write_json({
		info = info;
	})
end

function action_toolbar_show_sys()
	local cpu = "0"
	local load_avg = "0"
	local cpu_count = proc_cpu_count()
	local pid = proc_find_core_pid()

	if pid and pid ~= "" then
		local usage = proc_core_cpu_percent(pid)
		if usage then
			cpu = usage
		end

		local loadavg = nixio.fs.readfile("/proc/loadavg")
		if loadavg then
			load_avg = loadavg:match("^%S+%s+(%S+)") or "0"
		end

		if not string.match(load_avg, "^[0-9]*%.?[0-9]*$") then
			load_avg = "0"
		end
	end

	HTTP.prepare_content("application/json")
	HTTP.write_json({
		cpu = tostring(cpu),
		load_avg = tostring(tonumber(load_avg) / tonumber(cpu_count) * 100);
	})
end

function action_toolbar_show()
	local pid = proc_find_core_pid()
	local traffic, connections, connection, up, down, up_total, down_total, mem, cpu, load_avg, cpu_count
	connection = "0"
	up = "0"
	down = "0"
	up_total = "0"
	down_total = "0"
	mem = 0
	cpu = 0
	load_avg = "0"
	cpu_count = proc_cpu_count()
	if pid and pid ~= "" then
		local daip = daip()
		local dase = dase() or ""
		local cn_port = cn_port()
		if not daip or not cn_port then return end

		-- Parallel curl helper
		local function fork_curl(endpoint)
			local fdi, fdo = nixio.pipe()
			if not fdi or not fdo then return nil end
			local cmd = string.format(
				'curl -sL -m 3 -H "Content-Type: application/json" -H "Authorization: Bearer %s" -XGET "http://%s:%s/%s"',
				dase, daip, cn_port, endpoint
			)
			local child = nixio.fork()
			if child > 0 then
				fdo:close()
				return {pid = child, fdi = fdi, buf = ""}
			elseif child == 0 then
				nixio.dup(fdo, nixio.stdout)
				fdi:close()
				fdo:close()
				nixio.exec("/bin/sh", "-c", cmd)
			else
				if fdi then fdi:close() end
				if fdo then fdo:close() end
				return nil
			end
		end

		local t_job = fork_curl("traffic")
		local c_job = fork_curl("connections")

		if t_job and c_job then
			local t_done, c_done = false, false
			local delay = 50000000
			local max_wait = 40
			for _ = 1, max_wait do
				if not t_done then
					local buf = try_read(t_job.fdi, 4096)
					if buf then t_job.buf = t_job.buf .. buf end
					if nixio.waitpid(t_job.pid, "nohang") then
						while true do
							local b = try_read(t_job.fdi, 4096)
							if not b then break end
							t_job.buf = t_job.buf .. b
						end
						pcall(t_job.fdi.close, t_job.fdi)
						t_done = true
					end
				end
				if not c_done then
					local buf = try_read(c_job.fdi, 4096)
					if buf then c_job.buf = c_job.buf .. buf end
					if nixio.waitpid(c_job.pid, "nohang") then
						while true do
							local b = try_read(c_job.fdi, 4096)
							if not b then break end
							c_job.buf = c_job.buf .. b
						end
						pcall(c_job.fdi.close, c_job.fdi)
						c_done = true
					end
				end
				if t_done and c_done then break end
				nixio.nanosleep(0, delay)
				delay = math.min(delay * 2, 200000000)
			end
			if not t_done then
				pcall(t_job.fdi.close, t_job.fdi)
				nixio.kill(t_job.pid, 9)
			end
			if not c_done then
				pcall(c_job.fdi.close, c_job.fdi)
				nixio.kill(c_job.pid, 9)
			end
			traffic = t_done and t_job.buf ~= "" and json.parse(t_job.buf) or nil
			connections = c_done and c_job.buf ~= "" and json.parse(c_job.buf) or nil
		else
			if t_job then pcall(t_job.fdi.close, t_job.fdi) end
			if c_job then pcall(c_job.fdi.close, c_job.fdi) end
			traffic = json.parse(SYS.exec(string.format('curl -sL -m 3 --retry 2 -H "Content-Type: application/json" -H "Authorization: Bearer %s" -XGET http://"%s":"%s"/traffic', dase, daip, cn_port)))
			connections = json.parse(SYS.exec(string.format('curl -sL -m 3 --retry 2 -H "Content-Type: application/json" -H "Authorization: Bearer %s" -XGET http://"%s":"%s"/connections', dase, daip, cn_port)))
		end

		if traffic and connections and connections.connections then
			connection = #(connections.connections)
			up = traffic.up
			down = traffic.down
			up_total = connections.uploadTotal
			down_total = connections.downloadTotal
		else
			up = "0"
			down = "0"
			up_total = "0"
			down_total = "0"
			connection = "0"
		end

		mem = tonumber(SYS.exec(string.format("cat /proc/%s/status 2>/dev/null |grep -w VmRSS |awk '{print $2}'", pid)))
		cpu = proc_core_cpu_percent(pid)

		if mem then
			mem = mem * 1024
		else
			mem = 0
		end
		cpu = cpu or 0

		load_avg = SYS.exec("awk '{print $2; exit}' /proc/loadavg 2>/dev/null"):gsub("\n", "") or "0"
		cpu_count = SYS.exec("grep -c ^processor /proc/cpuinfo 2>/dev/null"):gsub("\n", "") or 1

		if not string.match(load_avg, "^[0-9]*%.?[0-9]*$") then
			load_avg = "0"
		end
	end

	HTTP.prepare_content("application/json")
	HTTP.write_json({
		connections = connection,
		up = up,
		down = down,
		up_total = up_total,
		down_total = down_total,
		mem = mem,
		cpu = tostring(cpu),
		load_avg = tostring(tonumber(load_avg) / tonumber(cpu_count) * 100);
	})
end

function action_config_name()
	HTTP.prepare_content("application/json")
	HTTP.write_json({
		config_name = config_name(),
		config_path = config_path();
	})
end

function action_op_mode()
	local op_mode = fs.uci_get_config("config", "operation_mode")
	HTTP.prepare_content("application/json")
	HTTP.write_json({
		op_mode = op_mode;
	})
end

function action_switch_mode()
	local switch_mode = fs.uci_get_config("config", "operation_mode")
	if switch_mode == "redir-host" then
		uci:set("openclash", "config", "operation_mode", "fake-ip")
		uci:commit("openclash")
	else
		uci:set("openclash", "config", "operation_mode", "redir-host")
		uci:commit("openclash")
	end
	HTTP.prepare_content("application/json")
	HTTP.write_json({
		switch_mode = switch_mode;
	})
end

function action_conn_status(internal)
	local data = {
		clash = uci:get("openclash", "config", "enable") == "1",
		daip = daip(),
		dase = dase(),
		-- Keep the misspelled JSON keys for compatibility with existing views.
		db_foward_port = dashboard_forward_port(),
		db_foward_domain = dashboard_forward_domain(),
		db_forward_ssl = dashboard_forward_ssl(),
		cn_port = cn_port()
	}
	if internal then return data end
	HTTP.prepare_content("application/json")
	HTTP.write_json(data)
end

function action_status()
	local status_data = action_conn_status(true)
	local rule_data = action_rule_mode(true)
	local oc_data = action_oc_settings(true)

	local result = {
		-- status fields
		clash = status_data.clash,
		daip = status_data.daip,
		dase = status_data.dase,
		db_foward_port = status_data.db_foward_port,
		db_foward_domain = status_data.db_foward_domain,
		db_forward_ssl = status_data.db_forward_ssl,
		dashboard_custom_url = dashboard_custom_url(),
		dashboard_custom_clash_compatible = dashboard_custom_clash_compatible(),
		cn_port = status_data.cn_port,
		yacd = fs.isdirectory("/usr/share/openclash/ui/yacd"),
		dashboard = fs.isdirectory("/usr/share/openclash/ui/dashboard"),
		metacubexd = fs.isdirectory("/usr/share/openclash/ui/metacubexd"),
		zashboard = fs.isdirectory("/usr/share/openclash/ui/zashboard"),
		core_type = fs.uci_get_config("config", "core_type") or "Meta",
		core_running = is_running(),
		kill_switch = uci:get("openclash", "config", "kill_switch") ~= "0",
		kill_switch_state = (nixio.fs.readfile("/var/run/openclash_ks.state") or ""):gsub("%s+", ""),
		-- run_mode
		run_mode = mode(),
		-- rule_mode
		rule_mode = rule_data.mode,
		-- oc_settings
		meta_sniffer = oc_data.meta_sniffer,
		respect_rules = oc_data.respect_rules,
		oversea = oc_data.oversea,
		mixed_port = fs.uci_get_config("config", "mixed_port") or "7893",
	}

	HTTP.prepare_content("application/json")
	HTTP.write_json(result)
end

function action_close_all_connection()
	return SYS.call("sh /usr/share/openclash/openclash_history_get.sh 'close_all_conection'")
end

function action_reload_firewall()
	return SYS.call("/etc/init.d/openclash reload 'manual' >/dev/null 2>&1 &")
end

function action_oc_settings(internal)
	local result = {
		meta_sniffer = "0",
		respect_rules = "0",
		oversea = "0"
	}

	local meta_sniffer = fs.uci_get_config("config", "enable_meta_sniffer")
	if meta_sniffer == "1" then
		result.meta_sniffer = "1"
	end

	local respect_rules = fs.uci_get_config("config", "enable_respect_rules")
	if respect_rules == "1" then
		result.respect_rules = "1"
	end

	local oversea = fs.uci_get_config("config", "china_ip_route")
	if oversea == "1" then
		result.oversea = "1"
	elseif oversea == "2" then
		result.oversea = "2"
	else
		result.oversea = "0"
	end

	if internal then return result end
	HTTP.prepare_content("application/json")
	HTTP.write_json(result)
end

function action_switch_oc_setting()
	local setting = HTTP.formvalue("setting")
	local value = HTTP.formvalue("value")

	if not setting or not value then
		HTTP.status(500, "Missing parameters")
		return
	end

	local function get_runtime_config_path()
		local config_path = fs.uci_get_config("config", "config_path")
		if not config_path then
			return nil
		end
		local config_filename = fs.basename(config_path)
		return "/etc/openclash/" .. config_filename
	end

	local function update_runtime_config(ruby_cmd)
		local runtime_config_path = get_runtime_config_path()
		if not runtime_config_path then
			HTTP.status(500, "No config path found")
			return false
		end

		local ruby_result = SYS.call(ruby_cmd)
		if ruby_result ~= 0 then
			HTTP.status(500, "Failed to modify config file")
			return false
		end

		local daip = daip()
		local dase = dase() or ""
		local cn_port = cn_port()
		if not daip or not cn_port then
			HTTP.status(500, "Switch Failed")
			return false
		end

		local reload_result = SYS.exec(string.format('curl -sL -m 5 --connect-timeout 2 --retry 2 -H "Content-Type: application/json" -H "Authorization: Bearer %s" -XPUT http://"%s":"%s"/configs?force=true -d \'{"path":"%s"}\' 2>&1', dase, daip, cn_port, runtime_config_path))

		if reload_result ~= "" then
			HTTP.status(500, "Switch Failed")
			return false
		end

		return true
	end

	if setting == "meta_sniffer" then
		if is_running() then
			local runtime_config_path = get_runtime_config_path()
			local ruby_cmd

			if value == "1" then
				ruby_cmd = string.format([[
					ruby -ryaml -rYAML -I "/usr/share/openclash" -E UTF-8 -e "
					begin
						config_path = '%s'

						config = File.exist?(config_path) ? YAML.load_file(config_path) : {}
						config ||= {}

						if config['sniffer']&.dig('enable') == true &&
						   config['sniffer']&.dig('parse-pure-ip') == true &&
						   config['sniffer']&.dig('sniff')
							exit 0
						end

						config['sniffer'] = {
							'enable' => true,
							'parse-pure-ip' => true,
							'override-destination' => false
						}

						custom_sniffer_path = '/etc/openclash/custom/openclash_custom_sniffer.yaml'
						if File.exist?(custom_sniffer_path)
							begin
								custom_sniffer = YAML.load_file(custom_sniffer_path)
								if custom_sniffer&.dig('sniffer')
									config['sniffer'].merge!(custom_sniffer['sniffer'])
								end
							rescue
							end
						end

						unless config['sniffer']['sniff']
							config['sniffer']['sniff'] = {
								'QUIC' => { 'ports' => [443] },
								'TLS' => { 'ports' => [443, '8443'] },
								'HTTP' => { 'ports' => [80, '8080-8880'], 'override-destination' => false }
							}
						end

						unless config['sniffer']['force-domain']
							config['sniffer']['force-domain'] = ['+.netflix.com', '+.nflxvideo.net', '+.amazonaws.com']
						end

						unless config['sniffer']['skip-domain']
							config['sniffer']['skip-domain'] = ['+.apple.com', 'Mijia Cloud', 'dlg.io.mi.com']
						end

						YAML.dump(config, config_path)

					rescue => e
						exit 1
					end
					" 2>/dev/null
				]], runtime_config_path)
			else
				ruby_cmd = string.format([[
					ruby -ryaml -rYAML -I "/usr/share/openclash" -E UTF-8 -e "
					begin
						config_path = '%s'

						if File.exist?(config_path)
							config = YAML.load_file(config_path)
							if config&.dig('sniffer', 'enable') == false
								exit 0
							end
						else
							config = {}
						end

						config ||= {}
						config['sniffer'] = { 'enable' => false }

						YAML.dump(config, config_path)

					rescue => e
						exit 1
					end
					" 2>/dev/null
				]], runtime_config_path)
			end

			if not update_runtime_config(ruby_cmd) then
				return
			end
		end
		uci:set("openclash", "config", "enable_meta_sniffer", tonumber(value))
		uci:set("openclash", "config", "enable_meta_sniffer_pure_ip", tonumber(value))
		uci:set("openclash", "@overwrite[0]", "enable_meta_sniffer", tonumber(value))
		uci:set("openclash", "@overwrite[0]", "enable_meta_sniffer_pure_ip", tonumber(value))
		uci:commit("openclash")
	elseif setting == "respect_rules" then
		if is_running() then
			local runtime_config_path = get_runtime_config_path()
			local target_value = (value == "1") and "true" or "false"

			local ruby_cmd = string.format([[
				ruby -ryaml -rYAML -I "/usr/share/openclash" -E UTF-8 -e "
				begin
					config_path = '%s'
					target_value = %s

					if File.exist?(config_path)
						config = YAML.load_file(config_path)
						if config&.dig('dns', 'respect-rules') == target_value
							if target_value == true && (!config&.dig('dns', 'proxy-server-nameserver') || config['dns']['proxy-server-nameserver'].empty?)
							else
								exit 0
							end
						end
					else
						config = {}
					end

					config ||= {}
					config['dns'] ||= {}
					config['dns']['respect-rules'] = target_value

					if target_value == true
						if !config['dns']['proxy-server-nameserver'] || config['dns']['proxy-server-nameserver'].empty?
							config['dns']['proxy-server-nameserver'] = ['114.114.114.114', '119.29.29.29', '8.8.8.8', '1.1.1.1']
						end
					end

					YAML.dump(config, config_path)

				rescue => e
					exit 1
				end
				" 2>/dev/null
			]], runtime_config_path, target_value)

			if not update_runtime_config(ruby_cmd) then
				return
			end
		end
		uci:set("openclash", "config", "enable_respect_rules", tonumber(value))
		uci:set("openclash", "@overwrite[0]", "enable_respect_rules", tonumber(value))
		uci:commit("openclash")
	elseif setting == "oversea" then
		oversea_v6_setting = fs.uci_get_config("config", "ipv6_enable") or "0"
		if oversea_v6_setting ~= "0" then
			uci:set("openclash", "config", "china_ip6_route", value)
		end
		uci:set("openclash", "config", "china_ip_route", value)
		uci:commit("openclash")
		if is_running() then
			if oversea_v6_setting ~= "0" then
				uci:set("openclash", "@overwrite[0]", "china_ip6_route", value)
			end
			uci:set("openclash", "@overwrite[0]", "china_ip_route", value)
			uci:commit("openclash")
			SYS.exec("/etc/init.d/openclash restart >/dev/null 2>&1")
		end
	else
		HTTP.status(500, "Invalid setting")
		return
	end

	HTTP.prepare_content("application/json")
	HTTP.write_json({
		status = "success",
		setting = setting,
		value = value
	})
end

function action_oc_action()
	local action = HTTP.formvalue("action")
	local config_file = HTTP.formvalue("config_file")

	if not action then
		HTTP.status(500, "Missing action parameter")
		return
	end

	if config_file and config_file ~= "" then
		local config_path = "/etc/openclash/config/" .. config_file
		if not fs.access(config_path) then
			HTTP.status(500, "Config file not found")
			return
		end

		if uci:get("openclash", "config", "config_path") ~= config_path then
			uci:set("openclash", "config", "config_path", config_path)
		end
	end

	if action == "start" then
		if uci:get("openclash", "config", "enable") ~= "1" then
			uci:set("openclash", "config", "enable", "1")
			uci:commit("openclash")
		end
		if not is_running() then
			kill_process()
			SYS.call("/etc/init.d/openclash start >/dev/null 2>&1")
		else
			SYS.call("/etc/init.d/openclash restart >/dev/null 2>&1")
		end
	elseif action == "stop" then
		if uci:get("openclash", "config", "enable") ~= "0" then
			uci:set("openclash", "config", "enable", "0")
			uci:commit("openclash")
		end
		kill_process()
		SYS.call("/etc/init.d/openclash stop >/dev/null 2>&1")
	elseif action == "restart" then
		if uci:get("openclash", "config", "enable") ~= "1" then
			uci:set("openclash", "config", "enable", "1")
			uci:commit("openclash")
		end
		kill_process()
		SYS.call("/etc/init.d/openclash restart >/dev/null 2>&1")
	else
		HTTP.status(500, "Invalid action parameter")
		return
	end

	HTTP.prepare_content("application/json")
	HTTP.write_json({status = "success", action = action})
end

function action_config_stats()
	local filename = HTTP.formvalue("filename")
	HTTP.prepare_content("application/json")

	if not filename or filename == "" then
		HTTP.write_json({ status = "error", message = "Missing filename" })
		return
	end

	local base = filename:match("([^/]+)$")
	if not base or not is_safe_filename(base) then
		HTTP.write_json({ status = "error", message = "Invalid filename" })
		return
	end

	local path = "/etc/openclash/config/" .. base
	if not fs.access(path) and not base:match("%.ya?ml$") then
		path = path .. ".yaml"
	end
	if not fs.access(path) then
		HTTP.write_json({ status = "error", message = "Config file not found" })
		return
	end

	-- a running config is answered by the core; static=1 parses the stored file instead (core unreachable)
	local active_path = fs.uci_get_config("config", "config_path")
	if active_path == path and HTTP.formvalue("static") ~= "1" then
		local st = fs.stat(path)
		HTTP.write_json({
			status = "success",
			active = true,
			size = (st and st.size) or 0,
			mtime = (st and st.mtime) and os.date("%Y-%m-%d %H:%M:%S", st.mtime) or ""
		})
		return
	end

	local stats = SYS.exec(string.format("/usr/share/openclash/yml_stats_get.sh %s 2>/dev/null", UTIL.shellquote(path)))
	stats = stats:gsub("%s+$", "")
	if stats == "" or not stats:find("{", 1, true) then
		HTTP.write_json({ status = "error", message = "Stats unavailable" })
		return
	end
	local decoded = json.parse(stats)
	if decoded and type(decoded) == "table" then
		local st = fs.stat(path)
		decoded.size = (st and st.size) or 0
		HTTP.write_json(decoded)
	else
		HTTP.write(stats)
	end
end

function action_runtime_stats()
	HTTP.prepare_content("application/json")

	local service_up = service_running()
	local offline = { status = "success", online = false }
	if service_up ~= nil then offline.service_running = service_up end

	if not is_running() then
		HTTP.write_json(offline)
		return
	end

	local version_data = nil
	local version_raw = core_api_get("/version")
	if version_raw and version_raw:find("version") then
		version_data = json.parse(version_raw)
	end
	if not version_data then
		HTTP.write_json(offline)
		return
	end

	local result = {
		status = "success",
		online = true,
		version = version_data.version or "",
		nodes = { total = 0, types = {} },
		rules = { total = 0, types = {} },
		providers = { total = 0, items = {} }
	}
	if service_up ~= nil then result.service_running = service_up end

	local proxies_raw = core_api_get("/proxies")
	local proxies = proxies_raw and json.parse(proxies_raw) or nil
	if proxies and type(proxies.proxies) == "table" then
		-- the core reports group types in CamelCase without dashes (Selector, URLTest, ...)
		local group_types = { select = true, urltest = true, fallback = true, loadbalance = true, smart = true, relay = true, selector = true }
		local builtin_types = { direct = true, reject = true, rejectdrop = true, pass = true, passrule = true, compatible = true }
		local group_names = {}
		for name, p in pairs(proxies.proxies) do
			local t = string.lower(p.type or "")
			if group_types[(t:gsub("%-", ""))] and name ~= "GLOBAL" then
				group_names[name] = true
			end
		end
		for name, p in pairs(proxies.proxies) do
			-- provider nodes are not listed in /proxies, the rest are groups and builtin entries
			local t = p.type or "unknown"
			local tk = string.lower(t):gsub("%-", "")
			if name ~= "GLOBAL" and not group_names[name] and not builtin_types[tk] then
				result.nodes.total = result.nodes.total + 1
				result.nodes.types[t] = (result.nodes.types[t] or 0) + 1
			end
		end
		local ref_counts = {}
		for name, p in pairs(proxies.proxies) do
			if group_names[name] and type(p.all) == "table" then
				local seen = {}
				for _, m in ipairs(p.all) do
					if type(m) == "string" and m ~= name and group_names[m] and not seen[m] then
						seen[m] = true
						ref_counts[m] = (ref_counts[m] or 0) + 1
					end
				end
			end
		end
		local groups_out = {}
		for name, p in pairs(proxies.proxies) do
			if group_names[name] and type(p.all) == "table" then
				local members, seen = {}, {}
				local node_count = 0
				for _, m in ipairs(p.all) do
					if type(m) == "string" and m ~= name and not seen[m] then
						seen[m] = true
						if m == "DIRECT" then
							members[#members + 1] = { k = "direct", v = "DIRECT" }
						elseif m:match("^REJECT") or m == "PASS" then
							members[#members + 1] = { k = "reject", v = m }
						elseif group_names[m] then
							members[#members + 1] = { k = "ref", v = m }
						else
							node_count = node_count + 1
						end
					end
				end
				if node_count > 0 then
					members[#members + 1] = { k = "nodes", v = node_count }
				end
				groups_out[#groups_out + 1] = { n = name, t = p.type, refs = ref_counts[name] or 0, members = members }
			end
		end
		table.sort(groups_out, function(a, b)
			if a.refs ~= b.refs then return a.refs > b.refs end
			return a.n < b.n
		end)
		result.structure = result.structure or {}
		result.structure.groups = groups_out
	end

	local rules_raw = core_api_get("/rules")
	local rules = rules_raw and json.parse(rules_raw) or nil
	if rules and type(rules.rules) == "table" then
		result.rules.total = #rules.rules
		-- map the core's CamelCase types (DomainSuffix / RuleSet) back to the config
		-- spelling so both stats sources feed the same charts
		local rule_type_names = {
			domain = "DOMAIN", domainsuffix = "DOMAIN-SUFFIX", domainkeyword = "DOMAIN-KEYWORD",
			domainregex = "DOMAIN-REGEX", domainwildcard = "DOMAIN-WILDCARD", geosite = "GEOSITE",
			geoip = "GEOIP", srcgeoip = "SRC-GEOIP", ipasn = "IP-ASN", srcipasn = "SRC-IP-ASN",
			ipcidr = "IP-CIDR", srcipcidr = "SRC-IP-CIDR", ipsuffix = "IP-SUFFIX", srcipsuffix = "SRC-IP-SUFFIX",
			srcport = "SRC-PORT", dstport = "DST-PORT", inport = "IN-PORT", dscp = "DSCP",
			inuser = "IN-USER", inname = "IN-NAME", intype = "IN-TYPE",
			processname = "PROCESS-NAME", processpath = "PROCESS-PATH",
			processnameregex = "PROCESS-NAME-REGEX", processpathregex = "PROCESS-PATH-REGEX",
			processnamewildcard = "PROCESS-NAME-WILDCARD", processpathwildcard = "PROCESS-PATH-WILDCARD",
			rematchname = "REMATCH-NAME", ruleset = "RULE-SET", match = "MATCH", network = "NETWORK",
			uid = "UID", ["and"] = "AND", ["or"] = "OR", ["not"] = "NOT",
		}
		local targets, order = {}, {}
		for _, r in ipairs(rules.rules) do
			local raw_type = type(r) == "table" and type(r.type) == "string" and r.type or ""
			local tkey = raw_type ~= "" and (string.lower(raw_type):gsub("[^%w]", "")) or ""
			local tname = rule_type_names[tkey]
			if tname then
				result.rules.types[tname] = (result.rules.types[tname] or 0) + 1
			elseif raw_type ~= "" then
				result.rules.types[raw_type] = (result.rules.types[raw_type] or 0) + 1
			end
			local target = type(r) == "table" and r.proxy or nil
			if type(target) == "string" and target ~= "" then
				local entry = targets[target]
				if not entry then
					entry = { t = target, c = 0, sets = {}, rules = {} }
					targets[target] = entry
					order[#order + 1] = target
				end
				entry.c = entry.c + 1
				local label = type(r.payload) == "string" and r.payload or ""
				if tkey == "ruleset" then
					if #entry.sets < 48 and label ~= "" then
						entry.sets[#entry.sets + 1] = label
					end
				elseif #entry.rules < 48 and label ~= "" then
					entry.rules[#entry.rules + 1] = label
				end
			end
		end
		local target_list = {}
		for _, name in ipairs(order) do
			target_list[#target_list + 1] = targets[name]
		end
		result.structure = result.structure or {}
		result.structure.rules = { targets = target_list }
	end

	local rprov_raw = core_api_get("/providers/rules")
	local rprov = rprov_raw and json.parse(rprov_raw) or nil
	if rprov and type(rprov.providers) == "table" then
		local prov_count = 0
		for _ in pairs(rprov.providers) do
			prov_count = prov_count + 1
		end
		result.rules.sets = prov_count
	end

	local prov_raw = core_api_get("/providers/proxies")
	local prov = prov_raw and json.parse(prov_raw) or nil
	if prov and type(prov.providers) == "table" then
		for name, info in pairs(prov.providers) do
			-- the smart core exposes every group as a compatible provider, only real ones count
			if info.vehicleType ~= "Compatible" then
				local items = type(info.proxies) == "table" and info.proxies or {}
				local ptypes = {}
				for _, px in ipairs(items) do
					local t = type(px) == "table" and px.type or nil
					if type(t) == "string" and t ~= "" then
						ptypes[t] = (ptypes[t] or 0) + 1
					end
				end
				table.insert(result.providers.items, { name = name, count = #items, types = ptypes })
				result.providers.total = result.providers.total + #items
				result.nodes.total = result.nodes.total + #items
			end
		end
	end

	HTTP.write_json(result)
end

function action_theme_get()
	local result = {
		mode = uci:get("openclash", "config", "theme_mode") or "",
		name = uci:get("openclash", "config", "theme_name") or "",
		custom = uci:get("openclash", "config", "theme_custom") or ""
	}
	HTTP.prepare_content("application/json")
	HTTP.write_json(result)
end

function action_theme_save()
	local mode = HTTP.formvalue("mode") or ""
	local name = HTTP.formvalue("name") or ""
	local custom = HTTP.formvalue("custom")
	if mode ~= "" then
		if mode ~= "light" and mode ~= "dark" and mode ~= "auto" then
			HTTP.status(400, "Invalid mode")
			HTTP.write_json({status = "error", msg = "invalid mode"})
			return
		end
		uci:set("openclash", "config", "theme_mode", mode)
	end
	if name ~= "" then
		local valid = {classic = true, cyan = true, indigo = true, graphite = true, amber = true, imperial = true, rose = true, smoky = true, custom = true}
		if not valid[name] then
			HTTP.status(400, "Invalid theme")
			HTTP.write_json({status = "error", msg = "invalid theme"})
			return
		end
		uci:set("openclash", "config", "theme_name", name)
	end
	if custom ~= nil then
		custom = custom:lower()
		if custom == "" then
			uci:delete("openclash", "config", "theme_custom")
		elseif custom:match("^#%x%x%x%x%x%x$") then
			uci:set("openclash", "config", "theme_custom", custom)
		else
			HTTP.status(400, "Invalid color")
			HTTP.write_json({status = "error", msg = "invalid color"})
			return
		end
	end
	uci:commit("openclash")
	HTTP.prepare_content("application/json")
	HTTP.write_json({status = "success"})
end

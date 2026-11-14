setfenv(1, require "luci.routerclash.api.env")

-- no_restart is passed by the config upload flow, which restarts at its own switch step
function action_update_config()
	-- filename is basename
	local filename = HTTP.formvalue("filename")

	HTTP.prepare_content("application/json")

	if not filename then
		HTTP.write_json({
			status = "error",
			message = "Config file not found"
		})
		return
	end

	local no_restart = HTTP.formvalue("no_restart")
	local restart_arg = no_restart == "1" and " norestart" or ""

	local update_result = SYS.call(string.format("/usr/share/routerclash/routerclash.sh '%s'%s >/dev/null 2>&1", filename, restart_arg))

	if update_result == 0 then
		HTTP.write_json({
			status = "success",
			message = "Config update started successfully",
			filename = filename
		})
	else
		HTTP.write_json({
			status = "error",
			message = "Failed to update config"
		})
	end
end

function action_restore_config()
	uci:set("routerclash", "config", "enable", "0")
	uci:commit("routerclash")
	SYS.call("mkdir -p /etc/routerclash/custom >/dev/null 2>&1")
	SYS.call("mkdir -p /etc/routerclash/overwrite >/dev/null 2>&1")
	SYS.call("mkdir -p /etc/routerclash/rule_provider >/dev/null 2>&1")
	SYS.call("/etc/init.d/routerclash stop >/dev/null 2>&1")
	SYS.call("cp -f /usr/share/routerclash/backup/routerclash /etc/config/routerclash >/dev/null 2>&1 &")
	SYS.call("cp -f /usr/share/routerclash/backup/routerclash_custom* /etc/routerclash/custom/ >/dev/null 2>&1 &")
	SYS.call("cp -f /usr/share/routerclash/backup/routerclash_force_sniffing* /etc/routerclash/custom/ >/dev/null 2>&1 &")
	SYS.call("cp -f /usr/share/routerclash/backup/routerclash_sniffing* /etc/routerclash/custom/ >/dev/null 2>&1 &")
	SYS.call("cp -f /usr/share/routerclash/backup/china_ip_route.ipset /etc/routerclash/china_ip_route.ipset >/dev/null 2>&1 &")
	SYS.call("cp -f /usr/share/routerclash/backup/china_ip6_route.ipset /etc/routerclash/china_ip6_route.ipset >/dev/null 2>&1 &")
	SYS.call("cp -f /usr/share/routerclash/backup/overwrite/default /etc/routerclash/overwrite/default >/dev/null 2>&1 &")
	SYS.call("cp -f /usr/share/routerclash/backup/rc-cn-domain.mrs /etc/routerclash/rule_provider/rc-cn-domain.mrs >/dev/null 2>&1 &")
	SYS.call("rm -rf /etc/routerclash/history/* >/dev/null 2>&1 &")
end

function action_switch_config()
	local config_file = HTTP.formvalue("config_file")
	local config_name = HTTP.formvalue("config_name")

	if not config_file and config_name then
		config_file = "/etc/routerclash/config/" .. config_name
	end

	if not config_file then
		HTTP.prepare_content("application/json")
		HTTP.write_json({
			status = "error",
			message = "No config file specified"
		})
		return
	end

	if not fs.access(config_file) then
		HTTP.prepare_content("application/json")
		HTTP.write_json({
			status = "error",
			message = "Config file does not exist: " .. config_file
		})
		return
	end

	uci:set("routerclash", "config", "config_path", config_file)
	uci:set("routerclash", "config", "enable", "1")
	uci:commit("routerclash")

	SYS.call("/etc/init.d/routerclash restart >/dev/null 2>&1 &")

	HTTP.prepare_content("application/json")
	HTTP.write_json({
		status = "success",
		message = "Config file switched successfully",
		config_file = config_file
	})
end

function create_file()
	local file_name = HTTP.formvalue("filename")
	local file_path = HTTP.formvalue("filepath")..file_name
	fs.writefile(file_path, "")
	if not fs.isfile(file_path) then
		HTTP.status(500, "Create File Failed")
	end
	return
end

function rename_file()
	local new_file_name = HTTP.formvalue("new_file_name")
	local file_path = HTTP.formvalue("file_path")
	local old_file_name = HTTP.formvalue("file_name")
	local old_file_path = file_path .. old_file_name
	local new_file_path = file_path .. new_file_name
	local old_run_file_path = "/etc/routerclash/" .. old_file_name
	local new_run_file_path = "/etc/routerclash/" .. new_file_name
	if fs.rename(old_file_path, new_file_path) then
		if file_path == "/etc/routerclash/config/" then
			if fs.uci_get_config("config", "config_path") == old_file_path then
				uci:set("routerclash", "config", "config_path", new_file_path)
			end

			if fs.isfile(old_run_file_path) then
				fs.rename(old_run_file_path, new_run_file_path)
			end

			fs.config_refs(old_file_name, new_file_name)
		end
		HTTP.status(200, "Rename File Successful")
	else
		HTTP.status(500, "Rename File Failed")
	end
	return
end

function action_config_file_list()
	local config_files = {}
	local age_files = {}
	local current_config = ""
	local config_path = fs.uci_get_config("config", "config_path")

	if config_path then
		current_config = config_path
	end

	uci:foreach("routerclash", "config_age_secret", function(a)
		if a.name and (a.secret or a.public) then
			table.insert(age_files, {
				name = a.name,
				secret = a.secret or "",
				public = a.public or ""
			})
		else
			uci:delete("routerclash", "config_age_secret", a[".name"])
			uci:commit("routerclash")
		end
	end)

	local config_dir = "/etc/routerclash/config/"
	local fingerprint_parts = {}
	local cache_valid = false
	local client_fp = HTTP.formvalue("fingerprint")

	if fs.access(config_dir) then
		local files = fs.dir(config_dir)
		if files then
			local yaml_files = {}
			for _, f in ipairs(files) do
				if string.match(f, "%.ya?ml$") then
					local stat = fs.stat(config_dir .. f)
					if stat and stat.type == "regular" then
						yaml_files[#yaml_files + 1] = f .. ":" .. (stat.mtime or 0)
					end
				end
			end
			table.sort(yaml_files)
			fingerprint_parts[#fingerprint_parts + 1] = table.concat(yaml_files, "|")
		end
	end
	for _, a in ipairs(age_files) do
		fingerprint_parts[#fingerprint_parts + 1] = "AGE:" .. a.name .. ":" .. (a.secret ~= "" and "1" or "0")
	end
	local fingerprint = table.concat(fingerprint_parts, "||")

	if client_fp and client_fp == fingerprint then
		cache_valid = true
	end

	if fs.access(config_dir) then
		local files = fs.dir(config_dir)
		if files then
			for _, file in ipairs(files) do
				local full_path = config_dir .. file
				local stat = fs.stat(full_path)
				local name_no_ext = file:match("^(.*)%.ya?ml$")
				if stat and stat.type == "regular" and string.match(file, "%.ya?ml$") then
					if name_no_ext and #age_files > 0 and not cache_valid then
						local cfile = io.open(full_path,"r")
						if cfile then
							local content = cfile:read(1024)
							local age_symbol = content:find("BEGIN AGE ENCRYPTED FILE", 1, true)
							for _, age in pairs(age_files) do
								if age.name == name_no_ext and age.secret and age_symbol then
									stat.age = true
									break
								end
							end
							cfile:close()
						end
					end
					table.insert(config_files, {
						name = file,
						path = full_path,
						size = stat.size,
						mtime = stat.mtime,
						age = stat.age or false
					})
				end
			end
		end

		table.sort(config_files, function(a, b)
			return string.lower(a.name) < string.lower(b.name)
		end)
	end

	HTTP.prepare_content("application/json")
	HTTP.write_json({
		config_files = config_files,
		current_config = current_config,
		total_count = #config_files,
		fingerprint = fingerprint
	})
end

function action_upload_config()
	if not require_token() then return end

	local config_dir = "/etc/routerclash/config/"
	local started, fp, filename, target_path, file_size, stream_err = false, nil, nil, nil, 0, nil

	HTTP.setfilehandler(function(meta, chunk, eof)
		if stream_err then
			return
		end

		if not started then
			if not chunk then
				return
			end

			started = true

			local name = (meta and meta.file) or ""
			if name == "" or not is_safe_filename(name) then
				stream_err = "Invalid filename"
				return
			end

			if not string.match(name, "%.ya?ml$") then
				name = name .. ".yaml"
			end

			filename = name
			target_path = config_dir .. name

			SYS.call("mkdir -p " .. config_dir)

			fp = io.open(target_path, "w")
			if not fp then
				stream_err = "Failed to save config file to disk"
				return
			end
		end

		if #chunk > 0 then
			if not fp:write(chunk) then
				stream_err = "Failed to save config file to disk"
				return
			end

			file_size = file_size + #chunk
		end

		if eof then
			fp:close()
			fp = nil
		end
	end)

	HTTP.formvalue("config_file")
	HTTP.prepare_content("application/json")

	if stream_err then
		if target_path then
			fs.unlink(target_path)
		end

		HTTP.write_json({
			status = "error",
			message = stream_err
		})
		return
	end

	if not target_path then
		HTTP.write_json({
			status = "error",
			message = "No file uploaded"
		})
		return
	end

	if file_size == 0 then
		fs.unlink(target_path)
		HTTP.write_json({
			status = "error",
			message = "Uploaded file is empty"
		})
		return
	end

	local yaml_valid = false
	local content_start = ""
	local rfp = io.open(target_path, "r")
	if rfp then
		content_start = rfp:read(5000) or ""
		rfp:close()
	end

	if string.find(content_start, "proxy%-providers:") or
	   string.find(content_start, "proxies:") or
	   string.find(content_start, "rules:") or
	   string.find(content_start, "port:") or
	   string.find(content_start, "mode:") then
		yaml_valid = true
	end

	if not yaml_valid then
		HTTP.write_json({
			status = "error",
			message = "Invalid config file format - missing required YAML sections"
		})
		return
	end

	SYS.call(string.format("chmod 644 '%s'", target_path))
	SYS.call(string.format("chown root:root '%s'", target_path))

	HTTP.write_json({
		status = "success",
		message = "Config file uploaded successfully",
		filename = filename,
		file_path = target_path,
		file_size = file_size,
		readable_size = fs.filesize(file_size)
	})
end

function action_restore_backup()
	if not require_token() then return end

	local backup_dir = "/tmp/"
	local started, fp, target_path, stream_err = false, nil, nil, nil

	HTTP.setfilehandler(function(meta, chunk, eof)
		if stream_err then
			return
		end

		if not started then
			if not chunk then
				return
			end

			started = true

			local name = (meta and meta.file) or ""
			if name == "" or not is_safe_filename(name) then
				stream_err = "Invalid filename"
				return
			end

			target_path = backup_dir .. name

			fp = io.open(target_path, "w")
			if not fp then
				stream_err = "Failed to save backup file to disk"
				return
			end
		end

		if chunk and fp then
			fp:write(chunk)
		end

		if eof and fp then
			fp:close()
			fp = nil
		end
	end)

	HTTP.formvalue("backup_file")
	HTTP.prepare_content("application/json")

	if stream_err then
		if target_path then
			fs.unlink(target_path)
		end

		HTTP.write_json({
			status = "error",
			message = stream_err
		})
		return
	end

	if not target_path then
		HTTP.write_json({
			status = "error",
			message = "No file uploaded"
		})
		return
	end

	local restored = fs.restore_backup(target_path)
	fs.unlink(target_path)

	if restored then
		HTTP.write_json({
			status = "success",
			message = "Backup File Restore Successful!"
		})
	else
		HTTP.write_json({
			status = "error",
			message = "Backup File Restore Failed!"
		})
	end
end

function action_config_file_read()
	local config_file = HTTP.formvalue("config_file")

	if not config_file then
		HTTP.status(400, "Missing config_file parameter")
		return
	end

	local allow = false
	if config_file == "/etc/routerclash/custom/routerclash_custom_overwrite.sh" then
		allow = true
	elseif config_file:match("^/etc/routerclash/overwrite/[^/]+$") and not string.find(config_file, "%.%.") then
		allow = true
	elseif config_file:match("^/etc/routerclash/[^/]+%.ya?ml$") then
		allow = true
	elseif config_file:match("^/etc/routerclash/config/[^/]+%.ya?ml$") and not string.find(config_file, "%.%.") then
		allow = true
	end

	if not allow then
		HTTP.status(403, "Invalid config file path")
		return
	end

	local stat = fs.stat(config_file)
	if stat and stat.type ~= "regular" then
		HTTP.status(500, "Config file is not a regular file")
		return
	end

	HTTP.header("X-Oc-Size", stat and tostring(stat.size) or "0")
	HTTP.header("X-Oc-Mtime", stat and tostring(stat.mtime) or "0")
	HTTP.prepare_content("text/plain; charset=utf-8")

	if not stat then
		return
	end

	local reader = ltn12_popen("exec cat " .. UTIL.shellquote(config_file))
	if not reader then
		return
	end
	luci.ltn12.pump.all(reader, HTTP.write)
	reader.kill()
end

function action_config_file_save()
	if not require_token() then return end

	local config_file, fp, file_size, backup_file, stream_err, started, opened = nil, nil, 0, nil, nil, false, false

	HTTP.setfilehandler(function(meta, chunk, eof)
		if stream_err then
			return
		end

		if not started then
			if not chunk then
				return
			end

			started = true

			config_file = HTTP.formvalue("config_file", true)
			if not config_file then
				stream_err = "Missing config_file parameter"
				return
			end

			local is_overwrite = (config_file == "/etc/routerclash/custom/routerclash_custom_overwrite.sh" or config_file:match("^/etc/routerclash/overwrite/[^/]+$"))
			if not is_overwrite then
				if not string.match(config_file, "^/etc/routerclash/config/[^/]+%.ya?ml$") or string.find(config_file, "%.%.") then
					stream_err = "Invalid config file path"
					return
				end
			else
				if not (config_file == "/etc/routerclash/custom/routerclash_custom_overwrite.sh" or (config_file:match("^/etc/routerclash/overwrite/[^/]+$") and not string.find(config_file, "%.%."))) then
					stream_err = "Invalid overwrite file path"
					return
				end
			end

			if fs.access(config_file) then
				backup_file = config_file .. ".backup." .. os.time()
				if SYS.call(string.format("cp '%s' '%s'", config_file, backup_file)) ~= 0 then
					backup_file = nil
					stream_err = "Failed to create backup file"
					return
				end
			end
		end

		if #chunk > 0 then
			if not fp then
				fp = io.open(config_file, "w")
				if not fp then
					stream_err = "Failed to write config file"
					return
				end

				opened = true
			end

			if not fp:write(chunk) then
				stream_err = "Failed to write config file"
				return
			end

			file_size = file_size + #chunk
		end

		if eof and fp then
			fp:close()
			fp = nil
		end
	end)

	HTTP.formvalue("config_file")
	HTTP.prepare_content("application/json")

	if not stream_err and not config_file then
		stream_err = "Missing config_file parameter"
	end

	if not stream_err and file_size == 0 then
		stream_err = "Missing content parameter"
	end

	if not stream_err then
		local saved = fs.stat(config_file)
		if not saved or saved.size ~= file_size then
			stream_err = "File write verification failed"
		end
	end

	if stream_err then
		if opened then
			if backup_file then
				SYS.call(string.format("mv '%s' '%s'", backup_file, config_file))
			else
				fs.unlink(config_file)
			end
		end

		HTTP.write_json({
			status = "error",
			message = stream_err
		})
		return
	end

	local is_overwrite = (config_file == "/etc/routerclash/custom/routerclash_custom_overwrite.sh" or config_file:match("^/etc/routerclash/overwrite/[^/]+$"))

	if not is_overwrite then
		SYS.call(string.format("chmod 644 '%s'", config_file))
	end
	SYS.call(string.format("chown root:root '%s'", config_file))

	if backup_file then
		SYS.call(string.format([[
			(
				config_dir="$(dirname '%s')"
				config_basename="$(basename '%s')"
				cd "$config_dir" 2>/dev/null || exit 0
				rm -f "${config_basename}.backup."* 2>/dev/null
			) &
		]], config_file, config_file))
	end

	local stat = fs.stat(config_file)
	local file_info = {}
	if stat then
		file_info = {
			path = config_file,
			size = stat.size,
			mtime = stat.mtime,
			readable_size = fs.filesize(stat.size),
			last_modified = os.date("%Y-%m-%d %H:%M:%S", stat.mtime)
		}
	end

	HTTP.write_json({
		status = "success",
		message = "Config file saved successfully",
		file_info = file_info,
		backup_created = backup_file and true or false
	})
end

function action_add_subscription()
	local name = HTTP.formvalue("name")
	local address = HTTP.formvalue("address")
	local sub_ua = HTTP.formvalue("sub_ua") or "clash-verge/v2.4.5"
	local sub_convert = HTTP.formvalue("sub_convert") or "0"
	local convert_address = HTTP.formvalue("convert_address") or ""
	local template = HTTP.formvalue("template") or ""
	local custom_template_url = HTTP.formvalue("custom_template_url") or ""
	local emoji = HTTP.formvalue("emoji") or "false"
	local udp = HTTP.formvalue("udp") or "false"
	local skip_cert_verify = HTTP.formvalue("skip_cert_verify") or "false"
	local sort = HTTP.formvalue("sort") or "false"
	local node_type = HTTP.formvalue("node_type") or "false"
	local rule_provider = HTTP.formvalue("rule_provider") or "false"
	local tfo = HTTP.formvalue("tfo") or "false"
	local tls13 = HTTP.formvalue("tls13") or "false"
	local custom_params = HTTP.formvalue("custom_params") or ""
	local keyword_option = HTTP.formvalue("keyword_option") or "0"
	local keyword = HTTP.formvalue("keyword") or ""
	local ex_keyword = HTTP.formvalue("ex_keyword") or ""
	local de_ex_keyword = HTTP.formvalue("de_ex_keyword") or ""
	local sub_headers = HTTP.formvalue("sub_headers") or ""
	HTTP.prepare_content("application/json")

	if not name then
		HTTP.write_json({
			status = "error",
			message = "Missing name parameter"
		})
		return
	end

	local is_valid_url = false

	if address and address ~= "" and sub_convert == "1" then
		local prefixed_pattern = "^[^,%s]+,%a[%w+.-]*://.+"
		local encoded_prefixed_pattern = "^[^%%%s]+%%2[Cc]%a[%%%w+.-]*%%3[Aa]%%2[Ff]%%2[Ff].+"

		if string.find(address, "\n") or string.find(address, "|") then
			local links = {}
			if string.find(address, "\n") then
				for line in address:gmatch("[^\n]+") do
					table.insert(links, line:match("^%s*(.-)%s*$"))
				end
			else
				for link in address:gmatch("[^|]+") do
					table.insert(links, link:match("^%s*(.-)%s*$"))
				end
			end

			for _, link in ipairs(links) do
				if link and link ~= "" then
					if string.find(link, "^https?://")
						or string.find(link, "^[a-zA-Z]+://")
						or string.find(link, prefixed_pattern)
						or string.find(link, encoded_prefixed_pattern) then
						is_valid_url = true
						break
					end
				end
			end
		else
			if string.find(address, "^https?://")
				or string.find(address, "^[a-zA-Z]+://")
				or string.find(address, prefixed_pattern)
				or string.find(address, encoded_prefixed_pattern) then
				is_valid_url = true
			end
		end
	elseif address and address ~= "" then
		if string.find(address, "^https?://") and not string.find(address, "\n") and not string.find(address, "|") then
			is_valid_url = true
		end
	else
		is_valid_url = true
	end

	if not is_valid_url then
		local error_msg
		if sub_convert == "1" then
			error_msg = "Invalid subscription URL format. Support: HTTP/HTTPS subscription URLs, or protocol links, can be separated by newlines or |"
		else
			error_msg = "Invalid subscription URL format. Only single HTTP/HTTPS subscription URL is supported when subscription conversion is disabled"
		end

		HTTP.write_json({
			status = "error",
			message = error_msg
		})
		return
	end

	local existing_section_id = nil
	uci:foreach("routerclash", "config_subscribe", function(s)
		if s.name == name then
			existing_section_id = s['.name']
			return false
		end
	end)

	local normalized_address = address
	if sub_convert == "1" and (string.find(address, "\n") or string.find(address, "|")) then
		local links = {}
		if string.find(address, "\n") then
			for line in address:gmatch("[^\n]+") do
				local link = line:match("^%s*(.-)%s*$")
				if link and link ~= "" then
					table.insert(links, link)
				end
			end
		else
			for link in address:gmatch("[^|]+") do
				local clean_link = link:match("^%s*(.-)%s*$")
				if clean_link and clean_link ~= "" then
					table.insert(links, clean_link)
				end
			end
		end
		normalized_address = table.concat(links, "\n")
	else
		normalized_address = address:match("^%s*(.-)%s*$")
	end

	local section_id
	if existing_section_id then
		section_id = existing_section_id
	else
		section_id = uci:add("routerclash", "config_subscribe")
	end

	if section_id then
		uci:set("routerclash", section_id, "name", name)
		if normalized_address and normalized_address ~= "" then
			uci:set("routerclash", section_id, "address", normalized_address)
		else
			uci:delete("routerclash", section_id, "address")
		end
		uci:set("routerclash", section_id, "sub_ua", sub_ua)

		uci:delete("routerclash", section_id, "sub_headers")
		if sub_headers and sub_headers ~= "" then
			local headers = {}
			for line in sub_headers:gmatch("[^\n]+") do
				local h = line:match("^%s*(.-)%s*$")
				if h and h ~= "" then
					table.insert(headers, h)
				end
			end
			if #headers > 0 then
				uci:set_list("routerclash", section_id, "sub_headers", headers)
			end
		end

		uci:set("routerclash", section_id, "sub_convert", sub_convert)
		if sub_convert == "1" then
			uci:set("routerclash", section_id, "convert_address", convert_address)
			uci:set("routerclash", section_id, "template", template)
			if template == "0" then
				uci:set("routerclash", section_id, "custom_template_url", custom_template_url)
			else
				uci:delete("routerclash", section_id, "custom_template_url")
			end
		else
			uci:delete("routerclash", section_id, "convert_address")
			uci:delete("routerclash", section_id, "template")
			uci:delete("routerclash", section_id, "custom_template_url")
		end
		uci:set("routerclash", section_id, "emoji", emoji)
		uci:set("routerclash", section_id, "udp", udp)
		uci:set("routerclash", section_id, "skip_cert_verify", skip_cert_verify)
		uci:set("routerclash", section_id, "sort", sort)
		uci:set("routerclash", section_id, "node_type", node_type)
		uci:set("routerclash", section_id, "rule_provider", rule_provider)
		uci:set("routerclash", section_id, "tfo", tfo)
		uci:set("routerclash", section_id, "tls13", tls13)

		uci:delete("routerclash", section_id, "custom_params")
		if custom_params and custom_params ~= "" and sub_convert == "1" then
			local params = {}
			for line in custom_params:gmatch("[^\n]+") do
				local param = line:match("^%s*(.-)%s*$")
				if param and param ~= "" then
					table.insert(params, param)
				end
			end
			if #params > 0 then
				uci:set_list("routerclash", section_id, "custom_params", params)
			end
		end

		uci:set("routerclash", section_id, "keyword_option", keyword_option)

		uci:delete("routerclash", section_id, "keyword")
		if keyword and keyword ~= "" then
			local keywords = {}
			for line in keyword:gmatch("[^\n]+") do
				local kw = line:match("^%s*(.-)%s*$")
				if kw and kw ~= "" then
					table.insert(keywords, kw)
				end
			end
			if #keywords > 0 then
				uci:set_list("routerclash", section_id, "keyword", keywords)
			end
		end

		uci:delete("routerclash", section_id, "ex_keyword")
		if ex_keyword and ex_keyword ~= "" then
			local ex_keywords = {}
			for line in ex_keyword:gmatch("[^\n]+") do
				local ex_kw = line:match("^%s*(.-)%s*$")
				if ex_kw and ex_kw ~= "" then
					table.insert(ex_keywords, ex_kw)
				end
			end
			if #ex_keywords > 0 then
				uci:set_list("routerclash", section_id, "ex_keyword", ex_keywords)
			end
		end

		uci:set("routerclash", section_id, "de_ex_keyword", de_ex_keyword)

		uci:commit("routerclash")

		local action_msg = existing_section_id and "Subscription updated successfully" or "Subscription added successfully"
		HTTP.write_json({
			status = "success",
			message = action_msg,
			name = name,
			address = normalized_address,
			sub_ua = sub_ua,
			sub_convert = sub_convert,
			multiple_links = sub_convert == "1" and (string.find(normalized_address, "\n") and true or false)
		})
	else
		HTTP.write_json({
			status = "error",
			message = "Failed to add/update subscription configuration"
		})
	end
end

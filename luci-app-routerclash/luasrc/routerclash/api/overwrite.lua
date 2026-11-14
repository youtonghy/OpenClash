setfenv(1, require "luci.routerclash.api.env")

function action_upload_overwrite()
	if not require_token() then return end

	local overwrite_dir = "/etc/routerclash/overwrite/"
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

			filename = name
			target_path = overwrite_dir .. name

			SYS.call("mkdir -p " .. overwrite_dir)

			fp = io.open(target_path, "w")
			if not fp then
				stream_err = "Failed to save file to disk"
				return
			end
		end

		if #chunk > 0 then
			if not fp:write(chunk) then
				stream_err = "Failed to save file to disk"
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

		HTTP.write_json({status = "error", message = stream_err})
		return
	end

	if not target_path then
		HTTP.write_json({status = "error", message = "No file uploaded"})
		return
	end

	if file_size == 0 then
		fs.unlink(target_path)
		HTTP.write_json({status = "error", message = "Uploaded file is empty"})
		return
	end

	local config_values = {}
	local raw_config = HTTP.formvalue("config") or ""
	if raw_config ~= "" then
		for line in raw_config:gmatch("[^\n]+") do
			local config_value = line:match("^%s*(.-)%s*$")
			if config_value and config_value ~= "" then
				table.insert(config_values, config_value)
			end
		end
	end
	local enable = HTTP.formvalue("enable")
	local order = HTTP.formvalue("order")

	if target_path then
		local section_name = filename
		local found = false

		uci:foreach("routerclash", "config_overwrite", function(s)
			if s.name == section_name then
				found = true
				uci:delete("routerclash", s[".name"], "config")
				if #config_values > 0 then
					uci:set_list("routerclash", s[".name"], "config", config_values)
				end
				if s.enable == nil or (s.enable ~= nil and enable ~= nil) then
					if enable == nil then
						enable = 0
					end
					uci:set("routerclash", s[".name"], "enable", tostring(enable))
				end
				-- an uploaded local file replaces the remote source of this module
				uci:set("routerclash", s[".name"], "type", "file")
				uci:set("routerclash", s[".name"], "url", "")
				if order ~= nil then
					uci:set("routerclash", s[".name"], "order", tostring(tonumber(order) or 0))
				end
				return false
			end
		end)
		if not found then
			local sid = uci:add("routerclash", "config_overwrite")
			uci:set("routerclash", sid, "name", section_name)
			uci:set("routerclash", sid, "type", "file")
			uci:delete("routerclash", sid, "config")
			if #config_values > 0 then
				uci:set_list("routerclash", sid, "config", config_values)
			end
			if enable ~= nil then
				uci:set("routerclash", sid, "enable", tostring(enable))
			else
				uci:set("routerclash", sid, "enable", 0)
			end
			if order ~= nil then
				uci:set("routerclash", sid, "order", tostring(order))
			else
				local max_order = -1
				uci:foreach("routerclash", "config_overwrite", function(s)
					local o = tonumber(s.order)
					if o and o > max_order then max_order = o end
				end)
				uci:set("routerclash", sid, "order", tostring(max_order + 1))
			end
		end

		uci:commit("routerclash")

		HTTP.write_json({
			status = "success",
			message = "Overwrite file uploaded successfully",
			filename = filename,
			file_path = target_path,
			file_size = file_size,
			readable_size = fs.filesize(file_size)
		})
	end
end

function action_overwrite_subscribe_info()
	local method = HTTP.getenv("REQUEST_METHOD")
	local filename = HTTP.formvalue("filename")
	local old_filename = HTTP.formvalue("old_filename")
	local typ = HTTP.formvalue("type") or "file"
	local section_name = nil
	local old_section_name = nil

	if filename and not is_safe_filename(filename) then
		HTTP.prepare_content("application/json")
		HTTP.write_json({status = "error", message = "Invalid filename"})
		return
	end

	if filename then
		section_name = filename:match("([^/]+)$")
	end
	if old_filename then
		old_section_name = old_filename:match("([^/]+)$")
	end

	if method == "GET" then
		local result = {}
		uci:foreach("routerclash", "config_overwrite", function(s)
			if s.name then
				local config_value = ""
				if s.config then
					local config_items = type(s.config) == "table" and s.config or { s.config }
					local config_list = {}
					for _, item in ipairs(config_items) do
						if item and item ~= "" then
							table.insert(config_list, tostring(item))
						end
					end
					if #config_list > 0 then
						config_value = config_list
					end
				end

				result[s.name] = {
					url = s.url or "",
					config = config_value,
					update_days = s.update_days or "",
					update_hour = s.update_hour or "",
					order = tonumber(s.order) or 0,
					type = s.type or "file",
					param = s.param or "",
					official = tonumber(s.official) or 0,
					enable = tonumber(s.enable) or 0
				}
			end
		end)
		HTTP.prepare_content("application/json")
		HTTP.write_json({status="success", data=result})
		return
	elseif method == "POST" then
		if not section_name then
			HTTP.status(500, "Missing filename")
			return
		end
		local url = HTTP.formvalue("url") or ""
		local update_days = HTTP.formvalue("update_days") or ""
		local update_hour = HTTP.formvalue("update_hour") or ""
		local order = HTTP.formvalue("order")
		local param = HTTP.formvalue("param") or ""
		local config_values = {}
		local raw_config = HTTP.formvalue("config") or ""
		if raw_config ~= "" then
			for line in raw_config:gmatch("[^\n]+") do
				local config_value = line:match("^%s*(.-)%s*$")
				if config_value and config_value ~= "" then
					table.insert(config_values, config_value)
				end
			end
		end
		typ = HTTP.formvalue("type") or typ or "file"
		local enable = HTTP.formvalue("enable")

		if typ == "http" then
			if not url or url == "" then
				HTTP.prepare_content("application/json")
				HTTP.write_json({
					status = "error",
					message = "Subscribe URL cannot be empty"
				})
				return
			end
			local is_valid_url = false
			if url:match("^https?://") and not url:find("\n") and not url:find("|") then
				is_valid_url = true
			end
			if not is_valid_url then
				HTTP.prepare_content("application/json")
				HTTP.write_json({
					status = "error",
					message = "Invalid subscribe URL format, only single HTTP/HTTPS link is supported"
				})
				return
			end
		end

		-- locate the section to update (rename source or the section with the target name)
		local target_section = nil
		local rename_source = nil
		uci:foreach("routerclash", "config_overwrite", function(s)
			if s.name == section_name then
				target_section = s
			end
			if old_section_name and old_section_name ~= "" and old_section_name ~= section_name and s.name == old_section_name then
				rename_source = s
			end
		end)

		local file_path = "/etc/routerclash/overwrite/" .. section_name
		-- only refresh the module body when it is really needed (new url / explicit refresh / missing file)
		local need_download = false
		if typ == "http" and url ~= "" then
			local known_url = ""
			if target_section and target_section.url then
				known_url = target_section.url
			elseif rename_source and rename_source.url then
				known_url = rename_source.url
			end
			if HTTP.formvalue("refresh") == "1" or known_url ~= url or not fs.access(file_path) then
				need_download = true
			end
		end

		if need_download then
			local tmp_file = "/tmp/routerclash_overwrite_download"
			SYS.call("rm -f " .. tmp_file)
			local ret = SYS.call(string.format('curl -fsSL --connect-timeout 5 -m 30 --retry 2 "%s" -o "%s"', url, tmp_file))
			local stat = fs.stat(tmp_file)
			if ret ~= 0 or not stat or stat.type ~= "regular" or stat.size == 0 then
				SYS.call("rm -f " .. tmp_file)
				HTTP.prepare_content("application/json")
				HTTP.write_json({status="error", message="Download failed"})
				return
			end
			SYS.call(string.format("mkdir -p /etc/routerclash/overwrite && mv -f '%s' '%s' && chmod 644 '%s'", tmp_file, file_path, file_path))
			if not fs.access(file_path) then
				HTTP.prepare_content("application/json")
				HTTP.write_json({status="error", message="Failed to save downloaded file"})
				return
			end
		end

		if old_section_name and old_section_name ~= "" and old_section_name ~= section_name then
			local old_file = "/etc/routerclash/overwrite/" .. old_section_name
			if fs.access(old_file) then
				if need_download or fs.access(file_path) then
					fs.unlink(old_file)
				else
					fs.rename(old_file, file_path)
				end
			end
		end

		if not fs.access(file_path) then
			fs.writefile(file_path, "")
		end
		local section = rename_source or target_section
		local sid = nil
		if section then
			sid = section[".name"]
			if section_name ~= old_section_name and rename_source and rename_source[".name"] == sid then
				uci:set("routerclash", sid, "name", section_name)
			end
		else
			-- never register a module without a config match: it would stay inactive forever
			if #config_values == 0 then
				HTTP.prepare_content("application/json")
				HTTP.write_json({status="error", message="Config file match cannot be empty"})
				return
			end
			sid = uci:add("routerclash", "config_overwrite")
			uci:set("routerclash", sid, "name", section_name)
		end
		uci:set("routerclash", sid, "type", typ)
		uci:set("routerclash", sid, "url", url)
		uci:set("routerclash", sid, "update_days", update_days)
		uci:set("routerclash", sid, "update_hour", update_hour)
		uci:set("routerclash", sid, "param", param)
		if #config_values > 0 then
			uci:delete("routerclash", sid, "config")
			uci:set_list("routerclash", sid, "config", config_values)
		end
		local order_num = tonumber(order)
		if order_num == nil then
			order_num = section and tonumber(section.order) or nil
		end
		if order_num == nil then
			local max_order = -1
			uci:foreach("routerclash", "config_overwrite", function(s)
				local o = tonumber(s.order)
				if o and o > max_order then max_order = o end
			end)
			order_num = max_order + 1
		end
		uci:set("routerclash", sid, "order", tostring(order_num))
		local enable_num = tonumber(enable)
		if enable_num == nil then
			enable_num = section and tonumber(section.enable) or 0
		end
		uci:set("routerclash", sid, "enable", tostring(enable_num == 1 and 1 or 0))
		uci:commit("routerclash")

		HTTP.prepare_content("application/json")
		HTTP.write_json({status="success"})
		return
	else
		HTTP.status(500, "Method Not Allowed")
	end
end

function action_overwrite_file_list()
	local overwrite_files = {}
	local custom_file = "/etc/routerclash/custom/routerclash_custom_overwrite.sh"

	if fs.access(custom_file) then
		local stat = fs.stat(custom_file)
		if stat and stat.type == "regular" then
			table.insert(overwrite_files, {
				name = "routerclash_custom_overwrite.sh",
				path = custom_file,
				size = stat.size,
				mtime = stat.mtime
			})
		end
	end

	local overwrite_dir = "/etc/routerclash/overwrite/"
	if fs.access(overwrite_dir) then
		local files = fs.dir(overwrite_dir)
		if files then
			for _, file in ipairs(files) do
				local full_path = overwrite_dir .. file
				local stat = fs.stat(full_path)
				if stat and stat.type == "regular" and file:sub(1, 1) ~= "." and not file:match("%.backup%.") and not file:match("%.tmp$") then
					table.insert(overwrite_files, {
						name = file,
						path = full_path,
						size = stat.size,
						mtime = stat.mtime
					})
				end
			end
		end
	end

	table.sort(overwrite_files, function(a, b)
		return (a.mtime or 0) > (b.mtime or 0)
	end)

	HTTP.prepare_content("application/json")
	HTTP.write_json({
		overwrite_files = overwrite_files,
		total_count = #overwrite_files
	})
end

function delete_overwrite_file()
	local filename = HTTP.formvalue("filename")
	if not filename or filename == "" then
		HTTP.prepare_content("application/json")
		HTTP.write_json({status="error", message="Missing filename"})
		return
	end
	if not is_safe_filename(filename) then
		HTTP.prepare_content("application/json")
		HTTP.write_json({status="error", message="Invalid filename"})
		return
	end
	local overwrite_dir = "/etc/routerclash/overwrite/"
	local file_path = overwrite_dir .. filename

	if fs.access(file_path) then
		fs.unlink(file_path)
	end

	uci:foreach("routerclash", "config_overwrite", function(s)
		if s.name == filename then
			uci:delete("routerclash", s[".name"])
			return false
		end
	end)
	uci:commit("routerclash")

	local order_list = {}
	uci:foreach("routerclash", "config_overwrite", function(s)
		table.insert(order_list, { section = s[".name"], order = tonumber(s.order) or 0 })
	end)
	table.sort(order_list, function(a, b) return a.order < b.order end)
	for idx, item in ipairs(order_list) do
		uci:set("routerclash", item.section, "order", tostring(idx))
	end
	uci:commit("routerclash")

	HTTP.prepare_content("application/json")
	HTTP.write_json({status="success"})
end

setfenv(1, require "luci.openclash.api.env")

function write_padded(data)
	if write_padded_first then
		if L and L.http then
			L.http:header("X-Accel-Buffering", "no")
		else
			HTTP.header("X-Accel-Buffering", "no")
		end
		if L and L.http then
			L.http:write(string.rep(" ", 8192) .. "\n")
			L.http:write(data .. "\n")
		else
			HTTP.write(string.rep(" ", 8192) .. "\n")
			HTTP.write(data .. "\n")
		end
		write_padded_first = false
	else
		if L and L.http then
			L.http:write(data .. "\n")
		else
			HTTP.write(data .. "\n")
		end
	end
	io.flush()
end

function try_read(fd, maxlen)
	local pfds = {
		{ fd = fd, events = nixio.poll_flags("in", "hup", "err") }
	}
	local nfds = nixio.poll(pfds, 0)
	if nfds and nfds > 0 then
		local buf = fd:read(maxlen or 4096)
		if buf and #buf > 0 then
			return buf
		end
	end
	return nil
end

function trans_line(data)
	if data == nil or data == "" then
		return ""
	end

	local line_trans = ""

	local has_timestamp = string.len(data) >= 19 and string.match(string.sub(data, 1, 19), "%d%d%d%d%-%d%d%-%d%d %d%d:%d%d:%d%d")
	local time_part = ""
	local level_part = ""
	local content_start = has_timestamp and 21 or 1

	if has_timestamp then
		time_part = string.sub(data, 1, 20)
		local level_start, level_end, level_content = string.find(data, "%[([^%]]+)%]", 21)
		if level_start and level_end and level_start == 21 then
			level_part = "[" .. luci.i18n.translate(level_content) .. "] "
			content_start = level_end + 2
		end
	end

	local segments = {}
	local last_pos = content_start
	local pos = string.find(data, "【", content_start)

	while pos do
		if pos > last_pos then
			segments[#segments + 1] = {
				type = "trans",
				text = string.sub(data, last_pos, pos - 1)
			}
		end

		local close_pos = string.find(data, "】", pos + 1)
		if not close_pos then
			segments[#segments + 1] = {
				type = "trans",
				text = string.sub(data, pos, -1)
			}
			break
		end

		segments[#segments + 1] = {
			type = "no_trans",
			text = string.sub(data, pos, close_pos + 2)
		}

		last_pos = close_pos + 3
		pos = string.find(data, "【", last_pos)
	end

	if last_pos <= string.len(data) then
		segments[#segments + 1] = {
			type = "trans",
			text = string.sub(data, last_pos, -1)
		}
	end

	line_trans = time_part .. level_part
	for _, seg in ipairs(segments) do
		if seg.type == "trans" then
			line_trans = line_trans .. luci.i18n.translate(seg.text)
		else
			line_trans = line_trans .. seg.text
		end
	end

	return line_trans
end

function process_status(name)
	local cmd = string.format("%s |grep '%s' |grep -v grep", fs.ps_cmd(), name)
	local result = SYS.exec(cmd)
	return result ~= nil and result ~= "" and not result:match("^%s*$")
end

function stream_log_and_parse(reader)
	local buf = ""

	while true do
		local chunk = reader()
		if not chunk then break end
		buf = buf .. chunk
		while true do
			local nl = buf:find("\n")
			if not nl then break end
			local line = buf:sub(1, nl - 1)
			buf = buf:sub(nl + 1)
			line = line:gsub("^%s+", ""):gsub("%s+$", "")
			if line ~= "" then
				if line == "##FINISHED##" or line == "##CONTINUE##" then
					write_padded(line)
				else
					write_padded(trans_line(line))
				end
			end
		end
	end
	reader.kill()
end

function action_start()
	HTTP.prepare_content("text/plain; charset=utf-8")
	local logfile = "/tmp/openclash_start.log"
	local patterns = START_SCRIPT_PATTERNS[HTTP.formvalue("script")]
	if type(patterns) == "string" then
		patterns = { patterns }
	end

	local cmd
	if patterns then
		local pattern_cases = {}
		for idx, p in ipairs(patterns) do
			pattern_cases[#pattern_cases + 1] = string.format(
				"%d) %s | grep -v grep | grep \"%s\" | grep -v \"openclash_start\" | grep -c \"^\";;",
				idx, "$PS_CMD", p
			)
		end
		local check_fn = string.format(
			"check_liveness() { case \"$1\" in %s *) echo 0;; esac; }; ",
			table.concat(pattern_cases, " ")
		)
		cmd = string.format(
			"logfile='%s'; " ..
			check_fn ..
			"if [ \"$(ps --version 2>&1 | grep -c procps-ng)\" -eq 1 ]; then PS_CMD='ps -efw'; else PS_CMD='ps -w'; fi; " ..
			"bytes=$(wc -c < \"$logfile\" 2>/dev/null); bytes=${bytes:-0}; " ..
			"[ \"$bytes\" -gt 0 ] && tail -c +1 \"$logfile\" 2>/dev/null; " ..
			"seen=0; [ \"$bytes\" -gt 0 ] && seen=1; " ..
			"elapsed=0; i=1; miss=0; total=%d; " ..
			"while true; do " ..
			"new_bytes=$(wc -c < \"$logfile\" 2>/dev/null); new_bytes=${new_bytes:-0}; " ..
			"if [ \"$new_bytes\" -gt \"$bytes\" ] 2>/dev/null; then " ..
			"if [ \"$(tail -c 1 \"$logfile\" 2>/dev/null)\" = \"$(printf '\\n')\" ]; then " ..
			"tail -c +$((bytes + 1)) \"$logfile\" 2>/dev/null; bytes=$new_bytes; " ..
			"else tail -c +$((bytes + 1)) \"$logfile\" 2>/dev/null | awk '{ if (p) printf \"%%s\\n\", prev; prev = $0; p = 1 }'; " ..
			"bytes=$((new_bytes - $(tail -c +$((bytes + 1)) \"$logfile\" 2>/dev/null | awk 'END { print length($0) }'))); " ..
			"fi; seen=1; " ..
			"elif [ \"$new_bytes\" -lt \"$bytes\" ] 2>/dev/null; then " ..
			"if [ \"$(tail -c 1 \"$logfile\" 2>/dev/null)\" = \"$(printf '\\n')\" ]; then " ..
			"tail -c +1 \"$logfile\" 2>/dev/null; bytes=$new_bytes; " ..
			"else tail -c +1 \"$logfile\" 2>/dev/null | awk '{ if (p) printf \"%%s\\n\", prev; prev = $0; p = 1 }'; " ..
			"bytes=$((new_bytes - $(tail -c +1 \"$logfile\" 2>/dev/null | awk 'END { print length($0) }'))); " ..
			"fi; seen=1; " ..
			"fi; " ..
			"found=0; i=1; " ..
			"while [ \"$i\" -le \"$total\" ]; do " ..
			"liveness=$(check_liveness \"$i\"); " ..
			"if [ \"$liveness\" -gt 0 ] 2>/dev/null; then found=1; seen=1; break; fi; " ..
			"i=$((i + 1)); " ..
			"done; " ..
			"if [ \"$found\" = \"1\" ]; then miss=0; " ..
			"if [ \"$elapsed\" -ge 50 ]; then echo '##CONTINUE##'; exit 0; fi; " ..
			"else " ..
			"miss=$((miss + 1)); " ..
			"if [ \"$seen\" -eq 1 ] && [ \"$miss\" -ge 3 ]; then echo '##FINISHED##'; exit 0; fi; " ..
			"if [ \"$elapsed\" -ge 8 ]; then echo '##FINISHED##'; exit 0; fi; " ..
			"fi; " ..
			"sleep 1; elapsed=$((elapsed + 1)); " ..
			"done",
			logfile, #patterns
		)
	else
		cmd = string.format(
			"logfile='%s'; " ..
			"bytes=$(wc -c < \"$logfile\" 2>/dev/null); bytes=${bytes:-0}; " ..
			"[ \"$bytes\" -gt 0 ] && tail -c +1 \"$logfile\" 2>/dev/null; " ..
			"observed=0; [ \"$bytes\" -gt 0 ] && observed=1; " ..
			"elapsed=0; idle=0; " ..
			"while true; do " ..
			"new_bytes=$(wc -c < \"$logfile\" 2>/dev/null); new_bytes=${new_bytes:-0}; " ..
			"if [ \"$new_bytes\" -gt \"$bytes\" ] 2>/dev/null; then " ..
			"if [ \"$(tail -c 1 \"$logfile\" 2>/dev/null)\" = \"$(printf '\\n')\" ]; then " ..
			"tail -c +$((bytes + 1)) \"$logfile\" 2>/dev/null; bytes=$new_bytes; " ..
			"else tail -c +$((bytes + 1)) \"$logfile\" 2>/dev/null | awk '{ if (p) printf \"%%s\\n\", prev; prev = $0; p = 1 }'; " ..
			"bytes=$((new_bytes - $(tail -c +$((bytes + 1)) \"$logfile\" 2>/dev/null | awk 'END { print length($0) }'))); " ..
			"fi; observed=1; idle=0; " ..
			"elif [ \"$new_bytes\" -lt \"$bytes\" ] 2>/dev/null; then " ..
			"if [ \"$(tail -c 1 \"$logfile\" 2>/dev/null)\" = \"$(printf '\\n')\" ]; then " ..
			"tail -c +1 \"$logfile\" 2>/dev/null; bytes=$new_bytes; " ..
			"else tail -c +1 \"$logfile\" 2>/dev/null | awk '{ if (p) printf \"%%s\\n\", prev; prev = $0; p = 1 }'; " ..
			"bytes=$((new_bytes - $(tail -c +1 \"$logfile\" 2>/dev/null | awk 'END { print length($0) }'))); " ..
			"fi; observed=1; idle=0; " ..
			"else idle=$((idle + 1)); fi; " ..
			"if [ \"$observed\" -eq 1 ] && [ \"$idle\" -ge 10 ]; then echo '##FINISHED##'; exit 0; fi; " ..
			"if [ \"$elapsed\" -ge 50 ]; then echo '##FINISHED##'; exit 0; fi; " ..
			"if [ \"$observed\" -eq 0 ] && [ \"$elapsed\" -ge 3 ]; then echo '##FINISHED##'; exit 0; fi; " ..
			"sleep 1; elapsed=$((elapsed + 1)); " ..
			"done",
			logfile
		)
	end

	local reader = ltn12_popen(cmd)
	if not reader then return end

	stream_log_and_parse(reader)
end

function action_refresh_log()
	HTTP.prepare_content("application/json")
	local logfile = "/tmp/openclash.log"
	local log_len = tonumber(HTTP.formvalue("log_len")) or 0
	local core_refresh = HTTP.formvalue("core_refresh") == "true"

	if not fs.access(logfile) then
		HTTP.write_json({
			len = 0,
			update = false,
			core_log = "",
			oc_log = ""
		})
		return
	end

	local total_lines = tonumber(SYS.exec("wc -l < " .. logfile)) or 0

	if total_lines == log_len and log_len > 0 then
		HTTP.write_json({
			len = total_lines,
			update = false,
			core_log = "",
			oc_log = ""
		})
		return
	end

	local exclude_pattern = "UDP%-Receive%-Buffer%-Size|^Sec%-Fetch%-Mode|^User%-Agent|^Access%-Control|^Accept|^Origin|^Referer|^Connection|^Pragma|^Cache%-"
	local core_pattern = "level=|^time="
	local limit = core_refresh and 2500 or 5000
	local start_line = (log_len > 0 and total_lines > log_len) and (log_len + 1) or 1
	local read_count = math.max(0, total_lines - start_line + 1)
	local core_raw, oc_raw
	local oc_truncated = false
	local core_truncated = false
	local core_log = ""
	local oc_log = ""

	local sed_range = string.format("sed -n '%d,%dp' '%s'", start_line, start_line + read_count - 1, logfile)

	local oc_cmd = string.format(
		"%s | grep -v -E '%s' | grep -v -E '%s' | tail -n %d",
		sed_range, exclude_pattern, core_pattern, limit + 1
	)

	oc_raw = SYS.exec(oc_cmd)

	if oc_raw and oc_raw ~= "" then
		local oc_logs = {}
		local oc_count = 0
		for line in oc_raw:gmatch("[^\n]+") do
			oc_count = oc_count + 1
			if not string.match(string.sub(line, 1, 19), "%d%d%d%d%-%d%d%-%d%d %d%d:%d%d:%d%d") then
				line = os.date("%Y-%m-%d %H:%M:%S") .. ' [Fatal] ' .. line
			end
			oc_logs[#oc_logs + 1] = trans_line(line)
		end

		oc_truncated = (oc_count > limit)
		if oc_truncated and #oc_logs > limit then
			local kept = {}
			for i = #oc_logs - limit + 1, #oc_logs do
				kept[#kept + 1] = oc_logs[i]
			end
			oc_logs = kept
		end
		oc_log = #oc_logs > 0 and table.concat(oc_logs, "\n") or ""
	end

	if core_refresh then
		local core_cmd = string.format(
			"%s | grep -v -E '%s' | grep -E '%s' | tail -n %d",
			sed_range, exclude_pattern, core_pattern, limit + 1
		)
		core_raw = SYS.exec(core_cmd)

		if core_raw and core_raw ~= "" then
			local _, core_count = core_raw:gsub("\n", "")
			if core_raw:sub(-1) ~= "\n" then
				core_count = core_count + 1
			end

			core_truncated = (core_count > limit)
			if core_truncated then
				core_log = core_raw:match("\n(.+)") or ""
				core_log = core_log:gsub("\n$", "")
			else
				core_log = core_raw:gsub("\n$", "")
			end
		end
	end

	if core_truncated and core_log ~= "" then
		core_log = "...\n" .. core_log
	end
	if oc_truncated and oc_log ~= "" then
		oc_log = "...\n" .. oc_log
	end

	HTTP.write_json({
		len = total_lines,
		update = true,
		core_log = core_log,
		oc_log = oc_log
	})
end

function action_del_log()
	local log_type = HTTP.formvalue("type")
	if log_type == "debug" then
		SYS.exec(": > /tmp/openclash_debug.log")
	else
		SYS.exec(": > /tmp/openclash.log")
	end
	return
end

function action_del_start_log()
	fs.writefile("/tmp/openclash_start.log", "")
end

function action_diag_connection()
	local addr = HTTP.formvalue("addr")
	if addr and (datatype.hostname(addr) or datatype.ipaddr(addr)) then
		local cmd = string.format("/usr/share/openclash/openclash_debug_getcon.lua %s", addr)
		HTTP.prepare_content("text/plain")
		local reader = ltn12_popen(cmd)
		if not reader then return end
		local buf = ""
		while true do
			local chunk = reader()
			if not chunk then break end
			buf = buf .. chunk
			while true do
				local nl = buf:find("\n")
				if not nl then break end
				local line = buf:sub(1, nl - 1)
				buf = buf:sub(nl + 1)
				write_padded(line)
			end
		end
		reader.kill()
		return
	end
	HTTP.status(500, "Bad address")
end

function action_diag_dns()
	local addr = HTTP.formvalue("addr")
	if addr and datatype.hostname(addr)then
		local cmd = string.format("/usr/share/openclash/openclash_debug_dns.lua %s", addr)
		HTTP.prepare_content("text/plain")
		local reader = ltn12_popen(cmd)
		if not reader then return end
		local buf = ""
		while true do
			local chunk = reader()
			if not chunk then break end
			buf = buf .. chunk
			while true do
				local nl = buf:find("\n")
				if not nl then break end
				local line = buf:sub(1, nl - 1)
				buf = buf:sub(nl + 1)
				write_padded(line)
			end
		end
		reader.kill()
		return
	end
	HTTP.status(500, "Bad address")
end

function action_gen_debug_logs()
	HTTP.prepare_content("text/plain; charset=utf-8")
	local logfile = "/tmp/openclash_debug.log"

	local cmd = string.format(
		"logfile='%s'; : > \"$logfile\"; " ..
		"/usr/share/openclash/openclash_debug.sh >/dev/null 2>&1 & DEBUG_PID=$!; " ..
		"bytes=0; elapsed=0; while true; do " ..
		"new_bytes=$(wc -c < \"$logfile\" 2>/dev/null); new_bytes=${new_bytes:-0}; " ..
		"if [ \"$new_bytes\" -gt \"$bytes\" ] 2>/dev/null; then " ..
		"if [ \"$(tail -c 1 \"$logfile\" 2>/dev/null)\" = \"$(printf '\\n')\" ]; then " ..
		"tail -c +$((bytes + 1)) \"$logfile\" 2>/dev/null; bytes=$new_bytes; " ..
		"else tail -c +$((bytes + 1)) \"$logfile\" 2>/dev/null | awk '{ if (p) printf \"%%s\\n\", prev; prev = $0; p = 1 }'; " ..
		"bytes=$((new_bytes - $(tail -c +$((bytes + 1)) \"$logfile\" 2>/dev/null | awk 'END { print length($0) }'))); " ..
		"fi; elapsed=0; fi; " ..
		"if ! kill -0 $DEBUG_PID 2>/dev/null; then " ..
		"exit 0; " ..
		"fi; sleep 1; elapsed=$((elapsed + 1)); " ..
		"if [ $elapsed -ge 60 ]; then exit 0; fi; done",
		logfile
	)
	local reader = ltn12_popen(cmd)
	if not reader then return end

	local buf = ""

	while true do
		local chunk = reader()
		if not chunk then break end
		buf = buf .. chunk
		while true do
			local nl = buf:find("\n")
			if not nl then break end
			local line = buf:sub(1, nl - 1)
			buf = buf:sub(nl + 1)
			write_padded(line)
		end
	end
	reader.kill()
end

function action_get_debug_logs()
	local logfile = "/tmp/openclash_debug.log"
	if not fs.access(logfile) then
		return
	end
	HTTP.prepare_content("text/plain; charset=utf-8")
	local reader = ltn12_popen("exec cat '" .. logfile .. "'")
	luci.ltn12.pump.all(reader, HTTP.write)
	reader.kill()
end

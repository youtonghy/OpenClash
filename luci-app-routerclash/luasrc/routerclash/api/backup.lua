setfenv(1, require "luci.routerclash.api.env")

function action_backup()
	local config = SYS.call("cp /etc/config/routerclash /etc/routerclash/routerclash >/dev/null 2>&1")
	local reader = ltn12_popen("exec tar -C '/etc/routerclash/' -cz . 2>/dev/null")

	HTTP.header(
		'Content-Disposition', 'attachment; filename="Backup-RouterClash-%s-%s-%s.tar.gz"' %{
			device_name, device_arh, os.date("%Y-%m-%d-%H-%M-%S")
		})

	HTTP.prepare_content("application/x-targz")
	luci.ltn12.pump.all(reader, HTTP.write)
	reader.kill()
	SYS.call("rm -rf /etc/routerclash/routerclash >/dev/null 2>&1")
end

function action_backup_ex_core()
	local config = SYS.call("cp /etc/config/routerclash /etc/routerclash/routerclash >/dev/null 2>&1")
	local reader = ltn12_popen("echo 'core' > /tmp/rc_exclude.txt && exec tar -C '/etc/routerclash/' -X '/tmp/rc_exclude.txt' -cz . 2>/dev/null")

	HTTP.header(
		'Content-Disposition', 'attachment; filename="Backup-RouterClash-Exclude-Cores-%s-%s-%s.tar.gz"' %{
			device_name, device_arh, os.date("%Y-%m-%d-%H-%M-%S")
		})

	HTTP.prepare_content("application/x-targz")
	luci.ltn12.pump.all(reader, HTTP.write)
	reader.kill()
	SYS.call("rm -rf /etc/routerclash/routerclash >/dev/null 2>&1")
end

function action_backup_only_config()
	local reader = ltn12_popen("exec tar -C '/etc/routerclash' -cz './config' 2>/dev/null")

	HTTP.header(
		'Content-Disposition', 'attachment; filename="Backup-RouterClash-Config-%s-%s-%s.tar.gz"' %{
			device_name, device_arh, os.date("%Y-%m-%d-%H-%M-%S")
		})

	HTTP.prepare_content("application/x-targz")
	luci.ltn12.pump.all(reader, HTTP.write)
	reader.kill()
end

function action_backup_only_core()
	local reader = ltn12_popen("exec tar -C '/etc/routerclash' -cz './core' 2>/dev/null")

	HTTP.header(
		'Content-Disposition', 'attachment; filename="Backup-RouterClash-Cores-%s-%s-%s.tar.gz"' %{
			device_name, device_arh, os.date("%Y-%m-%d-%H-%M-%S")
		})

	HTTP.prepare_content("application/x-targz")
	luci.ltn12.pump.all(reader, HTTP.write)
	reader.kill()
end

function action_backup_only_rule()
	local reader = ltn12_popen("exec tar -C '/etc/routerclash' -cz './rule_provider' 2>/dev/null")

	HTTP.header(
		'Content-Disposition', 'attachment; filename="Backup-RouterClash-Only-Rule-Provider-%s-%s-%s.tar.gz"' %{
			device_name, device_arh, os.date("%Y-%m-%d-%H-%M-%S")
		})

	HTTP.prepare_content("application/x-targz")
	luci.ltn12.pump.all(reader, HTTP.write)
	reader.kill()
end

function action_backup_only_proxy()
	local reader = ltn12_popen("exec tar -C '/etc/routerclash' -cz './proxy_provider' 2>/dev/null")

	HTTP.header(
		'Content-Disposition', 'attachment; filename="Backup-RouterClash-Proxy-Provider-%s-%s-%s.tar.gz"' %{
			device_name, device_arh, os.date("%Y-%m-%d-%H-%M-%S")
		})

	HTTP.prepare_content("application/x-targz")
	luci.ltn12.pump.all(reader, HTTP.write)
	reader.kill()
end

function ltn12_popen(command)
	local fdi, fdo = nixio.pipe()
	if not fdi or not fdo then return nil end

	local pid = nixio.fork()

	if pid > 0 then
		fdo:close()
		local reaped = false

		local function pipe_read()
			local ok_r, buffer = pcall(try_read, fdi, 16384)
			if ok_r and buffer then
				return buffer
			end

			if not reaped then
				local ok_w, wpid = pcall(nixio.waitpid, pid, "nohang")
				if ok_w and wpid then
					reaped = true
				end
			end

			if reaped then
				local ok_l, last = pcall(try_read, fdi, 16384)
				if ok_l and last then
					return last
				end
				pcall(fdi.close, fdi)
				return nil
			else
				nixio.nanosleep(0, 50000000)
				return ""
			end
		end

		local function pipe_kill()
			if not reaped then
				pcall(nixio.kill, pid, nixio.const.SIGTERM)
				nixio.nanosleep(0, 100000000)
				pcall(nixio.kill, pid, nixio.const.SIGKILL)
				nixio.waitpid(pid)
				reaped = true
			end
			pcall(fdi.close, fdi)
		end

		-- Lua 5.1 does not allow setting fields on functions.
		-- Use a callable table: reader() invokes __call, reader.kill() is a table field.
		local wrapper = { kill = pipe_kill }
		setmetatable(wrapper, { __call = function(_, ...) return pipe_read(...) end })
		return wrapper
	elseif pid == 0 then
		nixio.dup(fdo, nixio.stdout)
		fdi:close()
		fdo:close()
		nixio.exec("/bin/sh", "-c", command)
		os.exit(127)
	else
		fdi:close()
		fdo:close()
		return nil
	end
end

setfenv(1, require "luci.openclash.api.env")

local schema = require "luci.openclash.api.settings_schema"

local CUSTOM_FILES = {
	hosts = "/etc/openclash/custom/openclash_custom_hosts.list",
	rules = "/etc/openclash/custom/openclash_custom_rules.list",
	rules_2 = "/etc/openclash/custom/openclash_custom_rules_2.list",
	sniffer = "/etc/openclash/custom/openclash_custom_sniffer.yaml",
	local_network = "/etc/openclash/custom/openclash_custom_localnetwork_ipv4.list",
	local_network6 = "/etc/openclash/custom/openclash_custom_localnetwork_ipv6.list",
	firewall = "/etc/openclash/custom/openclash_custom_firewall_rules.sh",
}
local CUSTOM_FILE_MAX = 512 * 1024

local function reply(data, status)
	if status then HTTP.status(status, data.error or "Error") end
	HTTP.prepare_content("application/json")
	HTTP.write_json(data)
end

function settings_get()
	local values = {}
	for key in pairs(schema) do
		local value = uci:get("openclash", "config", key)
		if value ~= nil then values[key] = value end
	end
	reply({ values = values })
end

function settings_set()
	local input = json.parse(HTTP.formvalue("values") or "")
	if type(input) ~= "table" then
		return reply({ error = "invalid values" }, 400)
	end

	for key, value in pairs(input) do
		local kind = schema[key]
		if not kind then
			return reply({ error = "unknown option " .. tostring(key) }, 400)
		end
		if kind == "list" and type(value) ~= "table" or kind == "value" and type(value) ~= "string" then
			return reply({ error = "invalid type for " .. key }, 400)
		end
		if value == "" or (kind == "list" and #value == 0) then
			uci:delete("openclash", "config", key)
		else
			uci:set("openclash", "config", key, value)
		end
	end

	uci:commit("openclash")
	reply({ ok = true })
end

function custom_file_get()
	local path = CUSTOM_FILES[HTTP.formvalue("id") or ""]
	if not path then return reply({ error = "unknown file" }, 404) end
	reply({ content = nixio.fs.readfile(path) or "" })
end

function custom_file_save()
	local path = CUSTOM_FILES[HTTP.formvalue("id") or ""]
	local content = HTTP.formvalue("content")
	if not path then return reply({ error = "unknown file" }, 404) end
	if type(content) ~= "string" or #content > CUSTOM_FILE_MAX then
		return reply({ error = "invalid content" }, 400)
	end
	if not nixio.fs.writefile(path, (content:gsub("\r\n", "\n"))) then
		return reply({ error = "write failed" }, 500)
	end
	reply({ ok = true })
end

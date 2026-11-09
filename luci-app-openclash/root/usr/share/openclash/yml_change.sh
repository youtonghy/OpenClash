#!/bin/sh
. /usr/share/openclash/ruby.sh
. /usr/share/openclash/log.sh
. /usr/share/openclash/uci.sh
. /lib/functions.sh

LOG_FILE="/tmp/openclash.log"
CONFIG_FILE="$5"

custom_host=$(uci_get_config "custom_host" || echo 0)
system_hostname=$(uci -q get system.@system[0].hostname 2>/dev/null)
dnsmasq_domain=$(uci -q get dhcp.@dnsmasq[0].domain 2>/dev/null)
china_ip_route=$(uci_get_config "china_ip_route" || echo 0)
china_ip6_route=$(uci_get_config "china_ip6_route" || echo 0)
china_ip_route_domain_source=$(uci_get_config "china_ip_route_domain_source" || echo "mrs")
enable_redirect_dns=2
fake_ip_filter_mode="${33}"
[ -z "$fake_ip_filter_mode" ] && fake_ip_filter_mode="blacklist"
default_dashboard=$(uci_get_config "default_dashboard" || echo "zashboard")
yacd_type=$(uci_get_config "yacd_type" || echo "Official")
dashboard_type=$(uci_get_config "dashboard_type" || echo "Official")
dashboard_forward_port=$(uci_get_config "dashboard_forward_port" || echo 0)
dashboard_forward_ssl=$(uci_get_config "dashboard_forward_ssl" || echo 0)
dashboard_custom_url=$(uci_get_config "dashboard_custom_url" || echo 0)

[ "$china_ip_route" -ne 0 ] && [ "$china_ip_route" -ne 1 ] && [ "$china_ip_route" -ne 2 ] && china_ip_route=0
[ "$china_ip6_route" -ne 0 ] && [ "$china_ip6_route" -ne 1 ] && [ "$china_ip6_route" -ne 2 ] && china_ip6_route=0
case "$china_ip_route_domain_source" in
   mrs|geosite) ;;
   *) china_ip_route_domain_source="mrs" ;;
esac

en_mode_tun=${11:-0}
if [ -z "${12}" ]; then
   stack_type=${30:-"mips"}
else
   stack_type=${12}
fi

# 获取认证信息
yml_auth_get()
{
   local section="$1"
   local enabled username password
   config_get_bool "enabled" "$section" "enabled" "1"
   config_get "username" "$section" "username" ""
   config_get "password" "$section" "password" ""

   if [ "$enabled" = "0" ]; then
      return
   fi

   if [ -z "$username" ] || [ -z "$password" ]; then
      return
   else
      LOG_TIP "You have seted the authentication of SOCKS5/HTTP(S) proxy with user【$username】..."
      echo "  - $username:$password" >>/tmp/yaml_openclash_auth
   fi
}

config_load "openclash"
config_foreach yml_auth_get "authentication"

OPENCLASH_CORS_DOMAIN="${36}" \
OPENCLASH_CORS_PORT="$dashboard_forward_port" \
OPENCLASH_CORS_SSL="$dashboard_forward_ssl" \
OPENCLASH_CORS_CUSTOM_URL="$dashboard_custom_url" \
ruby -ryaml -rYAML -I "/usr/share/openclash" -E UTF-8 -e "

def safe_load_yaml(file_path)
   return nil unless File.exist?(file_path)
   YAML.load_file(file_path)
rescue
   nil
end

def merge_list_from_file(dns_hash, key, file_path)
   return unless File.exist?(file_path)
   lines = File.readlines(file_path).map { |l| l.gsub(/#.*$/, '').strip }.reject(&:empty?)
   return if lines.empty?
   (dns_hash[key] ||= []).unshift(*lines).uniq!
end

def http_origin(raw_url)
   raw = raw_url.to_s.strip
   return nil if raw.empty?
   scheme = raw[/\A(https?):\/\//i, 1]
   return nil unless scheme
   scheme = scheme.downcase
   rest = raw.sub(/\Ahttps?:\/\//i, '')
   return nil if rest.include?('@')
   authority = rest.split(/[\/?#]/, 2).first.to_s
   return nil if authority.empty?
   host, port = if (m = authority.match(/\A\[([^\]]+)\](?::(\d+))?\z/))
                  [m[1], m[2]]
               elsif (m = authority.match(/\A([^:]+)(?::(\d+))?\z/))
                  [m[1], m[2]]
               else
                  [nil, nil]
               end
   return nil if host.nil? || host.empty?
   host = '[' + host + ']' if host.include?(':')
   default_port = scheme == 'https' ? 443 : 80
   port = port ? port.to_i : default_port
   return nil unless port.between?(1, 65_535)
   scheme + '://' + host + (port == default_port ? '' : ':' + port.to_s)
rescue
   nil
end

def controller_origin(domain, configured_port, ssl)
   domain = domain.to_s.strip
   return nil if domain.empty? || domain == '0'
   return nil if domain.include?('@')
   domain = domain.sub(/\Ahttps?:\/\//i, '')

   port_text = configured_port.to_s.strip
   authority = domain.split(/[\/?#]/, 2).first.to_s
   embedded_port = authority[/\A\[[^\]]+\]:(\d+)\z/, 1] || authority[/\A[^:]+:(\d+)\z/, 1]
   port_text = embedded_port if (port_text.empty? || port_text == '0') && embedded_port

   scheme = ssl.to_s == '1' ? 'https' : 'http'
   default_port = scheme == 'https' ? 443 : 80
   port_text = default_port.to_s if port_text.empty? || port_text == '0'
   return nil unless (port_text =~ /\A\d+\z/) && port_text.to_i.between?(1, 65_535)

   host = if authority =~ /\A\[[^\]]+\]/
              authority[/\A\[([^\]]+)\]/ , 1]
           else
              authority.split(':', 2).first
           end
   return nil if host.nil? || host.empty?
   host = '[' + host + ']' if host.include?(':')
   port = port_text.to_i
   scheme + '://' + host + (port == default_port ? '' : ':' + port.to_s)
rescue
   nil
end


begin
   config_file = '$5'
   Value = YAML.load_file_cached(config_file, '/tmp/yaml_change_marshal')
rescue Exception => e
   YAML.LOG_ERROR('Load File Failed,【%s】' % [e.message])
   exit
end

begin
   fake_ip_mode = '$1'
   secret = '$2'
   controller_port = '$3'
   redir_port = '$4'
   enable_ipv6 = '$6' == '1'
   http_port = '$7'
   socks_port = '$8'
   log_level = '$9'
   mode = '${10}'
   en_mode_tun = '$en_mode_tun'
   stack_type = '$stack_type'
   dns_listen_port = '${13}'
   mixed_port = '${14}'
   tproxy_port = '${15}'
   dns_ipv6 = '${16}' == '1'
   store_fake_ip = '${17}' == '1'
   enable_sniffer = '${18}' == '1'
   geodata_mode = '${19}' == '1'
   geodata_loader = '${20}'
   append_sniffer_config = '${21}' == '1'
   interface_name = '${22}'
   tcp_concurrent = '${23}' == '1'
   add_default_from_dns = '${25}' == '1'
   sniffer_parse_pure_ip = '${26}' == '1'
   find_process_mode = '${27}'
   fake_ip_range = '${28}'
   ipv6_mode = '${29}'
   unified_delay = '${31}' == '1'
   respect_rules = '${32}' == '1'
   fake_ip_filter_mode = '$fake_ip_filter_mode'
   routing_mark_setting = '${34}'
   quic_gso = '${35}' == '1'
   cors_origin = http_origin(ENV['OPENCLASH_CORS_CUSTOM_URL']) || controller_origin(ENV['OPENCLASH_CORS_DOMAIN'], ENV['OPENCLASH_CORS_PORT'], ENV['OPENCLASH_CORS_SSL'])
   geo_custom_url = '${37}'
   geoip_custom_url = '${38}'
   geosite_custom_url = '${39}'
   geoasn_custom_url = '${40}'
   fake_ip_range6 = '${46}'
   fake_ip_range6_enable = '${47}' == '1'
   global_ua = '${48}'
   default_dashboard = '$default_dashboard'
   yacd_type = '$yacd_type'
   dashboard_type = '$dashboard_type'

   china_ip_route = '$china_ip_route' != '0'
   china_ip6_route = '$china_ip6_route' != '0'
   china_ip_route_domain_source = '$china_ip_route_domain_source'
   custom_host = '$custom_host' == '1'
   enable_redirect_dns = '$enable_redirect_dns'

   Value['dns'] ||= {}
   threads = []

   threads << YAML::Inline.new do
      begin
         Value['redir-port'] = redir_port.to_i
         Value['tproxy-port'] = tproxy_port.to_i
         Value['port'] = http_port.to_i
         Value['socks-port'] = socks_port.to_i
         Value['mixed-port'] = mixed_port.to_i
         Value['mode'] = mode
         Value['log-level'] = log_level if log_level != '0'
         Value['allow-lan'] = true
         Value['external-controller'] = '0.0.0.0:' + controller_port
         Value['secret'] = secret
         Value['bind-address'] = '*'
         Value['global-ua'] = global_ua if global_ua != '0'
         Value['external-ui'] = '/usr/share/openclash/ui'
         Value['external-ui-name'] = default_dashboard
         case default_dashboard
         when 'dashboard'
         if dashboard_type == 'Official'
            Value['external-ui-url'] = 'https://codeload.github.com/ayanamist/clash-dashboard/zip/refs/heads/gh-pages'
         else
            Value['external-ui-url'] = 'https://codeload.github.com/MetaCubeX/Razord-meta/zip/refs/heads/gh-pages'
         end
         when 'yacd'
         if yacd_type == 'Official'
            Value['external-ui-url'] = 'https://codeload.github.com/haishanh/yacd/zip/refs/heads/gh-pages'
         else
            Value['external-ui-url'] = 'https://codeload.github.com/MetaCubeX/Yacd-meta/zip/refs/heads/gh-pages'
         end
         when 'metacubexd'
            Value['external-ui-url'] = 'https://codeload.github.com/MetaCubeX/metacubexd/zip/refs/heads/gh-pages'
         when 'zashboard'
            Value['external-ui-url'] = 'https://codeload.github.com/Zephyruso/zashboard/zip/refs/heads/gh-pages-cdn-fonts'
         end
         if !Value.key?('keep-alive-interval') && !Value.key?('keep-alive-idle')
            Value['keep-alive-interval'] = 15
            Value['keep-alive-idle'] = 600
         end
         Value['ipv6'] = enable_ipv6
         Value['interface-name'] = interface_name if interface_name != '0'
         Value['geodata-mode'] = true if geodata_mode
         Value['geodata-loader'] = geodata_loader if geodata_loader != '0'
         Value['tcp-concurrent'] = true if tcp_concurrent
         Value['unified-delay'] = true if unified_delay
         Value['find-process-mode'] = find_process_mode if find_process_mode != '0'

         (Value['experimental'] ||= {})['quic-go-disable-gso'] = true if quic_gso
         if cors_origin
            (Value['external-controller-cors'] ||= {})['allow-origins'] = [cors_origin]
            Value['external-controller-cors']['allow-private-network'] = true
         end

         Value['geox-url'] ||= {}
         if geo_custom_url != '0'
            Value['geox-url']['mmdb'] = geo_custom_url
         end
         if geoip_custom_url != '0'
            Value['geox-url']['geoip'] = geoip_custom_url
         end
         if geosite_custom_url != '0'
            Value['geox-url']['geosite'] = geosite_custom_url
         end
         if geoasn_custom_url != '0'
            Value['geox-url']['asn'] = geoasn_custom_url
         end

         Value['dns']['enable'] = true
         Value['dns']['ipv6'] = dns_ipv6
         Value['ipv6'] = true if dns_ipv6

         if fake_ip_mode == 'redir-host'
            Value['dns']['enhanced-mode'] = 'redir-host'
            Value['dns'].delete('fake-ip-range')
         else
            Value['dns']['enhanced-mode'] = 'fake-ip'
            Value['dns']['fake-ip-range'] = fake_ip_range
            if Value['dns']['ipv6'] and fake_ip_range6_enable
               Value['dns']['fake-ip-range6'] = fake_ip_range6
            end
         end
         Value['dns']['listen'] = '0.0.0.0:' + dns_listen_port
         Value['dns']['respect-rules'] = respect_rules

         if enable_sniffer
            sniffer_config = {
               'enable' => true, 'override-destination' => false,
               'sniff' => {'QUIC' => {'ports' => [443]}, 'TLS' => {'ports' => [443, 8443]}, 'HTTP' => {'ports' => [80, '8080-8880'], 'override-destination' => false}},
               'force-domain' => ['+.netflix.com', '+.nflxvideo.net', '+.amazonaws.com', '+.media.dssott.com'],
               'skip-domain' => ['Mijia Cloud', 'dlg.io.mi.com', '+.oray.com', '+.sunlogin.net', '+.push.apple.com']
            }
            sniffer_config['force-dns-mapping'] = true if fake_ip_mode == 'redir-host'
            sniffer_config['parse-pure-ip'] = true if sniffer_parse_pure_ip
            Value['sniffer'] = sniffer_config
            if append_sniffer_config && (custom_sniffer = safe_load_yaml('/etc/openclash/custom/openclash_custom_sniffer.yaml'))
               Value['sniffer'].merge!(custom_sniffer['sniffer']) if custom_sniffer && custom_sniffer['sniffer']
            end
         else
            Value['sniffer']['enable'] = false if Value.key?('sniffer')
         end

         if en_mode_tun != '0' || ['2', '3'].include?(ipv6_mode)
            Value['tun'] = {
               'enable' => true, 'stack' => stack_type, 'device' => 'utun',
               'dns-hijack' => ['127.0.0.1:53'], 'endpoint-independent-nat' => true,
               'auto-route' => false, 'auto-detect-interface' => false,
               'auto-redirect' => false, 'strict-route' => false, 'disable-icmp-forwarding' => false,
               'gso' => true
            }
            Value['tun'].delete('iproute2-table-index')
         else
            Value.delete('tun')
         end

         Value.delete('iptables')
         (Value['profile'] ||= {})['store-selected'] = true
         Value['profile']['store-fake-ip'] = true if store_fake_ip
         Value.delete('ebpf')

         if routing_mark_setting == '0'
            Value['routing-mark'] = 6666
         else
            Value.delete('routing-mark')
         end
         Value.delete('auto-redir')

         (Value['ntp'] ||= {})['enable'] = true
         Value['ntp']['server'] = 'time.apple.com' if !Value['ntp'].key?('server')
         Value['ntp']['port'] = 123 if !Value['ntp'].key?('port')
         Value['ntp']['interval'] = 30 if !Value['ntp'].key?('interval')
         Value['ntp']['write-to-system'] = true if !Value['ntp'].key?('write-to-system')

      rescue Exception => e
         YAML.LOG_ERROR('Set General Failed,【%s】' % [e.message])
      end
   end

   threads << YAML::Inline.new do
      begin
         if add_default_from_dns
            reg = /^dhcp:\/\/|^system($|:\/\/)|([0-9a-zA-Z-]{1,}\.)+([a-zA-Z]{2,})/
            servers_to_check = Value.dig('dns', 'nameserver').to_a | Value.dig('dns', 'fallback').to_a
            non_domain_servers = servers_to_check.reject { |s| s.match?(reg) }
            if non_domain_servers.any?
               (Value['dns']['default-nameserver'] ||= []).concat(non_domain_servers).uniq!
            end
         end
      rescue Exception => e
         YAML.LOG_ERROR('Set default-nameserver Failed,【%s】' % [e.message])
      end

   end

   # Custom Hosts
   threads << YAML::Inline.new do
      begin
         if custom_host
            if (hosts_content = safe_load_yaml('/etc/openclash/custom/openclash_custom_hosts.list')) && !hosts_content.empty?
               Value['dns']['use-hosts'] = true
               if hosts_content.is_a?(Hash) && hosts_content.key?('hosts')
                  (Value['hosts'] ||= {}).merge!(hosts_content['hosts'])
               else
                  (Value['hosts'] ||= {}).merge!(hosts_content)
               end
               YAML.LOG_WARN('You May Need to Turn off The Rebinding Protection Option of Dnsmasq When Hosts Has Set a Reserved Address...')
            end
         end
      rescue Exception => e
         YAML.LOG_ERROR('Set Hosts Rules Failed,【%s】' % [e.message])
      end
   end

   # Authentication
   threads << YAML::Inline.new do
      begin
         if (auth_config = safe_load_yaml('/tmp/yaml_openclash_auth'))
            Value['authentication'] = auth_config
         end
      rescue Exception => e
         YAML.LOG_ERROR('Set authentication Failed,【%s】' % [e.message])
      end
   end

   threads.each(&:join)

   begin
      threads.clear

      # Built-in hosts for common OpenWrt router hostnames, resolve to router LAN IP
      begin
         Value['hosts'] ||= {}
         builtin_hosts = {
            'openwrt.lan' => 'lan',
            'immortalwrt.lan' => 'lan',
            'lede.lan' => 'lan',
            'router.lan' => 'lan'
         }
         system_hostname = '$system_hostname'
         dnsmasq_domain = '$dnsmasq_domain'
         builtin_hosts[system_hostname.to_s + '.lan'] = 'lan' unless system_hostname.to_s.empty?
         builtin_hosts[system_hostname.to_s + '.' + dnsmasq_domain.to_s] = 'lan' unless system_hostname.to_s.empty? || dnsmasq_domain.to_s.empty?
         builtin_hosts.each { |k, v| Value['hosts'][k] ||= v }
         Value['dns']['use-hosts'] = true
      rescue Exception => e
         YAML.LOG_ERROR('Set Built-in Hosts Failed,【%s】' % [e.message])
      end

      # DNS Loop Check
      if enable_redirect_dns == '1'
         dns_options = ['nameserver', 'fallback', 'default-nameserver', 'proxy-server-nameserver', 'nameserver-policy', 'direct-nameserver', 'proxy-server-nameserver-policy']
         dns_options.each do |option|
            threads << YAML::Inline.new(option) do |opt|
               begin
                  next unless Value['dns'].key?(opt) && !Value['dns'][opt].nil?
                     if opt != 'nameserver-policy' && opt != 'proxy-server-nameserver-policy'
                        original_size = Value['dns'][opt].size
                        Value['dns'][opt].reject! { |v| v.to_s.match?(/^system($|:\/\/)/) }
                        if Value['dns'][opt].size < original_size
                           YAML.LOG_TIP('Option【%s】is Setted【system】as DNS Server Which May Cause DNS Loop, Already Remove It...' % [opt])
                        end
                     else
                        Value['dns'][opt].each do |k, v|
                           if v.is_a?(Array)
                              original_size = v.size
                              v.reject! { |z| z.to_s.match?(/^system($|:\/\/)/) }
                              if v.empty?
                                 Value['dns'][opt].delete(k)
                                 YAML.LOG_TIP('Option【%s - %s】is Setted【system】as DNS Server Which May Cause DNS Loop, Already Remove It...' % [opt, k])
                              elsif v.size < original_size
                                 YAML.LOG_TIP('Option【%s - %s】is Setted【system】as DNS Server Which May Cause DNS Loop, Already Remove It...' % [opt, k])
                              end
                           elsif v.to_s.match?(/^system($|:\/\/)/)
                              Value['dns'][opt].delete(k)
                              YAML.LOG_TIP('Option【%s - %s】is Setted【%s】as DNS Server Which May Cause DNS Loop, Already Remove It...' % [opt, k, v.to_s])
                           end
                        end
                     end
               rescue Exception => e
                  YAML.LOG_ERROR('DNS Loop Check,【%s】' % [e.message])
               end
            end
         end
         threads.each(&:join)
      end

      if Value.dig('dns', 'nameserver').to_a.empty?
         YAML.LOG_TIP('Detected That The nameserver DNS Option Has No Server Set, Starting To Complete...')
         Value['dns']['nameserver'] = ['114.114.114.114', '119.29.29.29', '8.8.8.8', '1.1.1.1']
         Value['dns']['fallback'] ||= ['https://dns.cloudflare.com/dns-query', 'https://dns.google/dns-query']
      end

      if Value['dns'].key?('default-nameserver') && Value['dns']['default-nameserver'].to_a.empty?
         YAML.LOG_TIP('Detected That The default-nameserver DNS Option Has No Server Set, Starting To Complete...')
         Value['dns']['default-nameserver'] = ['114.114.114.114', '119.29.29.29', '8.8.8.8', '1.1.1.1']
      end

      # proxy-server-nameserver
      local_exclude = (%x{ls -l /sys/class/net/ |awk '{print \$9}'  2>&1}.each_line.map(&:strip) + ['h3=', 'skip-cert-verify=', 'ecs=', 'ecs-override=', 'disable-ipv6=', 'disable-ipv4=', 'disable-qtype-', 'disable-reuse='] + ['utun', 'tailscale0', 'docker0', 'tun163', 'br-lan', 'mihomo']).uniq.join('|')
      non_domain_reg = /^dhcp:\/\/|^system($|:\/\/)|([0-9a-zA-Z-]{1,}\.)+([a-zA-Z]{2,})/
      proxied_server_reg = /^[^#&]+#(?:(?:#{local_exclude})[^&]*&)*(?:(?!(?:#{local_exclude}))[^&]+)/
      servers_to_check = Value.dig('dns', 'nameserver').to_a | Value.dig('dns', 'fallback').to_a | Value.dig('dns', 'default-nameserver').to_a
      default_proxy_servers = servers_to_check.reject { |s| s.match?(non_domain_reg) }
      if ! default_proxy_servers.any? || default_proxy_servers.all? { |x| x.match?(proxied_server_reg) }
         default_proxy_servers = ['114.114.114.114', '119.29.29.29', '8.8.8.8', '1.1.1.1']
      end
      proxy_server_nameserver_policy = Value.dig('dns', 'proxy-server-nameserver-policy') && !Value['dns']['proxy-server-nameserver-policy'].empty?

      if Value.dig('dns', 'proxy-server-nameserver').to_a.empty?
         all_ns_proxied = Value.dig('dns', 'nameserver').to_a.all? { |x| x.match?(proxied_server_reg) }
         if respect_rules || Value.dig('dns', 'respect-rules').to_s == 'true' || all_ns_proxied || proxy_server_nameserver_policy
            Value['dns']['proxy-server-nameserver'] = default_proxy_servers
            if all_ns_proxied
               YAML.LOG_TIP('Nameserver Option Maybe All Setted The Proxy Option, Auto Set Proxy-server-nameserver Option to【%s】For Avoiding Proxies Server Resolve Loop...' % [default_proxy_servers.join(', ')])
            elsif proxy_server_nameserver_policy
               YAML.LOG_TIP('【Proxy-server-nameserver-policy】Need Proxy-server-nameserver Option Must Be Setted, Auto Set to【%s】' % [default_proxy_servers.join(', ')])
            else
               YAML.LOG_TIP('【Respect-rules】Need Proxy-server-nameserver Option Must Be Setted, Auto Set to【%s】' % [default_proxy_servers.join(', ')])
            end
         end
      else
         all_psn_proxied = Value.dig('dns', 'proxy-server-nameserver').to_a.all? { |x| x.match?(proxied_server_reg) }
         if all_psn_proxied
            (Value['dns']['proxy-server-nameserver'] ||= []).concat(default_proxy_servers).uniq!
            YAML.LOG_TIP('Proxy-server-nameserver Option Maybe All Setted The Proxy Option, Auto Set Proxy-server-nameserver Option to【%s】For Avoiding Proxies Server Resolve Loop...' % [default_proxy_servers.join(', ')])
         end
      end
   rescue Exception => e
      YAML.LOG_ERROR('Config File params checked Failed,【%s】' % [e.message])
   end
rescue Exception => e
   YAML.LOG_ERROR('Config File Overwrite Failed,【%s】' % [e.message])
ensure
   begin
      YAML.dump(Value, config_file)
      YAML.cache_write(config_file, Value, '/tmp/yaml_change_marshal')
   rescue Exception => e
      YAML.LOG_ERROR('Write file failed:【%s】' % [e.message])
      File.delete('/tmp/yaml_change_marshal') rescue nil
   end
end
" 2>/dev/null >> $LOG_FILE

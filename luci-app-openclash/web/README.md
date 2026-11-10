# RouterClash web app

The LuCI pages of this package are a React app built from this directory. The router only serves
the built files; Node is not needed on the device.

```sh
npm install
npm run build   # writes to ../root/www/luci-static/resources/openclash/app
npx oxlint src/pages src/lib src/App.tsx
```

The built files are committed so the OpenWrt SDK can package them without Node. Run the build and
commit the result whenever `src/` changes.

## Data flow

- `luasrc/controller/openclash.lua` only declares routes. Handlers live in
  `luasrc/openclash/api/*.lua` and load on first use.
- Mutating routes use LuCI's `post()` and need the token from `window.__OC__`. Upload routes read the
  token from the query string, because their body must not be parsed before the file handler is set.
- Live traffic, proxy groups, connections and providers come straight from the mihomo controller,
  through `/oc-api` when nginx provides it and otherwise on the controller port.
- `device_names` maps LAN addresses to device names (DHCP settings, leases and the neighbour table) for
  the connections page. Addresses without a name are shown shortened in a pill.
- The subscriptions page reads `subscriptionInfo` from mihomo. It is absent when the provider sent no
  usage header, and those providers are listed last. A `Total` of 0 means no traffic cap and an `Expire`
  of 0 means no end date.
- The statistics page charts live data only. Availability uses the last ten test results mihomo keeps per
  node, and the traffic globe reads each exit place from the node's flag or region name.
- Choosing a node on the proxy groups page closes that group's connections, so they reconnect through
  the new node. Testing a pinned automatic group re-pins it, because the controller clears the pin.

## Kill switch

`root/usr/share/openclash/openclash_killswitch.sh` keeps LAN devices from going direct while RouterClash
should be proxying but is not. It is on by default (`kill_switch` in UCI).

- A blackhole fallback in policy table 354 catches marked traffic the moment `utun` disappears.
- A separate firewall chain (fw3) or table (fw4) rejects LAN to internet traffic while the proxy rules
  are absent. It is also a firewall include, so it applies from boot.
- The router itself, the admin pages, private ranges, VPN interfaces and devices listed as not proxied
  are left alone. Stopping RouterClash from the page releases the block.

Escape hatches: the "allow direct access" button on the overview page, the setting, or
`openclash_killswitch.sh bypass` over SSH.

## Settings

`src/generated/settings-schema.json` describes every option on the settings page, and
`luasrc/openclash/api/settings_schema.lua` is the allowlist the API writes. Keep the two in step when
adding an option.

## Arc components

`src/components/arc` holds Arc and Arc Pro source installed with the shadcn CLI, including local changes.
Arc Pro is licensed, so it lives in the private repository
[youtonghy/RouterClash-arc](https://github.com/youtonghy/RouterClash-arc), mounted here as a git submodule.
The public repository only records which commit to use. Packaging does not need it, because the built
bundle is committed.

```sh
git submodule update --init   # needs read access to RouterClash-arc
```

Changing or adding components:

```sh
npx shadcn@latest add @uiarc/<name>       # needs ARC_PRO_TOKEN in .env.local, which git ignores
npx shadcn@latest add @uiarc-pro/<name>
cd src/components/arc && git add -A && git commit -m "..." && git push   # commit in the private repo first
cd - && git add src/components/arc                                        # then record the new commit here
```

The Check workflow reads the private repository with the `ARC_DEPLOY_KEY` secret, a read-only deploy key.
Without it (forks, pull requests from forks) the web build is skipped.

## Packaging

`../tools/build-ipk.sh <output-dir>` builds the ipk without the OpenWrt SDK.

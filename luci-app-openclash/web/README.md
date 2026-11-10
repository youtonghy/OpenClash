# RouterClash web app

The LuCI pages of this package are a React app built from this directory. The router only serves
the built files; Node is not needed on the device.

```sh
npm install
npm run arc     # fetch the Arc components (needs ARC_PRO_TOKEN, see "Arc components" below)
npm run build   # writes to ../root/www/luci-static/resources/openclash/app
npx oxlint src/pages src/lib src/App.tsx
```

The built files are not committed. CI builds them for every package and `../tools/build-ipk.sh` packs
whatever is in that folder, so run `npm run build` before packaging by hand.

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

Arc Pro is licensed, so no Arc source is committed. `src/components/arc` is ignored by git and rebuilt from
the registry by `npm run arc` (`predev` and `prebuild` run it when the folder is missing). It needs
`ARC_PRO_TOKEN`, from the environment or from `.env.local`, which git ignores. CI reads the `ARC_PRO_TOKEN`
secret and fetches fresh components on every run; forks and pull requests from forks have no secret, so they
skip the web build.

- `arc.json` lists the registry items to fetch.
- `arc-overrides/` holds the four files we rewrote as a whole (the traffic globe and the availability block
  with their data). They are copied over the fetched files.
- `scripts/arc-patches.mjs` holds the small edits applied to other files. Each one must match exactly once, so
  a registry update that moves the code fails the build instead of passing silently.

To add an item, append it to `arc.json`. Do not use `npx shadcn add` for Arc: with the `base-nova` style it
rewrites Radix `asChild` and drops comments, while `npm run arc` writes the registry files as published.

## Packaging

`../tools/build-ipk.sh <output-dir>` builds the ipk without the OpenWrt SDK.

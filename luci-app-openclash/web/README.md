# OpenClash web app

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
- Live traffic, connections and providers come straight from the mihomo controller, through
  `/oc-api` when nginx provides it and otherwise on the controller port.

## Settings

`src/generated/settings-schema.json` describes every option on the settings page, and
`luasrc/openclash/api/settings_schema.lua` is the allowlist the API writes. Keep the two in step when
adding an option.

## Arc components

`src/components/arc` holds Arc and Arc Pro source installed with the shadcn CLI. Installing more needs
`ARC_PRO_TOKEN` in `.env.local`, which is ignored by git:

```sh
npx shadcn@latest add @uiarc/<name>
npx shadcn@latest add @uiarc-pro/<name>
```

## Packaging

`../tools/build-ipk.sh <output-dir>` builds the ipk without the OpenWrt SDK.

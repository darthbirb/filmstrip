# Filmstrip

A gallery viewer and collection organiser for Windows. It runs locally against folders on
your own disk, with no account and no network service. A folder is a real directory and an
item is a real file under its own name.

**Status:** early. The backend is being brought over and the interface is being built from
scratch.

## Running it

Node 24, Rust stable, and Windows with Edge. `pnpm` runs through `npx` at a pinned version —
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) explains why.

```bash
npx --yes pnpm@12.4.1 install
npx --yes pnpm@12.4.1 tauri dev
```

## Docs

- [docs/PRODUCT.md](docs/PRODUCT.md) — what the app does
- [docs/DECISIONS.md](docs/DECISIONS.md) — why it is built this way
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — how to work on it
- [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md)

## Licence

[GPL-3.0-or-later](LICENSE). The name and the mark are covered separately — see
[TRADEMARKS.md](TRADEMARKS.md).

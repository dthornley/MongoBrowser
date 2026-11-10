# MongoBrowser

A Robo3T-style MongoDB GUI that runs natively on Apple Silicon Macs. Same way of working as Robo3T:
an explorer tree on the left, shell-syntax query tabs on the right, Tree / Table / Text result views,
a paging bar, and right-click menus for everything.

Built with Electron + TypeScript + React, the official `mongodb` Node driver, and CodeMirror.

**Download:** grab the latest signed, notarized `.dmg` from the
[Releases page](https://github.com/dthornley/MongoBrowser/releases) (Apple Silicon only).

## Publishing a release

```sh
npm run release 0.4.0      # bumps package.json, builds, signs, notarizes, tags, pushes, creates the GitHub release
```

Write the notes in `RELEASE_NOTES.md` first (git-ignored); otherwise the commit messages since the last tag are used.
The release includes `latest-mac.yml`, which the in-app updater reads.

## Updates

**MongoBrowser › Check for Updates…** (and a silent check on launch) compares against GitHub Releases and can
download and install the new version in place.

## Importing Robo3T connections

**File › Import Robo3T Connections…** reads `~/.3T/robo-3t/<version>/robo3t.json` and decrypts saved passwords with
`~/.3T/robo-3t/robo3t.key` (Qt SimpleCrypt). Copy both files from the old Mac into the same locations, or pick them in the dialog.

## Features

- **Connection manager** – saved connections (direct host, replica set, or URI) with authentication
  (SCRAM, X.509, PLAIN, AWS), TLS with CA / client cert, and SSH tunnels (password or private key).
  Connections are stored encrypted with the macOS keychain (`safeStorage`).
- **Explorer** – servers → databases → Collections / System / Functions / Users; collection nodes
  expand to show indexes. Double-click a collection to view its documents.
- **Shell-syntax query tabs** – type `db.orders.find({ total: { $gt: 10 } }).sort({ when: -1 })`,
  `aggregate([...])`, `updateMany`, `getIndexes()`, `db.stats()`, `use otherdb`, `show collections`,
  `print()` / `printjson()`, even `await` – run with ⌘↩ or F5. All the shell helpers are there:
  `ObjectId`, `ISODate`, `NumberLong`, `NumberInt`, `NumberDecimal`, `UUID`, `BinData`, `Timestamp`,
  `MinKey` / `MaxKey`, `DBRef`, `Code`.
- **Results** – Tree (Key / Value / Type), Table, and Text modes (⌘1/2/3), paging with skip / limit
  (⌘← / ⌘→), elapsed time, and the document count.
- **Document editing** – edit / insert / view documents in shell syntax with validation; delete; copy
  value / key / path; expand or collapse recursively.
- **Admin** – create / drop databases and collections (incl. capped), rename, duplicate, copy to
  another database or server, export to JSON, add / drop indexes (unique, sparse, TTL, partial),
  add / drop users, statistics, server status, host info, server log, current operations.
- **Scripts** – load (⌘O) and save (⌘S) query scripts.

## Development

```sh
npm install
npm run dev        # starts Vite + Electron with hot reload
npm run typecheck
```

If the window never appears and the log shows `Cannot read properties of undefined (reading 'whenReady')`,
your shell has `ELECTRON_RUN_AS_NODE=1` set (some tools export it). Run `env -u ELECTRON_RUN_AS_NODE npm run dev`.

A throwaway server for testing:

```sh
docker run -d --name mongo-test -p 27017:27017 mongo:7
```

## Building a release

```sh
npm run dist:unsigned   # unsigned arm64 .dmg and .zip in release/ (fine for your own Mac)
npm run dist            # signed + notarized build using your Apple Developer account
```

`npm run dist` signs with the *Developer ID Application* certificate in the login keychain (discovered
automatically) and notarizes with the `notarytool` keychain profile named `MongoBrowser`. To use a different profile:

```sh
APPLE_KEYCHAIN_PROFILE=MyProfile npm run dist
```

If the profile is ever missing (new Mac), recreate it once — you'll be prompted for an app-specific
password from https://account.apple.com:

```sh
xcrun notarytool store-credentials "MongoBrowser" --apple-id <your-apple-id> --team-id <team-id>
```

Verify a build with `codesign --verify --deep --strict release/mac-arm64/MongoBrowser.app`,
`spctl --assess --type execute release/mac-arm64/MongoBrowser.app` (expect `Notarized Developer ID`)
and `xcrun stapler validate release/mac-arm64/MongoBrowser.app`.

## Layout

```
src/main/            Electron main process
  index.ts           window, application menu
  ipc.ts             every IPC handler (connections, admin, queries, dialogs)
  store.ts           encrypted connection + settings persistence
  mongo/ClientManager.ts   MongoClient lifecycle, SSH tunnels, TLS/auth option mapping
  mongo/shell.ts     sandboxed evaluator for mongo-shell-style scripts (db.*, cursors, helpers)
src/preload/         contextBridge API exposed to the renderer (window.api)
src/renderer/src/    React UI: Explorer, QueryTab, result views, dialogs
src/shared/          IPC types and the shell-syntax formatter used by both sides
```

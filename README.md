# DevToolbox

![DevToolbox](devtoolbox.png)

A terminal-styled toolbox with the utilities software engineers reach for
every day.

## Tools

| Tool | Route | What it does |
| --- | --- | --- |
| QR Studio | `#/qr` | Generate QR codes (text, Wi-Fi, e-mail, MECARD, TOTP) and decode codes from **pasted**, dropped, uploaded or remote images. |
| JWT Workbench | `#/jwt` | Decode, verify and **sign** JSON Web Tokens (HS/RS/PS/ES 256-512) with jwt.io-style segment colouring and claim explanations. HMAC and PKCS#8 / SPKI keys use the Web Crypto API in the browser; PKCS#1, SEC1 and X.509 certificates are handled by the Rust backend. |
| URL Codec | `#/url` | Percent-encode/decode (component, full URI, form), deep-decode nested encodings and dissect a URL into its parts and query parameters. |
| JSON Formatter | `#/json` | Format, minify, sort keys, escape/unescape, inline lint, collapsible tree view, document statistics and a JSONPath-ish query box. |
| Base64 Codec | `#/base64` | Unicode-safe Base64 / Base64URL for text **and files**, MIME line wrapping, hex preview, data-URI export and binary download. |
| RegEx Lab | `#/regex` | Live matching with in-editor highlighting, capture groups, substitution, split, a pattern explainer and a cheat sheet. |
| ID Generator | `#/uuid` | Bulk UUID v4/v7, ULID, NanoID, hex tokens; plain/JSON/SQL output formats and a UUID inspector. |
| Hex Editor | `#/hex` | Read, edit and save binary files of **any size** - the file is never held in memory, only the chunks you look at. Multi-document tabs, insert/overwrite editing, unlimited undo, multi-range selections, search & replace (hex wildcards, 40+ encodings, numbers), data inspector, bit editor, bookmarks, histogram & entropy, streaming hashes, format identification, Intel HEX / S-Record, file merging, live preview and code export. |
| REST Client | `#/rest` | Postman-like HTTP client: methods, query params, headers, auth (bearer/basic/API key), JSON/text/multipart/urlencoded bodies, timing, cURL export and request history. |
| X.509 Forge | `#/certificates` | Generate key pairs (ECDSA, Ed25519, RSA) or paste your own, issue self-signed, root/intermediate CA and CA-signed certificates, create and sign CSRs, inspect certificates and export everything as `.pem`, `.crt`, `.cert`, `.der`, `.cer` or `.key`. |

Press <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>K</kbd> anywhere to open the quick switcher.

## Getting started

### Frontend

```bash
pnpm install
pnpm run dev        # http://localhost:5173
```

`npm run dev` proxies `/api` and `/rest` to `http://localhost:8080`, so start the Rust backend
(`cargo run` in the repository root) when working on the REST client or the X.509 forge.

Other scripts:

```bash
pnpm run build      # type-check (vue-tsc) + production build into dist/
pnpm run preview    # serve the production build
pnpm run typecheck  # type-check only
```

The build output in `dist/` is a plain static bundle. It uses hash based routing, so it can be
dropped on any static host (or opened from a file server) without server-side rewrites.

> **Registry note:** `.npmrc` pins this project to the public npm registry so it installs
> independently of any corporate registry configured globally.

#### Tech stack

- **Vue 3.5** (`<script setup>`, generics, `defineModel`) + **TypeScript** in strict mode
- **Vite 6** for dev server and bundling
- **Vue Router 4** with hash history and route-level code splitting
- **CodeMirror 6** for every editor surface
- `qrcode` (encoding) and `jsqr` (decoding)

#### Project layout

```
src/
├── assets/styles/
│   ├── tokens.css        # every colour, spacing and radius token — re-skin here
│   └── main.css          # global base styles + shared primitive classes
├── components/
│   ├── editor/           # CodeMirror wrapper, theme and custom extensions
│   │   ├── CodeEditor.vue      # the single editor component used by all tools
│   │   ├── cmSetup.ts          # language + base extension presets
│   │   ├── cmTheme.ts          # hacker theme + syntax highlighting
│   │   ├── jwtHighlight.ts     # colours the three JWT segments
│   │   └── rangeHighlight.ts   # generic range decorations (regex matches)
│   ├── hex/              # virtualised hex grid and its side panels
│   ├── layout/           # sidebar, top bar, status bar, command palette, split panes
│   └── ui/               # reusable presentational kit (panel, button, toast, …)
├── composables/          # clipboard, toasts, persisted state, image paste, hex workspace
├── lib/                  # pure, framework-free logic — unit-test friendly
│   ├── bytes.ts  jwt.ts  json.ts  url.ts  uuid.ts  regex.ts  qr.ts  http.ts
│   ├── certificates.ts   # typed client for the backend certificate API
│   └── hex/              # byte sources, piece table, encodings, search, hashes, …
├── router/               # routes generated from the tool registry
├── tools/registry.ts     # single source of truth for nav, routes and search
└── views/                # one view per tool, thin orchestration over lib/
```

#### Architectural rules

1. **Logic lives in `src/lib`.** Views only wire inputs, outputs and presentation. Every
   module there is pure and free of Vue imports, so it can be tested in isolation.
2. **One editor component.** Tools never instantiate CodeMirror directly; they configure
   `CodeEditor.vue` through props and pass extra extensions via the `extensions` prop.
3. **One registry.** Adding a tool means adding an entry to `src/tools/registry.ts` and a
   view file — navigation, routing, the command palette and search update automatically.
4. **Tokens over literals.** Colours and spacing come from `tokens.css`; component styles are
   scoped and never hardcode a palette value.
5. **State is persisted** through `usePersistentState`, so tool inputs survive a reload.
6. **Two panel work areas use `SplitPane`** (`components/layout/SplitPane.vue`). It renders the
   two panels with a draggable divider, remembers the ratio per `storage-key`, and stacks the
   panels once the view gets narrower than `stack-below` (760px by default). Use
   `sizing="content"` for panel pairs that are as tall as their content, `orientation="vertical"`
   for a split that is always top/bottom. The divider also responds to the arrow keys,
   <kbd>Home</kbd>/<kbd>End</kbd> and resets to the default ratio on double click.

#### How the hex editor handles large files

The editor never holds a file in memory, which is what lets it open an image that is larger
than the machine's RAM:

```
lib/hex/
├── source.ts       # ByteSource: 64 KiB chunk reader over a File (LRU cached),
│                   # in-memory buffers, virtual fill sources, append store
├── document.ts     # piece table - the document is a list of descriptors, so
│                   # insert/overwrite/delete copy nothing and undo is free
├── encodings.ts    # 40+ code pages incl. IBM437 and EBCDIC, per-cell decoding
├── inspector.ts    # ints, floats, LEB128/VLQ, GUIDs, six date/time formats
├── search.ts       # streaming scan in 1 MiB windows, bitmask patterns
├── parsers.ts      # clipboard/payload parsing (hex, Base64, escapes, numbers)
├── exporters.ts    # source code, hex dump, CSV, BaseXX
├── hashes.ts       # incremental CRC/Adler/XOR/Sum, MD5, SHA-1/224/256/384/512
├── signatures.ts   # magic byte file format identification
├── stats.ts        # histogram, entropy and descriptive statistics
└── records.ts      # Intel HEX and Motorola S-Record codecs
```

1. **Reading.** `FileByteSource` slices the `File` on demand; only the 64 KiB chunks the grid
   currently shows are fetched and cached. `HexGrid.vue` renders just the visible rows and maps
   the scrollbar onto the row range once the virtual content exceeds the browser's pixel limit,
   so the last row of a 3 GiB file is still reachable.
2. **Editing.** Every edit is a splice in the piece table: the bytes you type go into an
   append-only store, everything else keeps pointing at the original file. Undo/redo only
   restores descriptors, which is why the history is unlimited. Filling a gigabyte with `0xFF`
   costs one descriptor.
3. **Saving.** `document.blobParts()` turns the piece list into `Blob` parts; parts that come
   from the original file stay references, so the browser streams them from disk to the new
   file. Where the File System Access API is available the document can be written back in
   place, otherwise it is downloaded.

#### Adding a new tool

1. Create `src/views/MyToolView.vue`.
2. Put the non-UI logic in `src/lib/my-tool.ts`.
3. Register it:

```ts
// src/tools/registry.ts
{
  id: 'my-tool',
  path: '/my-tool',
  name: 'My Tool',
  short: 'MT',
  tagline: 'What it does in one line.',
  icon: 'wand',                       // key from components/ui/icons.ts
  keywords: ['my', 'tool'],
  component: () => import('@/views/MyToolView.vue'),
}
```

### Backend

```bash
cargo run
```

#### Tech stack

- **Rust** 2024 edition
- **rcgen** certificate generation and handling
- **aws-lc-rs** JWT signing and verification (HMAC, RSA PKCS#1 v1.5 / PSS, ECDSA)

#### JWT API

`POST /api/jwt/sign` and `POST /api/jwt/verify` work on the already base64url encoded
`header.payload` string, so the caller keeps full control over the token layout:

```bash
curl -s localhost:8080/api/jwt/sign -H 'content-type: application/json' -d '{
  "algorithm": "RS256",
  "key": "-----BEGIN RSA PRIVATE KEY-----\n...",
  "signing_input": "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0"
}'
# {"signature":"..."}   (base64url, ready to append as the third segment)

curl -s localhost:8080/api/jwt/verify -H 'content-type: application/json' -d '{
  "algorithm": "RS256",
  "key": "-----BEGIN CERTIFICATE-----\n...",
  "signing_input": "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0",
  "signature": "..."
}'
# {"valid":true}
```

| algorithms | sign with | verify with |
| --- | --- | --- |
| `HS256/384/512` | secret (`key_format`: `utf8` default, or `base64`) | the same secret |
| `RS*`, `PS*` | `PRIVATE KEY` (PKCS#8) or `RSA PRIVATE KEY` (PKCS#1), 2048-8192 bit | `PUBLIC KEY` (SPKI), `RSA PUBLIC KEY` (PKCS#1) or `CERTIFICATE` |
| `ES256/384/512` | `PRIVATE KEY` (PKCS#8) or `EC PRIVATE KEY` (SEC1) on P-256 / P-384 / P-521 | `PUBLIC KEY` (SPKI) or `CERTIFICATE` |

A signature that does not match answers `200 {"valid": false}`; malformed input (wrong key
type for the algorithm, bad PEM, ...) answers `400 {"error": "..."}`. Encrypted private keys
are not supported.


## Notes and limitations
- JWT keys: the browser's Web Crypto API only imports **PKCS#8** private keys and **SPKI**
  public keys, and those (plus HMAC secrets) are signed and verified in the tab without any
  server. Every other PEM flavour - **PKCS#1** (`RSA PRIVATE KEY`, `RSA PUBLIC KEY`), **SEC1**
  (`EC PRIVATE KEY`) and X.509 `CERTIFICATE`s - is transparently sent to the local Rust backend
  (`/api/jwt`), so no `openssl pkcs8 -topk8` conversion is needed. Without a running backend
  those formats report that the server is unreachable; encrypted private keys must be
  decrypted first (`openssl pkcs8 -in key.pem -out key.pkcs8.pem`).
- The X.509 forge delegates all cryptography to the Rust backend (`rcgen`) under
  `/api/certificates`; keys and certificates are generated locally and the results, including
  private keys, are cached in `localStorage` so a generated CA can sign further certificates.
  Use the vault's *Clear* button on shared machines.
- The hex editor works entirely in the browser. Files are read in 64 KiB chunks straight from
  disk, so opening a multi-gigabyte image is instant and uses a few MiB of memory. Saving
  needs either the File System Access API (Chromium: *Save* writes back into the opened file)
  or falls back to a download. BaseXX exports, clipboard copies and code snippets materialise
  the selected range and are therefore capped.
- Secrets, tokens and files never leave the tab — they are only kept in memory and in
  `localStorage` on your own machine.

### Build Binary

Building Backend & Frontend as binary

**target:** debug

```bash
make build-all-dev
```

**target:** release

```bash
make build-all-prod
```
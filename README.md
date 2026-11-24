# git2pdf: Technical Notes
 
Live site: https://git2pdf.devs.surf/
 
git2pdf turns a code project into one organised, print-ready PDF. The user gives a GitHub repo, a ZIP, or a set of files. They pick which files to include, put them in order, and print to PDF in colour or in black and white.
 
Everything runs in the browser. The only server-side piece is one tiny Cloudflare Worker, and it exists only for "Login with GitHub".
 
---
 
## Contents
 
1. [Stack](#1-stack)
2. [Project layout](#2-project-layout)
3. [Architecture](#3-architecture)
4. [User flow](#4-user-flow)
5. [Input methods](#5-input-methods)
6. [Data model](#6-data-model)
7. [File selection rules](#7-file-selection-rules)
8. [Fetching and highlighting](#8-fetching-and-highlighting)
9. [PDF generation](#9-pdf-generation)
10. [Security and privacy](#10-security-and-privacy)
11. [Limits and known issues](#11-limits-and-known-issues)
12. [Make your own](#12-make-your-own)
13. [Customising](#13-customising)
14. [Troubleshooting](#14-troubleshooting)
---
 
## 1. Stack
 
| Piece | Used for | Runs where |
|---|---|---|
| Plain HTML, CSS, JS | The whole app. No framework, no build step | Browser |
| GitHub REST API | Repo info, file tree, file contents, user info, repo list | Browser calls GitHub directly |
| raw.githubusercontent.com | File contents of public repos (not counted against the API limit) | Browser |
| highlight.js | Syntax highlighting | Browser (cdnjs) |
| SortableJS | Drag and drop ordering | Browser (cdnjs) |
| JSZip | Reading uploaded ZIP files | Browser (cdnjs) |
| marked and DOMPurify | README preview: markdown to HTML, then sanitising | Browser (cdnjs) |
| Google Fonts | JetBrains Mono, Fira Code, Source Code Pro, IBM Plex Mono | Browser |
| GitHub App | "Login with GitHub" and read-only access to chosen repos | GitHub |
| Cloudflare Worker | Swaps the login code for a token (needs the client secret) | Cloudflare |
| Browser print engine | Makes the PDF (`window.print()` then Save as PDF) | Browser |
 
---
 
## 2. Project layout
 
```
git2pdf/
├── index.html      page structure
├── style.css       app UI and print styles
├── app.js          all logic
└── worker/
    └── worker.js   Cloudflare Worker (deployed separately, not part of the site files)
```
 
`app.js` starts with three constants that connect the site to your GitHub App and Worker:
 
```js
const GITHUB_CLIENT_ID = "Iv...";                 // public, safe in the browser
const AUTH_WORKER_URL  = "https://your-worker.workers.dev"; // no trailing slash
const APP_SLUG         = "git2pdf";               // from github.com/apps/<slug>
```
 
---
 
## 3. Architecture
 
```
                         ┌──────────────────────────────┐
                         │          Browser             │
                         │  index.html + style.css +    │
                         │  app.js (all the logic)      │
                         └───┬──────────┬───────────┬───┘
                             │          │           │
        repo info, tree,     │          │           │  code + code_verifier
        contents, user,      │          │           │  (login only)
        repo list            │          │           │
                             ▼          ▼           ▼
                      api.github.com   raw.github-   Cloudflare Worker
                                       usercontent   (holds client secret)
                                       .com                │
                                                           ▼
                                                  github.com/login/oauth/
                                                  access_token
```
 
Repo contents and uploaded files never go to any server of ours. The Worker only ever sees a one-time login code, never repo content.
 
---
 
## 4. User flow
 
1. **Load.** Three inputs are visible at once: GitHub URL, Upload ZIP, Upload files.
2. **Select.** A folder tree with checkboxes. Binaries, lockfiles and build folders are unchecked by default.
3. **Order.** Drag and drop, plus quick sort buttons. README files get a Raw code / Preview switch.
4. **Fetch.** Contents are fetched (or read from memory for ZIP and uploads), decoded, highlighted and split into lines. A progress bar shows `12 / 40`.
5. **Export.** Choose font and size, then Colour PDF or Black & white PDF. The print dialog opens.
Loading from one source clears the state of the other two. Back and Start over work at every step.
 
---
 
## 5. Input methods
 
### 5.1 GitHub URL (free limit, no login)
 
Accepts `https://github.com/owner/repo`, with or without a trailing slash or `.git`.
 
```js
const headers = { Accept: "application/vnd.github+json" };
if (token) headers.Authorization = `Bearer ${token}`;
 
const repo = await (await fetch(`https://api.github.com/repos/${owner}/${name}`, { headers })).json();
const tree = await (await fetch(
  `https://api.github.com/repos/${owner}/${name}/git/trees/${repo.default_branch}?recursive=1`,
  { headers }
)).json();
 
const files = tree.tree
  .filter(n => n.type === "blob")
  .map(n => ({ path: n.path, size: n.size, type: "blob" }));
```
 
That is 2 API calls per repo. Unauthenticated, GitHub allows 60 API requests per hour per IP address. File contents of public repos come from `raw.githubusercontent.com`, which is not part of that limit, so the free limit is enough for normal use. Many people on one network (a campus, for example) share the same 60.
 
Error handling: invalid URL, repo not found or private, rate limit reached (HTTP 403 or 429 with `x-ratelimit-remaining: 0`), and a truncated tree (huge repos).
 
### 5.2 Manual token
 
When the rate limit is hit, the user can paste a fine-grained personal access token (Contents: read-only). It is stored in `sessionStorage` only and sent as `Authorization: Bearer TOKEN`. With a token, file contents are fetched through the contents API so private repos work:
 
```js
fetch(`https://api.github.com/repos/${owner}/${name}/contents/${encodedPath}?ref=${branch}`, {
  headers: { Accept: "application/vnd.github.raw+json", Authorization: `Bearer ${token}` }
});
```
 
Encode each path segment, not the slashes. Each file is one API call, which is fine under the 5,000/hour authenticated limit.
 
### 5.3 Login with GitHub (GitHub App, PKCE and a Worker)
 
This replaces the manual token for people who do not want to create one.
 
Why a Worker is needed: exchanging the login code for a token requires the app's **client secret**, and the secret must never be in browser code. GitHub's token endpoint also does not allow browser (CORS) requests. The Worker holds the secret and makes that one call.
 
Sequence:
 
1. The browser creates a random `code_verifier`, a random `state`, and `code_challenge = base64url(SHA-256(code_verifier))`. It saves verifier and state in `sessionStorage`.
2. The browser goes to `https://github.com/login/oauth/authorize?client_id=...&state=...&code_challenge=...&code_challenge_method=S256`. No `redirect_uri` is sent, so GitHub uses the Redirect URI registered on the app.
3. The user approves. GitHub redirects back to the site with `?code=...&state=...`.
4. The browser checks `state` matches the saved one, then POSTs `{ code, code_verifier }` to `AUTH_WORKER_URL + "/token"`.
5. The Worker adds `client_id` and `client_secret` and calls `https://github.com/login/oauth/access_token`. It returns only `{ access_token }`.
6. The browser saves the token in `sessionStorage`, cleans the URL with `history.replaceState`, and uses it exactly like a manual token.
PKCE helper (simplified):
 
```js
function randomString(len = 64) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  return Array.from(crypto.getRandomValues(new Uint8Array(len)), b => chars[b % chars.length]).join("");
}
function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const verifier = randomString();
const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
```
 
Notes:
- GitHub App user tokens expire after 8 hours. On a 401 the app clears the token and asks the user to log in again. Refresh tokens are not used.
- A GitHub App token can only see repos where the app is installed. For private repos the user must install the app on them once (`https://github.com/apps/<slug>/installations/new`). Public repos work by pasting the URL regardless.
- Logged-in users get 5,000 API requests per hour.
### 5.4 Repo dropdown (logged in)
 
After login the app calls `/user` for the avatar and handle, then builds a repo list:
 
1. `GET /user/installations?per_page=100`
2. For each installation: `GET /user/installations/{id}/repositories?per_page=100`, following pagination.
3. Also tries `GET /user/repos?per_page=100&sort=updated` and merges the result, ignoring failures.
4. Removes duplicates and sorts A to Z.
Picking a repo fills the URL input. The token field is hidden while logged in. Log out clears the token, avatar and list.
 
### 5.5 ZIP upload
 
JSZip reads the file entirely in the browser.
 
- Ignore directories, `__MACOSX`, `.DS_Store` and anything inside `.git`.
- If every path shares one top-level folder (GitHub ZIPs do, like `repo-main/`), strip it.
- Build the same file list shape as the GitHub flow and keep each file's bytes in memory.
- The cover page uses the ZIP name (without `.zip`) as the project name and hides the Branch line.
### 5.6 Upload files
 
For people with loose code files and no repo.
 
- A drop zone with a multi-file picker. Files accumulate in a list, so the user can add from several folders. Duplicate names get a suffix: `name (2).ext`.
- Files over 10 MB are skipped with a message. Maximum 500 files.
- Bytes are read with `file.arrayBuffer()` and kept in memory. The rest of the flow is the same local path as ZIP.
- The cover title is "Uploaded files" and the Branch line is hidden.
---
 
## 6. Data model
 
File list entry (all three sources produce this shape):
 
```js
{ path: "src/main.c", size: 1234, type: "blob" }
```
 
Prepared file (after step 4):
 
```js
{
  path: "src/main.c",
  language: "c",
  lines: ["<span class=\"hljs-keyword\">int</span> ...", "..."], // highlighted HTML, one entry per line
  text: "int main() { ... }",                                  // original decoded text
  mode: "raw"                                                  // "raw" or "preview" (README only)
}
```
 
Everything lives in memory. Only the token (and the temporary login verifier and state) are in `sessionStorage`.
 
---
 
## 7. File selection rules
 
Unchecked by default:
 
- Binary and media: png, jpg, jpeg, gif, webp, ico, svg, pdf, zip, mp3, mp4, woff, woff2, ttf, otf, exe, bin
- Lockfiles: package-lock.json, yarn.lock, pnpm-lock.yaml
- Anything inside node_modules, dist, build, .git, .next, __pycache__
- Files over 200 KB, with a small "large" label
Folder checkboxes cascade to children and show an indeterminate state when partly selected. The default order is alphabetical with folders grouped. Buttons: A to Z, Folders first, Original order.
 
---
 
## 8. Fetching and highlighting
 
- Fetch 5 files at a time with a progress bar.
- Failed or binary-looking files (null byte, or invalid UTF-8 for local sources) go to a skipped list, shown in a collapsible box.
- Local sources decode with `new TextDecoder("utf-8", { fatal: true })`.
- Normalise tabs to 4 spaces and line endings to `\n`.
- Language comes from the file extension.
### Multi-line tokens
 
highlight.js is run on the **whole file**, and the HTML is split into lines afterwards. A block comment or template string spans many lines, so each line must close the open `<span>` tags and the next line must reopen them. Otherwise tags leak across lines and the layout breaks.
 
```js
function splitHighlighted(html) {
  const out = [];
  const stack = [];
  let line = "";
  for (const m of html.match(/<span[^>]*>|<\/span>|\n|[^<\n]+/g) || []) {
    if (m === "\n") {
      out.push(line + "</span>".repeat(stack.length));
      line = stack.join("");
    } else {
      if (m.startsWith("<span")) stack.push(m);
      else if (m === "</span>") stack.pop();
      line += m;
    }
  }
  out.push(line + "</span>".repeat(stack.length));
  return out;
}
```
 
highlight.js escapes `<` and `>` inside code text, so a raw `<` only appears in real tags and the regex is safe.
 
---
 
## 9. PDF generation
 
### 9.1 Approach
 
The app builds a hidden **print view** in the page, hides the whole app UI with `@media print`, and calls `window.print()`. The user chooses Save as PDF. This is the simplest way to get real selectable text and sharp fonts. Before printing it waits for `document.fonts.ready`.
 
### 9.2 Page setup
 
```css
@page {
  size: A4;
  margin: 15mm 15mm 20mm;
  @bottom-left   { content: "https://git2pdf.devs.surf/"; font-size: 8pt; }
  @bottom-center { content: "Page " counter(page) " of " counter(pages); font-size: 8pt; }
}
```
 
Margin boxes and `counter(pages)` need a recent Chromium browser (Chrome or Edge 131+). In older browsers "Page X of Y" can show blank.
 
### 9.3 Fonts
 
JetBrains Mono (default), Fira Code, Source Code Pro, IBM Plex Mono, at 8, 9, 10 or 11pt (default 9). Ligatures are turned off so code prints exactly as written:
 
```css
font-variant-ligatures: none;
font-feature-settings: "liga" 0, "calt" 0;
```
 
### 9.4 Layout
 
- Cover page: project name, branch (GitHub only), file count, table of contents.
- Files flow continuously one after another with an 8 mm gap. Only the cover has its own page.
- Each file has a header bar (path and line count) with `break-after: avoid`, kept together with its first lines so it never sits alone at the bottom of a page.
- Line numbers sit in a left gutter, right-aligned, muted, not selectable. Long lines wrap under the code, not under the number (`white-space: pre-wrap; word-break: break-all; tab-size: 4`).
- Each line has `break-inside: avoid`, so a single line is never split across pages. There is no `break-inside: avoid` on whole files.
### 9.5 Colour vs black and white
 
| | Colour PDF | Black & white PDF |
|---|---|---|
| Background | White | White |
| Text | Dark | Pure black |
| Keywords | Purple | Bold |
| Strings | Green | Normal |
| Comments | Gray | Italic |
| Numbers / functions | Blue / dark blue | Normal |
| Line numbers | Muted gray | Black, with a thin right border, no fills |
 
Colours are CSS variables on the `.hljs-*` classes, with `print-color-adjust: exact` so they print. If colours are missing, tick "Background graphics" in the print dialog.
 
### 9.6 README preview
 
README files (`readme.md` or `.markdown`, any folder, case-insensitive) get two options in the Order step: **Raw code** (default) and **Preview**.
 
- Raw code: identical to any other file, continuous flow, no page break.
- Preview: markdown is converted with marked (GitHub flavoured) and sanitised with DOMPurify. It starts on a new page, and the file after it also starts on a new page (class on the next section, no trailing blank page). Content flows across pages normally.
- Relative links lose their href. Relative images are resolved to `raw.githubusercontent.com` URLs for GitHub projects, to data URLs for ZIP projects, and removed for uploaded files or when they fail to load.
- Fenced code blocks are highlighted with the same `.hljs-*` styles.
- Black and white mode: pure black text, black borders, no fills, images grayscale.
- The app waits for preview images to load (max 8 seconds) before printing.
### 9.7 PDF file name
 
Browsers use `document.title` as the default file name in the print dialog. To get names like `owner-repo-branch-colour.pdf`, set `document.title` right before `window.print()` and restore it on the `afterprint` event. This is a small optional addition.
 
---
 
## 10. Security and privacy
 
- **Repo content never leaves the browser.** Files are fetched from GitHub straight to the user's page or read from their own computer.
- **Tokens** live in `sessionStorage` only and vanish when the tab closes. They are sent only to GitHub.
- **Client secret** exists only as a Secret in the Worker. It is never in the site files or the repo.
- **PKCE and state** protect the login: the state check blocks forged redirects, and the code is useless without the matching verifier.
- **Worker CORS** allows only your site's origin (`ALLOWED_ORIGIN`) and answers only `POST /token`. It stores and logs nothing and returns only the access token.
- **README preview** is sanitised with DOMPurify (scripts, iframes, forms and styles are removed).
- **Least access.** The GitHub App asks for Contents: read-only, and users choose which repos it can see.
- Third-party requests the page makes: GitHub, raw.githubusercontent.com, Google Fonts, cdnjs, and your Worker. Pin library versions in the script URLs.
---
 
## 11. Limits and known issues
 
- **Unauthenticated:** 60 API requests per hour per IP.
- **Large repos:** GitHub truncates very large trees (over 100,000 entries or 7 MB). The app shows a message.
- **Login token lifetime:** 8 hours, then log in again.
- **Private repos with login:** the GitHub App must be installed on that repo.
- **Dropdown scope:** it lists only repos the GitHub App can see. Public repos outside that list work by URL.
- **Browser support for the footer:** margin boxes and "Page X of Y" need Chrome or Edge 131+.
- **Uploaded files** are a flat list. Folder structure is lost. Use ZIP for whole projects.
- **README images** need a network connection, and private-repo images cannot load.
- **Very large PDFs** (thousands of pages) can be slow in the print dialog.
---
 
## 12. Make your own
 
There are two versions. Pick one.
 
- **Version A: no login.** Static site only. Users rely on the free limit, a manual token, ZIP, or uploads. About 10 minutes.
- **Version B: with login.** Version A plus a GitHub App and a Worker. About 30 minutes.
### Step 1: Get the files
 
Copy `index.html`, `style.css`, `app.js` into a new folder or repo. Copy `worker.js` too if you want login.
 
### Step 2: Test locally
 
```
python3 -m http.server 8080
```
 
Open `http://localhost:8080/`. Everything except login works locally.
 
### Step 3: Host the static files
 
Any HTTPS static host works: GitHub Pages, Cloudflare Pages, Netlify, Vercel. Point your domain at it.
 
If you are doing Version A, stop here. Remove or hide the "Login with GitHub" button and the repo dropdown, or leave them out of your copy.
 
### Step 4 (Version B): Create a GitHub App
 
GitHub > Settings > Developer settings > GitHub Apps > **New GitHub App**:
 
- **GitHub App name:** anything unique
- **Homepage URL:** your site URL
- **Redirect URI** (called "Callback URL" in older docs): your site URL, exactly, with the trailing slash if you use one
- **Expire user authorization tokens:** ticked
- **Request user authorization (OAuth) during installation:** unticked
- **Enable Device Flow:** unticked
- **Webhook > Active:** unticked
- **Permissions > Repository permissions > Contents:** Read-only
- **Where can this GitHub App be installed:** Any account
After creating it:
1. Copy the **Client ID**.
2. Open **Credentials** (left sidebar) and click **Generate a new client secret**. Copy it immediately. It is shown once.
3. Note the **app slug** from `github.com/apps/<slug>`.
Ignore the banner about generating a private key. This login flow does not use it.
 
### Step 5 (Version B): Deploy the Worker
 
Cloudflare dashboard > **Workers & Pages** > **Create** > **Start with Hello World!** > name it > **Deploy** > **Edit code**. Replace everything with:
 
```js
export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    };
    const reply = (obj, status = 200) =>
      new Response(JSON.stringify(obj), {
        status,
        headers: { ...cors, "Content-Type": "application/json" }
      });
 
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST" || new URL(request.url).pathname !== "/token") {
      return reply({ error: "not_found" }, 404);
    }
    if (request.headers.get("Origin") !== env.ALLOWED_ORIGIN) {
      return reply({ error: "forbidden" }, 403);
    }
 
    let body;
    try {
      body = await request.json();
    } catch {
      return reply({ error: "bad_request" }, 400);
    }
    const { code, code_verifier } = body;
    if (!code || !code_verifier) {
      return reply({ error: "bad_request" }, 400);
    }
 
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "git2pdf"
      },
      body: JSON.stringify({
        client_id: env.CLIENT_ID,
        client_secret: env.CLIENT_SECRET,
        code,
        code_verifier
      })
    });
    const data = await res.json();
 
    if (!data.access_token) {
      return reply({ error: data.error || "token_failed" }, 400);
    }
    return reply({ access_token: data.access_token });
  }
};
```
 
Click **Deploy**. Then **Settings > Variables and Secrets > Add**:
 
| Name | Type | Value |
|---|---|---|
| `CLIENT_ID` | Text | your Client ID |
| `CLIENT_SECRET` | Secret | your client secret |
| `ALLOWED_ORIGIN` | Text | your site origin, like `https://yourdomain.com` (no trailing slash, no path) |
 
Click **Deploy** again. Open the Worker URL in a browser tab. `{"error":"not_found"}` means it is working.
 
### Step 6 (Version B): Connect the site
 
In `app.js`, set the three constants:
 
```js
const GITHUB_CLIENT_ID = "your client id";
const AUTH_WORKER_URL  = "https://your-worker.your-name.workers.dev"; // no trailing slash
const APP_SLUG         = "your-app-slug";
```
 
Redeploy the site, open it and click **Login with GitHub**.
 
### Step 7: Replace the branding
 
Change the PDF footer URL (the `@bottom-left` content in the print CSS), the site title and the logo text.
 
### Local login testing
 
Login only works on the exact Redirect URI. For local testing, create a second GitHub App with Redirect URI `http://localhost:8080/` and a second Worker with `ALLOWED_ORIGIN = http://localhost:8080`, and use those values while developing. Keep them separate from production.
 
### Checklist
 
- [ ] Site is on HTTPS
- [ ] Redirect URI equals your site URL exactly
- [ ] `ALLOWED_ORIGIN` equals your site origin exactly
- [ ] Client secret is stored as a Secret in the Worker, nowhere else
- [ ] `AUTH_WORKER_URL` has no trailing slash
- [ ] Worker URL opens and shows `{"error":"not_found"}`
- [ ] Login works, and a public repo loads
- [ ] A PDF prints with the right footer and page numbers
---
 
## 13. Customising
 
| Want to change | Where |
|---|---|
| Colours and theme | CSS variables on `:root` in `style.css` |
| Code fonts | The font dropdown options and the Google Fonts `<link>` |
| Default font size | The size dropdown default (9pt) |
| Ignore lists (folders, lockfiles, extensions) | The default-deselect rules in the file selection code |
| "Large file" threshold | 200 KB in the file selection code |
| Fetch concurrency | 5 in the fetch step |
| Syntax colours (colour mode) | `.hljs-*` variables in the print CSS |
| B&W token styling | Bold keywords, italic comments rules in the print CSS |
| Paper size and margins | The `@page` rule |
| Languages | The extension-to-language map in the highlight step |
| Upload limits | 10 MB per file, 500 files, in the Upload files code |
 
---
 
## 14. Troubleshooting
 
| Symptom | Cause and fix |
|---|---|
| Worker returns `{"error":"forbidden"}` | `ALLOWED_ORIGIN` does not exactly match the site origin. Use scheme and host only, no slash or path |
| Worker returns `{"error":"bad_verification_code"}` | The login code was used twice or expired (10 minutes), or the client ID or secret is wrong. Try logging in again, then re-check the variables |
| Worker returns `incorrect_client_credentials` | `CLIENT_ID` or `CLIENT_SECRET` is wrong. Copy the Client ID carefully (`l`, `I` and `1` look alike) |
| GitHub says redirect_uri mismatch | The Redirect URI on the GitHub App differs from the page URL. Match it exactly |
| "Login failed. Try again." | Open the browser dev tools, Network tab, and look at the `/token` request. Check `AUTH_WORKER_URL` has no trailing slash |
| Private repo says not found | Install the GitHub App on that repo, using the link in the error message |
| Rate limit reached | Log in, or paste a token, or use ZIP or Upload files |
| Session expired | The 8 hour token ended. Log in again |
| "Page X of Y" is blank | Use Chrome or Edge 131 or newer |
| Footer overlaps code | Increase the bottom margin in `@page` |
| Colours do not print | Tick "Background graphics" in the print dialog |
| Fonts look wrong | Wait for the fonts to load (needs internet), then print again |
| README images missing | Private or relative images that cannot be resolved are removed on purpose |
 

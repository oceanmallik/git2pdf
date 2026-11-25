const GITHUB_CLIENT_ID = "Iv23lixyC74uqMbFMtW1";
const AUTH_WORKER_URL = "https://git2pdf-auth.ocean-mallik.workers.dev";
const APP_SLUG = "git2pdf";

// Global variables
var repoFiles = [];
window.repoFiles = repoFiles;

var selectedFiles = [];
window.selectedFiles = selectedFiles;

var orderedFiles = [];
window.orderedFiles = orderedFiles;

var processedFiles = [];
window.processedFiles = processedFiles;

// README preview modes: filePath -> 'raw' | 'preview'
var readmePreviewModes = new Map();
window.readmePreviewModes = readmePreviewModes;

// Helper: Check if a file counts as a README
function isReadmeFile(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const fileName = filePath.split('/').pop().toLowerCase();
  return fileName === 'readme.md' || fileName === 'readme.markdown';
}

// Helper: Resolve relative paths for images in markdown
function resolveRelativePath(baseFilePath, targetPath) {
  if (!targetPath) return '';
  let cleanTarget = targetPath.replace(/\\/g, '/');
  if (cleanTarget.startsWith('/')) {
    cleanTarget = cleanTarget.replace(/^\/+/, '');
    const stack = [];
    for (const seg of cleanTarget.split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') {
        if (stack.length > 0) stack.pop();
      } else {
        stack.push(seg);
      }
    }
    return stack.join('/');
  }
  const baseParts = baseFilePath.split('/');
  baseParts.pop();
  for (const seg of cleanTarget.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (baseParts.length > 0) baseParts.pop();
    } else {
      baseParts.push(seg);
    }
  }
  return baseParts.join('/');
}

// Helper: Convert Uint8Array to base64 data URL
function uint8ArrayToDataUrl(uint8, ext) {
  const mimeMap = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml'
  };
  const mime = mimeMap[(ext || '').toLowerCase()] || 'image/png';
  let binary = '';
  const len = uint8.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = uint8.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk);
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

// Current repo / project info
var currentSource = 'github'; // 'github', 'zip', or 'files'
var currentOwner = '';
var currentRepo = '';
var currentBranch = '';
var currentToken = '';
var currentZipFileName = '';
var zipFileContents = new Map(); // path -> Uint8Array

// Upload files state
var chosenFiles = []; // array of { name: string, file: File, size: number }
var uploadedFileContents = new Map(); // name -> Uint8Array

window.currentSource = currentSource;
window.currentOwner = currentOwner;
window.currentRepo = currentRepo;
window.currentBranch = currentBranch;
window.currentToken = currentToken;
window.currentZipFileName = currentZipFileName;
window.zipFileContents = zipFileContents;
window.chosenFiles = chosenFiles;
window.uploadedFileContents = uploadedFileContents;

const TOKEN_KEY = 'github_token';
const LARGE_FILE_LIMIT = 200 * 1024; // 200 KB in bytes
const MAX_ZIP_SIZE = 100 * 1024 * 1024; // 100 MB max zip size
const MAX_UPLOADED_FILE_SIZE = 10 * 1024 * 1024; // 10 MB per file
const MAX_UPLOADED_FILES_COUNT = 500; // max 500 files

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'svg', 'pdf',
  'zip', 'mp3', 'mp4', 'woff', 'woff2', 'ttf', 'otf', 'exe', 'bin'
]);

const LOCKFILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'
]);

const IGNORED_DIRS = new Set([
  'node_modules', 'dist', 'build', '.git', '.next', '__pycache__'
]);

const EXTENSION_TO_LANGUAGE = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescript',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  less: 'less',
  json: 'json',
  json5: 'json',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  pyw: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  sql: 'sql',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  mk: 'makefile',
  graphql: 'graphql',
  gql: 'graphql',
  lua: 'lua',
  swift: 'swift',
  kt: 'kotlin',
  kts: 'kotlin',
  r: 'r',
  dart: 'dart',
  scala: 'scala',
  diff: 'diff',
  patch: 'diff',
  txt: 'plaintext'
};

// DOM Elements: Step 1 (Input Section & Tabs)
const inputSection = document.getElementById('input-section') || document.querySelector('.input-section');
const tabGithubBtn = document.getElementById('tab-github-btn');
const tabZipBtn = document.getElementById('tab-zip-btn');
const tabGithubPanel = document.getElementById('tab-github-panel');
const tabZipPanel = document.getElementById('tab-zip-panel');

const form = document.getElementById('repo-form');
const repoUrlInput = document.getElementById('repo-url') || document.querySelector('input[type="text"]');
const tokenInput = document.getElementById('token') || document.getElementById('github-token') || document.querySelector('input[type="password"]');
const loadBtn = document.getElementById('load-btn') || document.querySelector('button');
const tokenHelpToggle = document.getElementById('token-help-toggle') || document.querySelector('.help-link');
const tokenHelpBox = document.getElementById('token-help-box') || document.querySelector('.help-box');
const statusLine = document.getElementById('status') || document.getElementById('status-line');

// DOM Elements: GitHub OAuth
const githubLoginContainer = document.getElementById('github-login-container');
const githubLoginBtn = document.getElementById('github-login-btn');
const githubLoggedInContainer = document.getElementById('github-logged-in-container');
const githubLogoutBtn = document.getElementById('github-logout-btn');
const manualTokenContainer = document.getElementById('manual-token-container');
const privateRepoOption = document.getElementById('private-repo-option');

// DOM Elements: ZIP Dropzone
const zipDropzone = document.getElementById('zip-dropzone');
const zipFileInput = document.getElementById('zip-file-input');
const zipHelpToggle = document.getElementById('zip-help-toggle');
const zipHelpBox = document.getElementById('zip-help-box');

// DOM Elements: Upload Files
const filesDropzone = document.getElementById('files-dropzone');
const filesInput = document.getElementById('files-input');
const chosenFilesContainer = document.getElementById('chosen-files-container');
const chosenFilesList = document.getElementById('chosen-files-list');
const filesClearBtn = document.getElementById('files-clear-btn');
const filesContinueBtn = document.getElementById('files-continue-btn');

// DOM Elements: Step 2 (Tree Screen)
const treeContainer = document.getElementById('tree-container') || document.querySelector('.tree-container');
const fileTreeEl = document.getElementById('file-tree');
const selectAllBtn = document.getElementById('select-all-btn');
const deselectAllBtn = document.getElementById('deselect-all-btn');
const selectedCountEl = document.getElementById('selected-count');
const selectedLabelEl = document.getElementById('selected-label');
const nextBtn = document.getElementById('next-btn');
const treeBackBtn = document.getElementById('tree-back-btn');
const treeStartOverBtn = document.getElementById('tree-start-over-btn');

// DOM Elements: Step 3 (Ordering Screen)
const orderContainer = document.getElementById('order-container') || document.querySelector('.order-container');
const orderListEl = document.getElementById('order-list');
const orderCountEl = document.getElementById('order-count');
const sortAzBtn = document.getElementById('sort-az-btn');
const sortFoldersBtn = document.getElementById('sort-folders-btn');
const sortOriginalBtn = document.getElementById('sort-original-btn');
const orderBackBtn = document.getElementById('order-back-btn');
const orderStartOverBtn = document.getElementById('order-start-over-btn');
const orderNextBtn = document.getElementById('order-next-btn');

// DOM Elements: Step 4 (Content Fetching & PDF Export Screen)
const fetchContainer = document.getElementById('fetch-container') || document.querySelector('.fetch-container');
const progressTextEl = document.getElementById('progress-text');
const progressBarFillEl = document.getElementById('progress-bar-fill');
const fetchStatusLineEl = document.getElementById('fetch-status-line');
const skippedContainerEl = document.getElementById('skipped-container');
const skippedCountEl = document.getElementById('skipped-count');
const skippedListEl = document.getElementById('skipped-list');
const fetchBackBtn = document.getElementById('fetch-back-btn');
const fetchStartOverBtn = document.getElementById('fetch-start-over-btn');
const pdfControlsEl = document.getElementById('pdf-controls');
const fontSelectEl = document.getElementById('font-select');
const fontSizeSelectEl = document.getElementById('font-size-select');
const pdfColourBtn = document.getElementById('pdf-colour-btn');
const pdfBwBtn = document.getElementById('pdf-bw-btn');

// DOM Elements: Print View
const printViewEl = document.getElementById('print-view');

// State
var activeTab = 'github'; // 'github' or 'zip'
var selectedFilePaths = new Set();
var currentTreeRoot = null;
var allFileNodes = [];
var allFolderNodes = [];
window.allFileNodes = allFileNodes;
window.allFolderNodes = allFolderNodes;
let sortableInstance = null;

// Check if user is logged in via GitHub OAuth
function isLoggedInWithGitHub() {
  return sessionStorage.getItem('github_oauth') === '1' && Boolean(sessionStorage.getItem(TOKEN_KEY));
}

// Update UI between logged in with GitHub vs manual token
function updateAuthUI() {
  const isOauth = isLoggedInWithGitHub();
  const token = sessionStorage.getItem(TOKEN_KEY) || '';

  if (isOauth) {
    if (githubLoginContainer) githubLoginContainer.hidden = true;
    if (githubLoggedInContainer) githubLoggedInContainer.hidden = false;
    if (manualTokenContainer) manualTokenContainer.hidden = true;
    if (privateRepoOption) privateRepoOption.hidden = false;
    currentToken = token;
    window.currentToken = currentToken;
  } else {
    if (githubLoginContainer) githubLoginContainer.hidden = false;
    if (githubLoggedInContainer) githubLoggedInContainer.hidden = true;
    if (manualTokenContainer) manualTokenContainer.hidden = false;
    if (privateRepoOption) privateRepoOption.hidden = true;
    if (tokenInput) {
      tokenInput.value = token;
    }
    currentToken = token;
    window.currentToken = currentToken;
  }
}

// Log out: remove token from sessionStorage and restore logged-out UI
function logoutGitHub() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem('github_oauth');
  currentToken = '';
  window.currentToken = currentToken;
  if (tokenInput) {
    tokenInput.value = '';
  }
  updateAuthUI();
}

// Keep sessionStorage in sync on manual token input
if (tokenInput) {
  tokenInput.addEventListener('input', () => {
    const val = tokenInput.value.trim();
    if (val) {
      sessionStorage.setItem(TOKEN_KEY, val);
    } else {
      sessionStorage.removeItem(TOKEN_KEY);
    }
    sessionStorage.removeItem('github_oauth');
    currentToken = val;
    window.currentToken = currentToken;
  });
}

// Toggle token help box
if (tokenHelpToggle && tokenHelpBox) {
  tokenHelpToggle.addEventListener('click', (e) => {
    e.preventDefault();
    const isHidden = tokenHelpBox.hidden || tokenHelpBox.classList.contains('hidden') || tokenHelpBox.style.display === 'none';
    if (isHidden) {
      tokenHelpBox.hidden = false;
      tokenHelpBox.classList.remove('hidden');
      tokenHelpBox.style.display = 'block';
      tokenHelpToggle.setAttribute('aria-expanded', 'true');
    } else {
      tokenHelpBox.hidden = true;
      tokenHelpBox.classList.add('hidden');
      tokenHelpBox.style.display = 'none';
      tokenHelpToggle.setAttribute('aria-expanded', 'false');
    }
  });
}

// Toggle zip help box
if (zipHelpToggle && zipHelpBox) {
  zipHelpToggle.addEventListener('click', (e) => {
    e.preventDefault();
    const isHidden = zipHelpBox.hidden || zipHelpBox.classList.contains('hidden') || zipHelpBox.style.display === 'none';
    if (isHidden) {
      zipHelpBox.hidden = false;
      zipHelpBox.classList.remove('hidden');
      zipHelpBox.style.display = 'block';
      zipHelpToggle.setAttribute('aria-expanded', 'true');
    } else {
      zipHelpBox.hidden = true;
      zipHelpBox.classList.add('hidden');
      zipHelpBox.style.display = 'none';
      zipHelpToggle.setAttribute('aria-expanded', 'false');
    }
  });
}

// Set status message helpers
function setStatus(message, type = '') {
  if (!statusLine) return;
  statusLine.textContent = message;
  statusLine.className = 'status-line' + (type ? ' ' + type : '');
}

function setStatusHtml(html, type = '') {
  if (!statusLine) return;
  statusLine.innerHTML = html;
  statusLine.className = 'status-line' + (type ? ' ' + type : '');
}

// OAuth with PKCE helpers
function generateCodeVerifier() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const array = new Uint8Array(64);
  window.crypto.getRandomValues(array);
  let verifier = '';
  for (let i = 0; i < 64; i++) {
    verifier += chars[array[i] % chars.length];
  }
  return verifier;
}

function generateState() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const array = new Uint8Array(32);
  window.crypto.getRandomValues(array);
  let state = '';
  for (let i = 0; i < 32; i++) {
    state += chars[array[i] % chars.length];
  }
  return state;
}

function base64UrlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await window.crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(digest);
}

// Start GitHub OAuth login flow
async function startGitHubLogin() {
  try {
    const codeVerifier = generateCodeVerifier();
    const state = generateState();
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    sessionStorage.setItem('oauth_code_verifier', codeVerifier);
    sessionStorage.setItem('oauth_state', state);

    const authUrl = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(GITHUB_CLIENT_ID)}&state=${encodeURIComponent(state)}&code_challenge=${encodeURIComponent(codeChallenge)}&code_challenge_method=S256`;
    window.location.href = authUrl;
  } catch (_) {
    setStatus('Login failed. Try again.', 'error');
  }
}

// Handle OAuth callback on page load
async function handleOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');

  if (!code || !state) {
    updateAuthUI();
    return;
  }

  const savedState = sessionStorage.getItem('oauth_state');
  const savedVerifier = sessionStorage.getItem('oauth_code_verifier');

  function cleanOAuthUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete('code');
    url.searchParams.delete('state');
    const newSearch = url.searchParams.toString() ? `?${url.searchParams.toString()}` : '';
    window.history.replaceState({}, document.title, url.pathname + newSearch + url.hash);
  }

  if (!savedState || state !== savedState || !savedVerifier) {
    cleanOAuthUrl();
    updateAuthUI();
    return;
  }

  setStatus('Logging in...', 'loading');

  try {
    const res = await fetch(`${AUTH_WORKER_URL}/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ code, code_verifier: savedVerifier })
    });

    if (!res.ok) {
      throw new Error('Token request failed');
    }

    const data = await res.json();
    const token = data && (data.access_token || data.token);
    if (!token) {
      throw new Error('No access token in response');
    }

    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem('github_oauth', '1');
    currentToken = token;
    window.currentToken = currentToken;

    sessionStorage.removeItem('oauth_code_verifier');
    sessionStorage.removeItem('oauth_state');
    cleanOAuthUrl();

    updateAuthUI();
    setStatus('');
  } catch (_) {
    sessionStorage.removeItem('oauth_code_verifier');
    sessionStorage.removeItem('oauth_state');
    cleanOAuthUrl();
    updateAuthUI();
    setStatus('Login failed. Try again.', 'error');
  }
}

if (githubLoginBtn) {
  githubLoginBtn.addEventListener('click', startGitHubLogin);
}

if (githubLogoutBtn) {
  githubLogoutBtn.addEventListener('click', () => {
    logoutGitHub();
    setStatus('');
  });
}

// Initialise auth on page load
handleOAuthCallback();

// Clear state helper (used on start over)
function clearState() {
  repoFiles = [];
  selectedFiles = [];
  orderedFiles = [];
  processedFiles = [];
  window.repoFiles = repoFiles;
  window.selectedFiles = selectedFiles;
  window.orderedFiles = orderedFiles;
  window.processedFiles = processedFiles;

  readmePreviewModes.clear();

  selectedFilePaths.clear();
  currentTreeRoot = null;
  allFileNodes = [];
  allFolderNodes = [];
  window.allFileNodes = allFileNodes;
  window.allFolderNodes = allFolderNodes;

  zipFileContents.clear();
  currentZipFileName = '';
  currentSource = 'github';
  window.currentSource = currentSource;
  window.currentZipFileName = currentZipFileName;

  // Clear chosen uploaded files
  chosenFiles = [];
  window.chosenFiles = chosenFiles;
  uploadedFileContents.clear();
  if (filesInput) filesInput.value = '';
  renderChosenFilesList();

  if (fileTreeEl) fileTreeEl.innerHTML = '';
  if (orderListEl) orderListEl.innerHTML = '';
  if (skippedListEl) skippedListEl.innerHTML = '';
  if (printViewEl) printViewEl.innerHTML = '';

  if (treeContainer) treeContainer.hidden = true;
  if (orderContainer) orderContainer.hidden = true;
  if (fetchContainer) fetchContainer.hidden = true;

  if (zipFileInput) zipFileInput.value = '';
  if (zipDropzone) zipDropzone.classList.remove('dragover');
  if (filesDropzone) filesDropzone.classList.remove('dragover');

  setStatus('');
}

// Show initial screen (Step 1)
function showInitialScreen() {
  if (treeContainer) treeContainer.hidden = true;
  if (orderContainer) orderContainer.hidden = true;
  if (fetchContainer) fetchContainer.hidden = true;
  if (inputSection) inputSection.hidden = false;
}

// Start over
function startOver() {
  clearState();
  showInitialScreen();
}

// Parse GitHub repository URL
function parseGitHubUrl(url) {
  if (!url || typeof url !== 'string') return null;
  let s = url.trim();
  if (!s) return null;

  if (!/^https?:\/\//i.test(s)) {
    s = 'https://' + s;
  }

  try {
    const parsed = new URL(s);
    const host = parsed.hostname.toLowerCase();
    if (host !== 'github.com' && host !== 'www.github.com') {
      return null;
    }

    const pathname = parsed.pathname.replace(/^\/+|\/+$/g, '');
    const parts = pathname.split('/');
    if (parts.length !== 2) {
      return null;
    }

    const owner = parts[0];
    let repo = parts[1];

    if (repo.endsWith('.git')) {
      repo = repo.slice(0, -4);
    }

    if (!owner || !repo) {
      return null;
    }

    if (!/^[a-zA-Z0-9_.-]+$/.test(owner) || !/^[a-zA-Z0-9_.-]+$/.test(repo)) {
      return null;
    }

    return { owner, repo };
  } catch {
    return null;
  }
}

// Check if a file should be deselected by default
function isInsideIgnoredDir(filePath) {
  const parts = filePath.split('/');
  for (let i = 0; i < parts.length - 1; i++) {
    if (IGNORED_DIRS.has(parts[i].toLowerCase())) {
      return true;
    }
  }
  return false;
}

function isLargeFile(file) {
  if (!file) return false;
  const size = Number(file.size);
  return !isNaN(size) && size > LARGE_FILE_LIMIT;
}

function shouldDeselectByDefault(file) {
  if (isLargeFile(file)) {
    return true;
  }
  if (isInsideIgnoredDir(file.path)) {
    return true;
  }
  const fileName = file.path.split('/').pop().toLowerCase();
  if (LOCKFILES.has(fileName)) {
    return true;
  }
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot !== -1 && lastDot < fileName.length - 1) {
    const ext = fileName.slice(lastDot + 1);
    if (BINARY_EXTENSIONS.has(ext)) {
      return true;
    }
  }
  return false;
}

// ==========================================
// Step 1: ZIP File Handling
// ==========================================

function shouldIgnoreZipEntry(path, isDir) {
  if (isDir) return true;
  const norm = path.replace(/\\/g, '/');
  if (norm.endsWith('/')) return true;

  const parts = norm.split('/');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === '__MACOSX') return true;
    if (part === '.DS_Store') return true;
    if (part === '.git') return true;
  }
  const filename = parts[parts.length - 1];
  if (filename === '.DS_Store') return true;
  return false;
}

async function handleZipFile(file) {
  if (!file) return;

  // 1. Not a zip file check
  if (!file.name.toLowerCase().endsWith('.zip')) {
    setStatus('not a zip file', 'error');
    return;
  }

  // 2. Empty file check
  if (file.size === 0) {
    setStatus('empty zip', 'error');
    return;
  }

  // 3. File too large to read check
  if (file.size > MAX_ZIP_SIZE) {
    setStatus('file too large to read', 'error');
    return;
  }

  setStatus('Reading ZIP...', 'loading');

  let zip;
  try {
    if (typeof JSZip === 'undefined') {
      setStatus('JSZip library not loaded', 'error');
      return;
    }
    zip = await JSZip.loadAsync(file);
  } catch (err) {
    const msg = (err && err.message) ? err.message.toLowerCase() : '';
    if (err && (err.name === 'RangeError' || msg.includes('memory') || msg.includes('large'))) {
      setStatus('file too large to read', 'error');
    } else {
      setStatus('not a zip file', 'error');
    }
    return;
  }

  // Filter out directories, __MACOSX, .DS_Store, .git
  const validEntries = [];
  zip.forEach((relativePath, zipEntry) => {
    if (!shouldIgnoreZipEntry(relativePath, zipEntry.dir)) {
      validEntries.push({ rawPath: relativePath.replace(/\\/g, '/'), zipEntry });
    }
  });

  if (validEntries.length === 0) {
    setStatus('empty zip', 'error');
    return;
  }

  // Check if every path shares one single top-level folder
  let removePrefix = '';
  const firstParts = validEntries[0].rawPath.split('/');
  if (firstParts.length > 1) {
    const candidateTop = firstParts[0];
    const allShare = validEntries.every(entry => {
      const p = entry.rawPath.split('/');
      return p.length > 1 && p[0] === candidateTop;
    });
    if (allShare) {
      removePrefix = candidateTop + '/';
    }
  }

  // Clear other sources
  chosenFiles = [];
  window.chosenFiles = chosenFiles;
  uploadedFileContents.clear();
  if (filesInput) filesInput.value = '';
  renderChosenFilesList();
  currentOwner = '';
  currentRepo = '';
  currentBranch = '';

  // Build file list and keep each file's content in memory
  zipFileContents.clear();
  readmePreviewModes.clear();
  const fileList = [];
  currentSource = 'zip';
  currentZipFileName = file.name;
  window.currentSource = currentSource;
  window.currentZipFileName = currentZipFileName;

  try {
    for (const entry of validEntries) {
      const finalPath = removePrefix ? entry.rawPath.slice(removePrefix.length) : entry.rawPath;
      const uint8 = await entry.zipEntry.async('uint8array');
      zipFileContents.set(finalPath, uint8);
      fileList.push({
        path: finalPath,
        size: uint8.byteLength,
        type: 'blob'
      });
    }
  } catch (err) {
    const msg = (err && err.message) ? err.message.toLowerCase() : '';
    if (err && (err.name === 'RangeError' || msg.includes('memory') || msg.includes('large'))) {
      setStatus('file too large to read', 'error');
    } else {
      setStatus('not a zip file', 'error');
    }
    return;
  }

  if (fileList.length === 0) {
    setStatus('empty zip', 'error');
    return;
  }

  repoFiles = fileList;
  window.repoFiles = fileList;

  setStatus(`Loaded ${fileList.length} files.`, 'success');
  if (inputSection) inputSection.hidden = true;
  renderTree(fileList);
}

// Bind Dropzone events
if (zipDropzone && zipFileInput) {
  zipDropzone.addEventListener('click', () => {
    zipFileInput.click();
  });

  zipDropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      zipFileInput.click();
    }
  });

  zipFileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleZipFile(e.target.files[0]);
    }
  });

  zipDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zipDropzone.classList.add('dragover');
  });

  zipDropzone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    zipDropzone.classList.add('dragover');
  });

  zipDropzone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    zipDropzone.classList.remove('dragover');
  });

  zipDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    zipDropzone.classList.remove('dragover');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleZipFile(e.dataTransfer.files[0]);
    }
  });
}

// ==========================================
// Step 1: Upload Files (Separate Code Files) Handling
// ==========================================

// Prevent the browser from opening a file that is dropped outside drop zones
window.addEventListener('dragover', (e) => {
  e.preventDefault();
}, false);

window.addEventListener('drop', (e) => {
  e.preventDefault();
}, false);

// Format file size for display
function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Ensure unique file names with suffix "name (2).ext"
function getUniqueFileName(originalName, existingNamesSet) {
  if (!existingNamesSet.has(originalName)) {
    return originalName;
  }
  const lastDot = originalName.lastIndexOf('.');
  let base = (lastDot !== -1) ? originalName.slice(0, lastDot) : originalName;
  let ext = (lastDot !== -1) ? originalName.slice(lastDot) : '';

  let count = 2;
  while (true) {
    const candidate = `${base} (${count})${ext}`;
    if (!existingNamesSet.has(candidate)) {
      return candidate;
    }
    count++;
  }
}

// Render the chosen files list inside the Upload files card
function renderChosenFilesList() {
  if (!chosenFilesList || !chosenFilesContainer) return;

  if (chosenFiles.length === 0) {
    chosenFilesContainer.hidden = true;
    chosenFilesList.innerHTML = '';
    if (filesClearBtn) filesClearBtn.hidden = true;
    if (filesContinueBtn) filesContinueBtn.disabled = true;
    return;
  }

  chosenFilesContainer.hidden = false;
  if (filesClearBtn) filesClearBtn.hidden = false;
  if (filesContinueBtn) filesContinueBtn.disabled = false;

  chosenFilesList.innerHTML = '';
  const fragment = document.createDocumentFragment();

  chosenFiles.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'chosen-file-row';

    const infoDiv = document.createElement('div');
    infoDiv.className = 'chosen-file-info';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'chosen-file-name';
    nameSpan.textContent = item.name;

    const sizeSpan = document.createElement('span');
    sizeSpan.className = 'chosen-file-size';
    sizeSpan.textContent = formatFileSize(item.size);

    infoDiv.appendChild(nameSpan);
    infoDiv.appendChild(sizeSpan);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'chosen-file-remove-btn';
    removeBtn.setAttribute('aria-label', `Remove ${item.name}`);
    removeBtn.title = `Remove ${item.name}`;
    removeBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    `;

    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      chosenFiles.splice(index, 1);
      window.chosenFiles = chosenFiles;
      renderChosenFilesList();
    });

    li.appendChild(infoDiv);
    li.appendChild(removeBtn);
    fragment.appendChild(li);
  });

  chosenFilesList.appendChild(fragment);
}

// Handle adding chosen files (via picker or drag-drop)
function handleFilesAdded(fileList) {
  if (!fileList || fileList.length === 0) return;

  const existingNames = new Set(chosenFiles.map(f => f.name));
  let oversizedName = null;
  let addedCount = 0;

  for (let i = 0; i < fileList.length; i++) {
    if (chosenFiles.length >= MAX_UPLOADED_FILES_COUNT) {
      break;
    }
    const file = fileList[i];
    if (file.size > MAX_UPLOADED_FILE_SIZE) {
      if (!oversizedName) {
        oversizedName = file.name;
      }
      continue; // skip files over 10 MB, keep the rest
    }

    const uniqueName = getUniqueFileName(file.name, existingNames);
    existingNames.add(uniqueName);

    chosenFiles.push({
      name: uniqueName,
      file: file,
      size: file.size
    });
    addedCount++;
  }

  window.chosenFiles = chosenFiles;

  if (oversizedName) {
    setStatus(`${oversizedName} is too large to read`, 'error');
  } else if (addedCount > 0) {
    setStatus('');
  }

  renderChosenFilesList();
  if (filesInput) {
    filesInput.value = '';
  }
}

// Clear all chosen files
function handleFilesClear() {
  chosenFiles = [];
  window.chosenFiles = chosenFiles;
  uploadedFileContents.clear();
  if (filesInput) filesInput.value = '';
  renderChosenFilesList();
  setStatus('');
}

// Continue with uploaded files
async function handleFilesContinue() {
  if (chosenFiles.length === 0) {
    setStatus('No files selected', 'error');
    return;
  }

  // Clear other sources
  zipFileContents.clear();
  currentZipFileName = '';
  if (zipFileInput) zipFileInput.value = '';
  currentOwner = '';
  currentRepo = '';
  currentBranch = '';

  selectedFiles = [];
  orderedFiles = [];
  processedFiles = [];
  readmePreviewModes.clear();
  selectedFilePaths.clear();

  currentSource = 'files';
  window.currentSource = currentSource;

  setStatus('Reading files...', 'loading');

  uploadedFileContents.clear();
  const fileList = [];
  try {
    for (const item of chosenFiles) {
      const arrayBuffer = await item.file.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      uploadedFileContents.set(item.name, uint8);
      fileList.push({
        path: item.name,
        size: uint8.byteLength,
        type: 'blob'
      });
    }
  } catch (err) {
    setStatus('Error reading files', 'error');
    return;
  }

  repoFiles = fileList;
  window.repoFiles = fileList;

  setStatus(`Loaded ${fileList.length} files.`, 'success');
  if (inputSection) inputSection.hidden = true;
  renderTree(fileList);
}

// Bind Upload Files Dropzone events
if (filesDropzone && filesInput) {
  filesDropzone.addEventListener('click', () => {
    filesInput.click();
  });

  filesDropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      filesInput.click();
    }
  });

  filesInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFilesAdded(e.target.files);
    }
  });

  filesDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    filesDropzone.classList.add('dragover');
  });

  filesDropzone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    filesDropzone.classList.add('dragover');
  });

  filesDropzone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    filesDropzone.classList.remove('dragover');
  });

  filesDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    filesDropzone.classList.remove('dragover');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesAdded(e.dataTransfer.files);
    }
  });
}

if (filesClearBtn) {
  filesClearBtn.addEventListener('click', handleFilesClear);
}

if (filesContinueBtn) {
  filesContinueBtn.addEventListener('click', handleFilesContinue);
}

// Tree Node Class
class TreeNode {
  constructor(name, fullPath, isFolder = false, fileData = null) {
    this.name = name;
    this.fullPath = fullPath;
    this.isFolder = isFolder;
    this.fileData = fileData;
    this.children = [];
    this.parent = null;
    this.checkbox = null;
    this.element = null;
  }

  getAllFiles() {
    if (!this.isFolder) return [this];
    const files = [];
    for (const child of this.children) {
      files.push(...child.getAllFiles());
    }
    return files;
  }
}

// Build hierarchical tree from flat file list
function buildTree(files) {
  const root = new TreeNode('', '', true);

  for (const file of files) {
    const parts = file.path.split('/');
    let current = root;
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFile = (i === parts.length - 1);

      if (isFile) {
        const fileNode = new TreeNode(part, currentPath, false, file);
        fileNode.parent = current;
        current.children.push(fileNode);
      } else {
        let folderNode = current.children.find(c => c.isFolder && c.name === part);
        if (!folderNode) {
          folderNode = new TreeNode(part, currentPath, true);
          folderNode.parent = current;
          current.children.push(folderNode);
        }
        current = folderNode;
      }
    }
  }

  sortTreeNodes(root);
  return root;
}

function sortTreeNodes(node) {
  if (!node.isFolder) return;
  node.children.sort((a, b) => {
    if (a.isFolder && !b.isFolder) return -1;
    if (!a.isFolder && b.isFolder) return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  });
  for (const child of node.children) {
    if (child.isFolder) {
      sortTreeNodes(child);
    }
  }
}

// Update all folder checkboxes (checked vs indeterminate)
function updateAllFolderStates() {
  for (const folderNode of allFolderNodes) {
    if (!folderNode.checkbox) continue;
    const files = folderNode.getAllFiles();
    if (files.length === 0) {
      folderNode.checkbox.checked = false;
      folderNode.checkbox.indeterminate = false;
      continue;
    }
    let selectedCount = 0;
    for (const f of files) {
      if (selectedFilePaths.has(f.fullPath)) {
        selectedCount++;
      }
    }
    if (selectedCount === 0) {
      folderNode.checkbox.checked = false;
      folderNode.checkbox.indeterminate = false;
    } else if (selectedCount === files.length) {
      folderNode.checkbox.checked = true;
      folderNode.checkbox.indeterminate = false;
    } else {
      folderNode.checkbox.checked = false;
      folderNode.checkbox.indeterminate = true;
    }
  }
}

// Update the selected count and Next button state in Step 2
function updateSelectionSummary() {
  const count = selectedFilePaths.size;
  if (selectedCountEl) {
    selectedCountEl.textContent = count;
  }
  if (selectedLabelEl) {
    selectedLabelEl.textContent = count === 1 ? 'file selected' : 'files selected';
  }
  if (nextBtn) {
    nextBtn.disabled = (count === 0);
  }
  const currentFiles = Array.isArray(window.repoFiles) ? window.repoFiles : [];
  window.selectedFiles = currentFiles.filter(f => selectedFilePaths.has(f.path));
  selectedFiles = window.selectedFiles;
}

// Create DOM elements for a folder node
function createFolderElement(folderNode) {
  const container = document.createElement('div');
  container.className = 'tree-node folder-node';
  folderNode.element = container;

  const header = document.createElement('div');
  header.className = 'folder-header';

  // Toggle button (arrow)
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'folder-toggle';
  toggleBtn.setAttribute('aria-expanded', 'true');
  toggleBtn.setAttribute('aria-label', `Toggle ${folderNode.name} folder`);
  toggleBtn.innerHTML = '<span class="toggle-icon">▼</span>';

  // Checkbox
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'folder-checkbox';
  const checkboxId = 'folder-' + Math.random().toString(36).substring(2, 9);
  checkbox.id = checkboxId;
  folderNode.checkbox = checkbox;
  allFolderNodes.push(folderNode);

  // Label
  const label = document.createElement('label');
  label.htmlFor = checkboxId;
  label.className = 'folder-label';
  label.innerHTML = `<span class="folder-name">${escapeHtml(folderNode.name)}</span>`;

  header.appendChild(toggleBtn);
  header.appendChild(checkbox);
  header.appendChild(label);
  container.appendChild(header);

  // Children container
  const childrenContainer = document.createElement('div');
  childrenContainer.className = 'folder-children';

  for (const child of folderNode.children) {
    if (child.isFolder) {
      childrenContainer.appendChild(createFolderElement(child));
    } else {
      childrenContainer.appendChild(createFileElement(child));
    }
  }
  container.appendChild(childrenContainer);

  // Toggle collapse/expand on arrow click
  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isCollapsed = container.classList.toggle('collapsed');
    toggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
    const icon = toggleBtn.querySelector('.toggle-icon');
    if (icon) {
      icon.textContent = isCollapsed ? '▶' : '▼';
    }
  });

  // Folder checkbox change: check or uncheck all descendant files
  checkbox.addEventListener('change', () => {
    const isChecked = checkbox.checked;
    const descendantFiles = folderNode.getAllFiles();
    for (const f of descendantFiles) {
      if (isChecked) {
        selectedFilePaths.add(f.fullPath);
        if (f.checkbox) f.checkbox.checked = true;
      } else {
        selectedFilePaths.delete(f.fullPath);
        if (f.checkbox) f.checkbox.checked = false;
      }
    }
    updateAllFolderStates();
    updateSelectionSummary();
  });

  return container;
}

// Create DOM element for a file node
function createFileElement(fileNode) {
  const container = document.createElement('div');
  container.className = 'tree-node file-node';
  fileNode.element = container;

  const row = document.createElement('div');
  row.className = 'file-row';

  // Spacer for alignment with folder toggle buttons
  const spacer = document.createElement('span');
  spacer.className = 'toggle-spacer';

  // Checkbox
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'file-checkbox';
  const checkboxId = 'file-' + Math.random().toString(36).substring(2, 9);
  checkbox.id = checkboxId;
  checkbox.checked = selectedFilePaths.has(fileNode.fullPath);
  fileNode.checkbox = checkbox;
  allFileNodes.push(fileNode);

  // Label
  const label = document.createElement('label');
  label.htmlFor = checkboxId;
  label.className = 'file-label';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'file-name';
  nameSpan.textContent = fileNode.name;
  label.appendChild(nameSpan);

  // Small "large" label if file > 200 KB
  if (isLargeFile(fileNode.fileData)) {
    const largeBadge = document.createElement('span');
    largeBadge.className = 'badge-large';
    largeBadge.textContent = 'large';
    label.appendChild(largeBadge);
  }

  row.appendChild(spacer);
  row.appendChild(checkbox);
  row.appendChild(label);
  container.appendChild(row);

  checkbox.addEventListener('change', () => {
    if (checkbox.checked) {
      selectedFilePaths.add(fileNode.fullPath);
    } else {
      selectedFilePaths.delete(fileNode.fullPath);
    }
    updateAllFolderStates();
    updateSelectionSummary();
  });

  return container;
}

function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Render the tree in Step 2
function renderTree(files) {
  if (!fileTreeEl || !treeContainer) return;

  fileTreeEl.innerHTML = '';
  if (typeof fileTreeEl.replaceChildren === 'function') {
    fileTreeEl.replaceChildren();
  } else {
    while (fileTreeEl.firstChild) {
      fileTreeEl.removeChild(fileTreeEl.firstChild);
    }
  }

  allFileNodes = [];
  allFolderNodes = [];
  window.allFileNodes = allFileNodes;
  window.allFolderNodes = allFolderNodes;
  selectedFilePaths.clear();

  // Apply default selection rules
  for (const file of files) {
    if (!shouldDeselectByDefault(file)) {
      selectedFilePaths.add(file.path);
    }
  }

  currentTreeRoot = buildTree(files);

  const fragment = document.createDocumentFragment();
  for (const child of currentTreeRoot.children) {
    if (child.isFolder) {
      fragment.appendChild(createFolderElement(child));
    } else {
      fragment.appendChild(createFileElement(child));
    }
  }
  fileTreeEl.appendChild(fragment);

  updateAllFolderStates();
  updateSelectionSummary();
  if (orderContainer) orderContainer.hidden = true;
  if (fetchContainer) fetchContainer.hidden = true;
  if (inputSection) inputSection.hidden = true;
  treeContainer.hidden = false;
}

// Select All in Step 2
if (selectAllBtn) {
  selectAllBtn.addEventListener('click', () => {
    for (const f of allFileNodes) {
      selectedFilePaths.add(f.fullPath);
      if (f.checkbox) f.checkbox.checked = true;
    }
    updateAllFolderStates();
    updateSelectionSummary();
  });
}

// Deselect All in Step 2
if (deselectAllBtn) {
  deselectAllBtn.addEventListener('click', () => {
    selectedFilePaths.clear();
    for (const f of allFileNodes) {
      if (f.checkbox) f.checkbox.checked = false;
    }
    updateAllFolderStates();
    updateSelectionSummary();
  });
}

// Step 2 Back & Start over buttons
if (treeBackBtn) {
  treeBackBtn.addEventListener('click', () => {
    if (treeContainer) treeContainer.hidden = true;
    if (inputSection) inputSection.hidden = false;
  });
}

if (treeStartOverBtn) {
  treeStartOverBtn.addEventListener('click', startOver);
}

// ==========================================
// Step 3: Ordering Screen Logic
// ==========================================

// Sorting comparison: Folders first (alphabetical, folders grouped together)
function compareFoldersFirst(aPath, bPath) {
  const partsA = aPath.split('/');
  const partsB = bPath.split('/');
  const minLen = Math.min(partsA.length, partsB.length);

  for (let i = 0; i < minLen; i++) {
    const segA = partsA[i];
    const segB = partsB[i];
    const isFolderA = (i < partsA.length - 1);
    const isFolderB = (i < partsB.length - 1);

    if (segA !== segB) {
      if (isFolderA && !isFolderB) return -1;
      if (!isFolderA && isFolderB) return 1;
      return segA.localeCompare(segB, undefined, { sensitivity: 'base', numeric: true });
    }
  }
  return partsB.length - partsA.length;
}

// Sort by A to Z (full path alphabetical)
function sortListAtoZ(list) {
  return [...list].sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base', numeric: true }));
}

// Sort by Folders first (default order)
function sortListFoldersFirst(list) {
  return [...list].sort((a, b) => compareFoldersFirst(a.path, b.path));
}

// Sort by Original order (original order in repoFiles)
function sortListOriginal(list) {
  const originalIndex = new Map();
  repoFiles.forEach((file, idx) => {
    originalIndex.set(file.path, idx);
  });
  return [...list].sort((a, b) => {
    const idxA = originalIndex.has(a.path) ? originalIndex.get(a.path) : 0;
    const idxB = originalIndex.has(b.path) ? originalIndex.get(b.path) : 0;
    return idxA - idxB;
  });
}

// Set active sort button indicator
function setActiveSortButton(btnId) {
  [sortAzBtn, sortFoldersBtn, sortOriginalBtn].forEach(btn => {
    if (btn) btn.classList.remove('active');
  });
  const activeBtn = document.getElementById(btnId);
  if (activeBtn) {
    activeBtn.classList.add('active');
  }
}

// Render the ordered list into the DOM
function renderOrderListDOM() {
  if (!orderListEl) return;
  orderListEl.innerHTML = '';
  if (typeof orderListEl.replaceChildren === 'function') {
    orderListEl.replaceChildren();
  } else {
    while (orderListEl.firstChild) {
      orderListEl.removeChild(orderListEl.firstChild);
    }
  }

  const fragment = document.createDocumentFragment();
  for (const file of orderedFiles) {
    const li = document.createElement('li');
    li.className = 'order-item';
    li.dataset.path = file.path;

    // Drag handle
    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.title = 'Drag to reorder';
    handle.setAttribute('aria-label', 'Drag handle');
    handle.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        <circle cx="5" cy="3" r="1.5"/>
        <circle cx="11" cy="3" r="1.5"/>
        <circle cx="5" cy="8" r="1.5"/>
        <circle cx="11" cy="8" r="1.5"/>
        <circle cx="5" cy="13" r="1.5"/>
        <circle cx="11" cy="13" r="1.5"/>
      </svg>
    `;

    // Path
    const pathSpan = document.createElement('span');
    pathSpan.className = 'order-path';
    pathSpan.textContent = file.path;

    li.appendChild(handle);
    li.appendChild(pathSpan);

    // README Mode Toggle Control
    if (isReadmeFile(file.path)) {
      const currentMode = readmePreviewModes.get(file.path) || 'raw';
      readmePreviewModes.set(file.path, currentMode);

      const toggle = document.createElement('div');
      toggle.className = 'readme-mode-toggle';
      toggle.setAttribute('role', 'radiogroup');
      toggle.setAttribute('aria-label', `View mode for ${file.path}`);

      const rawBtn = document.createElement('button');
      rawBtn.type = 'button';
      rawBtn.className = 'readme-mode-btn' + (currentMode === 'raw' ? ' selected' : '');
      rawBtn.setAttribute('role', 'radio');
      rawBtn.setAttribute('aria-checked', String(currentMode === 'raw'));
      rawBtn.textContent = 'Raw code';

      const previewBtn = document.createElement('button');
      previewBtn.type = 'button';
      previewBtn.className = 'readme-mode-btn' + (currentMode === 'preview' ? ' selected' : '');
      previewBtn.setAttribute('role', 'radio');
      previewBtn.setAttribute('aria-checked', String(currentMode === 'preview'));
      previewBtn.textContent = 'Preview';

      rawBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (readmePreviewModes.get(file.path) === 'raw') return;
        readmePreviewModes.set(file.path, 'raw');
        rawBtn.classList.add('selected');
        rawBtn.setAttribute('aria-checked', 'true');
        previewBtn.classList.remove('selected');
        previewBtn.setAttribute('aria-checked', 'false');
      });

      previewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (readmePreviewModes.get(file.path) === 'preview') return;
        readmePreviewModes.set(file.path, 'preview');
        previewBtn.classList.add('selected');
        previewBtn.setAttribute('aria-checked', 'true');
        rawBtn.classList.remove('selected');
        rawBtn.setAttribute('aria-checked', 'false');
      });

      toggle.appendChild(rawBtn);
      toggle.appendChild(previewBtn);
      li.appendChild(toggle);
    }

    fragment.appendChild(li);
  }
  orderListEl.appendChild(fragment);

  if (orderCountEl) {
    const count = orderedFiles.length;
    orderCountEl.textContent = `${count} ${count === 1 ? 'file' : 'files'}`;
  }
}

// Sync orderedFiles array from DOM after drag-and-drop
function syncOrderedFilesFromDOM() {
  if (!orderListEl) return;
  const items = Array.from(orderListEl.querySelectorAll('.order-item'));
  const fileMap = new Map();
  for (const file of window.repoFiles) {
    fileMap.set(file.path, file);
  }
  orderedFiles = items
    .map(el => fileMap.get(el.dataset.path))
    .filter(Boolean);
  window.orderedFiles = orderedFiles;
  [sortAzBtn, sortFoldersBtn, sortOriginalBtn].forEach(b => b && b.classList.remove('active'));
}

// Initialize SortableJS
function initSortable() {
  if (!orderListEl) return;
  if (sortableInstance) {
    sortableInstance.destroy();
    sortableInstance = null;
  }
  if (typeof Sortable !== 'undefined') {
    sortableInstance = new Sortable(orderListEl, {
      handle: '.drag-handle',
      filter: '.readme-mode-toggle, .readme-mode-toggle *',
      preventOnFilter: false,
      animation: 150,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      onEnd: () => {
        syncOrderedFilesFromDOM();
      }
    });
  }
}

// Enter Step 3: Ordering screen
function openOrderingScreen() {
  const currentFiles = Array.isArray(window.repoFiles) ? window.repoFiles : [];
  const selected = currentFiles.filter(f => selectedFilePaths.has(f.path));
  if (selected.length === 0) return;

  // Default order: alphabetical, folders grouped together
  orderedFiles = sortListFoldersFirst(selected);
  window.orderedFiles = orderedFiles;

  if (inputSection) inputSection.hidden = true;
  if (treeContainer) treeContainer.hidden = true;
  if (fetchContainer) fetchContainer.hidden = true;
  if (orderContainer) orderContainer.hidden = false;

  renderOrderListDOM();
  setActiveSortButton('sort-folders-btn');
  initSortable();
}

// Step 2 Next button -> goes to Step 3
if (nextBtn) {
  nextBtn.addEventListener('click', openOrderingScreen);
}

// Step 3 Sort buttons
if (sortAzBtn) {
  sortAzBtn.addEventListener('click', () => {
    orderedFiles = sortListAtoZ(orderedFiles);
    window.orderedFiles = orderedFiles;
    renderOrderListDOM();
    setActiveSortButton('sort-az-btn');
  });
}

if (sortFoldersBtn) {
  sortFoldersBtn.addEventListener('click', () => {
    orderedFiles = sortListFoldersFirst(orderedFiles);
    window.orderedFiles = orderedFiles;
    renderOrderListDOM();
    setActiveSortButton('sort-folders-btn');
  });
}

if (sortOriginalBtn) {
  sortOriginalBtn.addEventListener('click', () => {
    orderedFiles = sortListOriginal(orderedFiles);
    window.orderedFiles = orderedFiles;
    renderOrderListDOM();
    setActiveSortButton('sort-original-btn');
  });
}

// Step 3 Back button -> returns to Step 2 keeping the selection
if (orderBackBtn) {
  orderBackBtn.addEventListener('click', () => {
    if (orderContainer) orderContainer.hidden = true;
    if (treeContainer) treeContainer.hidden = false;
  });
}

// Step 3 Start over button
if (orderStartOverBtn) {
  orderStartOverBtn.addEventListener('click', startOver);
}

// Step 3 Next button -> transitions to Step 4
if (orderNextBtn) {
  orderNextBtn.addEventListener('click', () => {
    openFetchScreen();
  });
}

// ==========================================
// Step 4: Content Fetching & Highlighting
// ==========================================

// Detect language from file path
function detectLanguage(filePath) {
  const fileName = filePath.split('/').pop().toLowerCase();
  if (fileName === 'dockerfile') return 'dockerfile';
  if (fileName === 'makefile') return 'makefile';
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot !== -1 && lastDot < fileName.length - 1) {
    const ext = fileName.slice(lastDot + 1);
    if (EXTENSION_TO_LANGUAGE[ext]) {
      return EXTENSION_TO_LANGUAGE[ext];
    }
  }
  return 'plaintext';
}

// Normalise tabs to 4 spaces and line endings to \n
function normalizeText(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, '    ');
}

// Check if content looks binary
function isBinaryContent(text) {
  if (typeof text !== 'string') return true;
  if (text.includes('\0')) return true;

  const sample = text.slice(0, 4000);
  let controlChars = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 65533) {
      controlChars++;
    }
  }
  return controlChars > sample.length * 0.1;
}

// Highlight code using highlight.js
function highlightCode(code, language) {
  if (typeof hljs !== 'undefined') {
    if (language && language !== 'plaintext' && hljs.getLanguage(language)) {
      try {
        return hljs.highlight(code, { language }).value;
      } catch (_) {}
    }
    try {
      return hljs.highlight(code, { language: 'plaintext' }).value;
    } catch (_) {}
  }
  return escapeHtml(code);
}

// Split highlighted HTML into lines preserving open span tags on every line
function splitHighlightedIntoLines(html) {
  const lines = [];
  const openTags = [];
  let currentLine = '';

  const tokenRegex = /(<span[^>]*>|<\/span>|\n|[^<\n]+|<)/g;
  let match;

  while ((match = tokenRegex.exec(html)) !== null) {
    const token = match[0];

    if (token === '\n') {
      let closedLine = currentLine;
      for (let i = openTags.length - 1; i >= 0; i--) {
        closedLine += '</span>';
      }
      lines.push(closedLine);

      currentLine = '';
      for (let i = 0; i < openTags.length; i++) {
        currentLine += openTags[i];
      }
    } else if (token.startsWith('<span')) {
      openTags.push(token);
      currentLine += token;
    } else if (token === '</span>') {
      if (openTags.length > 0) {
        openTags.pop();
      }
      currentLine += token;
    } else {
      currentLine += token;
    }
  }

  let closedLine = currentLine;
  for (let i = openTags.length - 1; i >= 0; i--) {
    closedLine += '</span>';
  }
  lines.push(closedLine);

  return lines;
}

// Fetch single file content from GitHub and process
async function fetchAndProcessFile(file) {
  const path = file.path;
  let text = '';
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');

  if (currentToken) {
    // With token: GitHub contents API with Accept: application/vnd.github.raw+json
    const url = `https://api.github.com/repos/${encodeURIComponent(currentOwner)}/${encodeURIComponent(currentRepo)}/contents/${encodedPath}?ref=${encodeURIComponent(currentBranch)}`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github.raw+json',
        'Authorization': `Bearer ${currentToken}`
      }
    });
    if (!res.ok) {
      return { skipped: true, path, reason: `HTTP ${res.status} ${res.statusText}` };
    }
    text = await res.text();
  } else {
    // Public repo: https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}
    const url = `https://raw.githubusercontent.com/${encodeURIComponent(currentOwner)}/${encodeURIComponent(currentRepo)}/${encodeURIComponent(currentBranch)}/${encodedPath}`;
    const res = await fetch(url);
    if (!res.ok) {
      return { skipped: true, path, reason: `HTTP ${res.status} ${res.statusText}` };
    }
    text = await res.text();
  }

  if (isBinaryContent(text)) {
    return { skipped: true, path, reason: 'Looks binary' };
  }

  const normalized = normalizeText(text);
  const isPreview = isReadmeFile(path) && readmePreviewModes.get(path) === 'preview';
  const language = detectLanguage(path);
  let lines = [];
  if (!isPreview) {
    const highlightedHtml = highlightCode(normalized, language);
    lines = splitHighlightedIntoLines(highlightedHtml);
  }

  return { skipped: false, path, language, lines, originalText: normalized };
}

// Concurrent worker pool for GitHub flow: fetch 5 at a time
async function runConcurrentFetch(files, concurrency = 5, onProgress) {
  const results = [];
  const skipped = [];
  let completed = 0;
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < files.length) {
      const idx = nextIdx++;
      const file = files[idx];
      try {
        const item = await fetchAndProcessFile(file);
        if (item.skipped) {
          skipped.push(item);
        } else {
          results.push(item);
        }
      } catch (err) {
        skipped.push({ path: file.path, reason: err.message || 'Fetch failed' });
      }
      completed++;
      if (onProgress) {
        onProgress(completed, files.length, file.path);
      }
    }
  }

  const workers = [];
  const poolSize = Math.min(concurrency, files.length);
  for (let i = 0; i < poolSize; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  // Preserve the user-specified order
  const orderMap = new Map();
  files.forEach((f, i) => orderMap.set(f.path, i));
  results.sort((a, b) => (orderMap.get(a.path) ?? 0) - (orderMap.get(b.path) ?? 0));

  return { results, skipped };
}

// Enter Step 4: Content Fetching / Processing screen
async function openFetchScreen() {
  if (!orderedFiles || orderedFiles.length === 0) return;

  if (inputSection) inputSection.hidden = true;
  if (orderContainer) orderContainer.hidden = true;
  if (fetchContainer) fetchContainer.hidden = false;

  const total = orderedFiles.length;
  if (progressTextEl) progressTextEl.textContent = `0 / ${total}`;
  if (progressBarFillEl) progressBarFillEl.style.width = '0%';
  if (fetchStatusLineEl) fetchStatusLineEl.textContent = (currentSource === 'zip' || currentSource === 'files') ? 'Processing files...' : 'Starting download...';
  if (skippedContainerEl) skippedContainerEl.hidden = true;
  if (skippedListEl) skippedListEl.innerHTML = '';
  if (pdfControlsEl) pdfControlsEl.hidden = true;
  if (fetchBackBtn) fetchBackBtn.disabled = true;

  let results = [];
  let skipped = [];

  if (currentSource === 'zip' || currentSource === 'files') {
    // In-memory flow (ZIP & Uploaded files): decode with TextDecoder, no network fetch
    const contentsMap = (currentSource === 'files') ? uploadedFileContents : zipFileContents;
    let completed = 0;
    for (const file of orderedFiles) {
      const uint8 = contentsMap.get(file.path);
      let isBinary = false;
      let text = '';

      if (!uint8) {
        isBinary = true;
      } else {
        try {
          const decoder = new TextDecoder('utf-8', { fatal: true });
          text = decoder.decode(uint8);
        } catch (_) {
          isBinary = true;
        }
      }

      if (!isBinary && text.includes('\0')) {
        isBinary = true;
      }

      if (isBinary) {
        skipped.push({ path: file.path, reason: 'Looks binary' });
      } else {
        const normalized = normalizeText(text);
        const isPreview = isReadmeFile(file.path) && readmePreviewModes.get(file.path) === 'preview';
        const language = detectLanguage(file.path);
        let lines = [];
        if (!isPreview) {
          const highlightedHtml = highlightCode(normalized, language);
          lines = splitHighlightedIntoLines(highlightedHtml);
        }
        results.push({ path: file.path, language, lines, originalText: normalized });
      }

      completed++;
      if (progressTextEl) {
        progressTextEl.textContent = `${completed} / ${total}`;
      }
      if (progressBarFillEl) {
        const pct = Math.round((completed / total) * 100);
        progressBarFillEl.style.width = `${pct}%`;
      }
      if (fetchStatusLineEl) {
        fetchStatusLineEl.textContent = `Processing (${completed}/${total}): ${file.path}`;
      }

      // Small async tick for smooth UI updates
      await new Promise(r => setTimeout(r, 0));
    }
  } else {
    // GitHub flow: network fetching 5 at a time
    const res = await runConcurrentFetch(orderedFiles, 5, (completed, totalCount, lastPath) => {
      if (progressTextEl) {
        progressTextEl.textContent = `${completed} / ${totalCount}`;
      }
      if (progressBarFillEl) {
        const pct = Math.round((completed / totalCount) * 100);
        progressBarFillEl.style.width = `${pct}%`;
      }
      if (fetchStatusLineEl) {
        fetchStatusLineEl.textContent = `Processing (${completed}/${totalCount}): ${lastPath}`;
      }
    });
    results = res.results;
    skipped = res.skipped;
  }

  processedFiles = results;
  window.processedFiles = processedFiles;

  // Display skipped files if any
  if (skipped.length > 0 && skippedContainerEl && skippedListEl) {
    skippedContainerEl.hidden = false;
    if (skippedCountEl) skippedCountEl.textContent = String(skipped.length);
    skippedListEl.innerHTML = '';
    for (const item of skipped) {
      const li = document.createElement('li');
      li.className = 'skipped-item';
      li.innerHTML = `<strong>${escapeHtml(item.path)}</strong>: ${escapeHtml(item.reason)}`;
      skippedListEl.appendChild(li);
    }
  }

  if (fetchStatusLineEl) {
    fetchStatusLineEl.textContent = `Completed: ${processedFiles.length} files processed${skipped.length > 0 ? `, ${skipped.length} skipped` : ''}.`;
  }
  if (fetchBackBtn) {
    fetchBackBtn.disabled = false;
  }
  if (pdfControlsEl) {
    pdfControlsEl.hidden = false;
  }
}

// Step 4 Back button -> returns to Step 3
if (fetchBackBtn) {
  fetchBackBtn.addEventListener('click', () => {
    if (fetchContainer) fetchContainer.hidden = true;
    if (orderContainer) orderContainer.hidden = false;
  });
}

// Step 4 Start over button
if (fetchStartOverBtn) {
  fetchStartOverBtn.addEventListener('click', startOver);
}

// ==========================================
// Final Step: Print-Ready Document & PDF Export
// ==========================================

// Render markdown to sanitized HTML with resolved links and images
function renderMarkdownPreview(markdownText, filePath) {
  if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
    throw new Error('Markdown preview libraries not loaded');
  }

  // Use marked with GitHub-flavoured markdown (tables, task lists, strikethrough)
  const rawHtml = marked.parse(markdownText || '', {
    gfm: true,
    breaks: false
  });

  // Sanitize with DOMPurify forbidding iframe, video, script, style, form tags
  const cleanHtml = DOMPurify.sanitize(rawHtml, {
    FORBID_TAGS: ['iframe', 'video', 'script', 'style', 'form']
  });

  const container = document.createElement('div');
  container.innerHTML = cleanHtml;

  // Process links: keep absolute http(s) links. For any other href (relative, #anchor), remove href and keep text
  const links = container.querySelectorAll('a');
  for (const a of links) {
    const href = a.getAttribute('href');
    if (href) {
      if (/^https?:\/\//i.test(href)) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      } else {
        a.removeAttribute('href');
      }
    }
  }

  // Process images
  const images = container.querySelectorAll('img');
  for (const img of images) {
    const originalSrc = (img.getAttribute('src') || '').trim();
    img.setAttribute('onerror', 'this.remove()');

    if (/^https?:\/\//i.test(originalSrc)) {
      // Keep absolute http(s) URLs as is
    } else if (originalSrc.startsWith('data:')) {
      // Keep data URL src
    } else if (originalSrc) {
      if (currentSource === 'files') {
        // Relative images from uploaded files cannot be resolved, so remove them
        img.remove();
      } else {
        const cleanTarget = originalSrc.split('?')[0].split('#')[0];
        const resolvedPath = resolveRelativePath(filePath, cleanTarget);

        if (currentSource === 'github') {
          const owner = currentOwner || window.currentOwner || '';
          const repo = currentRepo || window.currentRepo || '';
          const branch = currentBranch || window.currentBranch || 'main';
          const encoded = resolvedPath.split('/').map(encodeURIComponent).join('/');
          img.src = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}/${encoded}`;
        } else {
          // ZIP projects: look up in zipFileContents
          const extMatch = resolvedPath.match(/\.([a-zA-Z0-9]+)$/);
          const ext = extMatch ? extMatch[1].toLowerCase() : '';
          const supported = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];
          if (supported.includes(ext) && zipFileContents.has(resolvedPath)) {
            const uint8 = zipFileContents.get(resolvedPath);
            img.src = uint8ArrayToDataUrl(uint8, ext);
          } else {
            img.remove();
          }
        }
      }
    } else {
      img.remove();
    }
  }

  // Fenced code blocks: run highlight.js on pre code
  const codeBlocks = container.querySelectorAll('pre code');
  for (const block of codeBlocks) {
    if (typeof hljs !== 'undefined') {
      try {
        hljs.highlightElement(block);
      } catch (_) {}
    }
  }

  return container.innerHTML;
}

// Wait for document fonts and all preview images before window.print() (up to 8s)
function waitForPreviewImages(container, timeoutMs = 8000) {
  if (!container) return Promise.resolve();
  const images = Array.from(container.querySelectorAll('.preview-section img'));
  if (images.length === 0) return Promise.resolve();

  return new Promise((resolve) => {
    let finished = false;
    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        resolve();
      }
    }, timeoutMs);

    let remaining = images.length;
    function checkDone() {
      remaining--;
      if (remaining <= 0 && !finished) {
        finished = true;
        clearTimeout(timer);
        resolve();
      }
    }

    for (const img of images) {
      if (img.complete) {
        checkDone();
      } else {
        img.addEventListener('load', checkDone, { once: true });
        img.addEventListener('error', checkDone, { once: true });
      }
    }
  });
}

// Build the print-ready HTML
function renderPrintHtml(repoName, branch, files) {
  let html = '';

  // 1. Cover page (keeps its own page, first file starts after it)
  html += '<div class="cover-page">';
  html += `<h1 class="cover-repo-name">${escapeHtml(repoName)}</h1>`;
  html += '<div class="cover-meta">';
  if (branch) {
    html += `<div class="cover-meta-item"><strong>Branch:</strong> ${escapeHtml(branch)}</div>`;
  }
  html += `<div class="cover-meta-item"><strong>File count:</strong> ${files.length}</div>`;
  html += '</div>';
  html += '<div class="cover-toc">';
  html += '<h2 class="toc-title">Table of Contents</h2>';
  html += '<ol class="toc-list">';
  for (const f of files) {
    html += `<li class="toc-item">${escapeHtml(f.path)}</li>`;
  }
  html += '</ol>';
  html += '</div>';
  html += '</div>';

  // 2. Files flow
  let prevWasPreview = false;

  for (const f of files) {
    let isPreview = isReadmeFile(f.path) && readmePreviewModes.get(f.path) === 'preview';
    let previewHtml = '';

    if (isPreview) {
      try {
        previewHtml = renderMarkdownPreview(f.originalText || '', f.path);
      } catch (_) {
        // Silently fall back to Raw code for that file
        isPreview = false;
        if (!f.lines || f.lines.length === 0) {
          const lang = f.language || detectLanguage(f.path);
          const highlightedHtml = highlightCode(f.originalText || '', lang);
          f.lines = splitHighlightedIntoLines(highlightedHtml);
        }
      }
    }

    if (isPreview) {
      html += '<div class="file-section preview-section">';
      html += '<div class="file-header-group">';
      html += '<div class="file-header-bar">';
      html += `<span class="file-header-path">${escapeHtml(f.path)}</span>`;
      html += '</div>';
      html += '</div>'; // close file-header-group

      html += `<div class="readme-preview-content">${previewHtml}</div>`;
      html += '</div>'; // close file-section preview-section
      prevWasPreview = true;
    } else {
      const extraClass = prevWasPreview ? ' after-preview' : '';
      html += `<div class="file-section${extraClass}">`;
      html += '<div class="file-header-group">';
      html += '<div class="file-header-bar">';
      html += `<span class="file-header-path">${escapeHtml(f.path)}</span>`;
      html += `<span class="file-header-lines">${f.lines ? f.lines.length : 0} lines</span>`;
      html += '</div>';

      const firstLines = (f.lines || []).slice(0, 3);
      const restLines = (f.lines || []).slice(3);

      html += '<div class="file-code">';
      firstLines.forEach((lineHtml, idx) => {
        const lineNum = idx + 1;
        const content = lineHtml || '&#8203;';
        html += `<div class="code-line"><span class="line-number">${lineNum}</span><span class="line-content">${content}</span></div>`;
      });
      html += '</div>';
      html += '</div>'; // close file-header-group

      if (restLines.length > 0) {
        html += '<div class="file-code">';
        restLines.forEach((lineHtml, idx) => {
          const lineNum = idx + 4;
          const content = lineHtml || '&#8203;';
          html += `<div class="code-line"><span class="line-number">${lineNum}</span><span class="line-content">${content}</span></div>`;
        });
        html += '</div>';
      }

      html += '</div>'; // close file-section
      prevWasPreview = false;
    }
  }

  return html;
}

// Generate print view and trigger window.print()
async function printDocument(mode) {
  if (!window.processedFiles || window.processedFiles.length === 0) return;
  if (!printViewEl) return;

  const fontSelect = fontSelectEl || document.getElementById('font-select');
  const fontSizeSelect = fontSizeSelectEl || document.getElementById('font-size-select');
  const chosenFont = fontSelect ? fontSelect.value : "'JetBrains Mono', monospace";
  const chosenSize = fontSizeSelect ? fontSizeSelect.value : '9pt';
  const footerColor = (mode === 'bw') ? '#000000' : '#57606a';

  // Apply to document root for @page margin boxes
  if (document.documentElement && document.documentElement.style) {
    document.documentElement.style.setProperty('--code-font', chosenFont);
    document.documentElement.style.setProperty('--code-font-size', chosenSize);
    document.documentElement.style.setProperty('--footer-color', footerColor);
  }

  // Apply mode
  printViewEl.className = 'print-view ' + (mode === 'bw' ? 'bw-mode' : 'colour-mode');
  printViewEl.style.setProperty('--code-font', chosenFont);
  printViewEl.style.setProperty('--code-font-size', chosenSize);
  printViewEl.style.setProperty('--footer-color', footerColor);

  // Dynamic @page style tag for browser engines with strict @page margin box styling
  let pageStyle = document.getElementById('print-page-style');
  if (!pageStyle) {
    pageStyle = document.createElement('style');
    pageStyle.id = 'print-page-style';
    document.head.appendChild(pageStyle);
  }
  pageStyle.textContent = `
    @page {
      size: A4;
      margin: 15mm 15mm 20mm 15mm;
      @bottom-left {
        content: "https://git2pdf.devs.surf/";
        font-family: ${chosenFont};
        font-size: 8pt;
        color: ${footerColor};
      }
      @bottom-center {
        content: "Page " counter(page) " of " counter(pages);
        font-family: ${chosenFont};
        font-size: 8pt;
        color: ${footerColor};
      }
    }
  `;

  // Render print-ready document HTML
  let projectName = '';
  let branchName = '';

  if (currentSource === 'files') {
    projectName = 'Uploaded files';
    branchName = ''; // Hide branch line for uploaded files
  } else if (currentSource === 'zip') {
    projectName = (currentZipFileName || 'Project').replace(/\.zip$/i, '');
    branchName = ''; // Hide branch line for ZIP projects
  } else {
    const owner = currentOwner || window.currentOwner || '';
    const repo = currentRepo || window.currentRepo || '';
    branchName = currentBranch || window.currentBranch || 'main';
    projectName = (owner && repo) ? `${owner}/${repo}` : (repo || 'Repository');
  }

  printViewEl.innerHTML = renderPrintHtml(projectName, branchName, window.processedFiles);

  // Wait for Google Fonts and preview images before printing (max 8s)
  const fontPromise = (document.fonts && document.fonts.ready)
    ? document.fonts.ready.catch(() => {})
    : Promise.resolve();
  const imagesPromise = waitForPreviewImages(printViewEl, 8000);

  await Promise.all([fontPromise, imagesPromise]);

  // Open browser print dialog so user saves as PDF
  window.print();
}

// Bind PDF Export Buttons
if (pdfColourBtn) {
  pdfColourBtn.addEventListener('click', () => {
    return printDocument('colour');
  });
}

if (pdfBwBtn) {
  pdfBwBtn.addEventListener('click', () => {
    return printDocument('bw');
  });
}

// Handle HTTP response errors
async function handleHttpError(response) {
  const remaining = response.headers.get('x-ratelimit-remaining');
  let errBody = null;
  try {
    errBody = await response.json();
  } catch (_) {}

  const message = errBody && typeof errBody.message === 'string' ? errBody.message.toLowerCase() : '';

  if (response.status === 429 || (response.status === 403 && (remaining === '0' || message.includes('rate limit')))) {
    setStatus('rate limit reached (suggest adding a token)', 'error');
    return;
  }

  if (response.status === 404 || (response.status === 403 && message.includes('not accessible'))) {
    if (isLoggedInWithGitHub()) {
      setStatusHtml(
        `Repo not found. If it is private, give access: <a href="https://github.com/apps/${APP_SLUG}/installations/new" target="_blank" rel="noopener noreferrer">https://github.com/apps/${APP_SLUG}/installations/new</a>`,
        'error'
      );
    } else {
      setStatus('repo not found or private', 'error');
    }
    return;
  }

  if (response.status === 401) {
    if (isLoggedInWithGitHub()) {
      logoutGitHub();
      setStatus('Session expired. Log in again.', 'error');
    } else {
      setStatus('invalid token (bad credentials)', 'error');
    }
    return;
  }

  setStatus(errBody && errBody.message ? errBody.message : `Error ${response.status}`, 'error');
}

// Main load function for GitHub flow
async function handleLoad(e) {
  if (e) {
    e.preventDefault();
  }

  const rawUrl = repoUrlInput ? repoUrlInput.value.trim() : '';
  let token = '';
  if (isLoggedInWithGitHub()) {
    token = sessionStorage.getItem(TOKEN_KEY) || '';
  } else {
    token = tokenInput ? tokenInput.value.trim() : '';
    if (token) {
      sessionStorage.setItem(TOKEN_KEY, token);
    } else {
      sessionStorage.removeItem(TOKEN_KEY);
    }
  }

  const parsed = parseGitHubUrl(rawUrl);
  if (!parsed) {
    setStatus('invalid URL', 'error');
    if (treeContainer) treeContainer.hidden = true;
    if (orderContainer) orderContainer.hidden = true;
    if (fetchContainer) fetchContainer.hidden = true;
    return;
  }

  const { owner, repo } = parsed;
  readmePreviewModes.clear();

  // Clear other sources
  zipFileContents.clear();
  currentZipFileName = '';
  if (zipFileInput) zipFileInput.value = '';
  chosenFiles = [];
  window.chosenFiles = chosenFiles;
  uploadedFileContents.clear();
  if (filesInput) filesInput.value = '';
  renderChosenFilesList();

  currentSource = 'github';
  currentOwner = owner;
  currentRepo = repo;
  currentToken = token;
  window.currentSource = currentSource;
  window.currentOwner = currentOwner;
  window.currentRepo = currentRepo;
  window.currentToken = currentToken;

  const headers = {
    'Accept': 'application/vnd.github.v3+json'
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (loadBtn) loadBtn.disabled = true;
  if (treeContainer) treeContainer.hidden = true;
  if (orderContainer) orderContainer.hidden = true;
  if (fetchContainer) fetchContainer.hidden = true;
  setStatus('Loading...', 'loading');

  try {
    // 1. Get repository info to identify default branch
    const repoRes = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { headers });
    if (!repoRes.ok) {
      await handleHttpError(repoRes);
      return;
    }

    const repoData = await repoRes.json();
    const defaultBranch = repoData.default_branch;
    if (!defaultBranch) {
      if (isLoggedInWithGitHub()) {
        setStatusHtml(
          `Repo not found. If it is private, give access: <a href="https://github.com/apps/${APP_SLUG}/installations/new" target="_blank" rel="noopener noreferrer">https://github.com/apps/${APP_SLUG}/installations/new</a>`,
          'error'
        );
      } else {
        setStatus('repo not found or private', 'error');
      }
      return;
    }

    currentBranch = defaultBranch;
    window.currentBranch = currentBranch;

    // 2. Get recursive tree for default branch
    const treeRes = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`, { headers });
    if (!treeRes.ok) {
      await handleHttpError(treeRes);
      return;
    }

    const treeData = await treeRes.json();

    const fileList = Array.isArray(treeData.tree)
      ? treeData.tree
          .filter(item => item && item.type === 'blob')
          .map(item => ({
            path: item.path,
            size: item.size,
            type: item.type
          }))
      : [];

    repoFiles = fileList;
    window.repoFiles = fileList;

    if (treeData.truncated) {
      setStatus('truncated tree', 'error');
      if (inputSection) inputSection.hidden = true;
      renderTree(fileList);
      return;
    }

    setStatus(`Loaded ${fileList.length} files.`, 'success');
    if (inputSection) inputSection.hidden = true;
    renderTree(fileList);
  } catch (err) {
    setStatus(err.message || 'Error loading repository', 'error');
  } finally {
    if (loadBtn) loadBtn.disabled = false;
  }
}

// Bind form submission
if (form) {
  form.addEventListener('submit', handleLoad);
} else if (loadBtn) {
  loadBtn.addEventListener('click', handleLoad);
}

// ==========================================================================
// Subtle Tech Background Icons
// ==========================================================================
(function initTechBackground() {
  const container = document.getElementById('tech-bg-layer');
  if (!container) return;

  const TECH_ICONS = [
    // Terminal
    '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
    // Code brackets </>
    '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
    // Braces { }
    '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>',
    // Git branch
    '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
    // Git commit
    '<circle cx="12" cy="12" r="3"/><line x1="3" y1="12" x2="9" y2="12"/><line x1="15" y1="12" x2="21" y2="12"/>',
    // Git merge
    '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
    // Git pull request
    '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/>',
    // CPU / Chip
    '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
    // Database
    '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
    // Server
    '<rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>',
    // File code
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="m10 13-2 2 2 2"/><path d="m14 17 2-2-2-2"/>',
    // Command key
    '<path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"/>',
    // Hash
    '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
    // Layers
    '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
    // Box / Package
    '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
    // Cloud
    '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    // Network / Share
    '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
    // Sliders
    '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
    // Webhook / Circuit
    '<path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06"/><path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8"/>',
    // Shield / Security
    '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'
  ];

  // Jittered grid ensures even full-page distribution without overlapping clusters
  const cols = 8;
  const rows = 6;
  const cellW = 100 / cols;
  const cellH = 100 / rows;
  const fragment = document.createDocumentFragment();

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const iconMarkup = TECH_ICONS[Math.floor(Math.random() * TECH_ICONS.length)];
      const el = document.createElement('span');
      const isAccent = Math.random() < 0.22;
      el.className = isAccent ? 'tech-bg-icon tech-bg-icon--accent' : 'tech-bg-icon';

      const x = (col + 0.18 + Math.random() * 0.64) * cellW;
      const y = (row + 0.18 + Math.random() * 0.64) * cellH;
      const size = Math.round(18 + Math.random() * 16);
      const rotate = Math.round(-28 + Math.random() * 56);
      const opacity = (isAccent ? 0.04 + Math.random() * 0.035 : 0.03 + Math.random() * 0.035).toFixed(3);
      const duration = (14 + Math.random() * 12).toFixed(1) + 's';
      const delay = (-Math.random() * 14).toFixed(1) + 's';
      const floatY = Math.round(-10 + Math.random() * 20) + 'px';
      const floatTilt = Math.round(-6 + Math.random() * 12) + 'deg';

      el.style.left = x.toFixed(2) + '%';
      el.style.top = y.toFixed(2) + '%';
      el.style.width = size + 'px';
      el.style.height = size + 'px';
      el.style.setProperty('--icon-rotate', rotate + 'deg');
      el.style.setProperty('--icon-opacity', opacity);
      el.style.setProperty('--float-duration', duration);
      el.style.setProperty('--float-delay', delay);
      el.style.setProperty('--float-y', floatY);
      el.style.setProperty('--float-tilt', floatTilt);

      el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${iconMarkup}</svg>`;
      fragment.appendChild(el);
    }
  }

  container.appendChild(fragment);
})();
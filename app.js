// Global variables
var repoFiles = [];
window.repoFiles = repoFiles;

var selectedFiles = [];
window.selectedFiles = selectedFiles;

var orderedFiles = [];
window.orderedFiles = orderedFiles;

var processedFiles = [];
window.processedFiles = processedFiles;

// Current repo info
var currentOwner = '';
var currentRepo = '';
var currentBranch = '';
var currentToken = '';
window.currentOwner = currentOwner;
window.currentRepo = currentRepo;
window.currentBranch = currentBranch;
window.currentToken = currentToken;

const TOKEN_KEY = 'github_token';
const LARGE_FILE_LIMIT = 200 * 1024; // 200 KB in bytes

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

// DOM Elements: Form & Step 1
const form = document.getElementById('repo-form');
const repoUrlInput = document.getElementById('repo-url') || document.querySelector('input[type="text"]');
const tokenInput = document.getElementById('token') || document.getElementById('github-token') || document.querySelector('input[type="password"]');
const loadBtn = document.getElementById('load-btn') || document.querySelector('button');
const tokenHelpToggle = document.getElementById('token-help-toggle') || document.querySelector('.help-link');
const tokenHelpBox = document.getElementById('token-help-box') || document.querySelector('.help-box');
const statusLine = document.getElementById('status') || document.getElementById('status-line');

// DOM Elements: Step 2 (Tree Screen)
const treeContainer = document.getElementById('tree-container') || document.querySelector('.tree-container');
const fileTreeEl = document.getElementById('file-tree');
const selectAllBtn = document.getElementById('select-all-btn');
const deselectAllBtn = document.getElementById('deselect-all-btn');
const selectedCountEl = document.getElementById('selected-count');
const selectedLabelEl = document.getElementById('selected-label');
const nextBtn = document.getElementById('next-btn');

// DOM Elements: Step 3 (Ordering Screen)
const orderContainer = document.getElementById('order-container') || document.querySelector('.order-container');
const orderListEl = document.getElementById('order-list');
const orderCountEl = document.getElementById('order-count');
const sortAzBtn = document.getElementById('sort-az-btn');
const sortFoldersBtn = document.getElementById('sort-folders-btn');
const sortOriginalBtn = document.getElementById('sort-original-btn');
const orderBackBtn = document.getElementById('order-back-btn');
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
const pdfControlsEl = document.getElementById('pdf-controls');
const fontSelectEl = document.getElementById('font-select');
const fontSizeSelectEl = document.getElementById('font-size-select');
const pdfColourBtn = document.getElementById('pdf-colour-btn');
const pdfBwBtn = document.getElementById('pdf-bw-btn');

// DOM Elements: Print View
const printViewEl = document.getElementById('print-view');

// State
var selectedFilePaths = new Set();
var currentTreeRoot = null;
var allFileNodes = [];
var allFolderNodes = [];
window.allFileNodes = allFileNodes;
window.allFolderNodes = allFolderNodes;
let sortableInstance = null;

// Restore token from sessionStorage if present
const storedToken = sessionStorage.getItem(TOKEN_KEY);
if (storedToken && tokenInput) {
  tokenInput.value = storedToken;
}

// Keep sessionStorage in sync on token input
if (tokenInput) {
  tokenInput.addEventListener('input', () => {
    const val = tokenInput.value.trim();
    if (val) {
      sessionStorage.setItem(TOKEN_KEY, val);
    } else {
      sessionStorage.removeItem(TOKEN_KEY);
    }
  });
}

// Toggle help box
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

// Set status message helper
function setStatus(message, type = '') {
  if (!statusLine) return;
  statusLine.textContent = message;
  statusLine.className = 'status-line' + (type ? ' ' + type : '');
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

// Fetch single file content and process
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
  const language = detectLanguage(path);
  const highlightedHtml = highlightCode(normalized, language);
  const lines = splitHighlightedIntoLines(highlightedHtml);

  return { skipped: false, path, language, lines };
}

// Concurrent worker pool: fetch 5 at a time
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

// Enter Step 4: Content Fetching screen
async function openFetchScreen() {
  if (!orderedFiles || orderedFiles.length === 0) return;

  if (orderContainer) orderContainer.hidden = true;
  if (fetchContainer) fetchContainer.hidden = false;

  const total = orderedFiles.length;
  if (progressTextEl) progressTextEl.textContent = `0 / ${total}`;
  if (progressBarFillEl) progressBarFillEl.style.width = '0%';
  if (fetchStatusLineEl) fetchStatusLineEl.textContent = 'Starting download...';
  if (skippedContainerEl) skippedContainerEl.hidden = true;
  if (skippedListEl) skippedListEl.innerHTML = '';
  if (pdfControlsEl) pdfControlsEl.hidden = true;
  if (fetchBackBtn) fetchBackBtn.disabled = true;

  const { results, skipped } = await runConcurrentFetch(orderedFiles, 5, (completed, totalCount, lastPath) => {
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

  processedFiles = results.map(({ path, language, lines }) => ({ path, language, lines }));
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

  console.log('Step 4 results ready in window.processedFiles:', window.processedFiles);
}

// Step 4 Back button -> returns to Step 3
if (fetchBackBtn) {
  fetchBackBtn.addEventListener('click', () => {
    if (fetchContainer) fetchContainer.hidden = true;
    if (orderContainer) orderContainer.hidden = false;
  });
}

// ==========================================
// Final Step: Print-Ready Document & PDF Export
// ==========================================

// Build the print-ready HTML
function renderPrintHtml(repoName, branch, files) {
  let html = '';

  // 1. Cover page
  html += '<div class="cover-page">';
  html += `<h1 class="cover-repo-name">${escapeHtml(repoName)}</h1>`;
  html += '<div class="cover-meta">';
  html += `<div class="cover-meta-item"><strong>Branch:</strong> ${escapeHtml(branch)}</div>`;
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

  // 2. Each file starts on a new page with header bar and code lines
  for (const f of files) {
    html += '<div class="file-section">';
    html += '<div class="file-header-bar">';
    html += `<span class="file-header-path">${escapeHtml(f.path)}</span>`;
    html += `<span class="file-header-lines">${f.lines.length} lines</span>`;
    html += '</div>';
    html += '<div class="file-code">';
    f.lines.forEach((lineHtml, idx) => {
      const lineNum = idx + 1;
      const content = lineHtml || '&#8203;';
      html += `<div class="code-line"><span class="line-number">${lineNum}</span><span class="line-content">${content}</span></div>`;
    });
    html += '</div>';
    html += '</div>';
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

  // Apply mode
  printViewEl.className = 'print-view ' + (mode === 'bw' ? 'bw-mode' : 'colour-mode');
  printViewEl.style.setProperty('--code-font', chosenFont);
  printViewEl.style.setProperty('--code-font-size', chosenSize);

  // Render print-ready document HTML
  const owner = currentOwner || window.currentOwner || '';
  const repo = currentRepo || window.currentRepo || '';
  const branchName = currentBranch || window.currentBranch || 'main';
  const repoFullName = (owner && repo) ? `${owner}/${repo}` : (repo || 'Repository');

  printViewEl.innerHTML = renderPrintHtml(repoFullName, branchName, window.processedFiles);

  // Wait for Google Fonts before printing
  if (document.fonts && document.fonts.ready) {
    try {
      await document.fonts.ready;
    } catch (_) {}
  }

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
    setStatus('repo not found or private', 'error');
    return;
  }

  if (response.status === 401) {
    setStatus('invalid token (bad credentials)', 'error');
    return;
  }

  setStatus(errBody && errBody.message ? errBody.message : `Error ${response.status}`, 'error');
}

// Main load function
async function handleLoad(e) {
  if (e) {
    e.preventDefault();
  }

  const rawUrl = repoUrlInput ? repoUrlInput.value.trim() : '';
  const token = tokenInput ? tokenInput.value.trim() : '';

  if (token) {
    sessionStorage.setItem(TOKEN_KEY, token);
  } else {
    sessionStorage.removeItem(TOKEN_KEY);
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
  currentOwner = owner;
  currentRepo = repo;
  currentToken = token;
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
      setStatus('repo not found or private', 'error');
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
      renderTree(fileList);
      return;
    }

    setStatus(`Loaded ${fileList.length} files.`, 'success');
    renderTree(fileList);
  } catch (err) {
    setStatus(err.message || 'Error loading repository', 'error');
  } finally {
    if (loadBtn) loadBtn.disabled = false;
  }
}

// Bind events
if (form) {
  form.addEventListener('submit', handleLoad);
} else if (loadBtn) {
  loadBtn.addEventListener('click', handleLoad);
}

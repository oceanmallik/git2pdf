// Global variable for file list
var repoFiles = [];
window.repoFiles = repoFiles;

const TOKEN_KEY = 'github_token';

// DOM Elements
const form = document.getElementById('repo-form');
const repoUrlInput = document.getElementById('repo-url') || document.querySelector('input[type="text"]');
const tokenInput = document.getElementById('token') || document.getElementById('github-token') || document.querySelector('input[type="password"]');
const loadBtn = document.getElementById('load-btn') || document.querySelector('button');
const tokenHelpToggle = document.getElementById('token-help-toggle') || document.querySelector('.help-link');
const tokenHelpBox = document.getElementById('token-help-box') || document.querySelector('.help-box');
const statusLine = document.getElementById('status') || document.getElementById('status-line');

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
    return;
  }

  const { owner, repo } = parsed;
  const headers = {
    'Accept': 'application/vnd.github.v3+json'
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (loadBtn) loadBtn.disabled = true;
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
      return;
    }

    setStatus(`Loaded ${fileList.length} files.`, 'success');
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

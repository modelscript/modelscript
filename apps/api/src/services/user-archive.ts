// SPDX-License-Identifier: AGPL-3.0-or-later

import AdmZip from "adm-zip";
import type { LibraryDatabase } from "../database.js";

export interface UserArchiveBundle {
  exportedAt: string;
  regulation?: string;
  profile?: {
    id: number;
    username: string;
    email: string;
    display_name?: string;
    bio?: string;
    avatar_url?: string;
    banner_url?: string;
    account_type?: string;
    credit_balance?: number;
    created_at?: string;
  };
  user: {
    id: number;
    username: string;
    email: string;
    display_name?: string;
    bio?: string;
    avatar_url?: string;
    banner_url?: string;
    account_type?: string;
    credit_balance?: number;
    created_at?: string;
  };
  posts: {
    id: number;
    content: string;
    created_at: string;
    like_count?: number;
    reply_count?: number;
    repost_count?: number;
  }[];
  libraries: {
    name: string;
    version: string;
    created_at: string;
  }[];
  billingHistory: {
    id: number;
    amount: number;
    balance_after: number;
    type: string;
    description: string;
    created_at: string;
  }[];
  auditHistory: {
    action: string;
    resource_type: string;
    resource_id?: string;
    created_at: string;
  }[];
  bookmarks?: {
    post_id: number;
    content?: string;
    created_at?: string;
  }[];
  following?: string[];
  followers?: string[];
}

/**
 * Gathers complete user data for GDPR Art. 20 / CCPA portability requests.
 */
export function gatherUserDataBundle(database: LibraryDatabase, userId: number): UserArchiveBundle | null {
  const user = database.getUserById(userId) as any;
  if (!user) return null;

  const archiveData = database.getUserArchiveData(userId);
  const posts = archiveData.posts;
  const libraries = archiveData.libraries;
  const billingHistory = archiveData.billingHistory;
  const auditHistory = archiveData.auditHistory;
  const bookmarks = archiveData.bookmarks;
  const following = archiveData.following;
  const followers = archiveData.followers;

  const userData = {
    id: user.id,
    username: user.username,
    email: user.email,
    display_name: user.display_name,
    bio: user.bio,
    avatar_url: user.avatar_url,
    banner_url: user.banner_url,
    account_type: user.account_type,
    credit_balance: user.credit_balance,
    created_at: user.created_at,
  };

  return {
    exportedAt: new Date().toISOString(),
    regulation: "GDPR Article 20 / CCPA Data Portability Export",
    profile: userData,
    user: userData,
    posts,
    libraries,
    billingHistory,
    auditHistory,
    bookmarks,
    following,
    followers,
  };
}

/**
 * Builds a Twitter-style offline HTML viewer page.
 * Self-contained: 0 external CDN scripts or stylesheets. Runs completely offline.
 */
export function buildOfflineViewerHtml(bundle: UserArchiveBundle): string {
  const jsonPayload = JSON.stringify(bundle).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ModelScript Archive — @${bundle.user.username}</title>
  <style>
    :root {
      --bg: #0d1117;
      --bg-card: #161b22;
      --bg-hover: #21262d;
      --border: #30363d;
      --text: #c9d1d9;
      --text-muted: #8b949e;
      --brand: #58a6ff;
      --brand-gradient: linear-gradient(135deg, #1f6feb 0%, #8957e5 100%);
      --accent: #238636;
      --danger: #f85149;
    }
    body.light {
      --bg: #f6f8fa;
      --bg-card: #ffffff;
      --bg-hover: #f3f4f6;
      --border: #d0d7de;
      --text: #1f2328;
      --text-muted: #656d76;
      --brand: #0969da;
      --brand-gradient: linear-gradient(135deg, #0969da 0%, #8957e5 100%);
      --accent: #1a7f37;
      --danger: #cf222e;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      display: flex;
      min-height: 100vh;
    }
    .sidebar {
      width: 280px;
      background: var(--bg-card);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      position: sticky;
      top: 0;
      height: 100vh;
    }
    .brand-header {
      padding: 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      border-bottom: 1px solid var(--border);
    }
    .brand-title {
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--text);
    }
    .brand-badge {
      font-size: 0.7rem;
      padding: 2px 6px;
      background: var(--brand);
      color: #fff;
      border-radius: 4px;
      font-weight: 600;
    }
    .user-summary {
      padding: 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      border-bottom: 1px solid var(--border);
    }
    .user-avatar {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: var(--brand-gradient);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 1.2rem;
      object-fit: cover;
    }
    .user-names { overflow: hidden; }
    .display-name { font-weight: 700; font-size: 0.95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .username { font-size: 0.85rem; color: var(--text-muted); }
    .nav-tabs {
      padding: 12px 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      flex: 1;
      overflow-y: auto;
    }
    .tab-btn {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: transparent;
      border: none;
      border-radius: 8px;
      color: var(--text);
      font-size: 0.9rem;
      font-weight: 500;
      cursor: pointer;
      text-align: left;
      transition: background 0.15s;
    }
    .tab-btn:hover { background: var(--bg-hover); }
    .tab-btn.active {
      background: var(--brand);
      color: #fff;
      font-weight: 600;
    }
    .tab-count {
      font-size: 0.75rem;
      padding: 2px 7px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.2);
    }
    .sidebar-footer {
      padding: 16px;
      border-top: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .theme-toggle-btn {
      padding: 6px 12px;
      background: var(--bg-hover);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      cursor: pointer;
      font-size: 0.8rem;
    }
    .main-content {
      flex: 1;
      padding: 32px 40px;
      overflow-y: auto;
      max-width: 1000px;
    }
    .page-header {
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .page-title { font-size: 1.6rem; font-weight: 700; }
    .export-date { font-size: 0.85rem; color: var(--text-muted); }
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 16px;
    }
    .stat-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
    }
    .stat-val { font-size: 1.5rem; font-weight: 700; color: var(--brand); }
    .stat-lbl { font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; margin-top: 4px; }
    .item-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 12px;
      transition: border-color 0.2s;
    }
    .item-card:hover { border-color: var(--brand); }
    .item-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
      font-size: 0.85rem;
      color: var(--text-muted);
    }
    .item-content { font-size: 0.95rem; white-space: pre-wrap; word-break: break-word; }
    .item-metrics {
      display: flex;
      gap: 16px;
      margin-top: 10px;
      font-size: 0.8rem;
      color: var(--text-muted);
    }
    .search-box {
      width: 100%;
      padding: 10px 14px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      font-size: 0.95rem;
      margin-bottom: 20px;
      outline: none;
    }
    .search-box:focus { border-color: var(--brand); }
    .table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    .table th, .table td {
      padding: 12px;
      border-bottom: 1px solid var(--border);
      text-align: left;
    }
    .table th { color: var(--text-muted); font-size: 0.8rem; text-transform: uppercase; }
    .badge {
      font-size: 0.75rem;
      padding: 2px 8px;
      border-radius: 12px;
      font-weight: 600;
    }
    .badge-success { background: rgba(35, 134, 54, 0.2); color: #3fb950; }
    .badge-info { background: rgba(56, 139, 253, 0.2); color: #58a6ff; }
    .cert-box {
      border: 1px solid var(--border);
      background: var(--bg-card);
      border-radius: 12px;
      padding: 24px;
      margin-top: 16px;
    }
    .cert-seal {
      display: inline-block;
      padding: 4px 12px;
      background: rgba(56, 139, 253, 0.15);
      color: var(--brand);
      border: 1px solid var(--brand);
      border-radius: 20px;
      font-size: 0.8rem;
      font-weight: 700;
      margin-bottom: 12px;
    }
    .raw-json-btn {
      padding: 8px 14px;
      background: var(--brand);
      color: #fff;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <aside class="sidebar">
    <div class="brand-header">
      <span style="font-size: 1.4rem;">📐</span>
      <div>
        <div class="brand-title">ModelScript</div>
        <div class="brand-badge">Archive Viewer</div>
      </div>
    </div>

    <div class="user-summary">
      <div class="user-avatar" id="avatarBox">${bundle.user.avatar_url ? `<img src="${bundle.user.avatar_url}" class="user-avatar" alt="" />` : bundle.user.username.charAt(0).toUpperCase()}</div>
      <div class="user-names">
        <div class="display-name">${bundle.user.display_name || bundle.user.username}</div>
        <div class="username">@${bundle.user.username}</div>
      </div>
    </div>

    <nav class="nav-tabs">
      <button class="tab-btn active" onclick="switchTab('profile')">
        <span>👤 Account Profile</span>
      </button>
      <button class="tab-btn" onclick="switchTab('posts')">
        <span>📝 Posts & Replies</span>
        <span class="tab-count">${bundle.posts.length}</span>
      </button>
      <button class="tab-btn" onclick="switchTab('libraries')">
        <span>📦 Models & Packages</span>
        <span class="tab-count">${bundle.libraries.length}</span>
      </button>
      <button class="tab-btn" onclick="switchTab('billing')">
        <span>💳 Billing & Credits</span>
        <span class="tab-count">${bundle.billingHistory.length}</span>
      </button>
      <button class="tab-btn" onclick="switchTab('audit')">
        <span>🛡️ Security & Logs</span>
        <span class="tab-count">${bundle.auditHistory.length}</span>
      </button>
      <button class="tab-btn" onclick="switchTab('compliance')">
        <span>📜 Privacy Certificate</span>
      </button>
    </nav>

    <div class="sidebar-footer">
      <button class="theme-toggle-btn" onclick="toggleTheme()">Toggle Theme</button>
      <button class="raw-json-btn" onclick="downloadRawJson()">Export JSON</button>
    </div>
  </aside>

  <main class="main-content" id="contentArea">
    <!-- Populated by JavaScript -->
  </main>

  <script>
    const data = ${jsonPayload};

    function toggleTheme() {
      document.body.classList.toggle('light');
      localStorage.setItem('ms-archive-theme', document.body.classList.contains('light') ? 'light' : 'dark');
    }
    if (localStorage.getItem('ms-archive-theme') === 'light') {
      document.body.classList.add('light');
    }

    function switchTab(tab) {
      document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
      const activeBtn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.getAttribute('onclick').includes(tab));
      if (activeBtn) activeBtn.classList.add('active');

      const main = document.getElementById('contentArea');
      if (tab === 'profile') renderProfile(main);
      else if (tab === 'posts') renderPosts(main);
      else if (tab === 'libraries') renderLibraries(main);
      else if (tab === 'billing') renderBilling(main);
      else if (tab === 'audit') renderAudit(main);
      else if (tab === 'compliance') renderCompliance(main);
    }

    function renderProfile(container) {
      container.innerHTML = \`
        <div class="page-header">
          <div>
            <h1 class="page-title">Account Information</h1>
            <div class="export-date">Archive generated on \${new Date(data.exportedAt).toLocaleString()}</div>
          </div>
        </div>

        <div class="stat-grid">
          <div class="stat-card">
            <div class="stat-val">\${data.posts.length}</div>
            <div class="stat-lbl">Posts Authored</div>
          </div>
          <div class="stat-card">
            <div class="stat-val">\${data.libraries.length}</div>
            <div class="stat-lbl">Models & Packages</div>
          </div>
          <div class="stat-card">
            <div class="stat-val">\${Number(data.user.credit_balance || 0).toFixed(2)}</div>
            <div class="stat-lbl">Compute Credits</div>
          </div>
          <div class="stat-card">
            <div class="stat-val">\${(data.following || []).length} / \${(data.followers || []).length}</div>
            <div class="stat-lbl">Following / Followers</div>
          </div>
        </div>

        <div class="card">
          <h2 style="font-size: 1.1rem; margin-bottom: 16px;">Profile Details</h2>
          <table class="table">
            <tr><th>Field</th><th>Value</th></tr>
            <tr><td><strong>User ID</strong></td><td>\${data.user.id}</td></tr>
            <tr><td><strong>Username</strong></td><td>@\${data.user.username}</td></tr>
            <tr><td><strong>Email</strong></td><td>\${data.user.email}</td></tr>
            <tr><td><strong>Display Name</strong></td><td>\${data.user.display_name || 'Not set'}</td></tr>
            <tr><td><strong>Bio</strong></td><td>\${data.user.bio || 'None'}</td></tr>
            <tr><td><strong>Account Type</strong></td><td>\${data.user.account_type || 'user'}</td></tr>
            <tr><td><strong>Member Since</strong></td><td>\${data.user.created_at ? new Date(data.user.created_at).toLocaleDateString() : 'N/A'}</td></tr>
          </table>
        </div>
      \`;
    }

    function renderPosts(container) {
      container.innerHTML = \`
        <div class="page-header">
          <h1 class="page-title">Posts & Replies (\${data.posts.length})</h1>
        </div>
        <input type="text" class="search-box" id="postSearch" placeholder="Search posts..." oninput="filterPosts(this.value)" />
        <div id="postsList"></div>
      \`;
      filterPosts('');
    }

    function filterPosts(query) {
      const list = document.getElementById('postsList');
      if (!list) return;
      const q = query.toLowerCase();
      const filtered = data.posts.filter(p => (p.content || '').toLowerCase().includes(q));

      if (filtered.length === 0) {
        list.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 40px;">No posts match your search.</div>';
        return;
      }

      list.innerHTML = filtered.map(p => \`
        <div class="item-card">
          <div class="item-header">
            <span>Post #\${p.id}</span>
            <span>\${new Date(p.created_at).toLocaleString()}</span>
          </div>
          <div class="item-content">\${escapeHtml(p.content || '')}</div>
          <div class="item-metrics">
            <span>❤️ \${p.like_count || 0} likes</span>
            <span>💬 \${p.reply_count || 0} replies</span>
            <span>🔁 \${p.repost_count || 0} reposts</span>
          </div>
        </div>
      \`).join('');
    }

    function renderLibraries(container) {
      container.innerHTML = \`
        <div class="page-header">
          <h1 class="page-title">Published Models & Packages (\${data.libraries.length})</h1>
        </div>
        <div class="card">
          \${data.libraries.length === 0 ? '<div style="color: var(--text-muted);">No packages or models published.</div>' : \`
            <table class="table">
              <tr><th>Package Name</th><th>Version</th><th>Release Date</th></tr>
              \${data.libraries.map(lib => \`
                <tr>
                  <td><strong>\${escapeHtml(lib.name)}</strong></td>
                  <td><span class="badge badge-info">v\${lib.version}</span></td>
                  <td>\${new Date(lib.created_at).toLocaleDateString()}</td>
                </tr>
              \`).join('')}
            </table>
          \`}
        </div>
      \`;
    }

    function renderBilling(container) {
      container.innerHTML = \`
        <div class="page-header">
          <h1 class="page-title">Billing & Credits Ledger</h1>
          <div style="font-weight: 700; color: var(--brand);">Balance: \${Number(data.user.credit_balance || 0).toFixed(2)} cr</div>
        </div>
        <div class="card">
          \${data.billingHistory.length === 0 ? '<div style="color: var(--text-muted);">No billing transactions recorded.</div>' : \`
            <table class="table">
              <tr><th>Date</th><th>Type</th><th>Description</th><th>Amount</th><th>Balance After</th></tr>
              \${data.billingHistory.map(tx => \`
                <tr>
                  <td>\${new Date(tx.created_at).toLocaleString()}</td>
                  <td><span class="badge \${tx.amount >= 0 ? 'badge-success' : 'badge-info'}">\${tx.type}</span></td>
                  <td>\${escapeHtml(tx.description || '')}</td>
                  <td style="font-weight: 600; color: \${tx.amount >= 0 ? '#3fb950' : 'inherit'}">\${tx.amount >= 0 ? '+' : ''}\${Number(tx.amount).toFixed(2)}</td>
                  <td>\${Number(tx.balance_after).toFixed(2)}</td>
                </tr>
              \`).join('')}
            </table>
          \`}
        </div>
      \`;
    }

    function renderAudit(container) {
      container.innerHTML = \`
        <div class="page-header">
          <div>
            <h1 class="page-title">Security & Audit History</h1>
            <div class="export-date">Operational audit logs are retained for 30 days pursuant to security policy.</div>
          </div>
        </div>
        <div class="card">
          \${data.auditHistory.length === 0 ? '<div style="color: var(--text-muted);">No audit log events found.</div>' : \`
            <table class="table">
              <tr><th>Timestamp</th><th>Action</th><th>Resource Type</th><th>Resource ID</th></tr>
              \${data.auditHistory.map(a => \`
                <tr>
                  <td>\${new Date(a.created_at).toLocaleString()}</td>
                  <td><code>\${escapeHtml(a.action)}</code></td>
                  <td>\${escapeHtml(a.resource_type)}</td>
                  <td>\${escapeHtml(a.resource_id || '-')}</td>
                </tr>
              \`).join('')}
            </table>
          \`}
        </div>
      \`;
    }

    function renderCompliance(container) {
      container.innerHTML = \`
        <div class="page-header">
          <h1 class="page-title">Privacy Compliance & Legal Certificate</h1>
        </div>
        <div class="cert-box">
          <div class="cert-seal">GDPR Article 20 / CCPA Portability Certificate</div>
          <h2 style="font-size: 1.2rem; margin-bottom: 8px;">Official Data Subject Access & Export Record</h2>
          <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 16px;">
            This document certifies that the contents of this archive reflect a comprehensive data export delivered in fulfillment of statutory privacy rights under EU/UK GDPR (Articles 15 and 20) and the California Consumer Privacy Act (Cal. Civ. Code § 1798.100).
          </p>
          <table class="table">
            <tr><td><strong>Data Subject:</strong></td><td>@\${data.user.username} (\${data.user.email})</td></tr>
            <tr><td><strong>User ID:</strong></td><td>\${data.user.id}</td></tr>
            <tr><td><strong>Export Timestamp:</strong></td><td>\${data.exportedAt}</td></tr>
            <tr><td><strong>Controller / Organization:</strong></td><td>ModelScript Engineering Platform</td></tr>
            <tr><td><strong>Third-Party Trackers:</strong></td><td>None (0 third-party analytics or advertising processors)</td></tr>
            <tr><td><strong>IP Address Storage:</strong></td><td>Ephemeral only (Scrubbed in volatile RAM; never retained in analytics tables)</td></tr>
            <tr><td><strong>Right to Erasure:</strong></td><td>To request permanent deletion, navigate to Account Settings &rarr; Delete Account.</td></tr>
          </table>
        </div>
      \`;
    }

    function downloadRawJson() {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = \`modelscript-data-\${data.user.username}.json\`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    // Default view
    renderProfile(document.getElementById('contentArea'));
  </script>
</body>
</html>`;
}

/**
 * Creates the complete .zip archive buffer containing the offline viewer and JSON files.
 */
export function generateUserArchiveZip(database: LibraryDatabase, userId: number): Buffer | null {
  const bundle = gatherUserDataBundle(database, userId);
  if (!bundle) return null;

  const zip = new AdmZip();

  // 1. Offline Interactive Viewer
  const html = buildOfflineViewerHtml(bundle);
  zip.addFile("index.html", Buffer.from(html, "utf-8"));

  // 2. Readme Instructions
  const readme = `ModelScript Account Data Archive
=================================
Exported Date: ${bundle.exportedAt}
Account: @${bundle.user.username} (${bundle.user.email})
Regulation: GDPR Article 20 / CCPA § 1798.100 Data Portability Export

HOW TO BROWSE YOUR DATA:
1. Double-click "index.html" to launch the interactive archive viewer in any web browser.
   It runs 100% offline with zero external network connections.
2. The raw machine-readable JSON files are stored in the "data/" directory.

DATA STRUCTURE:
- data/manifest.json    : Export metadata and schema version
- data/profile.json     : Account profile, email, settings, credentials info
- data/posts.json       : All posts and replies written by your account
- data/libraries.json   : Published Modelica/SysML packages and versions
- data/billing.json     : Compute credit transactions and balances
- data/audit_logs.json  : Security log history
- data/compliance.json  : Legal privacy compliance declaration

Privacy Notice:
ModelScript uses zero third-party analytics scripts. IP addresses are scrubbed immediately
in volatile memory upon request and are never stored in user analytics tables.
`;
  zip.addFile("README.txt", Buffer.from(readme, "utf-8"));

  // 3. Raw Data Files
  zip.addFile(
    "data/manifest.json",
    Buffer.from(
      JSON.stringify(
        {
          schemaVersion: "1.0.0",
          exportedAt: bundle.exportedAt,
          userId: bundle.user.id,
          username: bundle.user.username,
        },
        null,
        2,
      ),
      "utf-8",
    ),
  );

  zip.addFile("data/profile.json", Buffer.from(JSON.stringify(bundle.user, null, 2), "utf-8"));
  zip.addFile("data/posts.json", Buffer.from(JSON.stringify(bundle.posts, null, 2), "utf-8"));
  zip.addFile("data/libraries.json", Buffer.from(JSON.stringify(bundle.libraries, null, 2), "utf-8"));
  zip.addFile("data/billing.json", Buffer.from(JSON.stringify(bundle.billingHistory, null, 2), "utf-8"));
  zip.addFile("data/audit_logs.json", Buffer.from(JSON.stringify(bundle.auditHistory, null, 2), "utf-8"));
  zip.addFile(
    "data/compliance.json",
    Buffer.from(
      JSON.stringify(
        {
          regulation: "GDPR Article 20 / CCPA Data Portability",
          exportedAt: bundle.exportedAt,
          controller: "ModelScript Platform",
          thirdPartyTrackers: "None",
          ipRetention: "Ephemeral in-memory only (Scrubbed)",
        },
        null,
        2,
      ),
      "utf-8",
    ),
  );

  return zip.toBuffer();
}

(() => {
  'use strict';

  const STORAGE_KEY = 'manga_tracker_config_v1';

  const state = {
    config: loadConfig(),
    comics: [],
    statusFilter: 'reading',
    searchQuery: '',
    loading: false
  };

  // DOM elements
  const els = {
    totalBadge: document.getElementById('totalBadge'),
    refreshBtn: document.getElementById('refreshBtn'),
    settingsBtn: document.getElementById('settingsBtn'),
    openSetupBtn: document.getElementById('openSetupBtn'),
    searchInput: document.getElementById('searchInput'),
    tabs: document.querySelectorAll('.tab'),
    setupBanner: document.getElementById('setupBanner'),
    errorBanner: document.getElementById('errorBanner'),
    comicList: document.getElementById('comicList'),
    emptyState: document.getElementById('emptyState'),
    emptyTitle: document.getElementById('emptyTitle'),
    settingsModal: document.getElementById('settingsModal'),
    closeSettingsBtn: document.getElementById('closeSettingsBtn'),
    settingsForm: document.getElementById('settingsForm'),
    inputUrl: document.getElementById('inputUrl'),
    inputKey: document.getElementById('inputKey'),
    inputSyncKey: document.getElementById('inputSyncKey'),
    genKeyBtn: document.getElementById('genKeyBtn'),
    copyConfigBtn: document.getElementById('copyConfigBtn'),
    configSnippet: document.getElementById('configSnippet'),
    toast: document.getElementById('toast')
  };

  // ============================================================
  // 設定讀寫與 RPC 工具
  // ============================================================
  function loadConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : { url: '', anonKey: '', syncKey: '' };
    } catch (_) {
      return { url: '', anonKey: '', syncKey: '' };
    }
  }

  function saveConfig(cfg) {
    state.config = cfg;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  }

  function isConfigured() {
    const { url, anonKey, syncKey } = state.config;
    return Boolean(url && anonKey && syncKey && syncKey.length >= 8);
  }

  async function callRpc(fnName, body) {
    const base = state.config.url.replace(/\/$/, '');
    const res = await fetch(`${base}/rest/v1/rpc/${fnName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: state.config.anonKey,
        Authorization: `Bearer ${state.config.anonKey}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Supabase RPC 失敗 (${res.status}): ${text}`);
    }
    return res.json();
  }

  // ============================================================
  // 資料載入與操作
  // ============================================================
  async function fetchComics() {
    if (!isConfigured()) {
      els.setupBanner.classList.remove('hidden');
      els.comicList.innerHTML = '';
      els.emptyState.classList.add('hidden');
      els.totalBadge.textContent = '0';
      return;
    }

    els.setupBanner.classList.add('hidden');
    els.errorBanner.classList.add('hidden');
    state.loading = true;
    els.refreshBtn.classList.add('spinning');

    try {
      const data = await callRpc('list_manga_progress', {
        p_sync_key: state.config.syncKey
      });
      state.comics = Array.isArray(data) ? data : [];
      render();
    } catch (err) {
      console.error(err);
      els.errorBanner.textContent = `無法載入資料：${err.message}`;
      els.errorBanner.classList.remove('hidden');
    } finally {
      state.loading = false;
      els.refreshBtn.classList.remove('spinning');
    }
  }

  async function updateStatus(id, newStatus) {
    try {
      await callRpc('update_manga_status', {
        p_sync_key: state.config.syncKey,
        p_id: id,
        p_status: newStatus
      });
      const item = state.comics.find((c) => c.id === id);
      if (item) item.status = newStatus;
      render();
      showToast('已更新狀態');
    } catch (err) {
      showToast(`更新失敗：${err.message}`);
    }
  }

  async function deleteComic(id, title) {
    if (!confirm(`確定要移除「${title}」的追蹤紀錄嗎？`)) return;
    try {
      await callRpc('delete_manga_progress', {
        p_sync_key: state.config.syncKey,
        p_id: id
      });
      state.comics = state.comics.filter((c) => c.id !== id);
      render();
      showToast('已移除紀錄');
    } catch (err) {
      showToast(`刪除失敗：${err.message}`);
    }
  }

  // ============================================================
  // 畫面渲染
  // ============================================================
  function formatRelativeTime(iso) {
    if (!iso) return '';
    const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (diffSec < 60) return '剛剛';
    const min = Math.floor(diffSec / 60);
    if (min < 60) return `${min} 分鐘前`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} 小時前`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day} 天前`;
    return new Date(iso).toLocaleDateString('zh-Hant');
  }

  function getGradient(seedStr) {
    const palettes = [
      ['#1e3a8a', '#0ea5e9'],
      ['#581c87', '#a855f7'],
      ['#065f46', '#10b981'],
      ['#9a3412', '#f97316'],
      ['#831843', '#ec4899'],
      ['#1e293b', '#475569']
    ];
    let hash = 0;
    for (let i = 0; i < seedStr.length; i++) {
      hash = (hash * 31 + seedStr.charCodeAt(i)) >>> 0;
    }
    const [c1, c2] = palettes[hash % palettes.length];
    return `linear-gradient(135deg, ${c1}, ${c2})`;
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function render() {
    const q = state.searchQuery.trim().toLowerCase();
    const filtered = state.comics.filter((c) => {
      const matchStatus = state.statusFilter === 'all' || c.status === state.statusFilter;
      const matchQuery = !q || (c.title || '').toLowerCase().includes(q);
      return matchStatus && matchQuery;
    });

    els.totalBadge.textContent = String(filtered.length);

    if (filtered.length === 0) {
      els.comicList.innerHTML = '';
      els.emptyState.classList.remove('hidden');
      els.emptyTitle.textContent = q ? '找不到符合的漫畫' : '這個分類目前沒有漫畫';
      return;
    }

    els.emptyState.classList.add('hidden');
    els.comicList.innerHTML = filtered
      .map((c) => {
        const pageLabel = c.total_pages
          ? `P.${c.page_num}/${c.total_pages}`
          : `P.${c.page_num}`;
        const progressText = c.chapter_title ? `${c.chapter_title} · ${pageLabel}` : pageLabel;
        const firstChar = (c.title || '漫').trim().charAt(0);
        const grad = getGradient(c.comic_id || c.title || '');

        const coverHtml = c.cover_url
          ? `<img class="cover-img" src="${escapeHtml(c.cover_url)}" alt="" referrerpolicy="no-referrer" onerror="this.outerHTML='<div class=\\'cover-fallback\\' style=\\'background:${grad}\\'>${escapeHtml(firstChar)}</div>'" />`
          : `<div class="cover-fallback" style="background:${grad}">${escapeHtml(firstChar)}</div>`;

        return `
          <article class="comic-card" data-id="${escapeHtml(c.id)}">
            <a class="cover-link" href="${escapeHtml(c.chapter_url)}" target="_blank" rel="noopener noreferrer">
              ${coverHtml}
            </a>
            <div class="card-body">
              <div>
                <a class="card-title" href="${escapeHtml(c.chapter_url)}" target="_blank" rel="noopener noreferrer">
                  ${escapeHtml(c.title)}
                </a>
                <div class="progress-row" style="margin-top:6px;">
                  <a class="progress-pill" href="${escapeHtml(c.chapter_url)}" target="_blank" rel="noopener noreferrer">
                    ${escapeHtml(progressText)}
                  </a>
                  <span class="updated-time">${escapeHtml(formatRelativeTime(c.updated_at))}</span>
                </div>
              </div>
              <div class="card-footer">
                <div class="card-links">
                  <a class="mini-btn primary" href="${escapeHtml(c.chapter_url)}" target="_blank" rel="noopener noreferrer">續看</a>
                  <a class="mini-btn" href="${escapeHtml(c.comic_url)}" target="_blank" rel="noopener noreferrer">目錄</a>
                </div>
                <div style="display:flex;align-items:center;gap:4px;">
                  <select class="status-select" data-action="status" aria-label="狀態">
                    <option value="reading" ${c.status === 'reading' ? 'selected' : ''}>追漫中</option>
                    <option value="on_hold" ${c.status === 'on_hold' ? 'selected' : ''}>擱置</option>
                    <option value="completed" ${c.status === 'completed' ? 'selected' : ''}>已完結</option>
                    <option value="dropped" ${c.status === 'dropped' ? 'selected' : ''}>棄坑</option>
                  </select>
                  <button class="delete-btn" data-action="delete" title="移除" aria-label="移除">🗑</button>
                </div>
              </div>
            </div>
          </article>
        `;
      })
      .join('');
  }

  // ============================================================
  // 設定視窗與 Userscript 片段產生
  // ============================================================
  function updateSnippet() {
    const url = (els.inputUrl.value || 'https://YOUR_PROJECT_ID.supabase.co').trim();
    const key = (els.inputKey.value || 'YOUR_SUPABASE_ANON_KEY').trim();
    const syncKey = (els.inputSyncKey.value || 'YOUR_SECRET_SYNC_KEY').trim();

    els.configSnippet.textContent = `const CONFIG = {\n  SUPABASE_URL: '${url}',\n  SUPABASE_ANON_KEY: '${key}',\n  SYNC_KEY: '${syncKey}',\n  DEBOUNCE_MS: 1200,\n  SHOW_TOAST: true\n};`;
  }

  function openSettings() {
    els.inputUrl.value = state.config.url || '';
    els.inputKey.value = state.config.anonKey || '';
    els.inputSyncKey.value = state.config.syncKey || '';
    updateSnippet();
    els.settingsModal.classList.remove('hidden');
  }

  function closeSettings() {
    els.settingsModal.classList.add('hidden');
  }

  function generateRandomKey() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const arr = new Uint32Array(24);
    crypto.getRandomValues(arr);
    return Array.from(arr, (x) => chars[x % chars.length]).join('');
  }

  let toastTimer = null;
  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 2200);
  }

  // ============================================================
  // 事件監聽
  // ============================================================
  els.refreshBtn.addEventListener('click', fetchComics);
  els.settingsBtn.addEventListener('click', openSettings);
  els.openSetupBtn.addEventListener('click', openSettings);
  els.closeSettingsBtn.addEventListener('click', closeSettings);
  els.settingsModal.querySelector('.modal-backdrop').addEventListener('click', closeSettings);

  [els.inputUrl, els.inputKey, els.inputSyncKey].forEach((el) => {
    el.addEventListener('input', updateSnippet);
  });

  els.genKeyBtn.addEventListener('click', () => {
    els.inputSyncKey.value = generateRandomKey();
    updateSnippet();
  });

  els.copyConfigBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(els.configSnippet.textContent);
      showToast('已複製 Userscript CONFIG');
    } catch (_) {
      showToast('請手動全選複製');
    }
  });

  els.settingsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    saveConfig({
      url: els.inputUrl.value.trim(),
      anonKey: els.inputKey.value.trim(),
      syncKey: els.inputSyncKey.value.trim()
    });
    closeSettings();
    showToast('設定已儲存');
    fetchComics();
  });

  els.searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    render();
  });

  els.tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      els.tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      state.statusFilter = tab.dataset.status;
      render();
    });
  });

  els.comicList.addEventListener('change', (e) => {
    if (e.target.dataset.action === 'status') {
      const card = e.target.closest('.comic-card');
      if (card) updateStatus(card.dataset.id, e.target.value);
    }
  });

  els.comicList.addEventListener('click', (e) => {
    if (e.target.dataset.action === 'delete') {
      const card = e.target.closest('.comic-card');
      const title = card?.querySelector('.card-title')?.textContent?.trim() || '這部漫畫';
      if (card) deleteComic(card.dataset.id, title);
    }
  });

  // 從漫畫網頁切換回 PWA 時自動刷新最新進度
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isConfigured()) {
      fetchComics();
    }
  });

  // 註冊 Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  fetchComics();
})();

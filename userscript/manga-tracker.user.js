// ==UserScript==
// @name         追漫進度自動同步 (Supabase)
// @namespace    manga-tracker-supabase
// @version      1.0.0
// @description  看漫畫櫃時自動記錄看到哪一話、哪一頁，背景同步到 Supabase，供 PWA 書架續看
// @match        https://m.manhuagui.com/comic/*
// @match        https://www.manhuagui.com/comic/*
// @match        https://tw.manhuagui.com/comic/*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      supabase.co
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ============================================================
  // 請填入你的 Supabase 設定（可從 PWA 的設定頁面一鍵複製）
  // ============================================================
  const CONFIG = {
    SUPABASE_URL: 'https://YOUR_PROJECT_ID.supabase.co',
    SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY',
    SYNC_KEY: 'YOUR_SECRET_SYNC_KEY', // 至少 8 字元，需與 PWA 設定相同
    DEBOUNCE_MS: 1200,                // 翻頁防抖時間（毫秒）
    SHOW_TOAST: true                  // 是否在角落顯示同步提示
  };

  if (CONFIG.SUPABASE_URL.includes('YOUR_PROJECT_ID')) {
    console.warn('[MangaTracker] 尚未填入 Supabase 設定，請先編輯 Userscript 中的 CONFIG。');
    return;
  }

  const SITE = 'manhuagui';
  const COVER_CACHE_PREFIX = 'mt_cover_';
  const TITLE_CACHE_PREFIX = 'mt_title_';

  const path = location.pathname;
  const chapterMatch = path.match(/^\/comic\/(\d+)\/(\d+)\.html/);
  const infoMatch = path.match(/^\/comic\/(\d+)\/?$/);

  // ============================================================
  // 1. 漫畫目錄頁：順手快取封面圖與正確書名，進閱讀頁時一起上傳
  // ============================================================
  if (infoMatch) {
    const comicId = infoMatch[1];
    const cacheMeta = () => {
      const coverEl =
        document.querySelector('.thumb img') ||
        document.querySelector('.book-cover img') ||
        document.querySelector('.cover img') ||
        document.querySelector('meta[property="og:image"]');
      const coverUrl = coverEl
        ? coverEl.getAttribute('src') || coverEl.getAttribute('data-src') || coverEl.getAttribute('content')
        : null;
      if (coverUrl) {
        const normalized = coverUrl.startsWith('//') ? 'https:' + coverUrl : coverUrl;
        try { localStorage.setItem(COVER_CACHE_PREFIX + comicId, normalized); } catch (_) {}
      }

      const titleEl =
        document.querySelector('.main-bar h1') ||
        document.querySelector('.book-title h1') ||
        document.querySelector('h1');
      if (titleEl && titleEl.textContent.trim()) {
        try { localStorage.setItem(TITLE_CACHE_PREFIX + comicId, titleEl.textContent.trim()); } catch (_) {}
      }
    };
    cacheMeta();
    setTimeout(cacheMeta, 1000);
    return;
  }

  // 非章節閱讀頁則不執行同步
  if (!chapterMatch) return;

  const comicId = chapterMatch[1];
  const comicUrl = `${location.origin}/comic/${comicId}/`;

  // ============================================================
  // 2. 解析書名、章節名稱、目前頁碼與總頁數
  // ============================================================
  function parseTitleAndChapter() {
    const cachedTitle = (() => {
      try { return localStorage.getItem(TITLE_CACHE_PREFIX + comicId); } catch (_) { return null; }
    })();

    // 手機版與電腦版 DOM 標題嘗試
    const h1Text = document.querySelector('header h1, .header h1, .w980 h1, .title h1')?.textContent?.trim();
    const h2Text = document.querySelector('header h2, .header h2, .w980 h2, .title h2')?.textContent?.trim();

    let title = cachedTitle || h1Text || '';
    let chapterTitle = h2Text || '';

    // 從 document.title 補充解析（例："進擊的巨人 第139話 - 看漫畫" 或 "書名_第12話_手機漫畫"）
    const rawDocTitle = (document.title || '')
      .replace(/\s*[-_|–—]\s*(看漫畫|漫畫櫃|手機漫畫|manhuagui).*$/i, '')
      .trim();

    if (!title || !chapterTitle) {
      const parts = rawDocTitle.split(/[\s_]+/).filter(Boolean);
      if (parts.length >= 2) {
        if (!chapterTitle) chapterTitle = parts[parts.length - 1];
        if (!title) title = parts.slice(0, -1).join(' ');
      } else if (!title) {
        title = rawDocTitle || `漫畫 #${comicId}`;
      }
    }

    return {
      title: title.trim() || `漫畫 #${comicId}`,
      chapterTitle: chapterTitle.trim() || ''
    };
  }

  function parsePageInfo() {
    let pageNum = 1;
    let totalPages = null;

    // 優先從網址 hash (#p=12) 讀取
    const hashMatch = location.hash.match(/p=(\d+)/i);
    if (hashMatch) {
      pageNum = parseInt(hashMatch[1], 10) || 1;
    }

    // 從頁面上的頁碼元素補充目前頁數與總頁數
    const pageSelectors = [
      '.manga-page',
      '#manga-page',
      '#page',
      '.page-num',
      '.pager-info',
      '#pageSelect',
      '.sub-btn'
    ];
    for (const sel of pageSelectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const text = el.textContent || '';
      const m = text.match(/(\d+)\s*\/\s*(\d+)/);
      if (m) {
        if (!hashMatch) pageNum = parseInt(m[1], 10) || pageNum;
        totalPages = parseInt(m[2], 10) || totalPages;
        break;
      }
    }

    // 備用：檢查下拉選單選項數
    if (!totalPages) {
      const selectEl = document.querySelector('#pageSelect, select.page-select');
      if (selectEl && selectEl.options && selectEl.options.length > 0) {
        totalPages = selectEl.options.length;
        if (!hashMatch && selectEl.selectedIndex >= 0) {
          pageNum = selectEl.selectedIndex + 1;
        }
      }
    }

    return { pageNum, totalPages };
  }

  function buildChapterUrl(pageNum) {
    const base = `${location.origin}${location.pathname}`;
    return pageNum > 1 ? `${base}#p=${pageNum}` : base;
  }

  // ============================================================
  // 3. 輕量提示氣泡（Toast）
  // ============================================================
  let toastTimer = null;
  function showToast(text, isError = false) {
    if (!CONFIG.SHOW_TOAST) return;
    let el = document.getElementById('mt-sync-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'mt-sync-toast';
      Object.assign(el.style, {
        position: 'fixed',
        right: '14px',
        bottom: '20px',
        zIndex: '2147483647',
        padding: '6px 12px',
        borderRadius: '999px',
        fontSize: '12px',
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
        color: '#fff',
        background: 'rgba(17, 24, 39, 0.85)',
        backdropFilter: 'blur(6px)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        pointerEvents: 'none',
        transition: 'opacity 0.25s ease',
        opacity: '0'
      });
      document.body.appendChild(el);
    }
    el.style.background = isError ? 'rgba(220, 38, 38, 0.9)' : 'rgba(17, 24, 39, 0.85)';
    el.textContent = text;
    el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.style.opacity = '0';
    }, 1800);
  }

  // ============================================================
  // 4. 傳送到 Supabase RPC（支援 GM_xmlhttpRequest / fetch）
  // ============================================================
  function postToSupabase(payload) {
    const url = `${CONFIG.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/upsert_manga_progress`;
    const headers = {
      'Content-Type': 'application/json',
      'apikey': CONFIG.SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${CONFIG.SUPABASE_ANON_KEY}`
    };
    const body = JSON.stringify(payload);

    return new Promise((resolve, reject) => {
      const gmRequest =
        typeof GM_xmlhttpRequest === 'function'
          ? GM_xmlhttpRequest
          : typeof GM !== 'undefined' && typeof GM.xmlHttpRequest === 'function'
            ? GM.xmlHttpRequest
            : null;

      if (gmRequest) {
        gmRequest({
          method: 'POST',
          url,
          headers,
          data: body,
          onload: (res) => {
            if (res.status >= 200 && res.status < 300) {
              resolve(res.responseText);
            } else {
              reject(new Error(`HTTP ${res.status}: ${res.responseText}`));
            }
          },
          onerror: (err) => reject(err)
        });
      } else {
        fetch(url, { method: 'POST', headers, body })
          .then((r) => (r.ok ? r.text() : r.text().then((t) => Promise.reject(new Error(`HTTP ${r.status}: ${t}`)))))
          .then(resolve)
          .catch(reject);
      }
    });
  }

  // ============================================================
  // 5. 監聽翻頁與換話並防抖同步
  // ============================================================
  let lastSyncedKey = '';
  let syncTimer = null;

  function scheduleSync(immediate = false) {
    const { pageNum, totalPages } = parsePageInfo();
    const { title, chapterTitle } = parseTitleAndChapter();
    const chapterUrl = buildChapterUrl(pageNum);
    const dedupeKey = `${chapterUrl}|${pageNum}|${totalPages || ''}`;

    if (dedupeKey === lastSyncedKey) return;

    clearTimeout(syncTimer);
    const run = () => {
      const coverUrl = (() => {
        try { return localStorage.getItem(COVER_CACHE_PREFIX + comicId); } catch (_) { return null; }
      })();

      const payload = {
        p_sync_key: CONFIG.SYNC_KEY,
        p_site: SITE,
        p_comic_id: comicId,
        p_title: title,
        p_comic_url: comicUrl,
        p_chapter_title: chapterTitle,
        p_chapter_url: chapterUrl,
        p_page_num: pageNum,
        p_total_pages: totalPages,
        p_cover_url: coverUrl
      };

      lastSyncedKey = dedupeKey;
      postToSupabase(payload)
        .then(() => {
          const label = chapterTitle ? `${chapterTitle} P.${pageNum}` : `P.${pageNum}`;
          showToast(`✓ 已同步 ${label}`);
        })
        .catch((err) => {
          lastSyncedKey = '';
          console.error('[MangaTracker] 同步失敗:', err);
          showToast('✕ 進度同步失敗', true);
        });
    };

    if (immediate) {
      run();
    } else {
      syncTimer = setTimeout(run, CONFIG.DEBOUNCE_MS);
    }
  }

  // 進頁後稍等 DOM 載入完成先同步一次
  setTimeout(() => scheduleSync(false), 1500);

  // 監聽網址 hash 變化（翻頁）
  window.addEventListener('hashchange', () => scheduleSync(false));
  window.addEventListener('popstate', () => scheduleSync(false));

  // 備用定時檢查（應對部分行動版翻頁不改 hash 的情況）
  setInterval(() => scheduleSync(false), 2500);

  // 切換分頁或離開前若有未送出的進度，立即送出
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      scheduleSync(true);
    }
  });
})();

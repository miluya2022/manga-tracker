// ==UserScript==
// @name         追漫進度自動同步 (Supabase)
// @namespace    manga-tracker-supabase
// @version      1.1.0
// @description  看漫畫人 (manhuaren) 或漫畫櫃 (manhuagui) 時自動記錄看到哪一話、哪一頁，背景同步到 Supabase，供 PWA 書架續看
// @match        https://www.manhuaren.com/*
// @match        https://m.manhuaren.com/*
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

  const host = location.hostname.toLowerCase();
  const path = location.pathname;

  const cacheGet = (k) => {
    try { return localStorage.getItem(k); } catch (_) { return null; }
  };
  const cacheSet = (k, v) => {
    if (!v) return;
    try { localStorage.setItem(k, v); } catch (_) {}
  };
  const normalizeImgUrl = (url) => {
    if (!url) return null;
    if (url.startsWith('//')) return 'https:' + url;
    return url;
  };

  // ============================================================
  // 站點適配器：漫畫人 (manhuaren.com)
  // ============================================================
  function createManhuarenAdapter() {
    const SITE = 'manhuaren';
    const infoMatch = path.match(/^\/manhua-([^/]+)\/?$/);
    const chapterMatch = path.match(/^\/m(\d+)(?:-p(\d+))?\/?$/);

    // 1) 漫畫目錄頁：快取封面與書名
    if (infoMatch) {
      const comicId = infoMatch[1];
      const cacheMeta = () => {
        const coverEl =
          document.querySelector('.detail-main-cover img') ||
          document.querySelector('.cover img') ||
          document.querySelector('.banner_detail_form .cover img') ||
          document.querySelector('meta[property="og:image"]');
        const coverUrl = normalizeImgUrl(
          coverEl?.getAttribute('src') ||
          coverEl?.getAttribute('data-src') ||
          coverEl?.getAttribute('content')
        );
        cacheSet(`mt_cover_${SITE}_${comicId}`, coverUrl);

        const titleEl =
          document.querySelector('.detail-main-info-title') ||
          document.querySelector('.normal-top-title') ||
          document.querySelector('h1');
        const title = titleEl?.textContent?.trim();
        cacheSet(`mt_title_${SITE}_${comicId}`, title);
      };
      cacheMeta();
      setTimeout(cacheMeta, 1000);
      return null;
    }

    if (!chapterMatch) return null;

    const chapterId = chapterMatch[1];

    function findComicSlug() {
      // 從頁面內連回漫畫目錄的連結抓取 /manhua-xxx/
      const links = document.querySelectorAll('a[href*="/manhua-"]');
      for (const a of links) {
        const m = (a.getAttribute('href') || '').match(/\/manhua-([^/]+)\/?/);
        if (m) return { slug: m[1], linkText: a.textContent?.trim() || '' };
      }
      // 從 referrer 備用抓取
      const refMatch = (document.referrer || '').match(/\/manhua-([^/]+)\/?/);
      if (refMatch) return { slug: refMatch[1], linkText: '' };

      return { slug: `m${chapterId}`, linkText: '' };
    }

    return {
      site: SITE,
      supportsScrollPaging: true,
      getData() {
        const { slug: comicId, linkText } = findComicSlug();
        const comicUrl = comicId.startsWith('m') && comicId === `m${chapterId}`
          ? `${location.origin}${location.pathname}`
          : `${location.origin}/manhua-${comicId}/`;

        const cachedTitle = cacheGet(`mt_title_${SITE}_${comicId}`);
        const coverUrl = cacheGet(`mt_cover_${SITE}_${comicId}`);

        // 解析書名與章節名
        const cleanDocTitle = (document.title || '')
          .replace(/[-_|–—]\s*(漫画人|漫畫人|在线漫画|免費漫畫|手机漫画).*$/i, '')
          .replace(/在线阅读.*$/i, '')
          .trim();

        let title = cachedTitle || (linkText && linkText.length < 40 ? linkText : '');
        let chapterTitle =
          document.querySelector('.view-header-2, .chapter-title, .top-title, header h1, .title h1')?.textContent?.trim() || '';

        if (!title || !chapterTitle) {
          // 常見標題格式：「有鬼拍不到 第1话」或「有鬼拍不到_第1话」
          const parts = cleanDocTitle.split(/[\s_]+/).filter(Boolean);
          if (parts.length >= 2) {
            if (!chapterTitle) chapterTitle = parts[parts.length - 1];
            if (!title) title = parts.slice(0, -1).join(' ');
          } else if (!title) {
            title = cleanDocTitle || `漫畫 ${comicId}`;
          }
        }

        // 若 chapterTitle 包含整個 title，把前面的 title 去掉讓標籤更乾淨
        if (title && chapterTitle && chapterTitle.startsWith(title) && chapterTitle.length > title.length) {
          chapterTitle = chapterTitle.slice(title.length).trim();
        }

        // 解析頁碼與總頁數
        let pageNum = 1;
        let totalPages = null;

        const pathPageMatch = location.pathname.match(/-p(\d+)\/?$/);
        const hashPageMatch = location.hash.match(/(?:ipg|p=)(\d+)/i);
        if (pathPageMatch) {
          pageNum = parseInt(pathPageMatch[1], 10) || 1;
        } else if (hashPageMatch) {
          pageNum = parseInt(hashPageMatch[1], 10) || 1;
        }

        // 檢查頁面上的頁碼文字 (如 3/24)
        const pageSelectors = [
          '.view-paging',
          '#chapterpager',
          '.page-num',
          '.view-main-2',
          '.top-page',
          '.bottom-page',
          '#cp_funtion_page'
        ];
        for (const sel of pageSelectors) {
          const el = document.querySelector(sel);
          if (!el) continue;
          const m = (el.textContent || '').match(/(\d+)\s*\/\s*(\d+)/);
          if (m) {
            if (!pathPageMatch && !hashPageMatch) pageNum = parseInt(m[1], 10) || pageNum;
            totalPages = parseInt(m[2], 10) || totalPages;
            break;
          }
        }

        // 條漫／直向捲動模式：依目前視窗內看到的漫畫圖片計算頁碼
        const imgs = Array.from(
          document.querySelectorAll('#cp_img img, .view-main-1 img, .comicpage img, .chapter-view img')
        ).filter((img) => img.naturalHeight > 150 || img.clientHeight > 150);

        if (imgs.length > 1) {
          if (!totalPages) totalPages = imgs.length;
          if (!pathPageMatch && !hashPageMatch) {
            const pivot = window.innerHeight * 0.35;
            let currentIdx = 0;
            for (let i = 0; i < imgs.length; i++) {
              const rect = imgs[i].getBoundingClientRect();
              if (rect.top <= pivot) currentIdx = i;
              else break;
            }
            pageNum = currentIdx + 1;
          }
        }

        // 組合可續看的章節網址
        let chapterUrl = `${location.origin}${location.pathname}`;
        if (pathPageMatch) {
          chapterUrl = `${location.origin}${location.pathname}`;
        } else if (pageNum > 1) {
          chapterUrl = `${location.origin}${location.pathname}#ipg${pageNum}`;
        }

        return {
          comicId,
          title: title || `漫畫 ${comicId}`,
          comicUrl,
          chapterTitle,
          chapterUrl,
          pageNum,
          totalPages,
          coverUrl
        };
      }
    };
  }

  // ============================================================
  // 站點適配器：漫畫櫃 (manhuagui.com)
  // ============================================================
  function createManhuaguiAdapter() {
    const SITE = 'manhuagui';
    const infoMatch = path.match(/^\/comic\/(\d+)\/?$/);
    const chapterMatch = path.match(/^\/comic\/(\d+)\/(\d+)\.html/);

    if (infoMatch) {
      const comicId = infoMatch[1];
      const cacheMeta = () => {
        const coverEl =
          document.querySelector('.thumb img') ||
          document.querySelector('.book-cover img') ||
          document.querySelector('.cover img') ||
          document.querySelector('meta[property="og:image"]');
        const coverUrl = normalizeImgUrl(
          coverEl?.getAttribute('src') ||
          coverEl?.getAttribute('data-src') ||
          coverEl?.getAttribute('content')
        );
        cacheSet(`mt_cover_${SITE}_${comicId}`, coverUrl);

        const titleEl =
          document.querySelector('.main-bar h1') ||
          document.querySelector('.book-title h1') ||
          document.querySelector('h1');
        cacheSet(`mt_title_${SITE}_${comicId}`, titleEl?.textContent?.trim());
      };
      cacheMeta();
      setTimeout(cacheMeta, 1000);
      return null;
    }

    if (!chapterMatch) return null;

    const comicId = chapterMatch[1];
    const comicUrl = `${location.origin}/comic/${comicId}/`;

    return {
      site: SITE,
      supportsScrollPaging: false,
      getData() {
        const cachedTitle = cacheGet(`mt_title_${SITE}_${comicId}`);
        const coverUrl = cacheGet(`mt_cover_${SITE}_${comicId}`);

        const h1Text = document.querySelector('header h1, .header h1, .w980 h1, .title h1')?.textContent?.trim();
        const h2Text = document.querySelector('header h2, .header h2, .w980 h2, .title h2')?.textContent?.trim();

        let title = cachedTitle || h1Text || '';
        let chapterTitle = h2Text || '';

        const rawDocTitle = (document.title || '')
          .replace(/\s*[-_|–—]\s*(看漫畫|漫畫櫃|手機漫畫|看漫画|漫画柜|手机漫画|manhuagui).*$/i, '')
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

        let pageNum = 1;
        let totalPages = null;
        const hashMatch = location.hash.match(/p=(\d+)/i);
        if (hashMatch) pageNum = parseInt(hashMatch[1], 10) || 1;

        for (const sel of ['.manga-page', '#manga-page', '#page', '.page-num', '.pager-info', '.sub-btn']) {
          const el = document.querySelector(sel);
          if (!el) continue;
          const m = (el.textContent || '').match(/(\d+)\s*\/\s*(\d+)/);
          if (m) {
            if (!hashMatch) pageNum = parseInt(m[1], 10) || pageNum;
            totalPages = parseInt(m[2], 10) || totalPages;
            break;
          }
        }

        if (!totalPages) {
          const selectEl = document.querySelector('#pageSelect, select.page-select');
          if (selectEl?.options?.length) {
            totalPages = selectEl.options.length;
            if (!hashMatch && selectEl.selectedIndex >= 0) pageNum = selectEl.selectedIndex + 1;
          }
        }

        const base = `${location.origin}${location.pathname}`;
        const chapterUrl = pageNum > 1 ? `${base}#p=${pageNum}` : base;

        return {
          comicId,
          title: title || `漫畫 #${comicId}`,
          comicUrl,
          chapterTitle,
          chapterUrl,
          pageNum,
          totalPages,
          coverUrl
        };
      }
    };
  }

  // 選擇對應站點適配器
  const adapter = host.includes('manhuaren.com')
    ? createManhuarenAdapter()
    : host.includes('manhuagui.com')
      ? createManhuaguiAdapter()
      : null;

  if (!adapter) return;

  // ============================================================
  // 輕量提示氣泡（Toast）
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
  // 傳送到 Supabase RPC（支援 GM_xmlhttpRequest / fetch）
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
  // 監聽翻頁、換話、捲動並防抖同步
  // ============================================================
  let lastSyncedKey = '';
  let syncTimer = null;

  function scheduleSync(immediate = false) {
    const data = adapter.getData();
    if (!data) return;

    const dedupeKey = `${data.comicId}|${data.chapterUrl}|${data.pageNum}|${data.totalPages || ''}`;
    if (dedupeKey === lastSyncedKey) return;

    clearTimeout(syncTimer);
    const run = () => {
      const payload = {
        p_sync_key: CONFIG.SYNC_KEY,
        p_site: adapter.site,
        p_comic_id: data.comicId,
        p_title: data.title,
        p_comic_url: data.comicUrl,
        p_chapter_title: data.chapterTitle,
        p_chapter_url: data.chapterUrl,
        p_page_num: data.pageNum,
        p_total_pages: data.totalPages,
        p_cover_url: data.coverUrl
      };

      lastSyncedKey = dedupeKey;
      postToSupabase(payload)
        .then(() => {
          const label = data.chapterTitle ? `${data.chapterTitle} P.${data.pageNum}` : `P.${data.pageNum}`;
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

  setTimeout(() => scheduleSync(false), 1500);
  window.addEventListener('hashchange', () => scheduleSync(false));
  window.addEventListener('popstate', () => scheduleSync(false));
  if (adapter.supportsScrollPaging) {
    window.addEventListener('scroll', () => scheduleSync(false), { passive: true });
  }
  setInterval(() => scheduleSync(false), 2500);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      scheduleSync(true);
    }
  });
})();

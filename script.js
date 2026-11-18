'use strict';

(function () {
  const cfg = window.CREATIVE_ART_CONFIG;
  if (!cfg) {
    console.error('config.js failed to load.');
    return;
  }

  const byId = (id) => document.getElementById(id);
  const styleLabel = (id) => (cfg.styles.find((s) => s.id === id) || {}).label || id;

  const el = {
    nav: byId('siteNav'), navToggle: byId('navToggle'),
    heroForm: byId('heroForm'), heroPrompt: byId('heroPrompt'), heroSubmit: byId('heroSubmit'), heroChips: byId('heroChips'),
    form: byId('genForm'), prompt: byId('prompt'), counter: byId('counter'), promptError: byId('promptError'),
    clearPrompt: byId('clearPrompt'), styleOptions: byId('styleOptions'), ratioOptions: byId('ratioOptions'),
    randomBtn: byId('randomBtn'), resetBtn: byId('resetBtn'), generateBtn: byId('generateBtn'),
    stage: byId('stage'), frame: byId('frame'), status: byId('status'), loadingText: byId('loadingText'),
    errorTitle: byId('errorTitle'), errorMessage: byId('errorMessage'), retryBtn: byId('retryBtn'),
    resultImg: byId('resultImg'), resultBar: byId('resultBar'), resultPrompt: byId('resultPrompt'), resultMeta: byId('resultMeta'),
    downloadBtn: byId('downloadBtn'), saveBtn: byId('saveBtn'), againBtn: byId('againBtn'),
    exploreFilters: byId('exploreFilters'), exploreList: byId('exploreList'),
    galleryGrid: byId('galleryGrid'), galleryEmpty: byId('galleryEmpty'), galleryCount: byId('galleryCount'), galleryNotice: byId('galleryNotice'),
    viewer: byId('viewer'), viewerImg: byId('viewerImg'), viewerPrompt: byId('viewerPrompt'), viewerMeta: byId('viewerMeta'),
    viewerDownload: byId('viewerDownload'), viewerDelete: byId('viewerDelete'), viewerClose: byId('viewerClose'),
    toast: byId('toast')
  };

  const state = {
    busy: false,
    result: null,        // { blob, url, prompt, style, ratio, saved }
    items: new Map(),    // gallery records by id
    galleryUrls: [],
    viewerId: null,
    viewerUrl: null,
    loadingTimer: null,
    exploreFilter: 'all'
  };

  /* ---------- Utilities ---------- */

  class ApiError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  let toastTimer = null;
  function toast(message, isError) {
    el.toast.textContent = message;
    el.toast.classList.toggle('is-error', Boolean(isError));
    el.toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('is-visible'), 3800);
  }

  function slugify(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'artwork';
  }

  function extensionFor(mime) {
    if (mime === 'image/png') return 'png';
    if (mime === 'image/webp') return 'webp';
    return 'jpg';
  }

  function downloadBlob(blob, prompt) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'creative-art-' + slugify(prompt) + '-' + Date.now() + '.' + extensionFor(blob.type);
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function base64ToBlob(b64, mime) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  function newId() {
    if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return Date.now() + '-' + Math.random().toString(36).slice(2);
  }

  /* ---------- Navigation ---------- */

  function closeNav() {
    el.nav.classList.remove('is-open');
    el.navToggle.setAttribute('aria-expanded', 'false');
  }

  el.navToggle.addEventListener('click', () => {
    const open = el.nav.classList.toggle('is-open');
    el.navToggle.setAttribute('aria-expanded', String(open));
  });
  el.nav.addEventListener('click', (e) => {
    if (e.target.closest('a')) closeNav();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeNav();
  });

  /* ---------- Form controls ---------- */

  function renderChoices(container, name, items, checkedId, withShape) {
    container.replaceChildren(
      ...items.map((item) => {
        const label = document.createElement('label');
        label.className = 'choice';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = name;
        input.value = item.id;
        input.checked = item.id === checkedId;
        const span = document.createElement('span');
        if (withShape) {
          const shape = document.createElement('i');
          shape.className = 'shape';
          shape.dataset.ratio = item.id;
          shape.setAttribute('aria-hidden', 'true');
          span.append(shape);
        }
        span.append(document.createTextNode(item.detail ? item.label + ' (' + item.detail + ')' : item.label));
        label.append(input, span);
        return label;
      })
    );
  }

  function getSelection() {
    return { style: el.form.elements.artStyle.value, ratio: el.form.elements.aspect.value };
  }

  function setSelection(style, ratio) {
    if (style) el.form.elements.artStyle.value = style;
    if (ratio) el.form.elements.aspect.value = ratio;
    syncFrameRatio();
  }

  function updateCounter() {
    const len = el.prompt.value.length;
    el.counter.textContent = len + ' / ' + cfg.maxPromptLength;
    el.counter.classList.toggle('is-near', len > cfg.maxPromptLength * 0.9);
  }

  function showFieldError(message) {
    el.promptError.textContent = message;
    el.promptError.hidden = false;
    el.prompt.setAttribute('aria-invalid', 'true');
  }

  function clearFieldError() {
    el.promptError.hidden = true;
    el.promptError.textContent = '';
    el.prompt.removeAttribute('aria-invalid');
  }

  function setPrompt(value) {
    el.prompt.value = value;
    updateCounter();
    clearFieldError();
  }

  function validatePrompt(prompt) {
    if (!prompt) return 'Describe the artwork you want to create.';
    if (prompt.length > cfg.maxPromptLength) return 'Keep the prompt under ' + cfg.maxPromptLength + ' characters.';
    return '';
  }

  function syncFrameRatio() {
    el.frame.dataset.ratio = state.result ? state.result.ratio : getSelection().ratio;
  }

  el.prompt.addEventListener('input', () => {
    updateCounter();
    if (!el.promptError.hidden) clearFieldError();
  });
  el.prompt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      generate();
    }
  });
  el.clearPrompt.addEventListener('click', () => {
    setPrompt('');
    el.prompt.focus();
  });
  el.ratioOptions.addEventListener('change', syncFrameRatio);

  el.randomBtn.addEventListener('click', () => {
    const idea = cfg.ideas[Math.floor(Math.random() * cfg.ideas.length)];
    setPrompt(idea.prompt);
    setSelection(idea.style);
    el.prompt.focus();
  });

  el.resetBtn.addEventListener('click', () => {
    if (state.busy) {
      toast('Wait for the current artwork to finish first.');
      return;
    }
    setPrompt('');
    setSelection(cfg.defaultStyle, cfg.defaultRatio);
    clearResult();
    showState('empty');
    el.status.textContent = 'Controls reset.';
  });

  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    generate();
  });

  /* ---------- Frame states ---------- */

  function showState(name) {
    el.frame.dataset.state = name;
    el.resultBar.hidden = name !== 'result';
  }

  function clearResult() {
    if (state.result) URL.revokeObjectURL(state.result.url);
    state.result = null;
    el.resultImg.removeAttribute('src');
    el.resultImg.alt = '';
    syncFrameRatio();
  }

  function setBusy(busy) {
    state.busy = busy;
    el.generateBtn.disabled = busy;
    el.generateBtn.textContent = busy ? 'Creating…' : 'Generate';
    el.heroSubmit.disabled = busy;
    el.againBtn.disabled = busy;
    el.retryBtn.disabled = busy;
    el.frame.setAttribute('aria-busy', String(busy));
  }

  function startLoading() {
    const started = Date.now();
    const tick = () => {
      const seconds = Math.floor((Date.now() - started) / 1000);
      el.loadingText.textContent = seconds < 12
        ? 'Sending your prompt and waiting for the model… ' + seconds + 's'
        : 'Still working. This is taking longer than usual… ' + seconds + 's';
    };
    tick();
    clearInterval(state.loadingTimer);
    state.loadingTimer = setInterval(tick, 1000);
    el.status.textContent = 'Creating your artwork. This usually takes a few seconds.';
    showState('loading');
  }

  function stopLoading() {
    clearInterval(state.loadingTimer);
    state.loadingTimer = null;
  }

  const ERROR_TITLES = {
    invalid_request: 'Check your prompt',
    network: 'Cannot reach the server',
    timeout: 'The request timed out',
    upstream_auth: 'Image service unavailable',
    server_misconfigured: 'Image service unavailable',
    rate_limited: 'Too many requests',
    upstream_rate_limited: 'Too many requests',
    quota_exhausted: 'Daily limit reached',
    content_rejected: 'Prompt not accepted',
    invalid_image: 'Unusable image received'
  };
  const NO_RETRY = new Set(['invalid_request', 'quota_exhausted', 'content_rejected', 'upstream_auth', 'server_misconfigured']);

  function showError(err) {
    const code = err instanceof ApiError ? err.code : 'unknown';
    const message = err instanceof ApiError ? err.message : 'An unexpected error occurred. Please try again.';
    el.errorTitle.textContent = ERROR_TITLES[code] || 'Something went wrong';
    el.errorMessage.textContent = message;
    el.retryBtn.hidden = NO_RETRY.has(code);
    el.status.textContent = 'Error: ' + message;
    showState('error');
  }

  /* ---------- Generation ---------- */

  async function requestImage(payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.requestTimeoutMs);
    let response;
    let data = null;
    try {
      response = await fetch(cfg.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      try {
        data = await response.json();
      } catch (_) {
        data = null;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw new ApiError('timeout', 'The image took too long to create. Try again, or simplify the prompt.');
      }
      throw new ApiError('network', 'Check your internet connection and try again.');
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok || !data || data.ok !== true) {
      const e = data && data.error ? data.error : {};
      throw new ApiError(e.code || 'server_error', e.message || 'The server returned an unexpected response (status ' + response.status + ').');
    }
    if (typeof data.image !== 'string' || !data.image || !/^image\/(jpeg|png|webp)$/.test(data.mime || '')) {
      throw new ApiError('invalid_image', 'The server did not return a valid image. Please try again.');
    }
    return data;
  }

  // FLUX.1 schnell on Cloudflare takes no width/height. We centre-crop the
  // fixed-size output to the chosen shape. Square output is left untouched.
  function cropToRatio(blob, ratio) {
    const parts = ratio.split(':').map(Number);
    const target = parts[0] / parts[1];
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const sw = img.naturalWidth;
        const sh = img.naturalHeight;
        if (!sw || !sh) {
          reject(new ApiError('invalid_image', 'The image data could not be read.'));
          return;
        }
        const current = sw / sh;
        if (Math.abs(current - target) < 0.01) {
          resolve(blob);
          return;
        }
        let cw = sw;
        let ch = sh;
        if (current > target) cw = Math.round(sh * target);
        else ch = Math.round(sw / target);
        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        canvas.getContext('2d').drawImage(img, Math.round((sw - cw) / 2), Math.round((sh - ch) / 2), cw, ch, 0, 0, cw, ch);
        canvas.toBlob((out) => {
          if (out) resolve(out);
          else reject(new ApiError('invalid_image', 'The image could not be cropped.'));
        }, 'image/jpeg', 0.92);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new ApiError('invalid_image', 'The image data could not be read. Please try again.'));
      };
      img.src = url;
    });
  }

  function setResult(result) {
    clearResult();
    state.result = Object.assign({}, result, { url: URL.createObjectURL(result.blob), saved: false });
    el.resultImg.src = state.result.url;
    el.resultImg.alt = 'AI artwork: ' + result.prompt.slice(0, 200);
    el.resultPrompt.textContent = result.prompt;
    el.resultMeta.textContent = 'Style: ' + styleLabel(result.style) + '. Shape: ' + result.ratio + '.';
    el.saveBtn.disabled = false;
    el.saveBtn.textContent = 'Save to gallery';
    el.saveBtn.classList.remove('is-saved');
    syncFrameRatio();
    showState('result');
    el.status.textContent = 'Your artwork is ready.';
  }

  async function generate() {
    if (state.busy) return;
    const prompt = el.prompt.value.trim();
    const problem = validatePrompt(prompt);
    if (problem) {
      showFieldError(problem);
      el.prompt.focus();
      return;
    }
    clearFieldError();
    const selection = getSelection();

    setBusy(true);
    clearResult();
    startLoading();
    el.stage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    try {
      const data = await requestImage({ prompt: prompt, style: selection.style, aspect: selection.ratio });
      const raw = base64ToBlob(data.image, data.mime);
      const blob = await cropToRatio(raw, selection.ratio);
      stopLoading();
      setResult({ blob: blob, prompt: prompt, style: selection.style, ratio: selection.ratio });
    } catch (err) {
      stopLoading();
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  el.retryBtn.addEventListener('click', generate);
  el.againBtn.addEventListener('click', generate);

  el.downloadBtn.addEventListener('click', () => {
    if (state.result) downloadBlob(state.result.blob, state.result.prompt);
  });

  el.saveBtn.addEventListener('click', async () => {
    const r = state.result;
    if (!r || r.saved) return;
    el.saveBtn.disabled = true;
    try {
      await saveArtwork({
        id: newId(),
        createdAt: Date.now(),
        prompt: r.prompt,
        style: r.style,
        ratio: r.ratio,
        blob: r.blob
      });
      r.saved = true;
      el.saveBtn.textContent = 'Saved to gallery';
      el.saveBtn.classList.add('is-saved');
      toast('Saved to My Gallery.');
      renderGallery();
    } catch (_) {
      el.saveBtn.disabled = false;
      toast('Could not save. Browser storage is unavailable or full.', true);
    }
  });

  /* ---------- Hero ---------- */

  cfg.examplePrompts.forEach((text) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = text;
    b.addEventListener('click', () => {
      el.heroPrompt.value = text;
      el.heroPrompt.focus();
    });
    el.heroChips.append(b);
  });

  el.heroForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (state.busy) {
      toast('An artwork is already being created.');
      return;
    }
    const value = el.heroPrompt.value.trim();
    if (!value) {
      toast('Describe what you want to see first.');
      el.heroPrompt.focus();
      return;
    }
    setPrompt(value.slice(0, cfg.maxPromptLength));
    byId('create').scrollIntoView({ behavior: 'smooth' });
    generate();
  });

  /* ---------- Explore ---------- */

  function renderExplore() {
    const filters = [{ id: 'all', label: 'All styles' }].concat(cfg.styles);
    el.exploreFilters.replaceChildren(
      ...filters.map((f) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip';
        b.textContent = f.label;
        b.setAttribute('aria-pressed', String(state.exploreFilter === f.id));
        b.addEventListener('click', () => {
          state.exploreFilter = f.id;
          renderExplore();
        });
        return b;
      })
    );

    const ideas = cfg.ideas.filter((i) => state.exploreFilter === 'all' || i.style === state.exploreFilter);
    el.exploreList.replaceChildren(
      ...ideas.map((idea) => {
        const li = document.createElement('li');
        li.className = 'idea';
        li.dataset.style = idea.style;
        const text = document.createElement('div');
        text.className = 'idea-text';
        const p = document.createElement('p');
        p.textContent = idea.prompt;
        const s = document.createElement('span');
        s.className = 'idea-style';
        s.textContent = styleLabel(idea.style);
        text.append(p, s);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-secondary';
        b.textContent = 'Use prompt';
        b.addEventListener('click', () => {
          setPrompt(idea.prompt);
          setSelection(idea.style);
          byId('create').scrollIntoView({ behavior: 'smooth' });
          el.prompt.focus({ preventScroll: true });
        });
        li.append(text, b);
        return li;
      })
    );
  }

  /* ---------- IndexedDB gallery ---------- */

  const DB_NAME = 'creative-art';
  const STORE = 'artworks';
  let dbPromise = null;

  function openDb() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB is unavailable'));
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('IndexedDB is blocked'));
      });
      dbPromise.catch(() => { dbPromise = null; });
    }
    return dbPromise;
  }

  async function withStore(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let request;
      try {
        request = fn(tx.objectStore(STORE));
      } catch (err) {
        reject(err);
        return;
      }
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
  }

  const saveArtwork = (record) => withStore('readwrite', (s) => s.put(record));
  const listArtworks = () => withStore('readonly', (s) => s.getAll());
  const deleteArtwork = (id) => withStore('readwrite', (s) => s.delete(id));

  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

  function buildTile(item) {
    const url = URL.createObjectURL(item.blob);
    state.galleryUrls.push(url);

    const li = document.createElement('li');
    li.className = 'tile';

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'tile-open';
    open.dataset.action = 'open';
    open.dataset.id = item.id;
    open.setAttribute('aria-label', 'Open preview: ' + item.prompt.slice(0, 80));
    const img = document.createElement('img');
    img.src = url;
    img.alt = 'AI artwork: ' + item.prompt.slice(0, 200);
    img.loading = 'lazy';
    img.decoding = 'async';
    img.style.aspectRatio = item.ratio.replace(':', ' / ');
    open.append(img);

    const prompt = document.createElement('p');
    prompt.className = 'tile-prompt';
    prompt.textContent = item.prompt;
    const meta = document.createElement('p');
    meta.className = 'tile-meta';
    meta.textContent = styleLabel(item.style) + ', ' + dateFormat.format(item.createdAt);

    const actions = document.createElement('div');
    actions.className = 'tile-actions';
    ['download', 'delete'].forEach((action) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-ghost';
      b.dataset.action = action;
      b.dataset.id = item.id;
      b.textContent = action === 'download' ? 'Download' : 'Delete';
      actions.append(b);
    });

    li.append(open, prompt, meta, actions);
    return li;
  }

  async function renderGallery() {
    let items = [];
    try {
      items = await listArtworks();
      el.galleryNotice.hidden = true;
    } catch (_) {
      el.galleryNotice.hidden = false;
    }
    items.sort((a, b) => b.createdAt - a.createdAt);
    state.items = new Map(items.map((i) => [i.id, i]));
    state.galleryUrls.forEach((u) => URL.revokeObjectURL(u));
    state.galleryUrls = [];

    el.galleryGrid.replaceChildren(...items.map(buildTile));
    el.galleryEmpty.hidden = items.length > 0;
    el.galleryCount.textContent = items.length === 0
      ? 'No saved artwork yet.'
      : items.length + (items.length === 1 ? ' saved artwork, stored in this browser.' : ' saved artworks, stored in this browser.');
  }

  async function removeArtwork(id) {
    if (!window.confirm('Delete this artwork from your gallery? This cannot be undone.')) return;
    try {
      await deleteArtwork(id);
      if (state.viewerId === id && el.viewer.open) el.viewer.close();
      await renderGallery();
      toast('Artwork deleted.');
    } catch (_) {
      toast('Could not delete the artwork.', true);
    }
  }

  function openViewer(id) {
    const item = state.items.get(id);
    if (!item) return;
    if (state.viewerUrl) URL.revokeObjectURL(state.viewerUrl);
    state.viewerId = id;
    state.viewerUrl = URL.createObjectURL(item.blob);
    el.viewerImg.src = state.viewerUrl;
    el.viewerImg.alt = 'AI artwork: ' + item.prompt.slice(0, 200);
    el.viewerPrompt.textContent = item.prompt;
    el.viewerMeta.textContent = 'Style: ' + styleLabel(item.style) + '. Shape: ' + item.ratio + '. Saved ' + dateFormat.format(item.createdAt) + '.';
    el.viewer.showModal();
  }

  el.galleryGrid.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const id = target.dataset.id;
    const item = state.items.get(id);
    if (!item) return;
    if (target.dataset.action === 'open') openViewer(id);
    else if (target.dataset.action === 'download') downloadBlob(item.blob, item.prompt);
    else if (target.dataset.action === 'delete') removeArtwork(id);
  });

  el.viewerDownload.addEventListener('click', () => {
    const item = state.items.get(state.viewerId);
    if (item) downloadBlob(item.blob, item.prompt);
  });
  el.viewerDelete.addEventListener('click', () => {
    if (state.viewerId) removeArtwork(state.viewerId);
  });
  el.viewerClose.addEventListener('click', () => el.viewer.close());
  el.viewer.addEventListener('click', (e) => {
    if (e.target === el.viewer) el.viewer.close();
  });
  el.viewer.addEventListener('close', () => {
    if (state.viewerUrl) URL.revokeObjectURL(state.viewerUrl);
    state.viewerUrl = null;
    state.viewerId = null;
    el.viewerImg.removeAttribute('src');
  });

  /* ---------- Init ---------- */

  renderChoices(el.styleOptions, 'artStyle', cfg.styles, cfg.defaultStyle, false);
  renderChoices(el.ratioOptions, 'aspect', cfg.ratios, cfg.defaultRatio, true);
  updateCounter();
  syncFrameRatio();
  showState('empty');
  renderExplore();
  renderGallery();

  const fontSheet = byId('fontSheet');
  if (fontSheet) fontSheet.media = 'all';
})();

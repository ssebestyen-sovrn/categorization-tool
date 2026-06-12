// ── DOM refs ─────────────────────────────────────────────────────
const btnSingle   = document.getElementById('btn-single');
const btnBulk     = document.getElementById('btn-bulk');
const singleForm  = document.getElementById('categorize-form');
const bulkForm    = document.getElementById('bulk-form');

const urlInput    = document.getElementById('url-input');
const submitBtn   = document.getElementById('submit-btn');
const btnLabel    = submitBtn.querySelector('.btn-label');
const btnSpinner  = document.getElementById('btn-spinner');
const errorMsg    = document.getElementById('error-msg');

const bulkInput       = document.getElementById('bulk-input');
const bulkSubmitBtn   = document.getElementById('bulk-submit-btn');
const bulkBtnLabel    = document.getElementById('bulk-btn-label');
const bulkBtnSpinner  = document.getElementById('bulk-btn-spinner');
const bulkCounter     = document.getElementById('bulk-counter');
const bulkErrorMsg    = document.getElementById('bulk-error-msg');

const resultsSection      = document.getElementById('results-section');
const resultsCard         = document.getElementById('results-card');
const bulkProgressSection = document.getElementById('bulk-progress-section');
const bulkProgressLabel   = document.getElementById('bulk-progress-label');
const bulkProgressFrac    = document.getElementById('bulk-progress-frac');
const bulkProgressFill    = document.getElementById('bulk-progress-fill');
const bulkResultsSection  = document.getElementById('bulk-results-section');
const bulkResultsSummary  = document.getElementById('bulk-results-summary');
const bulkResultsList     = document.getElementById('bulk-results-list');

const historySection = document.getElementById('history-section');
const historyToggle  = document.getElementById('history-toggle');
const historyBody    = document.getElementById('history-body');
const historyEmpty   = document.getElementById('history-empty');
const historyWrap    = document.getElementById('history-table-wrap');
const historyTbody   = document.getElementById('history-tbody');


const historySearchInput  = document.getElementById('history-search-input');
const historySearchClear  = document.getElementById('history-search-clear');
const historySearchStatus = document.getElementById('history-search-status');

let currentMode        = 'single';
let historyOpen        = false;
let sortCol            = 'confidence';
let sortDir            = 'desc';
let historyItems       = [];
let historyTypeFilter  = 'all';
let historyConfFilter  = 0;
let historySearchQuery = '';
let searchDebounce     = null;

// ── Helpers ──────────────────────────────────────────────────────

function confClass(c) {
  if (c >= 0.75) return 'conf-green';
  if (c >= 0.50) return 'conf-amber';
  return 'conf-red';
}
function pct(c) { return Math.round(c * 100) + '%'; }
function truncate(s, max = 60) { return s.length > max ? s.slice(0, max) + '…' : s; }
function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function parseUrls(text) {
  return text.split(/[\n,]+/)
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .slice(0, 100);
}

// ── Mode toggle ───────────────────────────────────────────────────

btnSingle.addEventListener('click', () => setMode('single'));
btnBulk.addEventListener('click',   () => setMode('bulk'));

function setMode(mode) {
  currentMode = mode;
  btnSingle.classList.toggle('active', mode === 'single');
  btnBulk.classList.toggle('active',   mode === 'bulk');
  singleForm.classList.toggle('hidden', mode !== 'single');
  bulkForm.classList.toggle('hidden',   mode !== 'bulk');
  resultsSection.classList.add('hidden');
  bulkResultsSection.classList.add('hidden');
  bulkProgressSection.classList.add('hidden');
  clearError();
  clearBulkError();
}

// ── Bulk textarea counter ─────────────────────────────────────────

bulkInput.addEventListener('input', () => {
  const urls = parseUrls(bulkInput.value);
  const count = urls.length;
  bulkCounter.textContent = `${count} / 100 URLs`;
  bulkCounter.classList.toggle('at-limit', count >= 100);
  bulkSubmitBtn.disabled = count === 0;
  bulkBtnLabel.textContent = count > 0 ? `Analyze ${count} URL${count > 1 ? 's' : ''}` : 'Analyze All';
});

// ── Shared result card renderer ───────────────────────────────────

function buildResultCardHTML(data) {
  const { url, domain, title, page_type = 'content',
          categories = [], sentiment = {},
          keywords = [], entities = [], locations = [],
          google_category, brand, merchant,
          flagged, cached, created_at } = data;

  const isProduct = page_type === 'product';

  function tagsHtml(items, cls) {
    if (!items || !items.length) return '<span class="tags-empty">None identified</span>';
    return items.map(t => `<span class="tag ${cls}">${escHtml(t)}</span>`).join('');
  }

  const cachedBadge = cached
    ? '<span class="badge badge-cached">⚡ Cached</span>'
    : '<span class="badge badge-fresh">✦ Fresh</span>';
  const flaggedBadge = flagged ? '<span class="badge badge-flagged">⚠ Flagged</span>' : '';
  const typeBadge = isProduct
    ? '<span class="badge badge-product">🛒 Product</span>'
    : '<span class="badge badge-content">📄 Content</span>';

  let bodyHtml = '';

  if (isProduct) {
    const conf = typeof data.confidence === 'number' ? data.confidence : 0;
    const cls  = confClass(conf);
    const categoryHtml = google_category
      ? `<div class="google-category-path">${escHtml(google_category)}</div>
         <div class="confidence-row" style="margin-top:6px">
           <div class="confidence-bar-track">
             <div class="confidence-bar-fill ${cls}" style="width:${pct(conf)}"></div>
           </div>
           <span class="confidence-pct ${cls}">${pct(conf)}</span>
           ${flagged ? '<span class="flag-pill">⚠ Low confidence</span>' : ''}
         </div>`
      : '<span class="tags-empty">No category returned</span>';

    bodyHtml = `
      <div>
        <div class="result-block-title">Google Product Category</div>
        ${categoryHtml}
      </div>
      <div class="product-meta-row">
        <div>
          <div class="result-block-title">Brand</div>
          <span class="product-meta-val">${escHtml(brand || '—')}</span>
        </div>
        <div>
          <div class="result-block-title">Merchant</div>
          <span class="product-meta-val">${escHtml(merchant || domain)}</span>
        </div>
      </div>
      <div>
        <div class="result-block-title">Keywords</div>
        <div class="tags-wrap">${tagsHtml(keywords, 'tag-keyword')}</div>
      </div>`;
  } else {
    const catRows = categories.map(cat => {
      const cls   = confClass(cat.confidence);
      const width = pct(cat.confidence);
      const tier2Part = cat.tier2_name
        ? `<span class="cat-sep">›</span><span class="cat-tier2">${escHtml(cat.tier2_name)}</span>` : '';
      const idPart = cat.tier2_id
        ? `<span class="cat-id">[${escHtml(cat.tier2_id)}]</span>`
        : `<span class="cat-id">[${escHtml(cat.tier1_id)}]</span>`;
      const flagPill = cat.flagged ? `<span class="flag-pill">⚠ Low confidence</span>` : '';
      return `
        <div class="category-row ${cat.flagged ? 'is-flagged' : ''}">
          <div class="category-breadcrumb">
            ${idPart}
            <span class="cat-tier1">${escHtml(cat.tier1_name)}</span>
            ${tier2Part}
          </div>
          <div class="confidence-row">
            <div class="confidence-bar-track">
              <div class="confidence-bar-fill ${cls}" style="width:${width}"></div>
            </div>
            <span class="confidence-pct ${cls}">${width}</span>
            ${flagPill}
          </div>
        </div>`;
    }).join('');

    const sentLabel = (sentiment.label || 'neutral').toLowerCase();
    const sentScore = parseFloat(sentiment.score ?? 0);
    const markerLeft = ((sentScore + 1) / 2 * 100).toFixed(1) + '%';

    bodyHtml = `
      <div>
        <div class="result-block-title">IAB 3.0 Categories</div>
        <div class="categories-list">${catRows || '<span class="tags-empty">No categories returned</span>'}</div>
      </div>
      <div>
        <div class="result-block-title">Sentiment</div>
        <div class="sentiment-block">
          <span class="sentiment-label sentiment-${sentLabel}">${escHtml(sentLabel)}</span>
          <div class="sentiment-score-wrap">
            <div class="sentiment-track">
              <div class="sentiment-marker" style="left:${markerLeft}"></div>
            </div>
            <span class="sentiment-score-val">${sentScore >= 0 ? '+' : ''}${sentScore.toFixed(2)}</span>
          </div>
        </div>
      </div>
      <div>
        <div class="result-block-title">Keywords</div>
        <div class="tags-wrap">${tagsHtml(keywords, 'tag-keyword')}</div>
      </div>
      <div>
        <div class="result-block-title">Entities</div>
        <div class="tags-wrap">${tagsHtml(entities, 'tag-entity')}</div>
      </div>
      <div>
        <div class="result-block-title">Locations</div>
        <div class="tags-wrap">${tagsHtml(locations, 'tag-location')}</div>
      </div>`;
  }

  return `
    <div class="results-header">
      <div class="results-url-block">
        <div class="results-title">${escHtml(title || domain)}</div>
        <div class="results-url">${escHtml(url)}</div>
        <span class="results-domain">${escHtml(domain)}</span>
      </div>
      <div class="results-badges">${typeBadge}${cachedBadge}${flaggedBadge}</div>
    </div>
    <div class="results-body">
      ${bodyHtml}
      ${created_at ? `<div style="font-size:.75rem;color:var(--text-3);margin-top:4px">Analyzed ${formatDate(created_at)}</div>` : ''}
    </div>`;
}

function renderResults(data) {
  resultsCard.innerHTML = buildResultCardHTML(data);
  resultsSection.classList.remove('hidden');
  resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── History toggle ────────────────────────────────────────────────

historyToggle.addEventListener('click', () => {
  historyOpen = !historyOpen;
  historySection.classList.toggle('open', historyOpen);
  historyBody.classList.toggle('hidden', !historyOpen);
});

// ── History search & filters ──────────────────────────────────────

historySearchInput.addEventListener('input', () => {
  historySearchQuery = historySearchInput.value.trim();
  historySearchClear.classList.toggle('hidden', !historySearchQuery);
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(searchHistory, 350);
});

historySearchClear.addEventListener('click', () => {
  historySearchInput.value = '';
  historySearchQuery = '';
  historySearchClear.classList.add('hidden');
  searchHistory();
});

document.querySelectorAll('.filter-btn[data-filter-type]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn[data-filter-type]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    historyTypeFilter = btn.dataset.filterType;
    searchHistory();
  });
});

document.querySelectorAll('.filter-btn[data-filter-conf]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn[data-filter-conf]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    historyConfFilter = parseInt(btn.dataset.filterConf, 10);
    renderHistoryRows();
  });
});

async function searchHistory() {
  const q    = historySearchQuery;
  const type = historyTypeFilter === 'all' ? '' : historyTypeFilter;

  try {
    let items;
    if (!q && !type) {
      const res = await fetch('/api/history');
      items = res.ok ? await res.json() : [];
      historySearchStatus.textContent = items.length ? `${items.length} most recent` : '';
    } else {
      const params = new URLSearchParams();
      if (q)    params.set('q', q);
      if (type) params.set('page_type', type);
      const res = await fetch(`/api/search?${params}`);
      items = res.ok ? await res.json() : [];
      historySearchStatus.textContent = `${items.length} result${items.length !== 1 ? 's' : ''}`;
    }
    renderHistory(items);
  } catch { /* silent */ }
}

// ── Sort helpers ──────────────────────────────────────────────────

function sortValue(item, col) {
  const isProd = item.page_type === 'product';
  switch (col) {
    case 'url':        return item.url.toLowerCase();
    case 'domain':     return item.domain.toLowerCase();
    case 'category':
      return isProd
        ? (item.google_category || '').toLowerCase()
        : ((item.categories?.[0]?.tier2_name || item.categories?.[0]?.tier1_name) || '').toLowerCase();
    case 'confidence':
      return isProd ? (item.confidence ?? -1) : (item.categories?.[0]?.confidence ?? -1);
    case 'sentiment':  return isProd ? -2 : (item.sentiment?.score ?? 0);
    case 'flagged':    return item.flagged ? 1 : 0;
    case 'date':       return item.created_at || '';
    default:           return '';
  }
}

function sortedItems(items) {
  return [...items].sort((a, b) => {
    const av = sortValue(a, sortCol);
    const bv = sortValue(b, sortCol);
    const cmp = typeof av === 'number' ? av - bv : av.localeCompare(bv);
    return sortDir === 'asc' ? cmp : -cmp;
  });
}

function updateSortHeaders() {
  document.querySelectorAll('.history-table th[data-col]').forEach(th => {
    const col = th.dataset.col;
    const icon = th.querySelector('.sort-icon');
    th.classList.toggle('sort-active', col === sortCol);
    if (col === sortCol) {
      icon.textContent = sortDir === 'asc' ? '▲' : '▼';
      th.classList.toggle('sort-asc',  sortDir === 'asc');
      th.classList.toggle('sort-desc', sortDir === 'desc');
    } else {
      icon.textContent = '';
      th.classList.remove('sort-asc', 'sort-desc');
    }
  });
}

// ── Render history ────────────────────────────────────────────────

function renderHistory(items) {
  historyItems = items;

  // Attach sort handlers (replace onclick to avoid stacking)
  document.querySelectorAll('.history-table th[data-col]').forEach(th => {
    th.onclick = () => {
      const col = th.dataset.col;
      if (sortCol === col) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortCol = col;
        sortDir = col === 'confidence' || col === 'date' || col === 'flagged' ? 'desc' : 'asc';
      }
      updateSortHeaders();
      renderHistoryRows();
    };
  });

  updateSortHeaders();
  renderHistoryRows();
}

function renderHistoryRows() {
  let items = sortedItems(historyItems);

  // Client-side confidence filter
  if (historyConfFilter > 0) {
    items = items.filter(item => {
      const conf = item.page_type === 'product'
        ? item.confidence
        : item.categories?.[0]?.confidence;
      return conf != null && Math.round(conf * 100) >= historyConfFilter;
    });
  }

  const count = items.length;

  if (count === 0) {
    const isFiltered = historySearchQuery || historyTypeFilter !== 'all' || historyConfFilter > 0;
    historyEmpty.textContent = isFiltered
      ? 'No results match your filters.'
      : 'No URLs analyzed yet. Enter a URL above to get started.';
    historyEmpty.classList.remove('hidden');
    historyWrap.classList.add('hidden');
    return;
  }

  historyEmpty.classList.add('hidden');
  historyWrap.classList.remove('hidden');

  historyTbody.innerHTML = items.map(item => {
    const isProd   = item.page_type === 'product';
    const catLabel = isProd
      ? (item.google_category ? truncate(item.google_category, 32) : '—')
      : (item.categories?.[0] ? truncate(item.categories[0].tier2_name || item.categories[0].tier1_name, 32) : '—');
    const conf    = isProd ? item.confidence : item.categories?.[0]?.confidence;
    const confVal = conf != null ? pct(conf) : '—';
    const confCls = conf != null ? confClass(conf) : '';
    const sent    = isProd ? '' : (item.sentiment?.label || 'neutral').toLowerCase();
    const pill    = isProd
      ? '<span class="type-pill type-pill-product">P</span>'
      : '<span class="type-pill type-pill-content">C</span>';

    return `
      <tr data-url="${escHtml(item.url)}">
        <td class="cell-url" title="${escHtml(item.url)}">${escHtml(truncate(item.url, 55))}</td>
        <td class="cell-domain">${pill} ${escHtml(item.domain)}</td>
        <td class="cell-category">${escHtml(catLabel)}</td>
        <td class="cell-conf ${confCls}">${confVal}</td>
        <td>${sent ? `<span class="sent-dot ${sent}"></span>${escHtml(sent)}` : '—'}</td>
        <td class="flag-icon">${item.flagged ? '⚠️' : ''}</td>
        <td class="cell-date">${formatDate(item.created_at)}</td>
      </tr>`;
  }).join('');

  historyTbody.querySelectorAll('tr').forEach(row => {
    row.addEventListener('click', () => {
      const item = historyItems.find(i => i.url === row.dataset.url);
      if (item) {
        urlInput.value = item.url;
        setMode('single');
        renderResults({ ...item, cached: true });
      }
    });
  });
}

async function loadHistory() {
  await searchHistory();
}

// ── Error helpers ─────────────────────────────────────────────────

function clearError()      { errorMsg.textContent = '';     errorMsg.classList.add('hidden'); }
function clearBulkError()  { bulkErrorMsg.textContent = ''; bulkErrorMsg.classList.add('hidden'); }
function showError(msg)    { errorMsg.textContent = msg;    errorMsg.classList.remove('hidden'); }
function showBulkError(msg){ bulkErrorMsg.textContent = msg;bulkErrorMsg.classList.remove('hidden'); }

// ── Single form ───────────────────────────────────────────────────

function setSingleLoading(on) {
  submitBtn.disabled = on;
  btnLabel.textContent = on ? 'Analyzing…' : 'Analyze';
  btnSpinner.classList.toggle('hidden', !on);
}

singleForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;

  clearError();
  setSingleLoading(true);
  resultsSection.classList.add('hidden');

  try {
    const res  = await fetch('/api/categorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) { showError(data.detail || `Error ${res.status}`); return; }
    renderResults(data);
    await searchHistory();
  } catch { showError('Network error — is the server running?'); }
  finally  { setSingleLoading(false); }
});

// ── Bulk form ─────────────────────────────────────────────────────

function setBulkLoading(on) {
  bulkSubmitBtn.disabled = on;
  bulkBtnSpinner.classList.toggle('hidden', !on);
  bulkInput.disabled = on;
}

function updateProgress(done, total) {
  const pctVal = total > 0 ? Math.round(done / total * 100) : 0;
  bulkProgressFill.style.width = pctVal + '%';
  bulkProgressFrac.textContent = `${done} / ${total}`;
  bulkProgressLabel.textContent = done < total
    ? `Analyzing URL ${done + 1} of ${total}…`
    : `Completed ${total} URL${total > 1 ? 's' : ''}`;
}

function renderBulkRow(result, index) {
  const row = document.createElement('div');
  row.className = `bulk-result-row${result.status === 'error' ? ' has-error' : ''}`;
  row.id = `bulk-row-${index}`;

  if (result.status === 'error') {
    row.innerHTML = `
      <div class="bulk-result-summary">
        <span class="bulk-status-icon">✗</span>
        <span class="bulk-result-url" title="${escHtml(result.url)}">${escHtml(truncate(result.url, 70))}</span>
        <span class="bulk-cat-label" style="color:var(--red)">${escHtml(result.error || 'Failed')}</span>
      </div>`;
    return row;
  }

  const data       = result.data;
  const isProduct  = data.page_type === 'product';
  const topCat     = data.categories?.[0];
  const catLabel   = isProduct
    ? (data.google_category || '—')
    : (topCat ? (topCat.tier2_name || topCat.tier1_name) : '—');
  const conf       = isProduct ? data.confidence : topCat?.confidence;
  const confVal    = conf != null ? pct(conf) : '—';
  const confCls    = conf != null ? confClass(conf) : '';
  const sent       = (data.sentiment?.label || '').toLowerCase();
  const cachedMark = result.cached ? ' <span style="color:var(--text-3);font-size:.72rem">(cached)</span>' : '';
  const typePill   = isProduct
    ? '<span class="type-pill type-pill-product">Product</span>'
    : '<span class="type-pill type-pill-content">Content</span>';

  row.innerHTML = `
    <div class="bulk-result-summary">
      <span class="bulk-status-icon">✓</span>
      ${typePill}
      <span class="bulk-result-url" title="${escHtml(data.url)}">${escHtml(truncate(data.url, 60))}</span>
      <div class="bulk-result-meta">
        <span class="bulk-cat-label">${escHtml(truncate(catLabel, 30))}</span>
        <span class="cell-conf ${confCls}" style="font-size:.8rem;font-weight:800">${confVal}</span>
        ${sent ? `<span><span class="sent-dot ${sent}"></span></span>` : ''}
        ${data.flagged ? '<span class="flag-pill">⚠</span>' : ''}
        ${cachedMark}
        <span class="bulk-expand-icon">▾</span>
      </div>
    </div>
    <div class="bulk-result-detail">
      <div class="results-card" style="border:none;box-shadow:none;border-radius:0">
        ${buildResultCardHTML({ ...data, cached: result.cached })}
      </div>
    </div>`;

  row.querySelector('.bulk-result-summary').addEventListener('click', () => {
    row.classList.toggle('expanded');
  });

  return row;
}

bulkForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const urls = parseUrls(bulkInput.value);
  if (!urls.length) return;

  clearBulkError();
  setBulkLoading(true);
  bulkResultsList.innerHTML = '';
  bulkResultsSection.classList.add('hidden');
  bulkProgressSection.classList.remove('hidden');
  updateProgress(0, urls.length);

  const results = new Array(urls.length);
  let done = 0;
  const CONCURRENCY = 5;

  const bulkTypeVal = document.querySelector('input[name="bulk-type"]:checked')?.value;
  const forceType   = bulkTypeVal === 'auto' ? null : bulkTypeVal;

  async function fetchOne(url, index) {
    try {
      const body = { url };
      if (forceType) body.force_type = forceType;
      const res  = await fetch('/api/categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      results[index] = res.ok
        ? { url, status: 'success', cached: data.cached, data }
        : { url, status: 'error', error: data.detail || `Error ${res.status}` };
    } catch {
      results[index] = { url, status: 'error', error: 'Network error' };
    }
    done++;
    updateProgress(done, urls.length);
  }

  const queue = urls.map((url, i) => () => fetchOne(url, i));
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) await queue.shift()();
  });
  await Promise.all(workers);

  updateProgress(urls.length, urls.length);

  const succeeded = results.filter(r => r.status === 'success');
  const failed    = results.filter(r => r.status === 'error');
  const cached    = succeeded.filter(r => r.cached);

  bulkResultsSummary.innerHTML = `
    <span class="bulk-stat bulk-stat-success">✓ ${succeeded.length} succeeded</span>
    ${failed.length ? `<span class="bulk-stat bulk-stat-error">✗ ${failed.length} failed</span>` : ''}
    ${cached.length ? `<span class="bulk-stat bulk-stat-cached">⚡ ${cached.length} cached</span>` : ''}`;

  results.forEach((r, i) => bulkResultsList.appendChild(renderBulkRow(r, i)));

  bulkProgressSection.classList.add('hidden');
  bulkResultsSection.classList.remove('hidden');
  bulkResultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

  setBulkLoading(false);
  bulkInput.disabled = false;

  await searchHistory();
});

// ── Targeting ─────────────────────────────────────────────────────

const targetingToggle    = document.getElementById('targeting-toggle');
const targetingBody      = document.getElementById('targeting-body');
const targetingForm      = document.getElementById('targeting-form');
const targetingInput     = document.getElementById('targeting-input');
const targetingSubmitBtn = document.getElementById('targeting-submit-btn');
const targetingBtnLabel  = document.getElementById('targeting-btn-label');
const targetingBtnSpinner= document.getElementById('targeting-btn-spinner');
const targetingError     = document.getElementById('targeting-error');
const targetingResults   = document.getElementById('targeting-results');
const targetingRationale = document.getElementById('targeting-rationale');
const targetingTags      = document.getElementById('targeting-tags');
const targetingCount     = document.getElementById('targeting-count');
const targetingTbody     = document.getElementById('targeting-tbody');
const targetingExportBtn = document.getElementById('targeting-export-btn');

let targetingOpen = false;

targetingToggle.addEventListener('click', () => {
  targetingOpen = !targetingOpen;
  document.getElementById('targeting-section').classList.toggle('open', targetingOpen);
  targetingBody.classList.toggle('hidden', !targetingOpen);
});

targetingForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const description = targetingInput.value.trim();
  if (!description) return;

  targetingError.classList.add('hidden');
  targetingResults.classList.add('hidden');
  targetingSubmitBtn.disabled = true;
  targetingBtnLabel.textContent = 'Finding matches…';
  targetingBtnSpinner.classList.remove('hidden');

  try {
    const res = await fetch('/api/targeting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
    });
    const data = await res.json();
    if (!res.ok) {
      targetingError.textContent = data.detail || 'Error finding matches';
      targetingError.classList.remove('hidden');
      return;
    }
    renderTargetingResults(data);
  } catch {
    targetingError.textContent = 'Network error — is the server running?';
    targetingError.classList.remove('hidden');
  } finally {
    targetingSubmitBtn.disabled = false;
    targetingBtnLabel.textContent = 'Find Matches';
    targetingBtnSpinner.classList.add('hidden');
  }
});

function renderTargetingResults(data) {
  const { rationale, iab_names = [], match_keywords = [], google_keywords = [], results = [], total } = data;

  targetingRationale.textContent = rationale;

  const iabTags  = iab_names.map(name =>
    `<span class="targeting-tag targeting-tag-iab">${escHtml(name)}</span>`).join('');
  const kwTags   = match_keywords.map(k =>
    `<span class="targeting-tag targeting-tag-kw">${escHtml(k)}</span>`).join('');
  const googTags = google_keywords.map(k =>
    `<span class="targeting-tag targeting-tag-google">${escHtml(k)}</span>`).join('');
  targetingTags.innerHTML = iabTags + kwTags + googTags;

  targetingCount.textContent = total === 0
    ? 'No matches found'
    : `${total} match${total !== 1 ? 'es' : ''}`;

  if (total === 0) {
    targetingTbody.innerHTML = `
      <tr><td colspan="5" style="text-align:center;color:var(--text-3);padding:32px">
        No matching domains found. Try a broader description.
      </td></tr>`;
  } else {
    targetingTbody.innerHTML = results.map(item => {
      const isProd   = item.page_type === 'product';
      const catLabel = isProd
        ? (item.google_category || '—')
        : (item.categories?.[0]
            ? (item.categories[0].tier2_name || item.categories[0].tier1_name)
            : '—');
      const conf    = item.match_confidence ?? (isProd ? item.confidence : item.categories?.[0]?.confidence);
      const confVal = conf != null ? pct(conf) : '—';
      const confCls = conf != null ? confClass(conf) : '';
      const pill    = isProd
        ? '<span class="type-pill type-pill-product">Product</span>'
        : '<span class="type-pill type-pill-content">Content</span>';

      return `
        <tr data-url="${escHtml(item.url)}" class="targeting-result-row">
          <td class="cell-domain">${escHtml(item.domain)}</td>
          <td class="cell-url" title="${escHtml(item.url)}">${escHtml(truncate(item.title || item.url, 55))}</td>
          <td class="cell-category">${escHtml(truncate(catLabel, 36))}</td>
          <td>${pill}</td>
          <td><span class="confidence-pct ${confCls}">${confVal}</span></td>
        </tr>`;
    }).join('');

    // Click row → show full result card
    targetingTbody.querySelectorAll('tr.targeting-result-row').forEach(row => {
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => {
        const item = results.find(i => i.url === row.dataset.url);
        if (item) {
          urlInput.value = item.url;
          setMode('single');
          renderResults({ ...item, cached: true });
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    });
  }

  targetingResults.classList.remove('hidden');

  if (total > 0) {
    targetingExportBtn.classList.remove('hidden');
    targetingExportBtn.onclick = () => exportTargetingCSV(results, targetingInput.value.trim());
  } else {
    targetingExportBtn.classList.add('hidden');
  }
}

function exportTargetingCSV(results, description) {
  const headers = ['domain', 'url', 'title', 'page_type', 'category', 'match_confidence'];

  const rows = results.map(item => {
    const isProd = item.page_type === 'product';
    const category = isProd
      ? (item.google_category || '')
      : (item.categories?.[0]
          ? [item.categories[0].tier1_name, item.categories[0].tier2_name].filter(Boolean).join(' > ')
          : '');
    const conf = (item.match_confidence * 100).toFixed(1) + '%';

    return [item.domain, item.url, item.title || '', item.page_type, category, conf]
      .map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });

  const slug = description.slice(0, 40).replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  const filename = `targeting_${slug}_${new Date().toISOString().slice(0,10)}.csv`;

  const blob = new Blob([[headers.join(','), ...rows].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Init ──────────────────────────────────────────────────────────
loadHistory();

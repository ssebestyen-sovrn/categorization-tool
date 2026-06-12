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
const historyCount   = document.getElementById('history-count');

let currentMode   = 'single';
let historyOpen   = false;
let sortCol       = 'confidence';
let sortDir       = 'desc';
let historyItems  = [];

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
    // Google Product Taxonomy path
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
    // IAB content path
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

// ── Sort helpers ──────────────────────────────────────────────────

function sortValue(item, col) {
  switch (col) {
    case 'url':        return item.url.toLowerCase();
    case 'domain':     return item.domain.toLowerCase();
    case 'category': {
      const c = item.categories?.[0];
      return c ? (c.tier2_name || c.tier1_name || '').toLowerCase() : '';
    }
    case 'confidence': return item.categories?.[0]?.confidence ?? -1;
    case 'sentiment':  return item.sentiment?.score ?? 0;
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
  const count = items.length;
  historyCount.textContent = count === 1 ? '1 URL' : `${count} URLs`;

  if (count === 0) {
    historyEmpty.classList.remove('hidden');
    historyWrap.classList.add('hidden');
    return;
  }
  historyEmpty.classList.add('hidden');
  historyWrap.classList.remove('hidden');

  renderHistoryRows();

  // Column sort click handlers (attach once)
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
}

function renderHistoryRows() {
  const sorted = sortedItems(historyItems);
  historyTbody.innerHTML = sorted.map(item => {
    const topCat  = item.categories?.[0];
    const catLabel = topCat ? (topCat.tier2_name || topCat.tier1_name) : '—';
    const confVal  = topCat ? pct(topCat.confidence) : '—';
    const confCls  = topCat ? confClass(topCat.confidence) : '';
    const sent     = (item.sentiment?.label || 'neutral').toLowerCase();
    return `
      <tr data-url="${escHtml(item.url)}">
        <td class="cell-url" title="${escHtml(item.url)}">${escHtml(truncate(item.url, 55))}</td>
        <td class="cell-domain">${escHtml(item.domain)}</td>
        <td class="cell-category">${escHtml(truncate(catLabel, 32))}</td>
        <td class="cell-conf ${confCls}">${confVal}</td>
        <td><span class="sent-dot ${sent}"></span>${escHtml(sent)}</td>
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
  try {
    const res = await fetch('/api/history');
    if (res.ok) renderHistory(await res.json());
  } catch { /* silent */ }
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
    const h = await fetch('/api/history');
    if (h.ok) renderHistory(await h.json());
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

  // Run with concurrency limit
  const queue = urls.map((url, i) => () => fetchOne(url, i));
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) await queue.shift()();
  });
  await Promise.all(workers);

  updateProgress(urls.length, urls.length);

  // Render bulk results
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

  // Refresh history
  const h = await fetch('/api/history');
  if (h.ok) renderHistory(await h.json());
});

// ── Init ──────────────────────────────────────────────────────────
loadHistory();

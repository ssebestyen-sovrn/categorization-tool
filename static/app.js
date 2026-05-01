const form       = document.getElementById('categorize-form');
const urlInput   = document.getElementById('url-input');
const submitBtn  = document.getElementById('submit-btn');
const btnLabel   = submitBtn.querySelector('.btn-label');
const btnSpinner = document.getElementById('btn-spinner');
const errorMsg   = document.getElementById('error-msg');
const resultsSection = document.getElementById('results-section');
const resultsCard    = document.getElementById('results-card');
const historySection = document.getElementById('history-section');
const historyEmpty   = document.getElementById('history-empty');
const historyWrap    = document.getElementById('history-table-wrap');
const historyTbody   = document.getElementById('history-tbody');
const historyCount   = document.getElementById('history-count');

// ── Helpers ──────────────────────────────────────────────────────

function confClass(confidence) {
  if (confidence >= 0.75) return 'conf-green';
  if (confidence >= 0.50) return 'conf-amber';
  return 'conf-red';
}

function pct(confidence) {
  return Math.round(confidence * 100) + '%';
}

function truncate(str, max = 60) {
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Render results card ──────────────────────────────────────────

function renderResults(data) {
  const { url, domain, title, categories = [], sentiment = {},
          keywords = [], entities = [], locations = [],
          flagged, cached, created_at } = data;

  const catRows = categories.map(cat => {
    const cls   = confClass(cat.confidence);
    const width = pct(cat.confidence);
    const tier2Part = cat.tier2_name
      ? `<span class="cat-sep">›</span><span class="cat-tier2">${escHtml(cat.tier2_name)}</span>`
      : '';
    const idPart = cat.tier2_id
      ? `<span class="cat-id">[${escHtml(cat.tier2_id)}]</span>`
      : `<span class="cat-id">[${escHtml(cat.tier1_id)}]</span>`;
    const flagPill = cat.flagged
      ? `<span class="flag-pill">⚠ Low confidence</span>` : '';

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

  // Sentiment
  const sentLabel = (sentiment.label || 'neutral').toLowerCase();
  const sentScore = parseFloat(sentiment.score ?? 0);
  const markerLeft = ((sentScore + 1) / 2 * 100).toFixed(1) + '%';

  const sentHtml = `
    <div class="sentiment-block">
      <span class="sentiment-label sentiment-${sentLabel}">${escHtml(sentLabel)}</span>
      <div class="sentiment-score-wrap">
        <div class="sentiment-track">
          <div class="sentiment-marker" style="left:${markerLeft}"></div>
        </div>
        <span class="sentiment-score-val">${sentScore >= 0 ? '+' : ''}${sentScore.toFixed(2)}</span>
      </div>
    </div>`;

  // Tags
  function tagsHtml(items, cls) {
    if (!items || !items.length) return '<span class="tags-empty">None identified</span>';
    return items.map(t => `<span class="tag ${cls}">${escHtml(t)}</span>`).join('');
  }

  const cachedBadge = cached
    ? '<span class="badge badge-cached">⚡ Cached</span>'
    : '<span class="badge badge-fresh">✦ Fresh</span>';
  const flaggedBadge = flagged
    ? '<span class="badge badge-flagged">⚠ Flagged</span>' : '';

  resultsCard.innerHTML = `
    <div class="results-header">
      <div class="results-url-block">
        <div class="results-title">${escHtml(title || domain)}</div>
        <div class="results-url">${escHtml(url)}</div>
        <span class="results-domain">${escHtml(domain)}</span>
      </div>
      <div class="results-badges">
        ${cachedBadge}
        ${flaggedBadge}
      </div>
    </div>

    <div class="results-body">
      <div>
        <div class="result-block-title">IAB 3.0 Categories</div>
        <div class="categories-list">${catRows || '<span class="tags-empty">No categories returned</span>'}</div>
      </div>

      <div>
        <div class="result-block-title">Sentiment</div>
        ${sentHtml}
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
      </div>

      ${created_at ? `<div style="font-size:.75rem;color:var(--text-3);margin-top:4px">Analyzed ${formatDate(created_at)}</div>` : ''}
    </div>`;

  resultsSection.classList.remove('hidden');
  resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Render history ───────────────────────────────────────────────

function renderHistory(items) {
  const count = items.length;
  historyCount.textContent = count === 1 ? '1 URL' : `${count} URLs`;

  if (count === 0) {
    historyEmpty.classList.remove('hidden');
    historyWrap.classList.add('hidden');
    return;
  }

  historyEmpty.classList.add('hidden');
  historyWrap.classList.remove('hidden');

  historyTbody.innerHTML = items.map(item => {
    const topCat = item.categories?.[0];
    const catLabel = topCat
      ? (topCat.tier2_name || topCat.tier1_name)
      : '—';
    const confVal = topCat ? pct(topCat.confidence) : '—';
    const confCls = topCat ? confClass(topCat.confidence) : '';
    const sent = (item.sentiment?.label || 'neutral').toLowerCase();

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

  // Click row to view cached result
  historyTbody.querySelectorAll('tr').forEach(row => {
    row.addEventListener('click', () => {
      const itemUrl = row.dataset.url;
      const item = items.find(i => i.url === itemUrl);
      if (item) {
        urlInput.value = itemUrl;
        renderResults({ ...item, cached: true });
      }
    });
  });
}

// ── Load history on startup ──────────────────────────────────────

async function loadHistory() {
  try {
    const res = await fetch('/api/history');
    if (res.ok) {
      const items = await res.json();
      renderHistory(items);
    }
  } catch { /* silent on startup */ }
}

// ── Form submit ──────────────────────────────────────────────────

function setLoading(loading) {
  submitBtn.disabled = loading;
  btnLabel.textContent = loading ? 'Analyzing…' : 'Analyze';
  if (loading) {
    btnSpinner.classList.remove('hidden');
  } else {
    btnSpinner.classList.add('hidden');
  }
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hidden');
}

function clearError() {
  errorMsg.textContent = '';
  errorMsg.classList.add('hidden');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;

  clearError();
  setLoading(true);
  resultsSection.classList.add('hidden');

  try {
    const res = await fetch('/api/categorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.detail || `Error ${res.status}: ${res.statusText}`);
      return;
    }

    renderResults(data);

    // Refresh history
    const histRes = await fetch('/api/history');
    if (histRes.ok) {
      renderHistory(await histRes.json());
    }
  } catch (err) {
    showError('Network error — is the server running?');
  } finally {
    setLoading(false);
  }
});

// ── Init ─────────────────────────────────────────────────────────
loadHistory();

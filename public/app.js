const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const searchResults = document.getElementById('search-results');
const filtersToggle = document.getElementById('filters-toggle');
const filtersBody = document.getElementById('filters-body');
const filterFloatMin = document.getElementById('filter-float-min');
const filterFloatMax = document.getElementById('filter-float-max');
const filterPaintSeed = document.getElementById('filter-paint-seed');
const filterWear = document.getElementById('filter-wear');
const filterStattrak = document.getElementById('filter-stattrak');
const filterSouvenir = document.getElementById('filter-souvenir');
const refreshBtn = document.getElementById('refresh-btn');
const watchlistTable = document.getElementById('watchlist-table');
const watchlistBody = document.getElementById('watchlist-body');
const watchlistEmpty = document.getElementById('watchlist-empty');

let watchlist = [];
let csfloatActive = true;
const priceCache = new Map();

// --- CSFloat status ---

function updateCsfloatHeader() {
  const header = document.getElementById('csfloat-header');
  if (!csfloatActive) {
    header.innerHTML = 'CSFloat <span class="badge-inactive">Inactive</span>'
      + '<div class="activate-hint">Add API key to .env to activate</div>';
  } else {
    header.textContent = 'CSFloat';
  }
}

// --- Filters ---

function getFilters() {
  return {
    floatMin: filterFloatMin.value ? parseFloat(filterFloatMin.value) : null,
    floatMax: filterFloatMax.value ? parseFloat(filterFloatMax.value) : null,
    paintSeed: filterPaintSeed.value ? parseInt(filterPaintSeed.value, 10) : null,
    wear: filterWear.value,
    stattrak: filterStattrak.value,
    souvenir: filterSouvenir.value,
  };
}

filtersToggle.addEventListener('click', () => {
  const isHidden = filtersBody.hidden;
  filtersBody.hidden = !isHidden;
  filtersToggle.querySelector('.toggle-icon').innerHTML = isHidden ? '&#9650;' : '&#9660;';
});

// --- Search ---

async function searchSkins(query) {
  if (!query.trim()) {
    searchResults.classList.remove('visible');
    return;
  }

  searchResults.innerHTML = '<div class="search-no-results">Searching...</div>';
  searchResults.classList.add('visible');

  const filters = getFilters();
  const params = new URLSearchParams({ q: query });
  if (filters.wear) params.set('wear', filters.wear);
  if (filters.stattrak !== 'either') params.set('stattrak', filters.stattrak);
  if (filters.souvenir !== 'either') params.set('souvenir', filters.souvenir);

  try {
    const resp = await fetch(`/api/skinport/search?${params}`);
    const items = await resp.json();

    if (items.length === 0) {
      searchResults.innerHTML = '<div class="search-no-results">No skins found</div>';
      return;
    }

    searchResults.innerHTML = items.map(item => {
      const wear = extractWear(item.name);
      const category = extractCategory(item.market_page);
      const meta = [category, wear].filter(Boolean).join(' \u00b7 ');
      return `
      <div class="search-result-item" data-name="${escapeAttr(item.name)}">
        <div class="result-left">
          <img class="skin-thumb" src="/api/image/${encodeURIComponent(item.name)}"
               onerror="this.style.display='none';this.nextElementSibling.style.display='block'" loading="lazy" alt="">
          <div class="skin-thumb-placeholder" style="display:none"></div>
          <div class="result-info">
            <span class="name">${escapeHtml(item.name)}</span>
            ${meta ? `<span class="result-meta">${escapeHtml(meta)}</span>` : ''}
          </div>
        </div>
        <span class="price">${item.min_price != null ? '$' + item.min_price.toFixed(2) : ''}</span>
        <button class="add-btn">+ Add</button>
      </div>`;
    }).join('');
  } catch {
    searchResults.innerHTML = '<div class="search-no-results">Search failed. Try again.</div>';
  }
}

searchBtn.addEventListener('click', () => searchSkins(searchInput.value));
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') searchSkins(searchInput.value);
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-section')) {
    searchResults.classList.remove('visible');
  }
});

// Add skin from search results
searchResults.addEventListener('click', async (e) => {
  const addBtn = e.target.closest('.add-btn');
  if (!addBtn) return;

  const item = addBtn.closest('.search-result-item');
  const name = item.dataset.name;
  const filters = getFilters();

  // Only persist float/pattern filters (wear/stattrak/souvenir are in the name)
  const savedFilters = {};
  if (filters.floatMin != null) savedFilters.floatMin = filters.floatMin;
  if (filters.floatMax != null) savedFilters.floatMax = filters.floatMax;
  if (filters.paintSeed != null) savedFilters.paintSeed = filters.paintSeed;

  try {
    const resp = await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, filters: savedFilters }),
    });

    if (resp.status === 409) {
      addBtn.textContent = 'Already added';
      addBtn.disabled = true;
      return;
    }

    watchlist = await resp.json();
    addBtn.textContent = 'Added!';
    addBtn.disabled = true;
    renderWatchlist();
    fetchAllPrices();
  } catch {
    addBtn.textContent = 'Error';
  }
});

// --- Watchlist ---

async function loadWatchlist() {
  try {
    const [watchlistResp, statusResp] = await Promise.all([
      fetch('/api/watchlist'),
      fetch('/api/csfloat/status'),
    ]);
    watchlist = await watchlistResp.json();
    const { active } = await statusResp.json();
    csfloatActive = active;
    updateCsfloatHeader();
    renderWatchlist();
    if (watchlist.length > 0) fetchAllPrices();
  } catch {
    console.error('Failed to load watchlist');
  }
}

function formatFilterTags(filters) {
  if (!filters) return '';
  const tags = [];
  if (filters.floatMin != null || filters.floatMax != null) {
    const min = filters.floatMin != null ? filters.floatMin.toFixed(2) : '0';
    const max = filters.floatMax != null ? filters.floatMax.toFixed(2) : '1';
    tags.push(`Float: ${min}\u2013${max}`);
  }
  if (filters.paintSeed != null) {
    tags.push(`Pattern: #${filters.paintSeed}`);
  }
  return tags.join(' \u00b7 ');
}

function renderWatchlist() {
  if (watchlist.length === 0) {
    watchlistTable.hidden = true;
    watchlistEmpty.hidden = false;
    return;
  }

  watchlistTable.hidden = false;
  watchlistEmpty.hidden = true;

  watchlistBody.innerHTML = watchlist.map(skin => {
    const filterText = formatFilterTags(skin.filters);
    return `
    <tr data-id="${escapeAttr(skin.id)}">
      <td>
        <div class="skin-name">${escapeHtml(skin.name)}</div>
        ${filterText ? `<div class="skin-filters">${escapeHtml(filterText)}</div>` : ''}
      </td>
      <td class="price skinport-price"><span class="loading-dots">Loading</span></td>
      <td class="price steam-price"><span class="loading-dots">Loading</span></td>
      <td class="price csfloat-price">${csfloatActive ? '<span class="loading-dots">Loading</span>' : '<span class="badge-inactive">Inactive</span>'}</td>
      <td class="price skinmonkey-price"><span class="badge-inactive">Inactive</span></td>
      <td class="best-price">-</td>
      <td style="text-align:center">
        <button class="remove-btn" title="Remove from watchlist">&times;</button>
      </td>
    </tr>`;
  }).join('');
}

// Remove skin
watchlistBody.addEventListener('click', async (e) => {
  const removeBtn = e.target.closest('.remove-btn');
  if (!removeBtn) return;

  const row = removeBtn.closest('tr');
  const id = row.dataset.id;

  try {
    const resp = await fetch(`/api/watchlist/${encodeURIComponent(id)}`, { method: 'DELETE' });
    watchlist = await resp.json();
    renderWatchlist();
    if (watchlist.length > 0) fetchAllPrices();
  } catch {
    console.error('Failed to remove skin');
  }
});

// Open skin modal on skin name click
watchlistBody.addEventListener('click', (e) => {
  const skinName = e.target.closest('.skin-name');
  if (!skinName) return;
  const row = skinName.closest('tr');
  if (!row) return;
  openSkinModal(row.dataset.id);
});

// --- Price Fetching ---

async function fetchAllPrices() {
  refreshBtn.disabled = true;
  refreshBtn.textContent = 'Refreshing...';

  const promises = watchlist.map(skin => fetchPricesForSkin(skin));
  await Promise.all(promises);

  refreshBtn.disabled = false;
  refreshBtn.textContent = 'Refresh Prices';
}

async function fetchPricesForSkin(skin) {
  const row = watchlistBody.querySelector(`tr[data-id="${CSS.escape(skin.id)}"]`);
  if (!row) return;

  const skinportCell = row.querySelector('.skinport-price');
  const steamCell = row.querySelector('.steam-price');
  const csfloatCell = row.querySelector('.csfloat-price');
  const bestCell = row.querySelector('.best-price');

  const filters = skin.filters || {};

  // Build CSFloat query params for float range and pattern
  const csfloatParams = new URLSearchParams();
  if (filters.floatMin != null) csfloatParams.set('min_float', filters.floatMin);
  if (filters.floatMax != null) csfloatParams.set('max_float', filters.floatMax);
  if (filters.paintSeed != null) csfloatParams.set('paint_seed', filters.paintSeed);
  const csfloatQuery = csfloatParams.toString();
  const csfloatUrl = `/api/csfloat/price/${encodeURIComponent(skin.name)}${csfloatQuery ? '?' + csfloatQuery : ''}`;

  // Fetch all active sources in parallel
  const [skinportData, steamData, csfloatData] = await Promise.all([
    fetch(`/api/skinport/price/${encodeURIComponent(skin.name)}`)
      .then(r => r.json())
      .catch(() => ({ price: null })),
    fetch(`/api/steam/price/${encodeURIComponent(skin.name)}`)
      .then(r => r.json())
      .catch(() => ({ price: null })),
    csfloatActive
      ? fetch(csfloatUrl).then(r => r.json()).catch(() => ({ price: null }))
      : Promise.resolve({ price: null, inactive: true }),
  ]);

  // If CSFloat returned an auth error, switch to inactive
  if (csfloatData.error === 'CSFloat API key not configured' || csfloatData.error === 'Invalid CSFloat API key') {
    csfloatActive = false;
    csfloatData.inactive = true;
    updateCsfloatHeader();
  }

  const skinportPrice = skinportData.price;
  const steamPrice = steamData.price;
  const csfloatPrice = csfloatData.price;

  // Determine cheapest across all active sources
  const prices = [];
  if (skinportPrice != null) prices.push({ source: 'Skinport', price: skinportPrice });
  if (steamPrice != null) prices.push({ source: 'Steam', price: steamPrice });
  if (csfloatPrice != null) prices.push({ source: 'CSFloat', price: csfloatPrice });
  prices.sort((a, b) => a.price - b.price);
  const cheapest = prices.length > 0 ? prices[0].price : null;

  function priceClass(p) {
    if (prices.length <= 1) return 'cheapest';
    return p <= cheapest ? 'cheapest' : 'not-cheapest';
  }

  // Cache prices for modal display
  priceCache.set(skin.id, { skinport: skinportPrice, steam: steamPrice, csfloat: csfloatPrice });

  // Skinport cell
  if (skinportPrice != null) {
    skinportCell.innerHTML = `<div class="price-value">$${skinportPrice.toFixed(2)}</div>`;
    skinportCell.className = 'price skinport-price ' + priceClass(skinportPrice);
  } else {
    skinportCell.innerHTML = '<div class="price-value">N/A</div>';
    skinportCell.className = 'price skinport-price unavailable';
  }

  // Steam cell
  if (steamPrice != null) {
    steamCell.innerHTML = `<div class="price-value">$${steamPrice.toFixed(2)}</div>`;
    steamCell.className = 'price steam-price ' + priceClass(steamPrice);
  } else {
    steamCell.innerHTML = '<div class="price-value">N/A</div>';
    steamCell.className = 'price steam-price unavailable';
  }

  // CSFloat cell
  if (csfloatData.inactive) {
    csfloatCell.innerHTML = '<span class="badge-inactive">Inactive</span>';
    csfloatCell.className = 'price csfloat-price';
  } else if (csfloatPrice != null) {
    const details = [];
    if (csfloatData.float_value != null) details.push(`Float: ${formatFloat(csfloatData.float_value)}`);
    if (csfloatData.paint_seed != null) details.push(`Pattern: #${csfloatData.paint_seed}`);
    const detailsHtml = details.length > 0
      ? `<div class="listing-details">${details.join(' \u00b7 ')}</div>`
      : '';
    csfloatCell.innerHTML = `<div class="price-value">$${csfloatPrice.toFixed(2)}</div>${detailsHtml}`;
    csfloatCell.className = 'price csfloat-price ' + priceClass(csfloatPrice);
  } else {
    csfloatCell.innerHTML = '<div class="price-value">N/A</div>';
    csfloatCell.className = 'price csfloat-price unavailable';
  }

  // Best price cell
  if (prices.length > 0) {
    bestCell.textContent = `$${prices[0].price.toFixed(2)} (${prices[0].source})`;
    bestCell.className = 'best-price';
  } else {
    bestCell.textContent = '-';
    bestCell.className = 'best-price';
  }
}

function formatFloat(value) {
  return value.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
}

refreshBtn.addEventListener('click', () => {
  if (watchlist.length > 0) {
    renderWatchlist();
    fetchAllPrices();
  }
});

// --- Helpers ---

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function extractWear(name) {
  const match = name.match(/\(([^)]+)\)$/);
  return match ? match[1] : '';
}

function extractCategory(marketPage) {
  if (!marketPage) return '';
  try {
    const parts = new URL(marketPage).pathname.split('/');
    if (parts.length >= 3) return parts[2].charAt(0).toUpperCase() + parts[2].slice(1);
  } catch {}
  return '';
}

// --- Modal ---

function skinportSlug(name) {
  return name
    .replace(/\u2122/g, '')
    .replace(/\u2605/g, '')
    .replace(/\s*\|\s*/g, '-')
    .replace(/[()]/g, '')
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function openSkinModal(skinId) {
  const skin = watchlist.find(s => s.id === skinId);
  if (!skin) return;

  const cached = priceCache.get(skinId) || {};
  const filterText = formatFilterTags(skin.filters);
  const name = skin.name;

  // Price rows
  const priceRows = [
    { source: 'Skinport', price: cached.skinport },
    { source: 'Steam', price: cached.steam },
  ];
  if (csfloatActive) {
    priceRows.push({ source: 'CSFloat', price: cached.csfloat });
  }

  const priceRowsHtml = priceRows.map(r => `
    <div class="modal-price-row">
      <span class="modal-source">${r.source}</span>
      <span class="modal-price-value${r.price != null ? '' : ' unavailable'}">${r.price != null ? '$' + r.price.toFixed(2) : 'N/A'}</span>
    </div>`).join('');

  // Marketplace links
  const links = [
    { label: 'View on Skinport', url: `https://skinport.com/item/${skinportSlug(name)}` },
    { label: 'View on Steam', url: `https://steamcommunity.com/market/listings/730/${encodeURIComponent(name)}` },
  ];
  if (csfloatActive) {
    links.push({ label: 'View on CSFloat', url: `https://csfloat.com/search?market_hash_name=${encodeURIComponent(name)}` });
  }

  const linksHtml = links.map(l =>
    `<a href="${escapeAttr(l.url)}" target="_blank" rel="noopener" class="modal-link">${escapeHtml(l.label)}</a>`
  ).join('');

  document.getElementById('modal-content').innerHTML = `
    <button class="modal-close">&times;</button>
    <img class="modal-skin-image" src="/api/image/${encodeURIComponent(name)}"
         onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" alt="">
    <div class="modal-skin-placeholder" style="display:none"></div>
    <h3 class="modal-skin-name">${escapeHtml(name)}</h3>
    ${filterText ? `<div class="modal-skin-filters">${escapeHtml(filterText)}</div>` : ''}
    <div class="modal-prices">${priceRowsHtml}</div>
    <div class="modal-links">${linksHtml}</div>`;

  document.getElementById('skin-modal').classList.add('visible');
}

function closeSkinModal() {
  document.getElementById('skin-modal').classList.remove('visible');
}

document.getElementById('skin-modal').addEventListener('click', (e) => {
  if (e.target.id === 'skin-modal' || e.target.closest('.modal-close')) {
    closeSkinModal();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('skin-modal').classList.contains('visible')) {
    closeSkinModal();
  }
});

// --- Init ---
loadWatchlist();

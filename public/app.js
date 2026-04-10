const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const filtersToggle = document.getElementById('filters-toggle');
const filtersBody = document.getElementById('filters-body');
const filterPriceMin = document.getElementById('filter-price-min');
const filterPriceMax = document.getElementById('filter-price-max');
const filterFloatMin = document.getElementById('filter-float-min');
const filterFloatMax = document.getElementById('filter-float-max');
const filterPaintSeed = document.getElementById('filter-paint-seed');
const filterWear = document.getElementById('filter-wear');
const filterStattrak = document.getElementById('filter-stattrak');
const filterSouvenir = document.getElementById('filter-souvenir');
const searchForm = document.getElementById('search-form');
const refreshBtn = document.getElementById('refresh-btn');
const sortSelect = document.getElementById('sort-select');
const watchlistTable = document.getElementById('watchlist-table');
const watchlistBody = document.getElementById('watchlist-body');
const watchlistEmpty = document.getElementById('watchlist-empty');

let watchlist = [];
let csfloatActive = true;
let currentSort = 'dateDesc';
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
    priceMin: filterPriceMin.value ? parseFloat(filterPriceMin.value) : null,
    priceMax: filterPriceMax.value ? parseFloat(filterPriceMax.value) : null,
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
  if (filters.priceMin != null) params.set('priceMin', filters.priceMin);
  if (filters.priceMax != null) params.set('priceMax', filters.priceMax);

  try {
    const resp = await fetch(`/api/skinport/search?${params}`);
    const items = await resp.json();

    if (items.length === 0) {
      searchResults.innerHTML = '<div class="search-no-results">No skins found</div>';
      return;
    }

    const currentFiltersStr = currentSavedFiltersJson();
    searchResults.innerHTML = items.map(item => {
      const wear = extractWear(item.name);
      const category = extractCategory(item.market_page);
      const meta = [category, wear].filter(Boolean).join(' \u00b7 ');
      const alreadyAdded = watchlist.some(s =>
        s.name === item.name && JSON.stringify(s.filters || {}) === currentFiltersStr
      );
      const buttonHtml = alreadyAdded
        ? `<button class="add-btn added" disabled>Added</button>`
        : `<button class="add-btn">+ Add</button>`;
      return `
      <div class="search-result-item"
           data-name="${escapeAttr(item.name)}"
           data-price="${item.min_price != null ? item.min_price : ''}"
           data-market-page="${escapeAttr(item.market_page || '')}">
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
        ${buttonHtml}
      </div>`;
    }).join('');
  } catch {
    searchResults.innerHTML = '<div class="search-no-results">Search failed. Try again.</div>';
  }
}

searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  searchSkins(searchInput.value);
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-section')) {
    searchResults.classList.remove('visible');
  }
});

function markBtnAsAdded(addBtn) {
  addBtn.textContent = 'Added';
  addBtn.classList.add('added');
  addBtn.disabled = true;
}

function currentSavedFiltersJson() {
  const filters = getFilters();
  const savedFilters = {};
  if (filters.floatMin != null) savedFilters.floatMin = filters.floatMin;
  if (filters.floatMax != null) savedFilters.floatMax = filters.floatMax;
  if (filters.paintSeed != null) savedFilters.paintSeed = filters.paintSeed;
  return JSON.stringify(savedFilters);
}

// Open preview modal when clicking a search result (but not the add button)
searchResults.addEventListener('click', (e) => {
  if (e.target.closest('.add-btn')) return;
  const item = e.target.closest('.search-result-item');
  if (!item) return;
  openSearchResultModal({
    name: item.dataset.name,
    min_price: item.dataset.price ? parseFloat(item.dataset.price) : null,
    market_page: item.dataset.marketPage || '',
  });
});

// Add skin from search results
searchResults.addEventListener('click', async (e) => {
  const addBtn = e.target.closest('.add-btn');
  if (!addBtn || addBtn.disabled) return;

  const item = addBtn.closest('.search-result-item');
  const name = item.dataset.name;
  const savedFilters = JSON.parse(currentSavedFiltersJson());

  try {
    const resp = await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, filters: savedFilters }),
    });

    if (resp.status === 409) {
      markBtnAsAdded(addBtn);
      return;
    }

    if (!resp.ok) {
      addBtn.textContent = 'Error';
      console.error('Add failed:', resp.status, await resp.text().catch(() => ''));
      return;
    }

    watchlist = await resp.json();
    markBtnAsAdded(addBtn);
    renderWatchlist();
    fetchAllPrices();
  } catch (err) {
    addBtn.textContent = 'Error';
    console.error('Add request failed:', err);
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

function priceFor(id, source) {
  const cached = priceCache.get(id);
  const p = cached?.[source];
  return p != null ? p : Infinity;
}

function bestPriceFor(id) {
  const cached = priceCache.get(id);
  if (!cached) return Infinity;
  const prices = ['skinport', 'steam', 'csfloat', 'bitskins', 'dmarket']
    .map(k => cached[k])
    .filter(p => p != null);
  return prices.length > 0 ? Math.min(...prices) : Infinity;
}

function isPriceSort() {
  return ['bestAsc', 'skinportAsc', 'steamAsc', 'bitskinsAsc', 'dmarketAsc'].includes(currentSort);
}

function getSortedWatchlist() {
  const list = [...watchlist];
  switch (currentSort) {
    case 'nameAsc':
      return list.sort((a, b) => a.name.localeCompare(b.name));
    case 'bestAsc':
      return list.sort((a, b) => bestPriceFor(a.id) - bestPriceFor(b.id));
    case 'skinportAsc':
      return list.sort((a, b) => priceFor(a.id, 'skinport') - priceFor(b.id, 'skinport'));
    case 'steamAsc':
      return list.sort((a, b) => priceFor(a.id, 'steam') - priceFor(b.id, 'steam'));
    case 'bitskinsAsc':
      return list.sort((a, b) => priceFor(a.id, 'bitskins') - priceFor(b.id, 'bitskins'));
    case 'dmarketAsc':
      return list.sort((a, b) => priceFor(a.id, 'dmarket') - priceFor(b.id, 'dmarket'));
    case 'dateDesc':
    default:
      return list.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
  }
}

function renderWatchlist() {
  if (watchlist.length === 0) {
    watchlistTable.hidden = true;
    watchlistEmpty.hidden = false;
    return;
  }

  watchlistTable.hidden = false;
  watchlistEmpty.hidden = true;

  const sorted = getSortedWatchlist();

  watchlistBody.innerHTML = sorted.map(skin => {
    const filterText = formatFilterTags(skin.filters);
    return `
    <tr data-id="${escapeAttr(skin.id)}">
      <td>
        <div class="skin-name">${escapeHtml(skin.name)}</div>
        ${filterText ? `<div class="skin-filters">${escapeHtml(filterText)}</div>` : ''}
        <div class="mobile-hint">Tap name to compare prices</div>
      </td>
      <td class="price skinport-price mobile-hide"><span class="loading-dots">Loading</span></td>
      <td class="price steam-price mobile-hide"><span class="loading-dots">Loading</span></td>
      <td class="price csfloat-price mobile-hide">${csfloatActive ? '<span class="loading-dots">Loading</span>' : '<span class="badge-inactive">Inactive</span>'}</td>
      <td class="price bitskins-price mobile-hide"><span class="loading-dots">Loading</span></td>
      <td class="price dmarket-price mobile-hide"><span class="loading-dots">Loading</span></td>
      <td class="price skinmonkey-price mobile-hide"><span class="badge-inactive">Inactive</span></td>
      <td class="best-price">-</td>
      <td style="text-align:center">
        <button class="remove-btn" title="Remove from watchlist">&times;</button>
      </td>
    </tr>`;
  }).join('');

  // Re-apply cached prices to the freshly rendered cells
  sorted.forEach(skin => {
    if (priceCache.has(skin.id)) renderPricesForSkin(skin);
  });
}

sortSelect.addEventListener('change', () => {
  currentSort = sortSelect.value;
  renderWatchlist();
});

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

  // Re-sort if currently sorting by a price column (prices may have changed)
  if (isPriceSort()) renderWatchlist();

  refreshBtn.disabled = false;
  refreshBtn.textContent = 'Refresh Prices';
}

async function fetchPricesForSkin(skin) {
  const filters = skin.filters || {};

  // Build CSFloat query params for float range and pattern
  const csfloatParams = new URLSearchParams();
  if (filters.floatMin != null) csfloatParams.set('min_float', filters.floatMin);
  if (filters.floatMax != null) csfloatParams.set('max_float', filters.floatMax);
  if (filters.paintSeed != null) csfloatParams.set('paint_seed', filters.paintSeed);
  const csfloatQuery = csfloatParams.toString();
  const csfloatUrl = `/api/csfloat/price/${encodeURIComponent(skin.name)}${csfloatQuery ? '?' + csfloatQuery : ''}`;

  // Fetch all active sources in parallel
  const [skinportData, steamData, csfloatData, bitskinsData, dmarketData] = await Promise.all([
    fetch(`/api/skinport/price/${encodeURIComponent(skin.name)}`)
      .then(r => r.json())
      .catch(() => ({ price: null })),
    fetch(`/api/steam/price/${encodeURIComponent(skin.name)}`)
      .then(r => r.json())
      .catch(() => ({ price: null })),
    csfloatActive
      ? fetch(csfloatUrl).then(r => r.json()).catch(() => ({ price: null }))
      : Promise.resolve({ price: null, inactive: true }),
    fetch(`/api/bitskins/price/${encodeURIComponent(skin.name)}`)
      .then(r => r.json())
      .catch(() => ({ price: null })),
    fetch(`/api/dmarket/price/${encodeURIComponent(skin.name)}`)
      .then(r => r.json())
      .catch(() => ({ price: null })),
  ]);

  // If CSFloat returned an auth error, switch to inactive
  if (csfloatData.error === 'CSFloat API key not configured' || csfloatData.error === 'Invalid CSFloat API key') {
    csfloatActive = false;
    csfloatData.inactive = true;
    updateCsfloatHeader();
  }

  // Cache everything needed for cell rendering and modal display
  priceCache.set(skin.id, {
    skinport: skinportData.price,
    steam: steamData.price,
    csfloat: csfloatData.price,
    csfloatFloat: csfloatData.float_value,
    csfloatSeed: csfloatData.paint_seed,
    csfloatInactive: csfloatData.inactive || false,
    bitskins: bitskinsData.price,
    dmarket: dmarketData.price,
  });

  renderPricesForSkin(skin);
}

function renderPricesForSkin(skin) {
  const row = watchlistBody.querySelector(`tr[data-id="${CSS.escape(skin.id)}"]`);
  if (!row) return;

  const cached = priceCache.get(skin.id);
  if (!cached) return;

  const skinportCell = row.querySelector('.skinport-price');
  const steamCell = row.querySelector('.steam-price');
  const csfloatCell = row.querySelector('.csfloat-price');
  const bitskinsCell = row.querySelector('.bitskins-price');
  const dmarketCell = row.querySelector('.dmarket-price');
  const bestCell = row.querySelector('.best-price');

  const { skinport, steam, csfloat, csfloatFloat, csfloatSeed, csfloatInactive, bitskins, dmarket } = cached;

  // Determine cheapest across all active sources
  const prices = [];
  if (skinport != null) prices.push({ source: 'Skinport', price: skinport });
  if (steam != null) prices.push({ source: 'Steam', price: steam });
  if (csfloat != null) prices.push({ source: 'CSFloat', price: csfloat });
  if (bitskins != null) prices.push({ source: 'BitSkins', price: bitskins });
  if (dmarket != null) prices.push({ source: 'DMarket', price: dmarket });
  prices.sort((a, b) => a.price - b.price);
  const cheapest = prices.length > 0 ? prices[0].price : null;

  function priceClass(p) {
    if (prices.length <= 1) return 'cheapest';
    return p <= cheapest ? 'cheapest' : 'not-cheapest';
  }

  // Skinport cell
  if (skinport != null) {
    skinportCell.innerHTML = `<div class="price-value">$${skinport.toFixed(2)}</div>`;
    skinportCell.className = 'price skinport-price mobile-hide ' + priceClass(skinport);
  } else {
    skinportCell.innerHTML = '<div class="price-value">Not listed</div>';
    skinportCell.className = 'price skinport-price mobile-hide unavailable';
  }

  // Steam cell
  if (steam != null) {
    steamCell.innerHTML = `<div class="price-value">$${steam.toFixed(2)}</div>`;
    steamCell.className = 'price steam-price mobile-hide ' + priceClass(steam);
  } else {
    steamCell.innerHTML = '<div class="price-value">Not listed</div>';
    steamCell.className = 'price steam-price mobile-hide unavailable';
  }

  // CSFloat cell
  if (csfloatInactive) {
    csfloatCell.innerHTML = '<span class="badge-inactive">Inactive</span>';
    csfloatCell.className = 'price csfloat-price mobile-hide';
  } else if (csfloat != null) {
    const details = [];
    if (csfloatFloat != null) details.push(`Float: ${formatFloat(csfloatFloat)}`);
    if (csfloatSeed != null) details.push(`Pattern: #${csfloatSeed}`);
    const detailsHtml = details.length > 0
      ? `<div class="listing-details">${details.join(' \u00b7 ')}</div>`
      : '';
    csfloatCell.innerHTML = `<div class="price-value">$${csfloat.toFixed(2)}</div>${detailsHtml}`;
    csfloatCell.className = 'price csfloat-price mobile-hide ' + priceClass(csfloat);
  } else {
    csfloatCell.innerHTML = '<div class="price-value">Not listed</div>';
    csfloatCell.className = 'price csfloat-price mobile-hide unavailable';
  }

  // BitSkins cell
  if (bitskins != null) {
    bitskinsCell.innerHTML = `<div class="price-value">$${bitskins.toFixed(2)}</div>`;
    bitskinsCell.className = 'price bitskins-price mobile-hide ' + priceClass(bitskins);
  } else {
    bitskinsCell.innerHTML = '<div class="price-value">Not listed</div>';
    bitskinsCell.className = 'price bitskins-price mobile-hide unavailable';
  }

  // DMarket cell
  if (dmarket != null) {
    dmarketCell.innerHTML = `<div class="price-value">$${dmarket.toFixed(2)}</div>`;
    dmarketCell.className = 'price dmarket-price mobile-hide ' + priceClass(dmarket);
  } else {
    dmarketCell.innerHTML = '<div class="price-value">Not listed</div>';
    dmarketCell.className = 'price dmarket-price mobile-hide unavailable';
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
  priceRows.push({ source: 'BitSkins', price: cached.bitskins });
  priceRows.push({ source: 'DMarket', price: cached.dmarket });

  const priceRowsHtml = priceRows.map(r => `
    <div class="modal-price-row">
      <span class="modal-source">${r.source}</span>
      <span class="modal-price-value${r.price != null ? '' : ' unavailable'}">${r.price != null ? '$' + r.price.toFixed(2) : 'Not listed'}</span>
    </div>`).join('');

  // Marketplace links
  const links = [
    { label: 'View on Skinport', url: `https://skinport.com/item/${skinportSlug(name)}` },
    { label: 'View on Steam', url: `https://steamcommunity.com/market/listings/730/${encodeURIComponent(name)}` },
  ];
  if (csfloatActive) {
    links.push({ label: 'View on CSFloat', url: `https://csfloat.com/search?market_hash_name=${encodeURIComponent(name)}` });
  }
  links.push({ label: 'View on BitSkins', url: `https://bitskins.com/market/cs2?search=${encodeURIComponent(name)}` });
  links.push({ label: 'View on DMarket', url: `https://dmarket.com/ingame-items/item-list/csgo-skins?title=${encodeURIComponent(name)}` });

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

function openSearchResultModal(item) {
  const name = item.name;
  const wear = extractWear(name);
  const category = extractCategory(item.market_page);
  const meta = [category, wear].filter(Boolean).join(' \u00b7 ');

  const filtersStr = currentSavedFiltersJson();
  const alreadyAdded = watchlist.some(s =>
    s.name === name && JSON.stringify(s.filters || {}) === filtersStr
  );

  const priceHtml = `
    <div class="modal-price-row">
      <span class="modal-source">Skinport</span>
      <span class="modal-price-value${item.min_price != null ? '' : ' unavailable'}">${item.min_price != null ? '$' + item.min_price.toFixed(2) : 'Not listed'}</span>
    </div>`;

  const addBtnHtml = alreadyAdded
    ? `<button class="modal-add-btn" disabled>Added to Watchlist</button>`
    : `<button class="modal-add-btn" data-name="${escapeAttr(name)}">+ Add to Watchlist</button>`;

  const linksHtml = [
    { label: 'View on Skinport', url: `https://skinport.com/item/${skinportSlug(name)}` },
    { label: 'View on Steam', url: `https://steamcommunity.com/market/listings/730/${encodeURIComponent(name)}` },
  ].map(l =>
    `<a href="${escapeAttr(l.url)}" target="_blank" rel="noopener" class="modal-link">${escapeHtml(l.label)}</a>`
  ).join('');

  document.getElementById('modal-content').innerHTML = `
    <button class="modal-close">&times;</button>
    <img class="modal-skin-image" src="/api/image/${encodeURIComponent(name)}"
         onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" alt="">
    <div class="modal-skin-placeholder" style="display:none"></div>
    <h3 class="modal-skin-name">${escapeHtml(name)}</h3>
    ${meta ? `<div class="modal-skin-meta">${escapeHtml(meta)}</div>` : ''}
    <div class="modal-prices">${priceHtml}</div>
    <div class="modal-note">Full price comparison available after adding to watchlist</div>
    ${addBtnHtml}
    <div class="modal-links">${linksHtml}</div>`;

  document.getElementById('skin-modal').classList.add('visible');
}

async function handleModalAddClick(addBtn) {
  const name = addBtn.dataset.name;
  if (!name) return;

  const savedFilters = JSON.parse(currentSavedFiltersJson());
  addBtn.disabled = true;
  addBtn.textContent = 'Adding...';

  try {
    const resp = await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, filters: savedFilters }),
    });

    if (resp.status === 409) {
      addBtn.textContent = 'Already in Watchlist';
      return;
    }

    if (!resp.ok) {
      addBtn.textContent = 'Error';
      addBtn.disabled = false;
      console.error('Modal add failed:', resp.status, await resp.text().catch(() => ''));
      return;
    }

    watchlist = await resp.json();
    addBtn.textContent = 'Added to Watchlist';
    renderWatchlist();
    fetchAllPrices();
  } catch (err) {
    addBtn.textContent = 'Error';
    addBtn.disabled = false;
    console.error('Modal add request failed:', err);
  }
}

function closeSkinModal() {
  document.getElementById('skin-modal').classList.remove('visible');
}

document.getElementById('skin-modal').addEventListener('click', async (e) => {
  if (e.target.id === 'skin-modal' || e.target.closest('.modal-close')) {
    closeSkinModal();
    return;
  }
  const addBtn = e.target.closest('.modal-add-btn');
  if (addBtn && !addBtn.disabled) {
    await handleModalAddClick(addBtn);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('skin-modal').classList.contains('visible')) {
    closeSkinModal();
  }
});

// --- Init ---
loadWatchlist();

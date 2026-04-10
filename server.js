require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const path = require('path');
const Fuse = require('fuse.js');
const { kv } = require('@vercel/kv');

const app = express();
const PORT = process.env.PORT || 3000;
const WATCHLIST_PATH = path.join(__dirname, 'data', 'watchlist.json');
const useKV = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Watchlist storage ---

async function getWatchlist() {
  if (useKV) {
    return (await kv.get('watchlist')) || [];
  }
  try {
    return JSON.parse(fs.readFileSync(WATCHLIST_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

async function saveWatchlist(watchlist) {
  if (useKV) {
    await kv.set('watchlist', watchlist);
  } else {
    fs.writeFileSync(WATCHLIST_PATH, JSON.stringify(watchlist, null, 2));
  }
}

// --- Watchlist endpoints ---

app.get('/api/watchlist', async (req, res) => {
  try {
    const watchlist = await getWatchlist();
    res.json(watchlist);
  } catch (err) {
    console.error('Watchlist read error:', err.message);
    res.status(500).json({ error: 'Failed to read watchlist' });
  }
});

app.post('/api/watchlist', async (req, res) => {
  try {
    const { name, filters } = req.body;
    if (!name) return res.status(400).json({ error: 'Skin name is required' });

    const watchlist = await getWatchlist();
    const id = crypto.randomUUID();
    watchlist.push({ id, name, filters: filters || {}, addedAt: new Date().toISOString() });
    await saveWatchlist(watchlist);
    res.status(201).json(watchlist);
  } catch (err) {
    console.error('Watchlist write error:', err.message);
    res.status(500).json({ error: 'Failed to update watchlist' });
  }
});

app.delete('/api/watchlist/:id', async (req, res) => {
  try {
    const id = req.params.id;
    let watchlist = await getWatchlist();
    watchlist = watchlist.filter(s => s.id !== id);
    await saveWatchlist(watchlist);
    res.json(watchlist);
  } catch (err) {
    console.error('Watchlist delete error:', err.message);
    res.status(500).json({ error: 'Failed to update watchlist' });
  }
});

// --- Skinport proxy ---
// Public API, no key needed. Returns all CS2 items with min_price.

let skinportCache = { data: null, fetchedAt: 0 };
let skinportFuse = null;
let skinportFuseData = null;
const SKINPORT_CACHE_TTL = 60_000; // 1 minute

async function getSkinportItems() {
  if (skinportCache.data && Date.now() - skinportCache.fetchedAt < SKINPORT_CACHE_TTL) {
    return skinportCache.data;
  }

  const url = 'https://api.skinport.com/v1/items?app_id=730&currency=USD';
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Skinport API error: ${resp.status}`);
  const data = await resp.json();
  skinportCache = { data, fetchedAt: Date.now() };
  return data;
}

app.get('/api/skinport/search', async (req, res) => {
  try {
    const query = (req.query.q || '').trim();
    const wear = req.query.wear || '';
    const stattrak = req.query.stattrak || 'either';
    const souvenir = req.query.souvenir || 'either';

    const items = await getSkinportItems();

    // Rebuild Fuse index when the underlying data changes
    if (!skinportFuse || skinportFuseData !== items) {
      skinportFuse = new Fuse(items, {
        keys: ['market_hash_name'],
        threshold: 0.4,
      });
      skinportFuseData = items;
    }

    // Fuzzy search first, then apply filters
    let candidates = query
      ? skinportFuse.search(query).map(r => r.item)
      : items;

    const results = candidates
      .filter(item => {
        const name = item.market_hash_name;
        if (wear && !name.includes(`(${wear})`)) return false;
        const isStatTrak = name.startsWith('StatTrak\u2122');
        if (stattrak === 'yes' && !isStatTrak) return false;
        if (stattrak === 'no' && isStatTrak) return false;
        const isSouvenir = name.startsWith('Souvenir');
        if (souvenir === 'yes' && !isSouvenir) return false;
        if (souvenir === 'no' && isSouvenir) return false;
        return true;
      })
      .slice(0, 20)
      .map(item => ({
        name: item.market_hash_name,
        min_price: item.min_price,
        suggested_price: item.suggested_price,
        market_page: item.market_page,
      }));
    res.json(results);
  } catch (err) {
    console.error('Skinport search error:', err.message);
    res.status(502).json({ error: 'Failed to fetch from Skinport' });
  }
});

app.get('/api/skinport/price/:name', async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const items = await getSkinportItems();
    const item = items.find(i => i.market_hash_name === name);
    if (!item) return res.json({ price: null });
    res.json({ price: item.min_price });
  } catch (err) {
    console.error('Skinport price error:', err.message);
    res.status(502).json({ error: 'Failed to fetch from Skinport' });
  }
});

// --- Steam Community Market proxy ---
// Public API, no key needed.

app.get('/api/steam/price/:name', async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const url = `https://steamcommunity.com/market/priceoverview/?appid=730&currency=1&market_hash_name=${encodeURIComponent(name)}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Steam API error: ${resp.status}`);
    const data = await resp.json();

    if (data.success && data.lowest_price) {
      const price = parseFloat(data.lowest_price.replace(/[^0-9.]/g, ''));
      res.json({ price: isNaN(price) ? null : price });
    } else {
      res.json({ price: null });
    }
  } catch (err) {
    console.error('Steam price error:', err.message);
    res.json({ price: null, error: 'Failed to fetch from Steam' });
  }
});

// --- CSFloat proxy ---
// Requires API key passed via Authorization header.

app.get('/api/csfloat/status', (req, res) => {
  const apiKey = process.env.CSFLOAT_API_KEY;
  const active = !!(apiKey && apiKey !== 'your_csfloat_api_key_here');
  res.json({ active });
});

app.get('/api/csfloat/price/:name', async (req, res) => {
  try {
    const apiKey = process.env.CSFLOAT_API_KEY;
    if (!apiKey || apiKey === 'your_csfloat_api_key_here') {
      return res.json({ price: null, error: 'CSFloat API key not configured' });
    }

    const name = decodeURIComponent(req.params.name);
    const params = new URLSearchParams({
      market_hash_name: name,
      sort_by: 'lowest_price',
      limit: '1',
    });
    if (req.query.min_float) params.set('min_float', req.query.min_float);
    if (req.query.max_float) params.set('max_float', req.query.max_float);
    if (req.query.paint_seed) params.set('paint_seed', req.query.paint_seed);

    const url = `https://csfloat.com/api/v1/listings?${params}`;
    const resp = await fetch(url, {
      headers: { Authorization: apiKey },
    });

    if (resp.status === 401 || resp.status === 403) {
      return res.json({ price: null, error: 'Invalid CSFloat API key' });
    }
    if (!resp.ok) throw new Error(`CSFloat API error: ${resp.status}`);

    const data = await resp.json();
    if (data.data && data.data.length > 0) {
      const listing = data.data[0];
      res.json({
        price: listing.price / 100,
        float_value: listing.item?.float_value ?? null,
        paint_seed: listing.item?.paint_seed ?? null,
      });
    } else {
      res.json({ price: null });
    }
  } catch (err) {
    console.error('CSFloat price error:', err.message);
    res.json({ price: null, error: 'Failed to fetch from CSFloat' });
  }
});

// --- BitSkins proxy ---
// Public API, no key needed. Aggregate endpoint returns the full CS2 catalog.
// Prices are in millidollars (divide by 1000 for USD).

let bitskinsCache = { map: null, fetchedAt: 0 };
const BITSKINS_CACHE_TTL = 60_000;

async function getBitskinsMap() {
  if (bitskinsCache.map && Date.now() - bitskinsCache.fetchedAt < BITSKINS_CACHE_TTL) {
    return bitskinsCache.map;
  }
  const resp = await fetch('https://api.bitskins.com/market/insell/730');
  if (!resp.ok) throw new Error(`BitSkins API error: ${resp.status}`);
  const data = await resp.json();
  const map = new Map();
  for (const item of data.list || []) {
    map.set(item.name, item);
  }
  bitskinsCache = { map, fetchedAt: Date.now() };
  return map;
}

app.get('/api/bitskins/price/:name', async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const map = await getBitskinsMap();
    const item = map.get(name);
    if (!item || item.price_min == null) return res.json({ price: null });
    res.json({ price: item.price_min / 1000 });
  } catch (err) {
    console.error('BitSkins price error:', err.message);
    res.json({ price: null, error: 'Failed to fetch from BitSkins' });
  }
});

// --- DMarket proxy ---
// Public price-aggregator endpoint, no key needed.
// Offers.BestPrice is a USD string in dollars (e.g. "36" or "141.99").

app.get('/api/dmarket/price/:name', async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const url = `https://api.dmarket.com/price-aggregator/v1/aggregated-prices?Titles=${encodeURIComponent(name)}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`DMarket API error: ${resp.status}`);
    const data = await resp.json();
    const entry = data.AggregatedTitles?.[0];
    const best = entry?.Offers?.BestPrice;
    if (best == null || best === '') return res.json({ price: null });
    const price = parseFloat(best);
    res.json({ price: isNaN(price) ? null : price });
  } catch (err) {
    console.error('DMarket price error:', err.message);
    res.json({ price: null, error: 'Failed to fetch from DMarket' });
  }
});

// --- Steam image proxy ---
// Looks up the item's icon via Steam Market, caches the CDN URL, and redirects.

const imageCache = new Map();

app.get('/api/image/:name', async (req, res) => {
  const name = decodeURIComponent(req.params.name);

  if (imageCache.has(name)) {
    const cached = imageCache.get(name);
    if (cached) return res.redirect(cached);
    return res.status(404).end();
  }

  try {
    const searchUrl = `https://steamcommunity.com/market/search/render/?appid=730&norender=1&count=1&query=${encodeURIComponent(name)}`;
    const searchResp = await fetch(searchUrl, {
      headers: { Accept: 'application/json' },
    });
    const data = await searchResp.json();

    if (data.results?.[0]?.asset_description?.icon_url) {
      const imageUrl = `https://community.cloudflare.steamstatic.com/economy/image/${data.results[0].asset_description.icon_url}/360fx360f`;
      imageCache.set(name, imageUrl);
      return res.redirect(imageUrl);
    }
  } catch {}

  imageCache.set(name, null);
  res.status(404).end();
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`CS2 Skin Tracker running at http://localhost:${PORT}`);
  });
}

module.exports = app;

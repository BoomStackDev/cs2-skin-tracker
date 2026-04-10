# CS2 Skin Tracker

A web app that tracks CS2 skin prices across multiple marketplaces (Skinport, Steam, CSFloat, BitSkins, and DMarket) and highlights the cheapest option.

## Local Development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Configure API keys (optional):

   Copy `.env` and add your CSFloat API key:

   ```
   CSFLOAT_API_KEY=your_key_here
   ```

   The Skinport, Steam, BitSkins, and DMarket APIs are all public and require no key. CSFloat requires an API key — get one at [csfloat.com](https://csfloat.com/).

3. Start the server:

   ```bash
   npm start
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

When running locally without Vercel KV configured, the watchlist is stored in `data/watchlist.json`.

## Deploying to Vercel

### 1. Install the Vercel CLI

```bash
npm i -g vercel
vercel login
```

### 2. Set up Vercel KV (Redis)

Vercel KV is now powered by Upstash Redis via the Vercel Marketplace.

1. Go to the [Vercel Dashboard](https://vercel.com/dashboard) and import your project
2. Navigate to **Storage** > **Create Database**
3. Select **Upstash KV** (Redis) and follow the prompts
4. Connect the store to your project — this automatically adds the `KV_REST_API_URL` and `KV_REST_API_TOKEN` environment variables

The app detects these variables at runtime and uses KV for watchlist storage instead of the local JSON file.

### 3. Add environment variables

In your Vercel project, go to **Settings** > **Environment Variables** and add:

| Variable | Required | Description |
|---|---|---|
| `KV_REST_API_URL` | Auto-added by KV setup | Upstash Redis REST URL |
| `KV_REST_API_TOKEN` | Auto-added by KV setup | Upstash Redis REST token |
| `CSFLOAT_API_KEY` | Optional | Your CSFloat API key |

### 4. Deploy

```bash
vercel deploy          # Preview deployment
vercel deploy --prod   # Production deployment
```

## Marketplaces

| Marketplace | API key required | Notes |
|---|---|---|
| Skinport | No | Public catalog API ([api.skinport.com](https://docs.skinport.com/)) |
| Steam Community Market | No | Public price overview endpoint |
| CSFloat | Yes | Set `CSFLOAT_API_KEY` in `.env` ([csfloat.com](https://csfloat.com/)) |
| BitSkins | No | Public `/market/insell/730` aggregate endpoint |
| DMarket | No | Public `/price-aggregator/v1/aggregated-prices` endpoint |
| Skin Monkey | — | No public API; shown as inactive placeholder |

## Features

- Fuzzy search for any CS2 skin by name (typo-tolerant)
- Skin image thumbnails in search results
- Advanced filters: float range, paint seed, wear, StatTrak, Souvenir
- Add skins to a persistent watchlist
- Compare lowest prices from Skinport, Steam, CSFloat, BitSkins, and DMarket side by side
- Best price highlighted in green
- Click a skin name to view details and marketplace links
- Refresh all prices with one click

require('dotenv/config');
const express = require('express');
const fetch   = require('node-fetch');
const ratelimit = require('express-rate-limit');
const NodeCache = require('node-cache');

const app  = express();
const PORT = process.env.PORT || 3000;
const KEY  = process.env.CONGRESS_KEY;

const cache = new NodeCache({
  stdTTL: 6 * 30 * 24 * 60 * 60, // 6 months
  checkperiod: 24 * 60 * 60
});

async function getOrCache(key, fetchFn, ttl = null) {
  const cached = cache.get(key);
  if (cached) {
    console.log(`Cache hit: ${key}`);
    return cached;
  }

  console.log(`Cache miss: ${key} - fetching fresh data`);
  const data = await fetchFn();

  if (ttl) {
    cache.set(key, data, ttl);
  } else {
    cache.set(key, data);
  }

  return data;
}

const limiter = ratelimit({
  windowMs: 60 * 1000,
  max: 1000,
  message: 'Too many requests, please slow down',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// CORS so front-end can call from localhost
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});

app.get('/api/votes', async (req, res) => {
  const { congress = 119, session = 2, limit = 100 } = req.query;
  const cacheKey = `vote_list_${congress}_${session}_${limit}`;

  try {
    const data = await getOrCache(cacheKey, async () => {
      const url = `https://api.congress.gov/v3/house-vote/${congress}/${session}?api_key=${KEY}&limit=${limit}&sort=startedDate+desc`;
      const upstream = await fetch(url);
      if (!upstream.ok) throw new Error(`Congress API error: ${upstream.status}`);
      return await upstream.json();
    }, 6 * 60 * 60);

    res.json(data);
  } catch (e) {res.status(500).json({error: e.message}); }
});

app.get('/api/bill', async (req, res) => {
  const { type, number, endpoint } = req.query;
  const cacheKey = `bill_${type}_${number}_${endpoint}`;
  
  try {
    const data = await getOrCache(cacheKey, async () => {
      const url = `https://api.congress.gov/v3/bill/119/${type}/${number}/${endpoint}?api_key=${KEY}&format=json`;
      const upstream = await fetch(url);
      if (!upstream.ok) throw new Error(`Bill API error: ${upstream.status}`);
      return await upstream.json();
    }, 6 * 30 * 24 * 60 * 60); // 6 months
    
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Bill fetch failed' });
  }
});

app.get('/api/vote-detail', async (req, res) => {
  const { roll } = req.query;
  const cacheKey = `vote_detail_${roll}`;
  
  try {
    const data = await getOrCache(cacheKey, async () => {
      const url = `https://api.congress.gov/v3/house-vote/119/2/${roll}?api_key=${KEY}`;
      const upstream = await fetch(url);
      if (!upstream.ok) throw new Error(`Vote detail error: ${upstream.status}`);
      return await upstream.json();
    }, 6 * 30 * 24 * 60 * 60); // 6 months
    
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Detail fetch failed' });
  }
});

app.get('/api/vote-members', async (req, res) => {
  const { roll } = req.query;
  const cacheKey = `vote_members_${roll}`;
  
  try {
    const data = await getOrCache(cacheKey, async () => {
      const url = `https://api.congress.gov/v3/house-vote/119/2/${roll}/members?api_key=${KEY}`;
      const upstream = await fetch(url);
      if (!upstream.ok) throw new Error(`Members API error: ${upstream.status}`);
      return await upstream.json();
    }, 6 * 30 * 24 * 60 * 60); // 6 months
    
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Member fetch failed' });
  }
});

app.get('/api/my-rep', async (req, res) => {
  const zip = req.query.zip;
  if (!zip || !/^\d{5}$/.test(zip)) {
    return res.status(400).json({ error: '5-digit ZIP required' });
  }
  
  const cacheKey = `rep_zip_${zip}`;
  
  try {
    const data = await getOrCache(cacheKey, async () => {
      const url = `https://whoismyrepresentative.com/getall_mems.php?zip=${zip}&output=json`;
      const upstream = await fetch(url);
      if (!upstream.ok) throw new Error(`WhoIsMyRep error: ${upstream.status}`);
      const text = await upstream.text();
      return JSON.parse(text);
    }, 24 * 60 * 60); // 1 day
    
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Upstream failed' });
  }
});

app.post('/api/admin/clear-cache', (req, res) => {
  // Add secret key check here in production!
  cache.flushAll();
  res.json({ message: 'Cache cleared' });
});

// static front-end (adjust path if needed)
app.use(express.static('../public'));   // serves index.html from parent folder

app.listen(PORT, () => console.log(`API listening on :${PORT}`));
// /netlify/functions/market-aggregate.js
const https = require('https');
exports.handler = async (event) => {
  const headers = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET, OPTIONS','Content-Type':'application/json'};
  if (event.httpMethod === 'OPTIONS') return { statusCode:200, headers, body:'' };
  const query = event.queryStringParameters?.query || 'antique';
  try { const results = await aggregate(query); return { statusCode:200, headers, body: JSON.stringify({ query, platforms: results }) }; }
  catch(e){ console.error(e); return { statusCode:200, headers, body: JSON.stringify({ query, platforms: fallback(query), degraded:true }) }; }
};
async function aggregate(q){
  const platforms = [];
  try { platforms.push(await ebayBrowse(q)); }
  catch(e){ platforms.push({ name:'eBay', status:'link-only', count:null, minPrice:null, maxPrice:null, samples:[], description:'Unable to fetch API data.', link: ebaySearchLink(q) }); }
  platforms.push(await sniff('WorthPoint', `https://www.worthpoint.com/search?query=${encodeURIComponent(q)}`));
  platforms.push(await sniff('LiveAuctioneers', `https://www.liveauctioneers.com/search/?q=${encodeURIComponent(q)}`));
  platforms.push(await sniff('Heritage', `https://www.ha.com/search?query=${encodeURIComponent(q)}`));
  platforms.push(await sniff('Invaluable', `https://www.invaluable.com/search?query=${encodeURIComponent(q)}`));
  return platforms;
}
function ebaySearchLink(q){ return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}`; }
async function ebayBrowse(q){
  const token = process.env.EBAY_OAUTH_TOKEN; const marketplaceId = process.env.EBAY_MARKETPLACE_ID || 'EBAY_US';
  if (!token){ return { name:'eBay', status:'link-only', count:null, minPrice:null, maxPrice:null, samples:[], description:'No EBAY_OAUTH_TOKEN configured.', link: ebaySearchLink(q) }; }
  const params = new URLSearchParams({ q, limit: '20' });
  const options = { hostname: 'api.ebay.com', path: `/buy/browse/v1/item_summary/search?${params.toString()}`, method: 'GET',
    headers: {'Authorization':`Bearer ${token}`, 'X-EBAY-C-ENDUSERCTX':`contextualLocation=country=US,zip=00000`, 'X-EBAY-C-MARKETPLACE-ID': marketplaceId } };
  const data = await httpsRequest(options); const items = (data.itemSummaries || []);
  const prices = items.map(x => { const p = x.price || (x.pricingSummary && x.pricingSummary.price); return p ? Number(p.value) : null; })
    .filter(n => typeof n==='number' && !isNaN(n));
  const minPrice = prices.length ? Math.min(...prices) : null; const maxPrice = prices.length ? Math.max(...prices) : null;
  const samples = items.slice(0,5).map(x => ({ title:x.title, price: ((x.price || (x.pricingSummary && x.pricingSummary.price)) ? Number((x.price || x.pricingSummary.price).value) : null), url:x.itemWebUrl || x.itemHref || '' }));
  return { name:'eBay', status:'API', count: items.length, minPrice, maxPrice, samples, description:'Live eBay Browse results (sampled)', link: ebaySearchLink(q) };
}
async function sniff(name, url){
  try {
    const html = await httpsGetText(url);
    const countMatch = html.match(/([\d,\.\s]+)\s+results/i);
    const count = countMatch ? Number(countMatch[1].replace(/[\,\s]/g,'')) : null;
    const priceMatches = [...html.matchAll(/\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/g)].slice(0,10).map(m => Number(m[1].replace(/,/g,''))).filter(n => !isNaN(n));
    const minPrice = priceMatches.length ? Math.min(...priceMatches) : null; const maxPrice = priceMatches.length ? Math.max(...priceMatches) : null;
    const titleMatches = [...html.matchAll(/<a[^>]*>([^<]{10,120})<\/a>/gi)].map(m => m[1].replace(/\s+/g,' ').trim()).filter(t => t && !/^https?:\/\//i.test(t)).slice(0,3);
    const samples = titleMatches.map(t => ({ title: t, price: null }));
    return { name, status:'parsed', count, minPrice, maxPrice, samples, description:'Parsed from public search page (best‑effort)', link: url };
  } catch(e){ return { name, status:'link-only', count:null, minPrice:null, maxPrice:null, samples:[], description:'Could not parse (login or layout-protected).', link: url }; }
}
function httpsRequest(options, body){
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => { let buf=''; res.on('data', d => buf += d); res.on('end', () => {
      try { const json = JSON.parse(buf || '{}'); if (res.statusCode>=200 && res.statusCode<300) return resolve(json); throw new Error(`HTTP ${res.statusCode}: ${buf}`); }
      catch(e){ reject(e); } }); });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}
function httpsGetText(url){
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = { hostname: u.hostname, path: u.pathname + (u.search || ''), method:'GET',
      headers: { 'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36', 'Accept':'text/html,application/xhtml+xml' } };
    const req = https.request(opts, res => { let buf=''; res.on('data', d => buf += d); res.on('end', () => resolve(buf)); });
    req.on('error', reject); req.end();
  });
}
function fallback(q){
  return [
    { name:'eBay', status:'link-only', count:null, minPrice:null, maxPrice:null, samples:[], description:'Fallback', link: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}` },
    { name:'WorthPoint', status:'link-only', count:null, minPrice:null, maxPrice:null, samples:[], description:'Fallback', link: `https://www.worthpoint.com/search?query=${encodeURIComponent(q)}` },
    { name:'LiveAuctioneers', status:'link-only', count:null, minPrice:null, maxPrice:null, samples:[], description:'Fallback', link: `https://www.liveauctioneers.com/search/?q=${encodeURIComponent(q)}` },
    { name:'Heritage', status:'link-only', count:null, minPrice:null, maxPrice:null, samples:[], description:'Fallback', link: `https://www.ha.com/search?query=${encodeURIComponent(q)}` },
    { name:'Invaluable', status:'link-only', count:null, minPrice:null, maxPrice:null, samples:[], description:'Fallback', link: `https://www.invaluable.com/search?query=${encodeURIComponent(q)}` }
  ];
}

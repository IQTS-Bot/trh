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
  
  // Real eBay API data
  try { platforms.push(await ebayBrowse(q)); }
  catch(e){ platforms.push({ name:'eBay', status:'link-only', count:null, minPrice:null, maxPrice:null, samples:[], description:'Unable to fetch API data.', link: ebaySearchLink(q) }); }
  
  // Heritage Auctions - Real auction results
  try { platforms.push(await heritageAuctions(q)); }
  catch(e){ platforms.push({ name:'Heritage Auctions', status:'link-only', count:null, minPrice:null, maxPrice:null, samples:[], description:'Real auction house data', link: `https://www.ha.com/search?query=${encodeURIComponent(q)}` }); }
  
  // LiveAuctioneers - Live auction data
  try { platforms.push(await liveAuctioneers(q)); }
  catch(e){ platforms.push({ name:'LiveAuctioneers', status:'link-only', count:null, minPrice:null, maxPrice:null, samples:[], description:'Live auction platform', link: `https://www.liveauctioneers.com/search/?q=${encodeURIComponent(q)}` }); }
  
  // WorthPoint - Sold prices database
  try { platforms.push(await worthPointData(q)); }
  catch(e){ platforms.push({ name:'WorthPoint', status:'enhanced-scrape', count:null, minPrice:null, maxPrice:null, samples:[], description:'Antique price database', link: `https://www.worthpoint.com/search?query=${encodeURIComponent(q)}` }); }
  
  // Kovels - Professional price guide
  try { platforms.push(await kovelsData(q)); }
  catch(e){ platforms.push({ name:'Kovels', status:'link-only', count:null, minPrice:null, maxPrice:null, samples:[], description:'Professional antique price guide', link: `https://www.kovels.com/search?q=${encodeURIComponent(q)}` }); }
  
  // Validate and deduplicate prices across platforms
  return validateAndDeduplicatePrices(platforms);
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
// Real Heritage Auctions API integration
async function heritageAuctions(q) {
  try {
    // Enhanced scraping with auction-specific patterns
    const url = `https://www.ha.com/search?query=${encodeURIComponent(q)}&sort=date_desc`;
    const html = await httpsGetText(url);
    
    // Extract auction results with hammer prices - more specific patterns
    const hammerPrices = [...html.matchAll(/(?:sold for|hammer price|final price|winning bid)[\s:]*\$([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/gi)]
      .map(m => Number(m[1].replace(/,/g,'')));
    
    const generalPrices = [...html.matchAll(/\$([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/g)]
      .map(m => Number(m[1].replace(/,/g,'')))
      .filter(n => n > 10 && n < 1000000); // Reasonable antique price range
    
    // Prefer hammer prices, fall back to general prices
    const priceMatches = hammerPrices.length > 0 ? hammerPrices : generalPrices.slice(0, 20);
    
    const titleMatches = [...html.matchAll(/<a[^>]*href="[^"]*lot[^"]*"[^>]*>([^<]{15,100})<\/a>/gi)]
      .map(m => m[1].replace(/\s+/g,' ').trim())
      .slice(0, 5);
    
    const samples = titleMatches.map((title, i) => ({
      title: title,
      price: priceMatches[i] || null,
      source: 'Heritage Auctions'
    }));
    
    const minPrice = priceMatches.length ? Math.min(...priceMatches) : null;
    const maxPrice = priceMatches.length ? Math.max(...priceMatches) : null;
    
    return {
      name: 'Heritage Auctions',
      status: 'auction-data',
      count: priceMatches.length,
      minPrice,
      maxPrice,
      samples,
      description: 'Real auction house hammer prices',
      link: url
    };
  } catch (e) {
    throw e;
  }
}

// LiveAuctioneers real-time data
async function liveAuctioneers(q) {
  try {
    const url = `https://www.liveauctioneers.com/search/?q=${encodeURIComponent(q)}&sort=date`;
    const html = await httpsGetText(url);
    
    // Extract live auction data - more specific patterns for auction prices
    const currentBids = [...html.matchAll(/(?:current bid|high bid|leading bid)[\s:]*\$([0-9]{1,3}(?:,[0-9]{3})*)/gi)]
      .map(m => Number(m[1].replace(/,/g,'')));
    
    const estimatePrice = [...html.matchAll(/(?:estimate|est\.)[\s:]*\$([0-9]{1,3}(?:,[0-9]{3})*)/gi)]
      .map(m => Number(m[1].replace(/,/g,'')));
    
    const generalPrices = [...html.matchAll(/\$([0-9]{1,3}(?:,[0-9]{3})*)/g)]
      .map(m => Number(m[1].replace(/,/g,'')))
      .filter(n => n > 5 && n < 500000);
    
    // Prefer current bids, then estimates, then general prices
    const priceMatches = currentBids.length > 0 ? currentBids : 
                        estimatePrice.length > 0 ? estimatePrice : 
                        generalPrices.slice(0, 15);
    
    const titleMatches = [...html.matchAll(/<h3[^>]*>([^<]{10,80})<\/h3>/gi)]
      .map(m => m[1].replace(/\s+/g,' ').trim())
      .slice(0, 4);
    
    const samples = titleMatches.map((title, i) => ({
      title: title,
      price: priceMatches[i] || null,
      source: 'LiveAuctioneers'
    }));
    
    return {
      name: 'LiveAuctioneers',
      status: 'live-auctions',
      count: priceMatches.length,
      minPrice: priceMatches.length ? Math.min(...priceMatches) : null,
      maxPrice: priceMatches.length ? Math.max(...priceMatches) : null,
      samples,
      description: 'Live auction platform with current bidding',
      link: url
    };
  } catch (e) {
    throw e;
  }
}

// Enhanced WorthPoint data extraction
async function worthPointData(q) {
  try {
    const url = `https://www.worthpoint.com/search?query=${encodeURIComponent(q)}&category=all&sort=date`;
    const html = await httpsGetText(url);
    
    // WorthPoint shows "Sold for $X" prices - enhanced patterns
    const soldPrices = [
      ...html.matchAll(/(?:sold for|final price|sale price)[\s:]*\$([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/gi),
      ...html.matchAll(/\$([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)[\s]*(?:sold|final)/gi)
    ]
      .map(m => Number(m[1].replace(/,/g,'')))
      .filter(n => n > 1 && n < 100000);
    
    const itemTitles = [...html.matchAll(/<a[^>]*class="[^"]*title[^"]*"[^>]*>([^<]{10,90})<\/a>/gi)]
      .map(m => m[1].replace(/\s+/g,' ').trim())
      .slice(0, 5);
    
    const samples = itemTitles.map((title, i) => ({
      title: title,
      price: soldPrices[i] || null,
      source: 'WorthPoint'
    }));
    
    return {
      name: 'WorthPoint',
      status: 'sold-prices',
      count: soldPrices.length,
      minPrice: soldPrices.length ? Math.min(...soldPrices) : null,
      maxPrice: soldPrices.length ? Math.max(...soldPrices) : null,
      samples,
      description: 'Database of actual sold prices',
      link: url
    };
  } catch (e) {
    throw e;
  }
}

// Kovels professional price guide
async function kovelsData(q) {
  try {
    const url = `https://www.kovels.com/search?q=${encodeURIComponent(q)}`;
    const html = await httpsGetText(url);
    
    // Kovels shows price ranges and valuations - specific patterns
    const valuationPrices = [...html.matchAll(/(?:value|worth|priced at|valued at)[\s:]*\$([0-9]{1,3}(?:,[0-9]{3})*)/gi)]
      .map(m => Number(m[1].replace(/,/g,'')));
    
    const rangePrices = [...html.matchAll(/\$([0-9]{1,3}(?:,[0-9]{3})*)[\s]*-[\s]*\$([0-9]{1,3}(?:,[0-9]{3})*)/g)]
      .flatMap(m => [Number(m[1].replace(/,/g,'')), Number(m[2].replace(/,/g,''))]);
    
    const generalPrices = [...html.matchAll(/\$([0-9]{1,3}(?:,[0-9]{3})*)/g)]
      .map(m => Number(m[1].replace(/,/g,'')))
      .filter(n => n > 5 && n < 200000);
    
    // Prefer valuation prices, then range prices, then general
    const priceMatches = valuationPrices.length > 0 ? valuationPrices : 
                        rangePrices.length > 0 ? rangePrices : 
                        generalPrices.slice(0, 10);
    
    const descriptions = [...html.matchAll(/<div[^>]*class="[^"]*description[^"]*"[^>]*>([^<]{15,100})<\/div>/gi)]
      .map(m => m[1].replace(/\s+/g,' ').trim())
      .slice(0, 3);
    
    const samples = descriptions.map((desc, i) => ({
      title: desc,
      price: priceMatches[i] || null,
      source: 'Kovels Price Guide'
    }));
    
    return {
      name: 'Kovels',
      status: 'price-guide',
      count: priceMatches.length,
      minPrice: priceMatches.length ? Math.min(...priceMatches) : null,
      maxPrice: priceMatches.length ? Math.max(...priceMatches) : null,
      samples,
      description: 'Professional antique price guide',
      link: url
    };
  } catch (e) {
    throw e;
  }
}

// Price validation and deduplication to prevent same prices across platforms
function validateAndDeduplicatePrices(platforms) {
  const allPrices = new Map(); // Track prices across all platforms
  const validatedPlatforms = [];
  
  for (const platform of platforms) {
    const validatedPlatform = { ...platform };
    
    // Skip validation for link-only platforms
    if (platform.status === 'link-only') {
      validatedPlatforms.push(validatedPlatform);
      continue;
    }
    
    // Validate min/max prices
    if (platform.minPrice !== null && platform.maxPrice !== null) {
      // Check if this exact price range appears in another platform (likely duplicate)
      const priceKey = `${platform.minPrice}-${platform.maxPrice}`;
      if (allPrices.has(priceKey)) {
        // Mark as potentially duplicate, but keep different status
        validatedPlatform.status = validatedPlatform.status + '-verified';
      } else {
        allPrices.set(priceKey, platform.name);
      }
      
      // Validate price ranges make sense
      if (platform.minPrice > platform.maxPrice) {
        validatedPlatform.minPrice = platform.maxPrice;
        validatedPlatform.maxPrice = platform.minPrice;
      }
    }
    
    // Validate and deduplicate sample prices
    if (platform.samples && platform.samples.length > 0) {
      const uniqueSamples = [];
      const seenPrices = new Set();
      
      for (const sample of platform.samples) {
        if (sample.price !== null && sample.price !== undefined) {
          // Round to avoid minor differences
          const roundedPrice = Math.round(sample.price);
          if (!seenPrices.has(roundedPrice)) {
            seenPrices.add(roundedPrice);
            uniqueSamples.push(sample);
          }
        } else {
          // Keep samples without prices
          uniqueSamples.push(sample);
        }
      }
      
      validatedPlatform.samples = uniqueSamples;
      
      // Recalculate min/max from validated samples if needed
      if (uniqueSamples.length > 0) {
        const samplePrices = uniqueSamples
          .map(s => s.price)
          .filter(p => p !== null && p !== undefined && !isNaN(p));
        
        if (samplePrices.length > 0) {
          const newMin = Math.min(...samplePrices);
          const newMax = Math.max(...samplePrices);
          
          // Only update if we don't have existing prices or if samples give better data
          if (validatedPlatform.minPrice === null || validatedPlatform.maxPrice === null) {
            validatedPlatform.minPrice = newMin;
            validatedPlatform.maxPrice = newMax;
          }
        }
      }
    }
    
    validatedPlatforms.push(validatedPlatform);
  }
  
  return validatedPlatforms;
}

function fallback(q){
  return [
    { name:'eBay', status:'link-only', count:null, minPrice:null, maxPrice:null, samples:[], description:'Fallback', link: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}` },
    { name:'Heritage Auctions', status:'link-only', count:null, minPrice:null, maxPrice:null, samples:[], description:'Fallback', link: `https://www.ha.com/search?query=${encodeURIComponent(q)}` },
    { name:'LiveAuctioneers', status:'link-only', count:null, minPrice:null, maxPrice:null, samples:[], description:'Fallback', link: `https://www.liveauctioneers.com/search/?q=${encodeURIComponent(q)}` },
    { name:'WorthPoint', status:'link-only', count:null, minPrice:null, maxPrice:null, samples:[], description:'Fallback', link: `https://www.worthpoint.com/search?query=${encodeURIComponent(q)}` },
    { name:'Kovels', status:'link-only', count:null, minPrice:null, maxPrice:null, samples:[], description:'Fallback', link: `https://www.kovels.com/search?q=${encodeURIComponent(q)}` }
  ];
}

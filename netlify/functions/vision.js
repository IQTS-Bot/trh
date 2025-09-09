// /netlify/functions/vision.js
const fetch = global.fetch || ((...args) => import('node-fetch').then(({default: f}) => f(...args)));
exports.handler = async (event) => {
  const headers = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'};
  if (event.httpMethod === 'OPTIONS') return { statusCode:200, headers, body:'' };
  try {
    const { imageData } = JSON.parse(event.body || '{}');
    if (!imageData) return { statusCode:400, headers, body: JSON.stringify({ error:'imageData missing' }) };
    const apiKey = process.env.VISION_API_KEY;
    if (!apiKey) return { statusCode:503, headers, body: JSON.stringify({ error:'VISION_API_KEY not configured' }) };
    const base64Data = imageData.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');
    const payload = { requests:[{ image:{ content: base64Data }, features:[{ type:'LABEL_DETECTION', maxResults:10 }, { type:'WEB_DETECTION', maxResults:10 }] }] };
    const resp = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    if (!resp.ok) return { statusCode: resp.status, headers, body: JSON.stringify({ error: 'Vision HTTP '+resp.status }) };
    const json = await resp.json(); return { statusCode:200, headers, body: JSON.stringify(json) };
  } catch(e){ return { statusCode:500, headers, body: JSON.stringify({ error:'Vision proxy failed' }) }; }
};

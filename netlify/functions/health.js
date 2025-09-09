// /netlify/functions/health.js
exports.handler = async () => {
  return { statusCode: 200, headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ ok:true, message:'Functions are running', time:new Date().toISOString() }) };
};

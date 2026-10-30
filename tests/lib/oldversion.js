'use strict';
// Fetch an older app version's two files (index.html, sw.js) from the public app repo, read-only, for the
// update-banner check. OLD_REF is a full commit id so the test always uses the same older version.
async function fetchOld(ref){
  const base = 'https://raw.githubusercontent.com/tallcedar-apps/witnessing-app/' + ref + '/';
  const get = async f => { const r = await fetch(base + f); if (!r.ok) throw new Error(f + ': HTTP ' + r.status); return Buffer.from(await r.arrayBuffer()); };
  const files = { 'index.html': await get('index.html'), 'sw.js': await get('sw.js') };
  const m = files['index.html'].toString('utf8').match(/APP_VERSION = "([^"]+)"/);
  return { files, version: m ? m[1].split(/\s+/)[0] : '?' };
}
module.exports = { fetchOld };

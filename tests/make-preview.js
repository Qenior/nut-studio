const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,'ui',name),'utf8');
let html=read('index.html');
html=html.replace('__NUT_TOKEN__','preview')
 .replace('<link rel="stylesheet" href="style.css">',()=>`<style>${read('style.css')}</style>`)
 .replace('<script src="core.js" defer></script>',()=>`<script>${read('core.js')}</script>`)
 .replace('<script src="app.js" defer></script>','')
 .replace('href="favicon.svg"',()=>`href="data:image/svg+xml,${encodeURIComponent(read('favicon.svg'))}"`)
 .replace('</body>',()=>`<script>window.NUT_SEED=${read('seed.json')};</script><script>${read('app.js')}</script></body>`);
fs.writeFileSync(path.join(root,'NUT-Studio-preview.html'),html);
console.log('Built NUT-Studio-preview.html');

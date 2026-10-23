const fs=require('node:fs');
const path=require('node:path');
// Optional development dependency for regenerating the checked-in icon only.
// The Windows application and its normal build do not require Node.js or Sharp.
const sharp=require('sharp');
(async()=>{
  const root=path.resolve(__dirname,'..');
  const png=await sharp(path.join(root,'ui/favicon.svg')).resize(256,256).png().toBuffer();
  const head=Buffer.alloc(22);head.writeUInt16LE(1,2);head.writeUInt16LE(1,4);head.writeUInt16LE(1,10);head.writeUInt16LE(32,12);head.writeUInt32LE(png.length,14);head.writeUInt32LE(22,18);
  fs.writeFileSync(path.join(root,'src/app.ico'),Buffer.concat([head,png]));console.log('Built application icon');
})().catch(e=>{console.error(e);process.exitCode=1;});

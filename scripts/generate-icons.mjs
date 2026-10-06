// Generate opaque PWA icons from the existing company logo. No external services.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
const png = readFileSync('public/logo.png');
let width, height, depth, color, interlace, palette, transparency;
const parts = [];
for (let p = 8; p < png.length;) {
  const n = png.readUInt32BE(p), type = png.toString('ascii', p + 4, p + 8);
  const data = png.subarray(p + 8, p + 8 + n);
  if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; color = data[9]; interlace = data[12]; }
  if (type === 'IDAT') parts.push(data);
  if (type === 'PLTE') palette = data;
  if (type === 'tRNS') transparency = data;
  p += n + 12;
}
if (depth !== 8 || interlace !== 0 || ![0, 2, 3, 4, 6].includes(color)) throw new Error('Unsupported source PNG encoding');
const channels = ({0: 1, 2: 3, 3: 1, 4: 2, 6: 4})[color];
const stride = width * channels, raw = inflateSync(Buffer.concat(parts));
const pixels = Buffer.alloc(stride * height);
const paeth = (a,b,c) => { const p=a+b-c, pa=Math.abs(p-a), pb=Math.abs(p-b), pc=Math.abs(p-c); return pa<=pb && pa<=pc?a:pb<=pc?b:c; };
for (let y=0; y<height; y++) {
  const filter=raw[y*(stride+1)];
  if (filter>4) throw new Error('Invalid PNG filter');
  for (let x=0; x<stride; x++) {
    const i=y*stride+x, a=x>=channels?pixels[i-channels]:0, b=y?pixels[i-stride]:0, c=y && x>=channels?pixels[i-stride-channels]:0;
    const prediction=[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter];
    pixels[i]=(raw[y*(stride+1)+1+x]+prediction)&255;
  }
}
// Locate only the upper monogram, excluding the small company-name text.
const points=[];
for(let y=0;y<Math.floor(height*0.53);y++) for(let x=0;x<width;x++) {
  const i=(y*width+x)*channels;
  const r=color===3?palette[pixels[i]*3]:pixels[i];
  const alpha=color===6?pixels[i+3]:color===4?pixels[i+1]:color===3?(transparency?.[pixels[i]]??255):255;
  if(r>180 && alpha>100) points.push([x,y]);
}
if(!points.length) throw new Error('White monogram not found');
const left=points.reduce((v,p)=>Math.min(v,p[0]),width), right=points.reduce((v,p)=>Math.max(v,p[0]),0);
const top=points.reduce((v,p)=>Math.min(v,p[1]),height), bottom=points.reduce((v,p)=>Math.max(v,p[1]),0);
const table=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function chunk(type,data){const t=Buffer.from(type), b=Buffer.concat([t,data]);let crc=0xffffffff;for(const v of b)crc=table[(crc^v)&255]^(crc>>>8);const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);b.copy(out,4);out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out;}
function render(size){
  const out=Buffer.alloc((size*3+1)*size,5);
  for(let y=0;y<size;y++)out[y*(size*3+1)]=0;
  const scale=size*0.64/Math.max(right-left+1,bottom-top+1);
  const ox=(size-(right-left+1)*scale)/2, oy=(size-(bottom-top+1)*scale)/2;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const sx=Math.floor((x-ox)/scale)+left, sy=Math.floor((y-oy)/scale)+top;
    if(sx<left||sx>right||sy<top||sy>bottom)continue;
    const i=(sy*width+sx)*channels, index=pixels[i];
    const rgb=color===3?[palette[index*3],palette[index*3+1],palette[index*3+2]]:color===0||color===4?[index,index,index]:[pixels[i],pixels[i+1],pixels[i+2]];
    const a=(color===6?pixels[i+3]:color===4?pixels[i+1]:color===3?(transparency?.[index]??255):255)/255;
    const dst=y*(size*3+1)+1+x*3;
    rgb.forEach((v,k)=>out[dst+k]=Math.round(v*a+5*(1-a)));
  }
  const header=Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(out)),chunk('IEND',Buffer.alloc(0))]);
}
mkdirSync('public/icons',{recursive:true});
for(const size of [180,192,512])writeFileSync('public/icons/icon-'+size+'.png',render(size));
console.log('Generated consistent opaque company icons: 180, 192, 512');

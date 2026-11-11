// ZIP STORE transport reused from the reviewed Phase 2A exporter.
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function header(size){const bytes=new Uint8Array(size);return {bytes,view:new DataView(bytes.buffer)};}
function join(parts){const size=parts.reduce((n,p)=>n+p.length,0);if(size>0xffffffff)throw new Error('ZIP too large');const out=new Uint8Array(size);let at=0;for(const part of parts){out.set(part,at);at+=part.length;}return out;}
// Standard ZIP STORE (no compression), UTF-8 names, CRC32. No network or dependency.
export function reportFilesZIP(files){
  if(!files.length||files.length>65535)throw new Error('Invalid ZIP file count');
  const encoder=new TextEncoder(),local=[],central=[],names=new Set();let offset=0;
  for(const file of files){
    if((!/^(?:\[Content_Types\]\.xml|(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+)$/.test(file.name)||file.name.includes('..')||file.name.startsWith('/'))||names.has(file.name))throw new Error('Unsafe/duplicate ZIP filename');names.add(file.name);
    const name=encoder.encode(file.name),body=encoder.encode(file.content),crc=crc32(body);
    if(offset+body.length+name.length+30>0xffffffff)throw new Error('ZIP64 not supported');
    const h=header(30),v=h.view;v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);
    v.setUint32(14,crc,true);v.setUint32(18,body.length,true);v.setUint32(22,body.length,true);v.setUint16(26,name.length,true);
    local.push(h.bytes,name,body);
    const c=header(46),w=c.view;w.setUint32(0,0x02014b50,true);w.setUint16(4,20,true);w.setUint16(6,20,true);w.setUint16(8,0x800,true);w.setUint16(14,33,true);
    w.setUint32(16,crc,true);w.setUint32(20,body.length,true);w.setUint32(24,body.length,true);w.setUint16(28,name.length,true);w.setUint32(42,offset,true);
    central.push(c.bytes,name);offset+=30+name.length+body.length;
  }
  const directory=join(central),end=header(22),v=end.view;v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,directory.length,true);v.setUint32(16,offset,true);
  return join([...local,directory,end.bytes]);
}

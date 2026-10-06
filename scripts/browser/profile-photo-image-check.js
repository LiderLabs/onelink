async page => {
  const origin = page.url().startsWith('http://127.0.0.1:5174') ? 'http://127.0.0.1:5174' : 'http://127.0.0.1:5173';
  await page.goto(`${origin}/login`);
  await page.reload();
  return page.evaluate(async () => {
    const {initialCrop,clampCrop,zoomCrop}=await import('/src/features/media/crop.ts');
    const {decodePhoto,encodeAvatar}=await import('/src/features/media/image.ts');
    const check=(condition,message)=>{if(!condition)throw new Error(message)};
    const reject=async(fn,part)=>{try{await fn()}catch(error){check(error.message.includes(part),error.message);return}throw new Error('Expected rejection: '+part)};
    const wide=initialCrop(1200,800);check(wide.x===200&&wide.y===0&&wide.size===800,'centered wide crop');
    const tall=initialCrop(800,1200);check(tall.x===0&&tall.y===200,'centered tall crop');
    check(clampCrop({x:-20,y:2000,size:100},800,1200).y===1100,'bounded crop');
    const zoomed=zoomCrop(wide,2,1200,800);check(zoomed.size===400&&zoomed.x===400&&zoomed.y===200,'zoom around center');
    const canvas=document.createElement('canvas');canvas.width=120;canvas.height=80;
    const ctx=canvas.getContext('2d');
    for(const [color,x,y] of [['#dc472e',0,0],['#2878bf',60,0],['#36a476',0,40],['#efbf33',60,40]]){ctx.fillStyle=color;ctx.fillRect(x,y,60,40)}
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const photo=await decodePhoto(new File([blob],'source.png',{type:'image/png'}));
    const avatar=await encodeAvatar(photo,initialCrop(photo.width,photo.height));
    check(avatar.type==='image/webp'&&avatar.size<=240*1024,'bounded WebP export');
    const exported=await createImageBitmap(avatar);check(exported.width===512&&exported.height===512,'512 square export');exported.close();photo.release();
    const jpeg=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.95));
    const jpegBytes=new Uint8Array(await jpeg.arrayBuffer());
    const exif=new Uint8Array([255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);
    const oriented=await decodePhoto(new File([jpegBytes.slice(0,2),exif,jpegBytes.slice(2)],'portrait.jpg',{type:'image/jpeg'}));
    check(oriented.width===80&&oriented.height===120,'EXIF 6 rotates dimensions');
    const rotated=await encodeAvatar(oriented,initialCrop(oriented.width,oriented.height));
    const rotatedBitmap=await createImageBitmap(rotated);canvas.width=canvas.height=512;ctx.drawImage(rotatedBitmap,0,0);
    const pixel=ctx.getImageData(20,20,1,1).data;check(pixel[1]>pixel[0]&&pixel[1]>pixel[2],'oriented crop preserves corner colors');rotatedBitmap.close();
    await reject(()=>decodePhoto(new File([new Uint8Array(10*1024*1024+1)],'huge.png',{type:'image/png'})),'10 MB');
    await reject(()=>decodePhoto(new File(['<svg/>'],'vector.svg',{type:'image/svg+xml'})),'JPEG');
    await reject(()=>decodePhoto(new File(['GIF89a'],'animation.gif',{type:'image/gif'})),'JPEG');
    await reject(()=>decodePhoto(new File(['corrupt'],'bad.jpg',{type:'image/jpeg'})),'read');
    const bitmapFactory=window.createImageBitmap;let closed=false;
    try{window.createImageBitmap=async()=>({width:10000,height:5000,close(){closed=true}});await reject(()=>decodePhoto(new File([blob],'large.png',{type:'image/png'})),'40 million');check(closed,'oversize bitmap released')}finally{window.createImageBitmap=bitmapFactory}
    const encoder=HTMLCanvasElement.prototype.toBlob;
    try{
      HTMLCanvasElement.prototype.toBlob=function(callback){callback(new Blob(['PNG'],{type:'image/png'}))};
      await reject(()=>encodeAvatar(oriented,initialCrop(oriented.width,oriented.height)),'WebP');
      HTMLCanvasElement.prototype.toBlob=function(callback){callback(new Blob([new Uint8Array(240*1024+1)],{type:'image/webp'}))};
      await reject(()=>encodeAvatar(oriented,initialCrop(oriented.width,oriented.height)),'240 KiB');
    }finally{HTMLCanvasElement.prototype.toBlob=encoder;oriented.release()}
    return {passed:['crop geometry','WebP encoding','EXIF orientation','source limits','invalid images','resource release','encoding failures']};
  });
}

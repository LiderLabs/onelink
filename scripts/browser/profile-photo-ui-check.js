async page => {
  await page.reload();
  const check=(condition,message)=>{if(!condition)throw new Error(message)};
  const transport=await page.evaluate(async()=>{
    const {uploadAvatar}=await import('/src/features/media/api.ts');
    const original=window.XMLHttpRequest;let scenario='success',sent,progress;
    class XHR {
      upload={};status=201;responseText='';headers={};
      open(method,url){this.method=method;this.url=url}
      setRequestHeader(name,value){this.headers[name]=value}
      getAllResponseHeaders(){return 'Retry-After: 17\r\n'}
      abort(){this.onabort?.()}
      send(blob){sent=this;this.upload.onprogress?.({lengthComputable:true,loaded:2,total:4});queueMicrotask(()=>{
        if(scenario==='timeout'){this.ontimeout();return}if(scenario==='network'){this.onerror();return}if(scenario==='abort'){this.onabort();return}
        this.status=scenario==='success'?201:Number(scenario);this.responseText=JSON.stringify(this.status===201?{data:{id:'test',key:'k',url:'u',width:512,height:512,bytes:blob.size}}:{error:{code:this.status===429?'RATE_LIMITED':'VALIDATION_ERROR',message:'Rejected'}});this.onload();
      })}
    }
    window.XMLHttpRequest=XHR;
    try{
      const asset=await uploadAvatar(new Blob(['webp'],{type:'image/webp'}),{onProgress:value=>progress=value});
      if(asset.id!=='test'||!sent.withCredentials||sent.timeout!==20000||sent.headers['Content-Type']!=='image/webp'||progress!==.5)throw new Error('upload transport contract');
      for(scenario of ['413','422','429','timeout','network','abort']){
        let failed=false;try{await uploadAvatar(new Blob(['webp'],{type:'image/webp'}),{})}catch(error){failed=true;if(scenario==='429'&&error.retryAfterSeconds!==17)throw new Error('retry hint lost')}
        if(!failed)throw new Error('expected '+scenario+' rejection');
      }
      return true;
    }finally{window.XMLHttpRequest=original}
  });
  check(transport,'transport check');
  await page.evaluate(async()=>{
    const main=await(await fetch('/src/main.tsx')).text();
    const moduleUrl=name=>main.match(new RegExp('"(/node_modules/\\.vite/deps/'+name+'[^" ]*)"'))[1];
    const React=(await import(moduleUrl('react\\.js'))).default;
    const client=await import(moduleUrl('react-dom_client\\.js'));
    const {createRoot}=client.default ?? client;
    const {PhotoCropDialog}=await import('/src/features/media/PhotoCropDialog.tsx');
    const canvas=document.createElement('canvas');canvas.width=800;canvas.height=1200;canvas.getContext('2d').fillRect(0,0,800,1200);
    const source=await createImageBitmap(canvas);const photo={source,width:800,height:1200,release:()=>source.close()};
    const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
    window.__photoTest={saves:0,crop:null,root,host,photo};
    function Harness(){
      const[open,setOpen]=React.useState(false),[pending,setPending]=React.useState(false);
      return React.createElement(React.Fragment,null,
        React.createElement('button',{onClick:()=>setOpen(true)},'Open crop'),
        React.createElement(PhotoCropDialog,{photo,open,pending,phase:pending?'uploading':'idle',progress:pending?.5:null,error:null,onCancel:()=>setOpen(false),onSave:crop=>{window.__photoTest.saves++;window.__photoTest.crop=crop;setPending(true)}}));
    }
    root.render(React.createElement(Harness));
  });
  const trigger=page.getByRole('button',{name:'Open crop',exact:true});await trigger.click();
  const dialog=page.getByRole('dialog',{name:'Crop your photo'});await dialog.waitFor();
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  check(await trigger.evaluate(el=>el===document.activeElement),'focus must return to trigger');
  await trigger.click();await dialog.waitFor();
  const zoom=dialog.getByRole('slider',{name:'Zoom'});await zoom.focus();await page.keyboard.press('Home');
  for(let i=0;i<20;i++)await page.keyboard.press('ArrowRight');
  const viewport=dialog.getByLabel('Photo crop',{exact:true});await viewport.focus();await page.keyboard.press('ArrowDown');
  const box=await viewport.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+20,box.y+box.height/2+25);await page.mouse.up();
  await viewport.dispatchEvent('pointerdown',{pointerId:5,pointerType:'touch',clientX:100,clientY:100});
  await viewport.dispatchEvent('pointermove',{pointerId:5,pointerType:'touch',clientX:100,clientY:120});await viewport.dispatchEvent('pointerup',{pointerId:5,pointerType:'touch'});
  await dialog.getByRole('button',{name:'Save photo',exact:true}).click();await page.keyboard.press('Escape');
  check(await dialog.isVisible(),'pending crop cannot dismiss');
  check(await dialog.getByRole('button',{name:'Save photo',exact:true}).isDisabled(),'pending save locked');
  check(await dialog.getByRole('progressbar').getAttribute('value')==='50','upload progress exposed');
  const state=await page.evaluate(()=>({saves:window.__photoTest.saves,crop:window.__photoTest.crop}));
  check(state.saves===1&&state.crop.size===400&&state.crop.x>=0&&state.crop.y>=0,'single bounded save callback');
  await page.evaluate(()=>{const t=window.__photoTest;t.root.unmount();t.photo.release();t.host.remove();delete window.__photoTest});
  return {passed:['credentialed progress transport','server/network errors','dialog focus','keyboard pointer touch crop','zoom bounds','pending lock']};
}

async page => {
  await page.unrouteAll({behavior:'ignoreErrors'});
  await page.reload();
  const check=(condition,message)=>{if(!condition)throw new Error(message)};
  const errors=[];const onError=error=>errors.push(error.message);page.on('pageerror',onError);
  const dialog=page.getByRole('dialog',{name:'Crop your photo'});
  const choose=async()=>{await page.waitForFunction(()=>!document.querySelector('input[aria-label="Choose profile photo"]').disabled);await page.getByLabel('Choose profile photo',{exact:true}).setInputFiles('scripts/browser/fixtures/source-photo.png');await dialog.waitFor()};
  const current=()=>page.evaluate(async()=>(await(await fetch('/api/v1/media/avatar')).json()).data.media);
  try {
    // Decode generation: a slow first image must be closed rather than replace the newer draft.
    await page.evaluate(()=>{
      const original=window.createImageBitmap;let calls=0;
      window.__decodeTest={original,closed:0,release:null};
      window.createImageBitmap=async(...args)=>{
        const bitmap=await original(...args);
        if(++calls===1){const close=bitmap.close.bind(bitmap);bitmap.close=()=>{window.__decodeTest.closed++;close()};await new Promise(resolve=>window.__decodeTest.release=resolve)}
        return bitmap;
      };
    });
    await page.waitForFunction(()=>document.querySelector('input[aria-label="Choose profile photo"]')?.disabled===false);
    await page.getByLabel('Choose profile photo',{exact:true}).setInputFiles('scripts/browser/fixtures/source-photo.png');
    await page.waitForFunction(()=>!!window.__decodeTest.release);
    await choose();await page.evaluate(()=>window.__decodeTest.release());
    await page.waitForFunction(()=>window.__decodeTest.closed===1);
    check(await dialog.isVisible(),'newer photo draft remains open');
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.evaluate(()=>{window.createImageBitmap=window.__decodeTest.original;delete window.__decodeTest});

    // Retry hints are shown in the editor, not only parsed by the transport.
    await page.route('**/api/v1/media/avatar?kind=avatar',route=>route.fulfill({status:429,headers:{'Retry-After':'17'},contentType:'application/json',body:JSON.stringify({error:{code:'RATE_LIMITED',message:'Too many uploads.'}})}));
    await choose();await dialog.getByRole('button',{name:'Save photo',exact:true}).click();
    await dialog.getByText('Too many uploads. Try again in 17s.',{exact:true}).waitFor();
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await page.unroute('**/api/v1/media/avatar?kind=avatar');

    // Pending attachment holds navigation and prevents duplicate writes.
    let release,patches=0;
    await page.route('**/api/v1/auth/me',async route=>{
      if(route.request().method()==='PATCH'){patches++;await new Promise(resolve=>release=resolve)}
      await route.continue();
    });
    await choose();await dialog.getByRole('button',{name:'Save photo',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.photo-crop-dialog button:last-child')?.disabled);
    while(!release)await page.waitForTimeout(20);
    await page.getByRole('link',{name:'OneLink',exact:true}).evaluate(link=>link.click());
    const guard=page.getByRole('dialog',{name:'Leave with unsaved identity changes?'});await guard.waitFor();
    check(await guard.getByRole('button',{name:'Working',exact:true}).isDisabled(),'pending navigation cannot proceed');
    check(patches===1,'one attachment request while pending');release();
    await page.waitForFunction(()=>!document.querySelector('.photo-crop-dialog'));
    await guard.getByRole('button',{name:'Keep editing'}).click();await page.unroute('**/api/v1/auth/me');
    const saved=await current();check(!!saved,'pending save commits');

    // A committed attachment with both response and reconciliation unavailable is not deleted.
    let unknown;
    await page.route('**/api/v1/media/avatar?kind=avatar',async route=>{const response=await route.fetch();unknown=(await response.json()).data;await route.fulfill({response})});
    await page.route('**/api/v1/auth/me',async route=>{
      if(route.request().method()==='PATCH'){await route.fetch();await route.abort('failed')}
      else await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'INTERNAL',message:'Read unavailable.'}})});
    });
    await page.getByLabel('Bio',{exact:true}).fill('Keep this draft during reconciliation');
    await choose();await dialog.getByRole('button',{name:'Save photo',exact:true}).click();
    await dialog.getByText('We could not confirm whether your photo was saved. Check your connection, then cancel and reload before trying again.',{exact:true}).waitFor();
    check((await current()).key===unknown.key,'ambiguous committed asset survives');
    check(await page.getByLabel('Bio',{exact:true}).inputValue()==='Keep this draft during reconciliation','failed reconciliation keeps bio draft');
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await page.unrouteAll({behavior:'ignoreErrors'});
    await page.getByRole('button',{name:'Undo changes',exact:true}).click();await page.reload();
    await page.getByRole('button',{name:'Change photo',exact:true}).waitFor();

    // A different tab replaces the avatar before this tab's conditional attachment.
    let competing;
    await page.route('**/api/v1/auth/me',async route=>{
      if(route.request().method()==='PATCH'){
        const body=route.request().postDataJSON();
        competing=await page.evaluate(async()=>{
          const {decodePhoto,encodeAvatar}=await import('/src/features/media/image.ts');
          const {initialCrop}=await import('/src/features/media/crop.ts');
          const canvas=document.createElement('canvas');canvas.width=200;canvas.height=200;canvas.getContext('2d').fillRect(0,0,200,200);
          const photo=await decodePhoto(new File([await new Promise(resolve=>canvas.toBlob(resolve,'image/png'))],'other.png',{type:'image/png'}));
          const blob=await encodeAvatar(photo,initialCrop(photo.width,photo.height));photo.release();
          const asset=(await(await fetch('/api/v1/media/avatar?kind=avatar',{method:'POST',headers:{'Content-Type':'image/webp'},body:blob})).json()).data;
          return asset;
        });
        await route.fetch({postData:JSON.stringify({avatarKey:competing.key,expectedAvatarKey:body.expectedAvatarKey})});
      }
      await route.continue();
    });
    await choose();await dialog.getByRole('button',{name:'Save photo',exact:true}).click();
    await dialog.getByText('Your profile photo changed. Reload it and try again.',{exact:true}).waitFor();
    check((await current()).key===competing.key,'conflict keeps competing tab photo');
    check((await page.locator('.profile-heading .profile-avatar img').getAttribute('src')).endsWith(competing.key),'conflict refreshes displayed photo');
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await page.unrouteAll({behavior:'ignoreErrors'});

    // Restricted accounts must not fetch protected metadata or enable writes.
    for(const mode of ['forced','suspended','impersonated']){
      let reads=0;
      await page.route('**/api/v1/media/avatar',async route=>{reads++;await route.continue()});
      await page.route('**/api/v1/auth/me',async route=>{
        const response=await route.fetch(),payload=await response.json();
        if(mode==='forced')payload.data.user.requirePasswordChange=true;
        if(mode==='suspended')payload.data.user.status='suspended';
        if(mode==='impersonated')payload.data.user.impersonatedBy='local-test-admin';
        await route.fulfill({response,json:payload});
      });
      await page.reload();await page.getByRole('heading',{name:'Profile photo',exact:true}).waitFor();
      check(await page.getByRole('button',{name:'Change photo',exact:true}).isDisabled(),mode+' cannot upload');
      if(mode!=='impersonated')check(reads===0,mode+' must not read protected metadata');
      await page.unrouteAll({behavior:'ignoreErrors'});
    }
    await page.reload();await page.getByRole('button',{name:'Change photo',exact:true}).waitFor();
    await page.emulateMedia({reducedMotion:'reduce'});
    for(const [width,height] of [[320,568],[390,520],[768,900],[1440,1000]]){
      await page.setViewportSize({width,height});await choose();await page.evaluate(()=>document.fonts.ready);
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no page overflow at '+width);
      const bounds=await dialog.boundingBox();check(bounds.x>=0&&bounds.x+bounds.width<=width+1&&bounds.height<=height,'crop fits '+width);
      await page.screenshot({path:`output/playwright/profile-photo-${width}.png`,animations:'disabled'});
      await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
    }
    check(errors.length===0,'unexpected JavaScript errors: '+errors.join('; '));
    return {passed:['slow decode','retry hint','pending navigation','single write','failed reconciliation','draft preservation','another-tab conflict','guarded sessions','responsive crop'],screenshots:4};
  } finally {page.off('pageerror',onError);await page.unrouteAll({behavior:'ignoreErrors'});await page.setViewportSize({width:1440,height:1000})}
}

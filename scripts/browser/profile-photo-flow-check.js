async page => {
  await page.unrouteAll({behavior:'ignoreErrors'});
  const accept=dialog=>dialog.accept();page.on('dialog',accept);
  const origin=new URL(page.url()).origin;
  await page.goto(`${origin}/login`);
  const account=await page.evaluate(async()=>{
    const username=`photo-check-${Date.now()}`;
    const response=await fetch('/api/v1/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,email:`${username}@example.com`,displayName:'Photo test',password:'Disposable-profile-photo-84!'})});
    if(!response.ok)throw new Error('Local fixture registration failed: '+response.status);
    return {username};
  });
  await page.goto(`${origin}/app/profile`);await page.getByRole('heading',{name:'Photo test',exact:true,level:1}).waitFor();
  const check=(condition,message)=>{if(!condition)throw new Error(message)};
  check(await page.getByRole('heading',{name:'Profile photo',exact:true}).count()===1,'profile photo editor is present');
  const dialog=page.getByRole('dialog',{name:'Crop your photo'});
  const choose=async()=>{await page.waitForFunction(()=>!document.querySelector('input[aria-label="Choose profile photo"]').disabled);await page.getByLabel('Choose profile photo',{exact:true}).setInputFiles('scripts/browser/fixtures/source-photo.png');await dialog.waitFor()};
  const current=()=>page.evaluate(async()=>{const res=await fetch('/api/v1/media/avatar');return(await res.json()).data.media});
  const save=async()=>{await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/v1/auth/me')&&r.request().method()==='PATCH'&&r.status()===200),dialog.getByRole('button',{name:'Save photo',exact:true}).click()]);await dialog.waitFor({state:'hidden'})};
  let uploads=0;const count=req=>{if(req.method()==='POST'&&req.url().includes('/api/v1/media'))uploads++};page.on('request',count);
  try{
    await choose();await dialog.getByRole('button',{name:'Cancel',exact:true}).click();check(uploads===0,'cancel must not upload');
    await page.getByLabel('Bio',{exact:true}).fill('Unsaved photo-test bio');await choose();await save();
    const first=await current();check(first.width===512&&first.height===512&&first.bytes<=240*1024,'stored bounded photo');
    check(await page.getByLabel('Bio',{exact:true}).inputValue()==='Unsaved photo-test bio','photo save preserves bio draft');
    await page.getByRole('link',{name:'OneLink',exact:true}).click();
    const unsaved=page.getByRole('dialog',{name:'Leave with unsaved identity changes?'});await unsaved.waitFor();await unsaved.getByRole('button',{name:'Keep editing'}).click();
    await page.getByRole('button',{name:'Undo changes',exact:true}).click();await page.reload();
    await page.getByRole('button',{name:'Change photo',exact:true}).waitFor();check((await current()).key===first.key,'saved photo survives reload');
    await page.route('**/api/v1/media?kind=avatar',route=>route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({error:{code:'VALIDATION_ERROR',message:'Photo rejected for testing.'}})}));
    await choose();await dialog.getByRole('button',{name:'Save photo',exact:true}).click();await dialog.getByText('Photo rejected for testing.',{exact:true}).waitFor();check((await current()).key===first.key,'upload rejection keeps previous photo');
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await page.unroute('**/api/v1/media?kind=avatar');
    await page.route('**/api/v1/auth/me',route=>route.request().method()==='PATCH'?route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:{code:'CONFLICT',message:'Your profile photo changed. Reload it and try again.'}})}):route.continue());
    await choose();await dialog.getByRole('button',{name:'Save photo',exact:true}).click();await dialog.getByText('Your profile photo changed. Reload it and try again.',{exact:true}).waitFor();check((await current()).key===first.key,'attach rejection keeps previous photo');
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await page.unroute('**/api/v1/auth/me');
    await page.route('**/api/v1/auth/me',async route=>{if(route.request().method()==='PATCH'){await route.fetch();await route.abort('failed')}else await route.continue()});
    await choose();await dialog.getByRole('button',{name:'Save photo',exact:true}).click();await dialog.waitFor({state:'hidden'});const reconciled=await current();check(reconciled&&reconciled.key!==first.key,'lost attach response reconciles committed photo');await page.unroute('**/api/v1/auth/me');
    await page.route(`**/api/v1/media/${reconciled.id}`,route=>route.request().method()==='DELETE'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'INTERNAL',message:'Cleanup temporarily unavailable.'}})}):route.continue());
    await choose();await save();const cleanupSaved=await current();check(cleanupSaved.key!==reconciled.key,'cleanup failure keeps new committed photo');await page.getByRole('button',{name:'Retry cleanup',exact:true}).waitFor();await page.unroute(`**/api/v1/media/${reconciled.id}`);await page.getByRole('button',{name:'Retry cleanup',exact:true}).click();
    await page.getByRole('button',{name:'Retry cleanup',exact:true}).waitFor({state:'hidden'});check(await page.evaluate(async url=>(await fetch(url)).status,reconciled.url)===404,'cleanup retry removes old object');
    await choose();await save();const second=await current();check(second.key!==first.key,'replacement key changes');
    check(await page.evaluate(async url=>(await fetch(url)).status,first.url)===404,'old public image removed');
    await page.getByRole('button',{name:'Remove photo',exact:true}).click();
    const removal=page.getByRole('dialog',{name:'Remove your profile photo?'});await removal.waitFor();await removal.getByRole('button',{name:'Cancel',exact:true}).click();check((await current()).key===second.key,'cancel keeps saved photo');
    await page.getByRole('button',{name:'Remove photo',exact:true}).click();await removal.getByRole('button',{name:'Remove photo',exact:true}).click();await removal.waitFor({state:'hidden'});
    check(await current()===null,'removal clears saved photo');
    await choose();await page.keyboard.press('Escape');check(!(await dialog.isVisible()),'same file can be selected again');
    await page.getByLabel('Choose profile photo',{exact:true}).setInputFiles('scripts/browser/fixtures/invalid.gif');
    check(await page.getByText('Choose a JPEG, PNG, or WebP photo.',{exact:true}).isVisible(),'invalid format explains itself');
    return {account,passed:['cancel','real save','bounded server image','dirty bio preservation','unsaved navigation','reload','rejected upload/attachment','lost response reconciliation','cleanup retry','replace cleanup','confirmed removal','same-file selection','invalid format']};
  }finally{page.off('request',count);page.off('dialog',accept)}
}

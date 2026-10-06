async page => {
  await page.unrouteAll({behavior:'ignoreErrors'});await page.reload();
  await page.waitForFunction(()=>document.querySelector('input[aria-label="Choose profile photo"]')?.disabled===false);
  let uploaded;
  await page.route('**/api/v1/media/avatar?kind=avatar',async route=>{
    const response=await route.fetch();uploaded=(await response.json()).data;await route.fulfill({response});
  });
  await page.evaluate(()=>{
    const original=window.fetch;window.__responseTest={original,interrupted:false};
    window.fetch=async(input,init)=>{
      const response=await original(input,init);
      if(String(input).endsWith('/api/v1/auth/me')&&init?.method==='PATCH'){
        response.text=async()=>{window.__responseTest.interrupted=true;throw new TypeError('Connection closed while reading response body')};
      }
      return response;
    };
  });
  const dialog=page.getByRole('dialog',{name:'Crop your photo'});
  try {
    await page.getByLabel('Choose profile photo',{exact:true}).setInputFiles('scripts/browser/fixtures/source-photo.png');
    await dialog.waitFor();await dialog.getByRole('button',{name:'Save photo',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('.photo-crop-dialog')||!!document.querySelector('.photo-crop-dialog .photo-error')?.textContent);
    const actual=await page.evaluate(async()=>(await(await fetch('/api/v1/media/avatar')).json()).data.media);
    if(actual?.key!==uploaded.key)throw new Error('Interrupted committed response deleted the newly saved avatar');
    if(await dialog.isVisible())throw new Error('Interrupted committed response must reconcile as a saved photo');
    if(!await page.evaluate(()=>window.__responseTest.interrupted))throw new Error('Response-body interruption was not exercised');
    return {passed:['committed response-body interruption reconciles','new avatar remains attached']};
  } finally {
    await page.evaluate(()=>{window.fetch=window.__responseTest.original;delete window.__responseTest});
    await page.unrouteAll({behavior:'ignoreErrors'});
  }
}

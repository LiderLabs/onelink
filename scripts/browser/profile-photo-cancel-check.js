async page => {
  await page.unrouteAll({behavior:'ignoreErrors'});await page.goto(new URL('/app/profile',page.url()).href);
  const errors=[];const onError=error=>errors.push(error.message);page.on('pageerror',onError);
  try {
    for(let i=0;i<12;i++){
      await page.waitForFunction(()=>document.querySelector('input[aria-label="Choose profile photo"]')?.disabled===false);
      await page.getByLabel('Choose profile photo',{exact:true}).setInputFiles('scripts/browser/fixtures/source-photo.png');
      const dialog=page.getByRole('dialog',{name:'Crop your photo'});await dialog.waitFor();await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
    }
    if(errors.length)throw new Error(errors.join('; '));
    if(await page.getByRole('heading',{name:'Unexpected Application Error!'}).count())throw new Error('Cancel crashed the page');
    return {passed:['12 immediate photo cancellations','no detached-image errors']};
  }finally{page.off('pageerror',onError)}
}

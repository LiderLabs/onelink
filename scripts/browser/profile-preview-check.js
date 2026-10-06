async page => {
  await page.unrouteAll({behavior:'ignoreErrors'});await page.reload();
  const errors=[];const onError=error=>errors.push(error.message);page.on('pageerror',onError);
  const check=(condition,message)=>{if(!condition)throw new Error(message)};
  const preview=page.getByRole('region',{name:'Live profile preview',exact:true,includeHidden:true});
  await preview.waitFor({state:'attached',timeout:5000});
  const nav=page.getByRole('navigation',{name:'Account pages',exact:true});
  const profile=nav.getByRole('link',{name:'Profile',exact:true}),socials=nav.getByRole('link',{name:'Socials',exact:true});
  const original=await page.evaluate(async()=>(await(await fetch('/api/v1/auth/me')).json()).data.user);
  let writes=0;const count=req=>{if(['POST','PATCH','PUT','DELETE'].includes(req.method())&&req.url().includes('/api/v1/'))writes++};page.on('request',count);
  try {
    await page.getByLabel('Display name',{exact:true}).fill('Preview draft');
    await page.getByLabel('Bio',{exact:true}).fill('A bio that has not been saved.');
    await page.getByLabel('Location',{exact:true}).fill('Lisbon');await page.getByLabel('Pronouns',{exact:true}).fill('they/them');
    await socials.click();
    await preview.getByRole('heading',{name:'Preview draft',exact:true}).waitFor();
    check(await preview.getByText('A bio that has not been saved.',{exact:true}).isVisible(),'live bio');
    check(await preview.getByText('Lisbon',{exact:true}).isVisible()&&await preview.getByText('they/them',{exact:true}).isVisible(),'live optional fields');
    check(writes===0,'typing must not save');
    await profile.click();await page.getByRole('button',{name:'Undo changes',exact:true}).click();await socials.click();await preview.getByRole('heading',{name:original.displayName,exact:true}).waitFor();

    const add=page.locator('.profile-social-add');
    await add.getByLabel('Platform',{exact:true}).selectOption('instagram');await add.getByLabel('URL',{exact:true}).fill('https://instagram.com/preview-draft');
    await preview.getByRole('link',{name:'Instagram',exact:true}).waitFor();
    check(await preview.getByRole('link',{name:'Instagram',exact:true}).getAttribute('href')==='https://instagram.com/preview-draft','draft social URL');
    await add.getByLabel('Show on my page',{exact:true}).uncheck();await preview.getByRole('link',{name:'Instagram',exact:true}).waitFor({state:'hidden'});
    await add.getByLabel('Show on my page',{exact:true}).check();await add.getByLabel('URL',{exact:true}).fill('javascript:alert(1)');
    check(await preview.locator('a[href^="javascript:"]').count()===0,'unsafe drafts cannot become links');
    check(writes===0,'social draft changes must not save');await add.getByLabel('URL',{exact:true}).fill('');

    await profile.click();await page.waitForFunction(()=>document.querySelector('input[aria-label="Choose profile photo"]')?.disabled===false);
    await page.getByLabel('Choose profile photo',{exact:true}).setInputFiles('scripts/browser/fixtures/source-photo.png');
    const crop=page.getByRole('dialog',{name:'Crop your photo'});await crop.waitFor();
    await preview.locator('canvas').waitFor({state:'attached'});
    const before=await preview.locator('canvas').evaluate(canvas=>canvas.toDataURL());
    await crop.getByRole('slider',{name:'Zoom'}).focus();await page.keyboard.press('End');
    await page.waitForFunction(before=>document.querySelector('.profile-preview canvas').toDataURL()!==before,before);
    await crop.getByRole('button',{name:'Cancel',exact:true}).click();await preview.locator('canvas').waitFor({state:'detached'});
    check(writes===0,'crop/cancel must not upload');
    await socials.click();

    const saved=await page.evaluate(async()=>(await(await fetch('/api/v1/auth/me')).json()).data.user);
    check(saved.displayName===original.displayName&&saved.bio===original.bio&&saved.avatarKey===original.avatarKey,'preview never changes persisted identity');
    await page.emulateMedia({reducedMotion:'reduce'});
    for(const width of [320,390,768,1440]){
      await page.setViewportSize({width,height:900});await page.evaluate(()=>document.fonts.ready);
      await page.evaluate(()=>window.scrollTo(0,0));
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no overflow at '+width);
      if(width<721)check((await preview.boundingBox()).y<(await page.getByRole('heading',{name:'Social links',exact:true}).boundingBox()).y,'mobile preview precedes editor');
      await page.screenshot({path:`output/playwright/profile-preview-${width}.png`,animations:'disabled',fullPage:true});
    }
    check(errors.length===0,'unexpected JavaScript errors: '+errors.join('; '));
    return {passed:['live identity','undo restoration','draft socials','visibility','safe URLs','live photo crop','cancel restoration','no auto-save','responsive layout'],screenshots:4};
  } finally {page.off('request',count);page.off('pageerror',onError);await page.setViewportSize({width:1440,height:1000});await profile.click()}
}

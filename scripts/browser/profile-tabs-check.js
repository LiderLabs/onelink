async page => {
  await page.unrouteAll({behavior:'ignoreErrors'});await page.reload();
  const check=(condition,message)=>{if(!condition)throw new Error(message)};
  const profile=page.getByRole('tab',{name:'Profile',exact:true}),socials=page.getByRole('tab',{name:'Socials',exact:true});
  await profile.waitFor({timeout:5000});
  const preview=page.getByRole('region',{name:'Live profile preview',exact:true});
  const errors=[];const onError=error=>errors.push(error.message);page.on('pageerror',onError);
  let writes=0;const onRequest=req=>{if(['POST','PATCH','PUT','DELETE'].includes(req.method())&&req.url().includes('/api/v1/'))writes++};page.on('request',onRequest);
  try {
    check(await profile.getAttribute('aria-selected')==='true','Profile opens by default');
    check(await page.getByRole('heading',{name:'Profile details',exact:true}).isVisible(),'profile details are on Profile');
    check(await page.getByRole('heading',{name:'Security',exact:true}).isVisible(),'security is on Profile');
    check(await page.getByRole('heading',{name:'Session details',exact:true}).isVisible(),'session details are on Profile');
    check(!await page.getByRole('heading',{name:'Social links',exact:true}).isVisible()&&!await preview.isVisible(),'Profile excludes socials and preview');
    const original=await page.getByLabel('Display name',{exact:true}).inputValue();
    await page.getByLabel('Display name',{exact:true}).fill('Unsaved tab draft');await socials.click();
    await preview.getByRole('heading',{name:'Unsaved tab draft',exact:true}).waitFor();
    check(await page.getByRole('heading',{name:'Social links',exact:true}).isVisible(),'Socials shows social editor');
    check(!await page.getByRole('heading',{name:'Security',exact:true}).isVisible()&&!await page.getByRole('heading',{name:'Session details',exact:true}).isVisible(),'Socials excludes security and session');
    await page.getByRole('link',{name:'OneLink',exact:true}).click();
    const guard=page.getByRole('dialog',{name:'Leave with unsaved identity changes?'});await guard.waitFor();await guard.getByRole('button',{name:'Keep editing'}).click();
    const add=page.locator('.profile-social-add');await add.getByLabel('Platform',{exact:true}).selectOption('x');await add.getByLabel('URL',{exact:true}).fill('https://x.com/tab-draft');
    await preview.getByRole('link',{name:'X',exact:true}).waitFor();await profile.click();
    check(await page.getByLabel('Display name',{exact:true}).inputValue()==='Unsaved tab draft','switching preserves identity draft');
    await socials.click();check(await add.getByLabel('URL',{exact:true}).inputValue()==='https://x.com/tab-draft','switching preserves social draft');
    check(writes===0,'tab switching and drafts do not write');
    await add.getByLabel('URL',{exact:true}).fill('');await profile.click();await page.getByRole('button',{name:'Undo changes',exact:true}).click();
    check(await page.getByLabel('Display name',{exact:true}).inputValue()===original,'Undo restores original identity');
    await page.waitForFunction(()=>!document.querySelector('input[aria-label="Choose profile photo"]').disabled);
    await page.evaluate(()=>{
      const native=window.createImageBitmap;
      window.createImageBitmap=async(...args)=>{await new Promise(resolve=>window.releaseTabDecode=resolve);return native(...args)};
      window.restoreTabDecode=()=>{window.createImageBitmap=native;window.releaseTabDecode?.()};
    });
    try {
      await page.getByLabel('Choose profile photo',{exact:true}).setInputFiles('scripts/browser/fixtures/source-photo.png');
      await page.getByText('Opening your photo…',{exact:true}).waitFor();
      check(await socials.isDisabled(),'tabs must remain locked during photo decoding');
    } finally {await page.evaluate(()=>window.restoreTabDecode())}
    const crop=page.getByRole('dialog',{name:'Crop your photo'});await crop.waitFor();await crop.getByRole('button',{name:'Cancel',exact:true}).click();
    check(await socials.isEnabled(),'tabs unlock after decoding');
    await profile.focus();await page.keyboard.press('ArrowRight');check(await socials.getAttribute('aria-selected')==='true'&&await socials.evaluate(el=>el===document.activeElement),'arrow selects and focuses Socials');
    await page.keyboard.press('Home');check(await profile.getAttribute('aria-selected')==='true','Home selects Profile');
    await page.keyboard.press('End');check(await socials.getAttribute('aria-selected')==='true','End selects Socials');
    for(const width of [320,390,768,1440]){
      await page.setViewportSize({width,height:900});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no Socials overflow at '+width);
      await profile.click();check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no Profile overflow at '+width);await socials.click();
    }
    await profile.click();check(errors.length===0,'unexpected JavaScript errors: '+errors.join('; '));
    return {passed:['separate panels','default Profile','live preview on Socials','draft preservation','navigation warning from hidden identity','decode tab lock','no writes','keyboard tabs','responsive panels']};
  } finally {page.off('pageerror',onError);page.off('request',onRequest);await page.setViewportSize({width:1440,height:1000})}
}

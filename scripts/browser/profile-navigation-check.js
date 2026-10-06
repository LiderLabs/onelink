async page => {
  const accept=dialog=>dialog.accept();page.on('dialog',accept);
  await page.unrouteAll({behavior:'ignoreErrors'});await page.goto(new URL('/app/profile',page.url()).href);
  const check=(condition,message)=>{if(!condition)throw new Error(message)};
  const nav=page.getByRole('navigation',{name:'Account pages',exact:true});
  await nav.getByRole('link',{name:'Socials',exact:true}).waitFor({timeout:5000});
  const profile=nav.getByRole('link',{name:'Profile',exact:true}),socials=nav.getByRole('link',{name:'Socials',exact:true});
  const preview=page.getByRole('region',{name:'Live profile preview',exact:true});
  const errors=[];const onError=error=>errors.push(error.message);page.on('pageerror',onError);
  try {
    check(await nav.evaluate(el=>Boolean(el.closest('header.profile-masthead'))),'navigation belongs to top header');
    check(await page.locator('.profile-heading,.profile-page-nav').count()===0,'no account banner or secondary navigation');
    const user=await page.evaluate(async()=>(await(await fetch('/api/v1/auth/me')).json()).data.user);
    const account=page.locator('.profile-session');
    check(await account.getByText('@'+user.username,{exact:true}).isVisible(),'header shows username');
    check(await account.locator('.profile-avatar').isVisible(),'header shows avatar');
    check(await profile.getAttribute('aria-current')==='page','Profile link active');
    const name=page.getByLabel('Display name',{exact:true});const original=await name.inputValue();await name.fill('Navbar draft');
    await socials.click();check(new URL(page.url()).pathname==='/app/socials','Socials opens its own URL');
    await preview.getByRole('heading',{name:'Navbar draft',exact:true}).waitFor();
    check(await socials.getAttribute('aria-current')==='page','Socials link active');
    check(await page.getByRole('heading',{name:'Social links',exact:true}).isVisible(),'Socials has editor');
    check(!await page.getByRole('heading',{name:'Security',exact:true}).isVisible(),'Socials excludes security');
    await page.getByRole('link',{name:'OneLink',exact:true}).click();const guard=page.getByRole('dialog',{name:'Leave with unsaved identity changes?'});await guard.waitFor();await guard.getByRole('button',{name:'Keep editing'}).click();
    const add=page.locator('.profile-social-add');await add.getByLabel('URL',{exact:true}).fill('https://example.com/navbar-draft');
    await profile.click();check(await name.inputValue()==='Navbar draft','identity draft survives page links');
    await page.getByRole('heading',{name:'Security',exact:true}).waitFor();
    check(await page.getByRole('heading',{name:'Security',exact:true}).isVisible()&&await page.getByRole('heading',{name:'Session details',exact:true}).isVisible(),'Profile has security and session');
    await page.getByRole('button',{name:'Undo changes',exact:true}).click();check(await name.inputValue()===original,'Undo remains available');
    await socials.click();check(await add.getByLabel('URL',{exact:true}).inputValue()==='https://example.com/navbar-draft','social draft survives page links');await add.getByLabel('URL',{exact:true}).fill('');
    await page.reload();await preview.waitFor();check(await socials.getAttribute('aria-current')==='page','direct Socials URL survives reload');
    await profile.click();await profile.focus();await page.keyboard.press('Tab');
    check(await socials.evaluate(el=>el===document.activeElement),'keyboard Tab reaches Socials');await page.keyboard.press('Enter');await preview.waitFor();
    await profile.click();await page.waitForFunction(()=>!document.querySelector('input[aria-label="Choose profile photo"]').disabled);
    await page.evaluate(()=>{const native=window.createImageBitmap;window.createImageBitmap=async(...args)=>{await new Promise(resolve=>window.releaseNavDecode=resolve);return native(...args)};window.restoreNavDecode=()=>{window.createImageBitmap=native;window.releaseNavDecode?.()}});
    try {
      await page.getByLabel('Choose profile photo',{exact:true}).setInputFiles('scripts/browser/fixtures/source-photo.png');await page.getByText('Opening your photo…',{exact:true}).waitFor();
      check(await socials.getAttribute('aria-disabled')==='true','navigation locked during photo decoding');
      await socials.click({force:true});check(new URL(page.url()).pathname==='/app/profile','locked navigation keeps Profile visible');
    }finally{await page.evaluate(()=>window.restoreNavDecode())}
    const crop=page.getByRole('dialog',{name:'Crop your photo'});await crop.waitFor();await crop.getByRole('button',{name:'Cancel',exact:true}).click();
    check(await socials.getAttribute('aria-disabled')===null,'navigation unlocks after decode');await socials.click();
    for(const width of [320,390,768,1440]){
      await page.setViewportSize({width,height:900});await page.evaluate(()=>window.scrollTo(0,0));
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no Socials overflow at '+width);
      await profile.click();check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no Profile overflow at '+width);
      await page.getByRole('heading',{name:'Security',exact:true}).waitFor();
      if(width===390||width===1440)await page.screenshot({path:`output/playwright/profile-navbar-${width}.png`,fullPage:true,animations:'disabled'});
      await socials.click();
    }
    check(errors.length===0,'unexpected JavaScript errors: '+errors.join('; '));await profile.click();
    return {passed:['top navbar','header identity','separate URLs','active links','draft preservation','navigation warning','direct Socials reload','keyboard navigation','decode navigation lock','responsive layout']};
  }finally{page.off('pageerror',onError);page.off('dialog',accept);await page.setViewportSize({width:1440,height:1000})}
}

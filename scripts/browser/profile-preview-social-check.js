async page => {
  await page.unrouteAll({behavior:'ignoreErrors'});await page.reload();
  const check=(condition,message)=>{if(!condition)throw new Error(message)};
  const preview=page.getByRole('region',{name:'Live profile preview',exact:true});await preview.waitFor();
  const ids=[];
  try {
    for(const [platform,url] of [['website','https://example.com/preview-fixture'],['github','https://github.com/preview-fixture']]){
      const id=await page.evaluate(async body=>{const response=await fetch('/api/v1/profile/socials',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!response.ok)throw new Error('Fixture creation failed '+response.status);return(await response.json()).data.id},{platform,url});ids.push(id);
    }
    await page.reload();await preview.getByRole('link',{name:'GitHub',exact:true}).waitFor();
    const row=page.locator('.profile-social-row').filter({has:page.getByRole('link',{name:'https://github.com/preview-fixture',exact:true})});
    await row.getByRole('button',{name:'Edit the GitHub link',exact:true}).click();
    const editing=page.locator('.profile-social-row.is-editing');
    await editing.getByLabel('Platform',{exact:true}).selectOption('x');await editing.getByLabel('URL',{exact:true}).fill('https://x.com/unsaved-preview');
    await preview.getByRole('link',{name:'X',exact:true}).waitFor();
    check(await preview.getByRole('link',{name:'X',exact:true}).getAttribute('href')==='https://x.com/unsaved-preview','existing row drafts update preview');
    await editing.getByLabel('Show on my page',{exact:true}).uncheck();await preview.getByRole('link',{name:'X',exact:true}).waitFor({state:'hidden'});
    await editing.getByRole('button',{name:'Cancel',exact:true}).click();await preview.getByRole('link',{name:'GitHub',exact:true}).waitFor();
    const labels=()=>preview.locator('.profile-preview-links a').allTextContents();
    const initial=await labels();
    let release;
    await page.route('**/api/v1/profile/socials/order',async route=>{await new Promise(resolve=>release=resolve);await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'INTERNAL',message:'Order rejected for testing.'}})})});
    await row.getByRole('button',{name:'Move the GitHub link up',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.profile-preview-links a')?.textContent.includes('GitHub'));
    while(!release)await page.waitForTimeout(20);release();
    await page.getByText('Order rejected for testing.',{exact:true}).waitFor();
    check(JSON.stringify(await labels())===JSON.stringify(initial),'rejected reorder restores saved preview order');await page.unroute('**/api/v1/profile/socials/order');
    await row.getByRole('button',{name:'Move the GitHub link up',exact:true}).click();await page.getByText('Order saved.',{exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelector('.profile-preview-links a')?.textContent.includes('GitHub'));
    await page.reload();await preview.getByRole('link',{name:'GitHub',exact:true}).waitFor();check((await labels())[0].includes('GitHub'),'saved order survives reload');
    return {passed:['existing social drafts','hidden drafts omitted','cancel restores saved social','immediate reorder preview','failed reorder rollback','saved order reload']};
  } finally {
    await page.unrouteAll({behavior:'ignoreErrors'});
    for(const id of ids)await page.evaluate(async id=>{await fetch('/api/v1/profile/socials/'+id,{method:'DELETE'})},id);
    await page.reload();
  }
}

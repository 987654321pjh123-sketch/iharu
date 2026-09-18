import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
test.use({baseURL:'http://127.0.0.1:4174'});
async function login(page:Page,request:APIRequestContext,email:string,ready=true){
 await page.request.post('/api/auth/sign-up/email',{headers:{Origin:'http://127.0.0.1:4174'},data:{email,password:'browser-family-password-2026',name:'가상 보호자',callbackURL:'/login?verified=1'}});
 const mail=await(await request.get('/__test__/mail')).json();const m=mail.find((m:{to:string})=>m.to===email);await page.goto(m.url);
 await page.getByLabel('이메일',{exact:true}).fill(email);await page.getByLabel('비밀번호',{exact:true}).fill('browser-family-password-2026');await page.getByRole('button',{name:'로그인',exact:true}).click();await expect(page.getByRole('heading',{name:'로그인 방법과 기기'})).toBeVisible();
 if(ready)expect((await request.post('/__test__/ready',{data:{email}})).ok()).toBe(true);
}
test('family creation → verified fixture consent → child → separate device pairing → immediate revocation',async({page,browser,request})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1440,height:1000});await login(page,request,'family-flow@example.test');await page.goto('/family');
 await page.getByLabel('가족 이름',{exact:true}).fill('우리 가상 가족');await page.getByRole('button',{name:'우리 가족 만들기'}).click();await expect(page.getByText('아직 공유받은 아이가 없어요')).toBeVisible();
 const draftResponse=page.waitForResponse(r=>r.url().endsWith('/child-registration-drafts')&&r.request().method()==='POST');await page.getByRole('button',{name:'아이 등록 시작'}).click();const draft=await(await draftResponse).json();
 await expect(page.getByText('아이와의 관계를 먼저 확인해요')).toBeVisible();await expect(page.getByLabel('아이 별명')).toHaveCount(0);
 expect((await request.post('/__test__/verify-draft',{data:{draftId:draft.id}})).ok()).toBe(true);await page.getByRole('button',{name:'등록 상태 새로고침'}).click();await page.getByLabel('아이 별명').fill('가상 하늘');await page.getByLabel('일정·대화·학원비를 위한').check();await page.getByRole('button',{name:'동의하고 아이 등록'}).click();
 await page.getByRole('button',{name:'가상 하늘 동의·공유·기기 관리'}).click();await expect(page.getByRole('heading',{name:'가상 하늘 · 공유와 기기'})).toBeVisible();
 await page.screenshot({path:'test-results/family-1440.png',fullPage:true});
 const context=await browser.newContext({viewport:{width:390,height:844}}),child=await context.newPage();await child.goto('http://127.0.0.1:4174/device/connect');await child.getByRole('button',{name:'연결 번호 받기'}).click();await expect(child.locator('.pairing-code')).toBeVisible();const code=(await child.locator('.pairing-code').innerText()).replace(/\s/g,'');
 await child.screenshot({path:'test-results/device-390.png',fullPage:true});await page.getByLabel('6자리 연결 번호').fill(code);await page.getByRole('button',{name:'연결할 기기 확인'}).click();await page.getByRole('button',{name:'이 아이의 기기로 승인'}).click();
 await child.getByRole('button',{name:'보호자 확인이 끝났어요'}).click();await expect(child.getByRole('heading',{name:'가상 하늘, 반가워요'})).toBeVisible();await child.reload();await expect(child.getByText('가족 연결 완료')).toBeVisible();
 const cookies=await context.cookies();expect(cookies.find(c=>c.name==='iharu-child')).toMatchObject({httpOnly:true,sameSite:'Strict'});expect(await child.evaluate(()=>JSON.stringify(localStorage))).not.toContain('token');
 await page.getByRole('button',{name:'연결 목록 새로고침'}).click();await expect(page.getByText('아이 기기',{exact:true})).toBeVisible();page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'해제',exact:true}).click();await expect(page.getByText('아직 연결된 아이 기기가 없어요.')).toBeVisible();await child.reload();await expect(child.getByRole('heading',{name:'연결을 확인해 주세요'})).toBeVisible();
 for(const width of [320,390,768]){await page.setViewportSize({width,height:900});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);}
 await page.getByRole('button',{name:'큰 글씨'}).click();await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:'test-results/family-768-large.png',fullPage:true});await context.close();expect(errors).toEqual([]);
});
test('unverified guardian sees preparation state without forms for child personal data',async({page,request})=>{
 await page.setViewportSize({width:320,height:740});await login(page,request,'family-not-ready@example.test',false);await page.getByRole('link',{name:'우리 가족 연결하기'}).click();await expect(page.getByRole('heading',{name:'아이 정보는 확인을 마친 뒤에'})).toBeVisible();await expect(page.getByRole('button',{name:'보호자 확인 · 준비 중'})).toBeDisabled();await expect(page.getByLabel('아이 별명')).toHaveCount(0);await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:'test-results/family-preparing-320.png',fullPage:true});
});
test('child connection screen works by keyboard and fits small screens',async({page})=>{
 await page.setViewportSize({width:320,height:740});await page.goto('/device/connect');await expect(page.getByRole('heading',{name:'가족과 연결해 볼까요?'})).toBeVisible();const button=page.getByRole('button',{name:'연결 번호 받기'});await button.focus();await page.keyboard.press('Enter');await expect(page.locator('.pairing-code')).toBeVisible();await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.getByRole('button',{name:'보호자 확인이 끝났어요'}).click();await expect(page.getByRole('status').filter({hasText:'아직 확인하고 있어요'})).toBeVisible();
});

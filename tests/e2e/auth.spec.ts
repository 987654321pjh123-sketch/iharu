import { test, expect } from '@playwright/test';

test('production account routes show truthful readiness and do not expose sample children',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/login');
  await expect(page.getByRole('heading',{name:'다시 만나 반가워요'})).toBeVisible();
  await expect(page.getByText('로그인 연결을 준비하고 있어요')).toBeVisible();
  for(const label of ['Google로 계속하기','카카오로 계속하기','네이버로 계속하기'])await expect(page.getByRole('button',{name:new RegExp(label)})).toBeDisabled();
  await expect(page.locator('#email')).toBeDisabled();
  await expect(page.getByText('서윤',{exact:true})).toHaveCount(0);
  await page.getByRole('link',{name:'회원가입',exact:true}).click();
  await expect(page.getByRole('heading',{name:'아이하루 시작하기'})).toBeVisible();
  await page.goto('/phone');await expect(page.getByRole('button',{name:'인증번호 받기',exact:true})).toBeDisabled();
  await page.goto('/account');await expect(page).toHaveURL(/\/login$/);
  expect(errors).toEqual([]);
});

test('account pages reflow at phone widths and large text with accessible form labels',async({page})=>{
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});
    for(const path of ['/login','/signup','/forgot-password','/verify-email','/reset-password','/phone','/account/reauth','/account/email']){
      await page.goto(path);await expect(page.locator('.auth-title')).toBeVisible();
      await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    }
  }
  await page.setViewportSize({width:390,height:844});await page.goto('/login');
  await page.screenshot({path:'test-results/login-390.png',fullPage:true});
  await page.getByRole('button',{name:'큰 글씨',exact:true}).click();await page.reload();
  await expect(page.getByRole('button',{name:'큰 글씨',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'큰 글씨',exact:true}).click();
  await page.screenshot({path:'test-results/login-1440.png',fullPage:true});
  await page.goto('/account/reauth');
  await page.getByLabel('비밀번호',{exact:true}).fill('user-owned-test-password');
  await page.getByRole('button',{name:'비밀번호 표시',exact:true}).click();
  await expect(page.getByLabel('비밀번호',{exact:true})).toHaveAttribute('type','text');
  await page.getByRole('button',{name:'비밀번호 숨기기',exact:true}).click();
  await expect(page.getByLabel('비밀번호',{exact:true})).toHaveAttribute('type','password');
});

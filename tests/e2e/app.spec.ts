import { test, expect } from '@playwright/test';

test('built SPA opens by direct URL, filters data and reloads without console errors', async ({ page, request }) => {
  const errors:string[]=[]; page.on('pageerror', error=>errors.push(error.message));
  await page.goto('/today');
  await expect(page.getByRole('heading',{name:'가족의 오늘을 한눈에'})).toBeVisible();
  await page.getByRole('button',{name:'도윤',exact:true}).click();
  await expect(page.locator('.attendance-content')).toHaveCount(2);
  await expect(page.locator('.fee-total')).toHaveText('150,000원');
  await page.getByRole('link',{name:'월간 일정',exact:true}).click();
  await page.reload();
  await expect(page.getByRole('heading',{name:'함께 챙기는 가족 일정'})).toBeVisible();
  const response=await request.get('/api/not-found');
  expect(response.status()).toBe(404);
  expect(response.headers()['content-type']).toContain('application/json');
  expect(errors).toEqual([]);
});

test('calendar supports holiday selection, month changes and an empty day', async ({page})=>{
  await page.goto('/calendar');
  await page.getByRole('button',{name:/9월 24일 추석 연휴/}).click();
  await expect(page.locator('.holiday-note')).toBeVisible();
  await page.getByRole('button',{name:'다음 달',exact:true}).click();
  await expect(page.getByRole('heading',{name:'2026년 10월'})).toBeVisible();
  await expect(page.getByText('등록된 예시 일정이 없어요.')).toBeVisible();
  await page.getByRole('button',{name:'예시 오늘'}).click();
  await expect(page.getByRole('button',{name:/9월 17일/})).toHaveAttribute('aria-pressed','true');
});

test('child actions show a truthful dialog, close with Escape and return focus', async ({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/child');
  const button=page.getByRole('button',{name:'도착했어요',exact:true});
  await button.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('화면을 미리 보고 있어요. 실제 기록이나 요청은 전송되지 않아요.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(button).toBeFocused();
  await page.getByRole('link',{name:'가족에게 말하기 그림으로 쉽게 보내요'}).click();
  await expect(page.getByRole('heading',{name:'그림으로 마음을 전해요'})).toBeVisible();
});

test('mobile navigation and content order remain usable without horizontal overflow', async ({page})=>{
  for (const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:900});
    for (const path of ['/today','/child']) {
      await page.goto(path);
      await expect(page.locator('h1')).toBeVisible();
      if (path==='/today') await expect(page.locator('.attendance-card')).toBeVisible();
      await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if ([390,1440].includes(width)) await page.screenshot({path:`test-results/${path.slice(1)}-${width}.png`,fullPage:true});
    }
  }
  await page.setViewportSize({width:390,height:844});
  await page.goto('/today');
  await expect(page.locator('.attendance-card')).toBeVisible();
  const ys=await page.locator('.attendance-card,.family-calendar,.location-card,.tuition-card').evaluateAll(elements=>elements.map(e=>e.getBoundingClientRect().top));
  expect(ys.length).toBe(4); expect(ys).toEqual([...ys].sort((a,b)=>a-b));
  const nav=page.getByRole('navigation',{name:'모바일 주 메뉴'});
  await nav.getByRole('link',{name:'아이 위치',exact:true}).click();
  await expect(page.getByRole('heading',{name:'공유한 위치를 한눈에'})).toBeVisible();
});

test('large type persists and 200 percent desktop reflow keeps all content inside viewport', async ({page})=>{
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('/today');
  await page.getByRole('button',{name:'큰 글씨',exact:true}).click();
  await page.reload();
  await expect(page.getByRole('button',{name:'큰 글씨',exact:true})).toHaveAttribute('aria-pressed','true');
  // 1440px at 200% zoom gives an effective 720 CSS-pixel layout viewport.
  await page.setViewportSize({width:720,height:700});
  await page.evaluate(()=>document.documentElement.style.fontSize='32px');
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('failed dashboard request can be retried without leaving the page', async ({page})=>{
  let fail=true;
  await page.route('**/api/demo/dashboard?*',route=>fail?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEMPORARY',message:'잠시 후 다시 시도해 주세요.'},requestId:'test'})}):route.continue());
  await page.goto('/today');
  await expect(page.getByRole('alert')).toBeVisible();
  fail=false;
  await page.getByRole('button',{name:'다시 불러오기'}).click();
  await expect(page.getByRole('heading',{name:'오늘의 등하원',exact:true})).toBeVisible();
});

import {test,expect,type Page} from '@playwright/test';
import {addDays,koreaToday} from '../../shared/schedules';
test.use({baseURL:'http://127.0.0.1:4174',actionTimeout:10000});
const origin='http://127.0.0.1:4174';
async function fixture(page:Page){
 const email=`schedule-${crypto.randomUUID()}@example.test`,password='schedule-browser-fixture-password';
 async function post(path:string,data:object){const r=await page.request.post(path,{headers:{Origin:origin,'Idempotency-Key':crypto.randomUUID()},data});expect(r.ok(),await r.text()).toBe(true);return r.json();}
 await post('/api/auth/sign-up/email',{email,password,name:'가상 보호자',callbackURL:'/login?verified=1'});
 const mail=await(await page.request.get('/__test__/mail')).json();await page.request.get(mail.find((m:{to:string})=>m.to===email).url);
 await post('/api/auth/sign-in/email',{email,password});await post('/__test__/ready',{email});
 const family=await post('/api/v1/families',{name:'일정 테스트 가족'}),draft=await post(`/api/v1/families/${family.id}/child-registration-drafts`,{});
 await post('/__test__/verify-draft',{draftId:draft.id});const proof=await post(`/api/v1/child-registration-drafts/${draft.id}/consent-proofs`,{general:true,location:false,policyVersion:'6.1'});
 await post(`/api/v1/families/${family.id}/children`,{draftId:draft.id,proofId:proof.proofId,nickname:'가상 하늘',birthDate:'2018-03-02'});
 return family.id as string;
}
test('P04 weekly calendar → manual decision → single edit → future preview → closure, accessible layouts',async({page})=>{
 test.setTimeout(90000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const familyId=await fixture(page),date=addDays(koreaToday(),1),dow=new Date(date+'T00:00:00Z').getUTCDay(),dayLabel=['일','월','화','수','목','금','토'][dow];
 await page.setViewportSize({width:1440,height:1000});await page.goto(`/today/calendar?family=${familyId}&day=${date}`);
 await expect(page.getByRole('heading',{name:'우리 가족 달력',exact:true})).toBeVisible();await expect(page.getByText('정보 미수집',{exact:false}).first()).toBeVisible();
 await page.getByRole('button',{name:'이날 일정 추가',exact:true}).click();const dialog=page.getByRole('dialog');
 await dialog.getByLabel('일정 이름',{exact:true}).fill('해봄 영어 학원');await dialog.getByLabel('장소',{exact:true}).fill('우리 동네 교실');
 for(const checkbox of await dialog.locator('.schedule-weekdays input').all())await checkbox.uncheck();await dialog.getByLabel(dayLabel,{exact:true}).check();await dialog.getByLabel(/^반복 종료 날짜/).fill(addDays(date,35));
 await dialog.getByRole('button',{name:'일정 등록',exact:true}).click();await expect(dialog).not.toBeVisible();
 await expect(page.locator('.schedule-day h3')).toHaveText('해봄 영어 학원');await expect(page.locator('.schedule-occurrence .badge')).toHaveText('확인 필요');
 await page.locator('.schedule-occurrence').getByRole('button',{name:'정상 진행',exact:true}).click();await expect(page.locator('.schedule-occurrence .badge')).toHaveText('정상 진행');
 await page.getByRole('button',{name:'일정 수정',exact:true}).click();await dialog.getByLabel('일정 이름',{exact:true}).fill('영어 학원 · 특별 수업');await dialog.getByRole('button',{name:'변경 미리보기'}).click();await dialog.getByRole('button',{name:'확인한 내용 적용'}).click();
 await expect(page.locator('.schedule-day h3')).toHaveText('영어 학원 · 특별 수업');await page.reload();await expect(page.locator('.schedule-day h3')).toHaveText('영어 학원 · 특별 수업');
 await page.getByRole('button',{name:'일정 수정',exact:true}).click();await dialog.getByLabel('변경 범위').selectOption('FUTURE');await dialog.getByLabel('변경 적용 날짜').fill(addDays(date,7));await dialog.getByLabel('시작 시각',{exact:true}).fill('17:00');await dialog.getByLabel('종료 시각',{exact:true}).fill('18:00');
 await dialog.getByRole('button',{name:'변경 미리보기'}).click();await expect(dialog.getByText('조회 범위 내 영향 회차')).toBeVisible();await dialog.getByRole('button',{name:'확인한 내용 적용'}).click();await expect(dialog).not.toBeVisible();
 const selected=page.locator(`[data-schedule-date="${date}"]`);await selected.focus();await page.keyboard.press('ArrowRight');await expect(page.locator(`[data-schedule-date="${addDays(date,1)}"]`)).toBeFocused();await page.keyboard.press('ArrowLeft');await expect(selected).toBeFocused();
 await page.screenshot({path:'test-results/schedules-1440.png',fullPage:true});
 for(const width of [320,390,768]){await page.setViewportSize({width,height:900});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'큰 글씨'}).click();await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/schedules-390-large.png',fullPage:true});
 await page.evaluate(()=>document.documentElement.style.fontSize='200%');await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.evaluate(()=>document.documentElement.style.removeProperty('font-size'));
 await page.getByRole('link',{name:'반복 일정',exact:true}).click();await expect(page.getByRole('heading',{name:'반복 일정을 한곳에'})).toBeVisible();await page.getByRole('button',{name:'휴강·방학 등록'}).click();await dialog.getByLabel('휴무 시작').fill(addDays(date,7));await dialog.getByLabel('휴무 종료').fill(addDays(date,14));await dialog.getByLabel('구분').selectOption('VACATION');await dialog.getByLabel('안내 내용').fill('기관 방학');await dialog.getByRole('button',{name:'휴무 기간 저장'}).click();await expect(page.getByText('방학 · 기관 방학',{exact:true})).toBeVisible();
 await page.context().storageState({path:'test-results/p04-local-fixture-state.json'});expect(errors).toEqual([]);
});

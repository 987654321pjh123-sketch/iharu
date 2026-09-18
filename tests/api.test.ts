import { describe, it, expect } from 'vitest';
import { createApp } from '../server/app';
import { readConfig } from '../server/env';
import { envelope, dashboardSchema, healthSchema, apiErrorSchema } from '../shared/contracts';
const app = createApp({ environment:'local', demoEnabled:true });
describe('P01 API boundaries', () => {
  it('returns a validated health response without exposing credentials', async () => {
    const response = await app.request('/api/health');
    expect(response.status).toBe(200);
    const body = envelope(healthSchema).parse(await response.json());
    expect(body.data.demoEnabled).toBe(true);
    expect(JSON.stringify(body)).not.toContain('DATABASE_URL');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
  it('filters demo events and money by selected child', async () => {
    const response = await app.request('/api/demo/dashboard?child=demo-doyun&month=2026-09');
    const { data, meta } = envelope(dashboardSchema).parse(await response.json());
    expect(meta.source).toBe('demo');
    expect(data.events.length).toBeGreaterThan(0);
    expect(data.events.every(e => e.childId==='demo-doyun')).toBe(true);
    expect(data.tuition.reduce((s,t)=>s+t.amount,0)).toBe(150000);
  });
  it.each(['child=real-child-id', 'month=2026-13', 'month=2026-00'])('rejects malformed demo query %s', async query => {
    const response = await app.request(`/api/demo/dashboard?${query}`);
    expect(response.status).toBe(400);
    expect(apiErrorSchema.parse(await response.json()).error.code).toBe('INVALID_QUERY');
  });
  it('never accepts client role or demo session as authentication', async () => {
    for (const method of ['GET','POST','DELETE']) {
      const response = await app.request('/api/v1/children', { method, headers:{ Authorization:'Bearer demo', 'X-Role':'owner' } });
      expect(response.status).toBe(401);
      expect(apiErrorSchema.parse(await response.json()).error.code).toBe('AUTH_REQUIRED');
    }
  });
  it('does not send SPA HTML for unknown APIs', async () => {
    const response = await app.request('/api/not-found');
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
  });
  it('disables demo in production even if requested', async () => {
    const production = createApp({ environment:'production', demoEnabled:true });
    expect((await production.request('/api/demo/dashboard')).status).toBe(404);
    const body = await (await production.request('/api/health')).json();
    expect(body.data.demoEnabled).toBe(false);
    expect(readConfig({ VERCEL_ENV:'production', APP_ENV:'local', DEMO_MODE:'true' }).demoEnabled).toBe(false);
  });
  it('requires an explicit opt-in for Preview demos', () => {
    expect(readConfig({ VERCEL_ENV:'preview' }).demoEnabled).toBe(false);
    expect(readConfig({ VERCEL_ENV:'preview', DEMO_MODE:'true' }).demoEnabled).toBe(true);
  });
  it('does not invent monthly fee data outside the fixture month', async () => {
    const response = await app.request('/api/demo/dashboard?month=2026-10');
    const {data}=envelope(dashboardSchema).parse(await response.json());
    expect(data.events).toEqual([]);
    expect(data.tuition).toEqual([]);
    expect(data.holidays.length).toBeGreaterThan(0);
  });
});

import {describe,it,expect} from 'vitest';
import {inspectSetup} from '../scripts/lib/setup-config';
const fixture={APP_ENV:'production',APP_ORIGIN:'https://iharu.example.test',BETTER_AUTH_SECRET:'fixture-secret-not-for-production-use-0001',APP_DATABASE_URL:'postgres://app_login:private@db.example.test/iharu',AUTH_DATABASE_URL:'postgres://auth_login:private@db.example.test/iharu'};
describe('DB activation preflight',()=>{
 it('reports missing configuration by name without inventing readiness',()=>{const r=inspectSetup({});expect(r.ready).toBe(false);expect(r.findings.every(f=>f.state==='missing')).toBe(true);expect(r.providers.every(p=>p.state==='not-configured')).toBe(true);});
 it('rejects shared Supavisor roles even with different password/host/port',()=>{const r=inspectSetup({...fixture,APP_DATABASE_URL:'postgres://shared.project-ref:alpha@pool.example.test:6543/postgres',AUTH_DATABASE_URL:'postgres://shared.project-ref:beta@other.example.test:5432/postgres'});expect(r.ready).toBe(false);});
 it('rejects admin runtime credentials, insecure TLS and preview/prod crossover',()=>{
  for(const override of [{APP_DATABASE_URL:'postgres://postgres:hidden@db.example.test/postgres'},{AUTH_DATABASE_URL:fixture.AUTH_DATABASE_URL+'?sslmode=no-verify'},{VERCEL_ENV:'preview'},{APP_ORIGIN:'http://iharu.example.test'}])expect(inspectSetup({...fixture,...override}).ready).toBe(false);
 });
 it('never returns supplied connection strings, usernames, passwords or malformed input',()=>{const r=JSON.stringify(inspectSetup({...fixture,AUTH_DATABASE_URL:'NOT A URL WITH PRIVATE MATERIAL',RESEND_API_KEY:'private-mail-key'}));for(const secret of ['NOT A URL','private-mail-key','app_login','private@','fixture-secret'])expect(r).not.toContain(secret);});
 it('handles invalid percent-encoded role names without leaking parser exceptions',()=>{const r=inspectSetup({...fixture,AUTH_DATABASE_URL:'postgres://bad%FF:private@db.example.test/iharu'});expect(r.ready).toBe(false);expect(r.findings.find(f=>f.key==='AUTH_DATABASE_URL')?.state).toBe('invalid');});
 it('distinguishes configured keys from supplier connectivity and partial providers',()=>{const r=inspectSetup({...fixture,GOOGLE_CLIENT_ID:'test'});expect(r.ready).toBe(true);expect(r.providers.find(p=>p.name==='google')?.state).toBe('incomplete');expect(r.notice).toContain('실제 연결');});
});

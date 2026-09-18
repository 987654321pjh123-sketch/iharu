import {describe,it,expect} from 'vitest';
import {inspectSetup} from '../scripts/lib/setup-config';
const fixture={APP_ENV:'production',APP_ORIGIN:'https://iharu.example.test',BETTER_AUTH_SECRET:'fixture-secret-not-for-production-use-0001',APP_DATABASE_URL:'postgres://app_login:private@db.example.test/iharu',AUTH_DATABASE_URL:'postgres://auth_login:private@db.example.test/iharu'};
describe('DB activation preflight',()=>{
 it('reports missing configuration by name without inventing readiness',()=>{const r=inspectSetup({});expect(r.ready).toBe(false);expect(r.findings.every(f=>f.state==='missing')).toBe(true);expect(r.providers.every(p=>p.state==='not-configured')).toBe(true);});
 it('rejects shared Supavisor roles even with different password/host/port',()=>{const r=inspectSetup({...fixture,APP_DATABASE_URL:'postgres://shared.project-ref:alpha@pool.example.test:6543/postgres',AUTH_DATABASE_URL:'postgres://shared.project-ref:beta@other.example.test:5432/postgres'});expect(r.ready).toBe(false);});
 it('rejects admin runtime credentials, insecure TLS and preview/prod crossover',()=>{
  for(const override of [{APP_DATABASE_URL:'postgres://postgres:hidden@db.example.test/postgres'},{AUTH_DATABASE_URL:fixture.AUTH_DATABASE_URL+'?sslmode=no-verify'},{VERCEL_ENV:'preview'},{APP_ORIGIN:'http://iharu.example.test'}])expect(inspectSetup({...fixture,...override}).ready).toBe(false);
 });
 it('rejects TLS overrides for both runtime URLs without exposing their values',()=>{
  for(const key of ['APP_DATABASE_URL','AUTH_DATABASE_URL'] as const){
   for(const query of ['ssl=false','sslmode=verify-ca','sslmode=unexpected','sslrootcert=private-cert-path','sslcert=private-cert-path','sslkey=private-key-path','uselibpqcompat=true']){
    const r=inspectSetup({...fixture,[key]:fixture[key]+'?'+query});
    expect(r.ready).toBe(false);
    expect(r.findings.find(f=>f.key===key)?.state).toBe('invalid');
    for(const secret of ['private-cert-path','private-key-path','app_login','auth_login','private@'])expect(JSON.stringify(r)).not.toContain(secret);
   }
  }
 });
 it('accepts verified remote TLS and isolated local PostgreSQL settings',()=>{
  for(const query of ['sslmode=require','sslmode=verify-full','ssl=true'])expect(inspectSetup({...fixture,APP_DATABASE_URL:fixture.APP_DATABASE_URL+'?'+query}).ready).toBe(true);
  expect(inspectSetup({...fixture,APP_ENV:'local',APP_ORIGIN:'http://localhost:5173',APP_DATABASE_URL:'postgres://app_login:private@127.0.0.1/iharu?sslmode=disable',AUTH_DATABASE_URL:'postgres://auth_login:private@127.0.0.1/iharu?sslmode=disable'}).ready).toBe(true);
 });
 it('never returns supplied connection strings, usernames, passwords or malformed input',()=>{const r=JSON.stringify(inspectSetup({...fixture,AUTH_DATABASE_URL:'NOT A URL WITH PRIVATE MATERIAL',RESEND_API_KEY:'private-mail-key'}));for(const secret of ['NOT A URL','private-mail-key','app_login','private@','fixture-secret'])expect(r).not.toContain(secret);});
 it('handles invalid percent-encoded role names without leaking parser exceptions',()=>{const r=inspectSetup({...fixture,AUTH_DATABASE_URL:'postgres://bad%FF:private@db.example.test/iharu'});expect(r.ready).toBe(false);expect(r.findings.find(f=>f.key==='AUTH_DATABASE_URL')?.state).toBe('invalid');});
 it('distinguishes configured keys from supplier connectivity and partial providers',()=>{const r=inspectSetup({...fixture,GOOGLE_CLIENT_ID:'test'});expect(r.ready).toBe(true);expect(r.providers.find(p=>p.name==='google')?.state).toBe('incomplete');expect(r.notice).toContain('실제 연결');});
});

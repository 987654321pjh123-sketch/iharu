import { describe, it, expect } from 'vitest';
import { X509Certificate } from 'node:crypto';
import { databaseConnectionOptions } from '../server/adapters/database-tls';
import { supabaseProductionCAs } from '../server/adapters/supabase-ca';

describe('verified database TLS', () => {
  it('vendors valid public production CA certificates from the official CLI', () => {
    for (const pem of supabaseProductionCAs) {
      const cert = new X509Certificate(pem);
      expect(cert.ca).toBe(true); expect(cert.verify(cert.publicKey)).toBe(true);
      expect(cert.subject).toContain('O=Supabase Inc');
      expect(Date.parse(cert.validFrom)).toBeLessThan(Date.now());
      expect(Date.parse(cert.validTo)).toBeGreaterThan(Date.now());
      expect(pem).not.toContain('PRIVATE KEY');
    }
  });
  it('keeps CA and hostname verification for Supabase without trusting lookalike hosts', () => {
    for (const host of ['aws-0-ap-northeast-2.pooler.supabase.com','db.fixture.supabase.co']) {
      const options=databaseConnectionOptions(`postgresql://fixture:fixture@${host}:6543/postgres?sslmode=require`);
      expect(options.ssl).toMatchObject({rejectUnauthorized:true});
      expect(options.ssl && options.ssl.ca).toEqual(expect.arrayContaining(supabaseProductionCAs));
      expect(options.connectionString).not.toContain('sslmode');
    }
    for (const host of ['pooler.supabase.com.attacker.test','supabase.com.attacker.test','db.example.test']) {
      expect(databaseConnectionOptions(`postgresql://fixture:fixture@${host}/db`).ssl).toEqual({rejectUnauthorized:true});
    }
  });
  it('blocks URL parameters that would replace strict TLS configuration', () => {
    for (const query of ['sslmode=disable','sslmode=no-verify','sslmode=prefer','ssl=false','sslrootcert=other','uselibpqcompat=true']) {
      expect(()=>databaseConnectionOptions(`postgresql://fixture:fixture@db.example.test/db?${query}`)).toThrow('UNSAFE_DATABASE_TLS_CONFIGURATION');
    }
    expect(databaseConnectionOptions('postgresql://fixture:fixture@127.0.0.1:5432/iharu_ci').ssl).toBe(false);
  });
});

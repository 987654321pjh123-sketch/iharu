import { describe, it, expect } from 'vitest';
import { databaseFailureReason } from '../server/adapters/database-errors';

describe('private database diagnostics', () => {
  it('distinguishes credential, TLS and privilege failures without the error payload', () => {
    for (const [code, reason] of [['28P01','POSTGRES_28P01'],['42501','POSTGRES_42501'],['SELF_SIGNED_CERT_IN_CHAIN','SELF_SIGNED_CERT_IN_CHAIN']]) {
      expect(databaseFailureReason(Object.assign(new Error('private password and connection URL'), {code, detail:'private SQL values'}))).toBe(reason);
    }
  });
  it('does not log raw messages, stacks, unknown codes or supplied values', () => {
    const secret='postgresql://private:password@example.test/db';
    for (const error of [new Error(secret), {code:secret,message:secret,stack:secret}, secret, null]) expect(databaseFailureReason(error)).toBe('UNKNOWN');
  });
});

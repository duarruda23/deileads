import { describe, expect, it } from 'vitest';

import { generateLeadIntakeToken, hashLeadIntakeToken } from './lead-intake';

describe('lead intake tokens', () => {
  it('generates an opaque token and its SHA-256 hash', () => {
    const generated = generateLeadIntakeToken();

    expect(generated.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(generated.token.length).toBeGreaterThanOrEqual(40);
    expect(generated.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(generated.hash).toBe(hashLeadIntakeToken(generated.token));
    expect(generated.hash).not.toContain(generated.token);
  });

  it('does not reuse plaintext credentials', () => {
    const first = generateLeadIntakeToken();
    const second = generateLeadIntakeToken();

    expect(first.token).not.toBe(second.token);
    expect(first.hash).not.toBe(second.hash);
  });
});

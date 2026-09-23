import { describe, expect, it } from 'vitest';
import { extractHotmartPhone } from './phone';

describe('extractHotmartPhone', () => {
  it('does not repeat an area code already present in checkout_phone', () => {
    expect(
      extractHotmartPhone({
        checkout_phone_code: '11',
        checkout_phone: '11987654321',
      })
    ).toBe('5511987654321');
  });

  it('adds an area code only when checkout_phone is a local number', () => {
    expect(
      extractHotmartPhone({
        checkout_phone_code: '11',
        checkout_phone: '987654321',
      })
    ).toBe('5511987654321');
  });

  it('preserves a complete number from the webhook', () => {
    expect(extractHotmartPhone({ phone: '+55 (11) 98765-4321' })).toBe(
      '5511987654321'
    );
  });
});

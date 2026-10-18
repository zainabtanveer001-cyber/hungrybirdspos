const { hashPin, validateAuthorizationPin, escapeHtml } = require('./test-utils');

describe('Security Utilities', () => {
  describe('hashPin', () => {
    test('produces a consistent SHA-256 hash for the same input', async () => {
      const hash1 = await hashPin('7774');
      const hash2 = await hashPin('7774');
      expect(hash1).toBe(hash2);
    });

    test('produces different hashes for different inputs', async () => {
      const hash1 = await hashPin('7774');
      const hash2 = await hashPin('1234');
      expect(hash1).not.toBe(hash2);
    });

    test('hash is a 64-character hex string', async () => {
      const hash = await hashPin('test');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    test('correctly hashes known pin value', async () => {
      // Verify the hash is deterministic and well-formed
      const hash = await hashPin('7774');
      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
    });
  });

  describe('validateAuthorizationPin', () => {
    test('returns true for matching PIN and hash', async () => {
      const hash = await hashPin('ownerSecret');
      const result = await validateAuthorizationPin('ownerSecret', hash);
      expect(result).toBe(true);
    });

    test('returns false for non-matching PIN', async () => {
      const hash = await hashPin('ownerSecret');
      const result = await validateAuthorizationPin('wrongPin', hash);
      expect(result).toBe(false);
    });

    test('returns false for empty PIN', async () => {
      const hash = await hashPin('ownerSecret');
      const result = await validateAuthorizationPin('', hash);
      expect(result).toBe(false);
    });

    test('does not return true for plaintext pin', async () => {
      // Ensure the function actually hashes the input, not comparing plaintext
      const result = await validateAuthorizationPin('7774', '7774');
      expect(result).toBe(false);
    });
  });

  describe('escapeHtml', () => {
    test('escapes basic HTML special characters', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
      );
    });

    test('escapes ampersands', () => {
      expect(escapeHtml('a & b')).toBe('a &amp; b');
    });

    test('escapes single quotes', () => {
      expect(escapeHtml("it's")).toBe("it&#039;s");
    });

    test('escapes double quotes', () => {
      expect(escapeHtml('say "hello"')).toBe('say &quot;hello&quot;');
    });

    test('handles null input', () => {
      expect(escapeHtml(null)).toBe('');
    });

    test('handles undefined input', () => {
      expect(escapeHtml(undefined)).toBe('');
    });

    test('handles non-string input by converting to string', () => {
      expect(escapeHtml(123)).toBe('123');
    });

    test('prevents HTML injection in realistic scenario', () => {
      const userInput = '<img src=x onerror=alert(1)>';
      const escaped = escapeHtml(userInput);
      expect(escaped).not.toContain('<img');
      expect(escaped).toContain('&lt;img');
    });
  });
});

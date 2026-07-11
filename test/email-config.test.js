const test = require('node:test');
const assert = require('node:assert/strict');
const { getEmailConfigurationStatus } = require('../server');

test('reports email disabled when no mail provider is configured', () => {
  const status = getEmailConfigurationStatus({});

  assert.equal(status.configured, false);
  assert.equal(status.provider, null);
  assert.match(status.reason, /RESEND_API_KEY/);
  assert.ok(status.missing.includes('RESEND_API_KEY or SMTP_HOST + SMTP_USER + SMTP_PASS'));
});

test('detects resend when an API key is present', () => {
  const status = getEmailConfigurationStatus({ RESEND_API_KEY: 'test-key' });

  assert.equal(status.configured, true);
  assert.equal(status.provider, 'resend');
  assert.equal(status.reason, 'Resend is configured.');
  assert.deepEqual(status.missing, []);
});

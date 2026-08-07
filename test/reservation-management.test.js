const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const artifactDir = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'villa-maris-reservations-'));
process.env.NODE_ENV = 'test';
process.env.CHECKOUT_TEST_MODE = 'true';
process.env.ARTIFACT_STORAGE_DIR = artifactDir;
process.env.RESEND_API_KEY = '';
process.env.SMTP_HOST = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';

const { app } = require('../server');

let server;
let baseUrl;

test.before(async () => {
  server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await fs.rm(artifactDir, { recursive: true, force: true });
});

async function request(pathname, options) {
  const response = await fetch(baseUrl + pathname, options);
  const body = await response.json();
  return { response, body };
}

test('looks up, modifies, and cancels a reservation using stored booking data', async () => {
  const booking = await request('/api/reservation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Jordan',
      lastName: 'Lee',
      email: 'jordan@example.com',
      phone: '+1 415 555 0100',
      room: 'marin-sanctuary',
      ratePlan: 'flexible',
      checkin: '2030-07-10',
      checkout: '2030-07-13',
      guests: '2',
      specialRequests: 'Late arrival',
      paymentMethod: { cardType: 'Visa', last4: '4242' }
    })
  });
  assert.equal(booking.response.status, 200);
  assert.equal(booking.body.success, true);

  const confirmation = booking.body.confirmation;
  const missing = await request('/api/reservation/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmationNumber: confirmation, email: 'wrong@example.com' })
  });
  assert.equal(missing.response.status, 404);

  const lookup = await request('/api/reservation/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmationNumber: '#' + confirmation.toLowerCase(), email: 'JORDAN@EXAMPLE.COM' })
  });
  assert.equal(lookup.response.status, 200);
  assert.equal(lookup.body.reservation.details.email, 'jordan@example.com');
  assert.equal(lookup.body.reservation.paymentMethod.last4, '4242');

  const modification = await request('/api/reservation/' + confirmation, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'jordan@example.com',
      checkin: '2030-07-11',
      checkout: '2030-07-15',
      guests: 3,
      specialRequests: 'Updated arrival'
    })
  });
  assert.equal(modification.response.status, 200);
  assert.equal(modification.body.reservation.status, 'modified');
  assert.equal(modification.body.reservation.details.checkin, '2030-07-11');
  assert.equal(modification.body.reservation.details.guests, 3);

  const cancellation = await request('/api/reservation/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      confirmationNumber: confirmation,
      email: 'jordan@example.com',
      reason: 'Plans changed',
      cancelledOn: '2030-01-01'
    })
  });
  assert.equal(cancellation.response.status, 200);
  assert.equal(cancellation.body.success, true);
  assert.equal(cancellation.body.cancellation.checkin, '2030-07-11');
  assert.equal(cancellation.body.summary.originalTotal, modification.body.reservation.quote.total);
  assert.equal(cancellation.body.email.skipped, true);

  const emailHtml = await fs.readFile(cancellation.body.email.emailPath, 'utf8');
  const pdf = await fs.readFile(cancellation.body.email.pdfPath);
  assert.match(emailHtml, new RegExp(confirmation));
  assert.match(emailHtml, /July 11, 2030/);
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  const pdfText = execFileSync('pdftotext', [cancellation.body.email.pdfPath, '-'], { encoding: 'utf8' });
  assert.match(pdfText, new RegExp(confirmation));
  assert.match(pdfText, /July 11, 2030/);

  const duplicate = await request('/api/reservation/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmationNumber: confirmation, email: 'jordan@example.com' })
  });
  assert.equal(duplicate.response.status, 409);
});

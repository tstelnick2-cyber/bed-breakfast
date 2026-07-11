const express = require('express');
const fs = require('fs');
require('dotenv').config();
const nodemailer = require('nodemailer');
const path = require('path');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 5000;

const CHECKOUT_TEST_MODE = (process.env.CHECKOUT_TEST_MODE || 'true').toLowerCase() !== 'false';
const AUTHNET_ENV = (process.env.AUTHORIZE_NET_ENV || process.env.AUTHNET_ENV || 'sandbox').toLowerCase();
const AUTHNET_API_LOGIN_ID = process.env.AUTHORIZE_NET_API_LOGIN_ID || process.env.AUTHNET_API_LOGIN_ID || '';
const AUTHNET_TRANSACTION_KEY = process.env.AUTHORIZE_NET_TRANSACTION_KEY || process.env.AUTHNET_TRANSACTION_KEY || '';
const AUTHNET_PUBLIC_CLIENT_KEY = process.env.AUTHORIZE_NET_PUBLIC_CLIENT_KEY || process.env.AUTHNET_PUBLIC_CLIENT_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || process.env.SMTP_FROM || 'Villa Maris Tiburon <reservations@villamaristiburon.com>';
const RESERVATIONS_EMAIL = process.env.RESERVATIONS_EMAIL || 'reservations@villamaristiburon.com';
const SMTP_CONFIGURED = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const isProduction = process.env.NODE_ENV === 'production';
const AUTHNET_ENDPOINTS = {
  sandbox: 'https://apitest.authorize.net/xml/v1/request.api',
  production: 'https://api2.authorize.net/xml/v1/request.api'
};

const ROOM_PRICES = {
  'tiburon-bay-suite': 695,
  'golden-gate-vista': 795,
  'marin-sanctuary': 595,
  'alcatraz-suite': 650,
  'captains-quarters': 550,
  'hillside-retreat': 525,
  'marina-room': 575,
  'garden-bower': 495
};

const RATE_PLANS = {
  flexible: {
    name: 'Flexible Rate',
    discount: 0,
    paymentType: 'deposit'
  },
  prepaid: {
    name: 'Prepaid Rate',
    discount: 0.08,
    paymentType: 'full'
  }
};

const ROOM_NAMES = {
  'tiburon-bay-suite': 'The Tiburon Bay Suite',
  'golden-gate-vista': 'The Golden Gate Vista',
  'marin-sanctuary': 'The Marin Sanctuary',
  'alcatraz-suite': 'The Alcatraz Suite',
  'captains-quarters': "The Captain's Quarters",
  'hillside-retreat': 'The Hillside Retreat',
  'marina-room': 'The Marina Room',
  'garden-bower': 'The Garden Bower'
};

const ADDON_NAMES = {
  sail: 'Bay Sailboat Charter',
  massage: 'In-Suite Massage',
  wine: 'Champagne & Flowers Welcome',
  hike: 'Guided Ring Mountain Hike',
  dinner: "Private Chef's Table Dinner"
};

function money(value) {
  return Number(value || 0).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD'
  });
}

function formatDate(value) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(`${value}T00:00:00Z`));
}

function createSmtpTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: (process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

function createEmailErrorStatus(error, fallbackMessage) {
  const status = {
    sent: false,
    error: fallbackMessage
  };

  if (!isProduction && error?.message) {
    status.detail = error.message;
  }

  return status;
}

function calculateStayQuote({ room, checkin, checkout, ratePlan = 'flexible' }) {
  if (!ROOM_PRICES[room]) {
    throw new Error('Please select a valid suite.');
  }
  const selectedRatePlan = RATE_PLANS[ratePlan] ? ratePlan : 'flexible';
  const plan = RATE_PLANS[selectedRatePlan];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkin || '') || !/^\d{4}-\d{2}-\d{2}$/.test(checkout || '')) {
    throw new Error('Please select valid check-in and check-out dates.');
  }

  const checkinDate = new Date(`${checkin}T00:00:00Z`);
  const checkoutDate = new Date(`${checkout}T00:00:00Z`);
  const nights = Math.round((checkoutDate - checkinDate) / (1000 * 60 * 60 * 24));

  if (!Number.isFinite(nights) || nights <= 0) {
    throw new Error('Check-out must be after check-in.');
  }

  const baseNightlyRate = ROOM_PRICES[room];
  const nightlyRate = Math.round(baseNightlyRate * (1 - plan.discount));
  const subtotalCents = nightlyRate * nights * 100;
  const taxCents = Math.round(subtotalCents * 0.12);
  const totalCents = subtotalCents + taxCents;
  const discountCents = (baseNightlyRate - nightlyRate) * nights * 100;
  const depositCents = Math.round(totalCents * 0.5);
  const amountDueCents = plan.paymentType === 'full' ? totalCents : depositCents;

  return {
    ratePlan: selectedRatePlan,
    ratePlanName: plan.name,
    paymentType: plan.paymentType,
    baseNightlyRate,
    nightlyRate,
    nights,
    discount: discountCents / 100,
    subtotal: subtotalCents / 100,
    tax: taxCents / 100,
    total: totalCents / 100,
    deposit: depositCents / 100,
    amountDue: amountDueCents / 100,
    balanceDue: (totalCents - amountDueCents) / 100
  };
}

function detectCardType(cardNumber = '') {
  const digits = cardNumber.replace(/\D/g, '');
  if (/^4/.test(digits)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'Mastercard';
  if (/^3[47]/.test(digits)) return 'American Express';
  if (/^(6011|65|64[4-9])/.test(digits)) return 'Discover';
  return 'Card';
}

function processTestPayment({ paymentMethod, amount, confirmationNumber }) {
  const last4 = paymentMethod?.last4 || '0000';
  return {
    mode: 'test',
    status: 'approved',
    transactionId: `TEST-${confirmationNumber}`,
    authCode: 'TESTMODE',
    accountNumber: `XXXX${last4}`,
    cardType: paymentMethod?.cardType || 'Card',
    amount,
    charged: false
  };
}

async function processAuthorizeNetPayment({ opaqueData, amount, confirmationNumber, reservation }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  const endpoint = AUTHNET_ENV === 'production' ? AUTHNET_ENDPOINTS.production : AUTHNET_ENDPOINTS.sandbox;
  const requestBody = {
    createTransactionRequest: {
      merchantAuthentication: {
        name: AUTHNET_API_LOGIN_ID,
        transactionKey: AUTHNET_TRANSACTION_KEY
      },
      transactionRequest: {
        transactionType: 'authCaptureTransaction',
        amount: amount.toFixed(2),
        payment: {
          opaqueData: {
            dataDescriptor: opaqueData.dataDescriptor,
            dataValue: opaqueData.dataValue
          }
        },
        order: {
          invoiceNumber: confirmationNumber,
          description: `Villa Maris ${reservation.ratePlan === 'prepaid' ? 'prepaid reservation' : 'reservation deposit'}: ${reservation.room}`
        },
        customer: {
          email: reservation.email
        },
        billTo: {
          firstName: reservation.firstName,
          lastName: reservation.lastName,
          email: reservation.email,
          ...(reservation.phone ? { phoneNumber: reservation.phone } : {})
        }
      }
    }
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    const responseText = await response.text();
    const apiResponse = JSON.parse(responseText.replace(/^\uFEFF/, ''));
    const transactionResponse = apiResponse.transactionResponse;
    const approved = apiResponse.messages?.resultCode === 'Ok' && transactionResponse?.responseCode === '1';

    if (approved) {
      return {
        transactionId: transactionResponse.transId,
        authCode: transactionResponse.authCode,
        accountNumber: transactionResponse.accountNumber
      };
    }

    const errorMessage =
      transactionResponse?.errors?.[0]?.errorText ||
      apiResponse.messages?.message?.[0]?.text ||
      'Payment was declined.';

    throw new Error(errorMessage);
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Payment processor timed out. Please try again.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function createReceiptPdfBuffer({ reservation, quote, payment, confirmationNumber }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 48, right: 48, bottom: 24, left: 48 }
    });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const navy = '#173b60';
    const gold = '#b8964e';
    const gray = '#6b6f76';
    const lightGray = '#e7e7e7';
    const roomName = ROOM_NAMES[reservation.room] || reservation.room;
    const guestName = `${reservation.firstName} ${reservation.lastName}`.trim();
    const addons = Array.isArray(reservation.addons) ? reservation.addons : [];
    const createdDate = formatDate(new Date().toISOString().slice(0, 10));

    doc.rect(0, 0, doc.page.width, 8).fill(navy);
    doc.rect(doc.page.width - 210, 0, 210, 8).fill(gold);

    doc.fillColor(navy).font('Times-Bold').fontSize(25).text('VILLA MARIS', 48, 52);
    doc.fillColor(gold).font('Helvetica-Bold').fontSize(9).text('TIBURON - PRIVATE LUXURY GUEST ESTATE', 48, 84, { characterSpacing: 2 });
    doc.fillColor(gray).font('Helvetica').fontSize(9).text('75 Rolling Hills Rd', 48, 106);
    doc.text('Tiburon, CA 94920', 48, 120);
    doc.text('www.villamaristiburon.com', 48, 134);

    doc.fillColor('#f0f0f0').font('Times-Bold').fontSize(30).text('RECEIPT', 410, 48, { align: 'right' });
    doc.fillColor(gray).font('Helvetica-Bold').fontSize(10).text(`REF: #${confirmationNumber}`, 380, 86, { align: 'right' });
    doc.text(`DATE: ${createdDate}`, 380, 101, { align: 'right' });

    doc.fillColor(gold).font('Helvetica-Bold').fontSize(9).text('GUEST DETAILS', 48, 182, { characterSpacing: 1.5 });
    doc.moveTo(48, 197).lineTo(278, 197).strokeColor(lightGray).stroke();
    doc.fillColor('#2f3237').font('Helvetica-Bold').fontSize(10).text(guestName, 48, 206);
    doc.fillColor('#2f3237').font('Helvetica').fontSize(10).text(reservation.email, 48, 222);
    if (reservation.phone) doc.text(reservation.phone, 48, 238);
    if (reservation.country) doc.text(reservation.country, 48, reservation.phone ? 254 : 238);

    doc.fillColor(gold).font('Helvetica-Bold').fontSize(9).text('STAY INFORMATION', 330, 182, { characterSpacing: 1.5 });
    doc.moveTo(330, 197).lineTo(564, 197).strokeColor(lightGray).stroke();
    doc.fillColor('#2f3237').font('Helvetica-Bold').fontSize(10).text('Suite:', 330, 206);
    doc.font('Helvetica').text(roomName, 368, 206);
    doc.font('Helvetica-Bold').text('Check-in:', 330, 222);
    doc.font('Helvetica').text(formatDate(reservation.checkin), 386, 222);
    doc.font('Helvetica-Bold').text('Check-out:', 330, 238);
    doc.font('Helvetica').text(formatDate(reservation.checkout), 394, 238);
    doc.font('Helvetica-Bold').text('Guests:', 330, 254);
    doc.font('Helvetica').text(String(reservation.guests || 'Not specified'), 378, 254);
    doc.font('Helvetica-Bold').text('Rate:', 330, 270);
    doc.font('Helvetica').text(quote.ratePlanName, 368, 270);

    const tableTop = 310;
    doc.fillColor(gray).font('Helvetica-Bold').fontSize(9).text('DESCRIPTION', 60, tableTop, { characterSpacing: 1.2 });
    doc.text('RATE', 362, tableTop, { width: 62, align: 'right' });
    doc.text('QTY', 438, tableTop, { width: 38, align: 'right' });
    doc.text('TOTAL', 494, tableTop, { width: 70, align: 'right' });
    doc.moveTo(48, tableTop + 22).lineTo(564, tableTop + 22).strokeColor(navy).stroke();

    const lineY = tableTop + 38;
    doc.fillColor(navy).font('Helvetica-Bold').fontSize(11).text('Luxury Suite Accommodation', 60, lineY);
    doc.fillColor(gray).font('Helvetica').fontSize(9).text(`${roomName} - ${quote.ratePlanName}`, 60, lineY + 17);
    doc.fillColor('#2f3237').fontSize(10).text(money(quote.nightlyRate), 362, lineY, { width: 62, align: 'right' });
    doc.text(String(quote.nights), 438, lineY, { width: 38, align: 'right' });
    doc.text(money(quote.subtotal), 494, lineY, { width: 70, align: 'right' });

    if (addons.length) {
      doc.moveTo(48, lineY + 54).lineTo(564, lineY + 54).strokeColor('#f1f1f1').stroke();
      doc.fillColor(navy).font('Helvetica-Bold').fontSize(11).text('Selected Enhancements', 60, lineY + 72);
      doc.fillColor(gray).font('Helvetica').fontSize(9).text(addons.map(addon => ADDON_NAMES[addon] || addon).join(', '), 60, lineY + 89, { width: 300 });
      doc.text('Billed at arrival', 494, lineY + 72, { width: 70, align: 'right' });
    }

    const totalsTop = addons.length ? 500 : 455;
    doc.fillColor('#2f3237').font('Helvetica').fontSize(11).text('Subtotal', 60, totalsTop);
    doc.text(money(quote.subtotal), 170, totalsTop, { width: 80, align: 'right' });
    doc.text('Occupancy Tax', 60, totalsTop + 22);
    doc.text('(12%)', 60, totalsTop + 36);
    doc.text(money(quote.tax), 170, totalsTop + 22, { width: 80, align: 'right' });
    doc.fillColor(navy).rect(48, totalsTop + 58, 190, 34).fill();
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11).text('TOTAL', 60, totalsTop + 69);
    doc.text(money(quote.total), 145, totalsTop + 69, { width: 76, align: 'right' });

    doc.fillColor('#2f3237').font('Helvetica').fontSize(10).text(quote.paymentType === 'full' ? 'Paid at Booking' : 'Deposit Authorized', 330, totalsTop);
    doc.font('Helvetica-Bold').text(money(quote.amountDue), 474, totalsTop, { width: 90, align: 'right' });
    doc.font('Helvetica').text('Payment Method', 330, totalsTop + 22);
    doc.font('Helvetica-Bold').text(`${payment.cardType || 'Card'} ending ${payment.accountNumber || 'XXXX0000'}`.replace('XXXX', ''), 430, totalsTop + 22, { width: 134, align: 'right' });
    doc.font('Helvetica').text('Status', 330, totalsTop + 44);
    doc.font('Helvetica-Bold').text(payment.charged === false ? 'Paid' : 'Paid', 430, totalsTop + 44, { width: 134, align: 'right' });
    if (quote.balanceDue > 0) {
      doc.font('Helvetica').text('Balance Due', 330, totalsTop + 66);
      doc.font('Helvetica-Bold').text(money(quote.balanceDue), 474, totalsTop + 66, { width: 90, align: 'right' });
    }

    if (reservation.specialRequests) {
      doc.fillColor(gold).font('Helvetica-Bold').fontSize(9).text('SPECIAL REQUESTS', 48, 640, { characterSpacing: 1.2 });
      doc.fillColor(gray).font('Helvetica').fontSize(9).text(reservation.specialRequests, 48, 656, { width: 516 });
    }

    doc.moveTo(0, 700).lineTo(doc.page.width, 700).strokeColor(lightGray).stroke();
    doc.fillColor(gold).font('Times-Italic').fontSize(12).text('Thank you for letting us be part of your story.', 48, 720, { width: 516, align: 'center' });
    doc.fillColor(navy).font('Helvetica').fontSize(9).text(`${RESERVATIONS_EMAIL} - (415) 555-0198`, 48, 740, { width: 516, align: 'center' });
    doc.fillColor(gray).font('Helvetica').fontSize(8).text('VILLA MARIS TIBURON | A PRIVATE LUXURY GUEST ESTATE', 48, 757, { width: 516, align: 'center', characterSpacing: 1 });

    doc.end();
  });
}

function createConfirmationEmailHtml({ reservation, quote, payment, confirmationNumber }) {
  const roomName = ROOM_NAMES[reservation.room] || reservation.room;
  const guestName = `${reservation.firstName} ${reservation.lastName}`.trim();
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f5f2ec;font-family:Arial,Helvetica,sans-serif;color:#26313d;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f2ec;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;width:100%;background:#ffffff;border:1px solid #e2ddd3;">
            <tr><td style="height:8px;background:#173b60;"><div style="height:8px;background:#b8964e;width:34%;margin-left:auto;"></div></td></tr>
            <tr>
              <td style="padding:34px 38px 18px;">
                <div style="font-family:Georgia,serif;font-size:32px;letter-spacing:.03em;color:#173b60;font-weight:bold;">VILLA MARIS</div>
                <div style="font-size:12px;letter-spacing:.22em;color:#b8964e;font-weight:bold;margin-top:6px;">TIBURON - PRIVATE LUXURY GUEST ESTATE</div>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 38px 26px;">
                <h1 style="font-family:Georgia,serif;font-size:30px;line-height:1.15;color:#173b60;margin:0 0 14px;">Your reservation is confirmed</h1>
                <p style="font-size:15px;line-height:1.7;margin:0;color:#4a4f57;">Dear ${guestName},</p>
                <p style="font-size:15px;line-height:1.7;margin:10px 0 0;color:#4a4f57;">Thank you for choosing Villa Maris Tiburon. We are pleased to confirm your stay. Your receipt is attached as a PDF for your records.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 38px 28px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e7e1d7;">
                  <tr>
                    <td colspan="2" style="background:#173b60;color:#ffffff;padding:16px 18px;font-size:14px;font-weight:bold;letter-spacing:.08em;">RESERVATION ${confirmationNumber}</td>
                  </tr>
                  <tr>
                    <td style="padding:16px 18px;border-bottom:1px solid #eee;color:#7a6a49;font-size:12px;font-weight:bold;">Suite</td>
                    <td style="padding:16px 18px;border-bottom:1px solid #eee;text-align:right;">${roomName}</td>
                  </tr>
                  <tr>
                    <td style="padding:16px 18px;border-bottom:1px solid #eee;color:#7a6a49;font-size:12px;font-weight:bold;">Dates</td>
                    <td style="padding:16px 18px;border-bottom:1px solid #eee;text-align:right;">${formatDate(reservation.checkin)} - ${formatDate(reservation.checkout)}</td>
                  </tr>
                  <tr>
                    <td style="padding:16px 18px;border-bottom:1px solid #eee;color:#7a6a49;font-size:12px;font-weight:bold;">Guests</td>
                    <td style="padding:16px 18px;border-bottom:1px solid #eee;text-align:right;">${reservation.guests || 'Not specified'}</td>
                  </tr>
                  <tr>
                    <td style="padding:16px 18px;border-bottom:1px solid #eee;color:#7a6a49;font-size:12px;font-weight:bold;">Rate plan</td>
                    <td style="padding:16px 18px;border-bottom:1px solid #eee;text-align:right;">${quote.ratePlanName}</td>
                  </tr>
                  <tr>
                    <td style="padding:16px 18px;border-bottom:1px solid #eee;color:#7a6a49;font-size:12px;font-weight:bold;">Estimated total</td>
                    <td style="padding:16px 18px;border-bottom:1px solid #eee;text-align:right;font-weight:bold;">${money(quote.total)}</td>
                  </tr>
                  <tr>
                    <td style="padding:16px 18px;color:#7a6a49;font-size:12px;font-weight:bold;">${quote.paymentType === 'full' ? 'Paid at booking' : 'Deposit'}</td>
                    <td style="padding:16px 18px;text-align:right;font-weight:bold;">${money(quote.amountDue)} ${payment.charged === false ? '(test authorization - no charge)' : 'paid'}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 38px 34px;">
                <p style="font-size:14px;line-height:1.7;color:#4a4f57;margin:0;">Check-in begins at 3:00 PM and check-out is by 11:00 AM. If you would like help arranging arrival details, dining, or experiences, reply directly to this email.</p>
                <p style="font-size:14px;line-height:1.7;color:#4a4f57;margin:16px 0 0;">Warmly,<br>The Villa Maris Tiburon Team</p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 38px;background:#f8f6f1;text-align:center;color:#777;font-size:12px;line-height:1.6;">
                75 Rolling Hills Rd, Tiburon, CA 94920<br>
                ${RESERVATIONS_EMAIL} - (415) 555-0198
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

async function saveReservationArtifacts({ confirmationNumber, pdfBuffer, emailHtml }) {
  const outputDir = path.join(__dirname, 'output', 'reservations');
  await fs.promises.mkdir(outputDir, { recursive: true });
  const pdfPath = path.join(outputDir, `${confirmationNumber}.pdf`);
  const emailPath = path.join(outputDir, `${confirmationNumber}.html`);
  await fs.promises.writeFile(pdfPath, pdfBuffer);
  await fs.promises.writeFile(emailPath, emailHtml);
  return { pdfPath, emailPath };
}

async function sendConfirmationEmail({ reservation, quote, payment, confirmationNumber, pdfBuffer }) {
  const emailHtml = createConfirmationEmailHtml({ reservation, quote, payment, confirmationNumber });
  const artifacts = await saveReservationArtifacts({ confirmationNumber, pdfBuffer, emailHtml });

  if (!SMTP_CONFIGURED) {
    return { sent: false, skipped: true, reason: 'SMTP is not configured.', ...artifacts };
  }

  const transporter = createSmtpTransporter();

  const info = await transporter.sendMail({
    from: EMAIL_FROM,
    to: reservation.email,
    bcc: process.env.RESERVATION_BCC || RESERVATIONS_EMAIL,
    subject: `Confirmation of your reservation at Villa Maris Tiburon - ${confirmationNumber}`,
    html: emailHtml,
    attachments: [{
      filename: `Villa-Maris-Receipt-${confirmationNumber}.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf'
    }]
  });

  return {
    sent: true,
    messageId: info.messageId,
    acceptedCount: Array.isArray(info.accepted) ? info.accepted.length : undefined,
    rejectedCount: Array.isArray(info.rejected) ? info.rejected.length : undefined,
    ...artifacts
  };
}

function createCancellationSummary({ quote, paymentMethod, cancellationFee }) {
  const originalTotal = quote.total;
  const retained = CHECKOUT_TEST_MODE ? 0 : Math.max(0, Number(cancellationFee || 0));
  const paidAmount = CHECKOUT_TEST_MODE ? 0 : quote.amountDue;
  const refund = Math.max(0, paidAmount - retained);
  const cardType = paymentMethod?.cardType || 'Card';
  const last4 = paymentMethod?.last4 || '0000';

  return {
    originalTotal,
    paidAmount,
    retained,
    refund,
    cardType,
    last4,
    testMode: CHECKOUT_TEST_MODE
  };
}

function createCancellationPdfBuffer({ cancellation, quote, summary }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 48, right: 48, bottom: 24, left: 48 }
    });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const navy = '#173b60';
    const gold = '#b8964e';
    const gray = '#6b6f76';
    const lightGray = '#e7e7e7';
    const roomName = ROOM_NAMES[cancellation.room] || cancellation.room;
    const guestName = `${cancellation.firstName} ${cancellation.lastName}`.trim();
    const cancelledDate = formatDate(new Date().toISOString().slice(0, 10));

    doc.rect(0, 0, doc.page.width, 8).fill(navy);
    doc.rect(doc.page.width - 210, 0, 210, 8).fill(gold);

    doc.fillColor(navy).font('Times-Bold').fontSize(25).text('VILLA MARIS', 48, 52);
    doc.fillColor(gold).font('Helvetica-Bold').fontSize(9).text('TIBURON - PRIVATE LUXURY GUEST ESTATE', 48, 84, { characterSpacing: 2 });
    doc.fillColor(gray).font('Helvetica').fontSize(9).text('75 Rolling Hills Rd', 48, 106);
    doc.text('Tiburon, CA 94920', 48, 120);
    doc.text('www.villamaristiburon.com', 48, 134);

    doc.fillColor('#f0f0f0').font('Times-Bold').fontSize(27).text('CANCELLATION', 330, 48, { align: 'right' });
    doc.fillColor(gray).font('Helvetica-Bold').fontSize(10).text(`BOOKING REF: #${cancellation.confirmationNumber}`, 330, 86, { align: 'right' });
    doc.text(`CANCELLED ON: ${cancelledDate}`, 330, 101, { align: 'right' });

    doc.fillColor(gold).font('Helvetica-Bold').fontSize(9).text('GUEST DETAILS', 48, 182, { characterSpacing: 1.5 });
    doc.moveTo(48, 197).lineTo(278, 197).strokeColor(lightGray).stroke();
    doc.fillColor('#2f3237').font('Helvetica-Bold').fontSize(10).text(guestName, 48, 206);
    doc.fillColor('#2f3237').font('Helvetica').fontSize(10).text(cancellation.email, 48, 222);
    if (cancellation.phone) doc.text(cancellation.phone, 48, 238);

    doc.fillColor(gold).font('Helvetica-Bold').fontSize(9).text('ORIGINAL STAY DETAILS', 330, 182, { characterSpacing: 1.5 });
    doc.moveTo(330, 197).lineTo(564, 197).strokeColor(lightGray).stroke();
    doc.fillColor('#2f3237').font('Helvetica-Bold').fontSize(10).text('Suite:', 330, 206);
    doc.font('Helvetica').text(roomName, 368, 206);
    doc.font('Helvetica-Bold').text('Check-in:', 330, 222);
    doc.font('Helvetica').text(formatDate(cancellation.checkin), 386, 222);
    doc.font('Helvetica-Bold').text('Check-out:', 330, 238);
    doc.font('Helvetica').text(formatDate(cancellation.checkout), 394, 238);
    doc.font('Helvetica-Bold').text('Rate:', 330, 254);
    doc.font('Helvetica').text(quote.ratePlanName, 368, 254);

    const tableTop = 310;
    doc.fillColor(gray).font('Helvetica-Bold').fontSize(9).text('DESCRIPTION', 60, tableTop, { characterSpacing: 1.2 });
    doc.text('ORIGINAL TOTAL', 320, tableTop, { width: 95, align: 'right' });
    doc.text('REFUND/ADJ', 430, tableTop, { width: 70, align: 'right' });
    doc.text('RETAINED', 512, tableTop, { width: 52, align: 'right' });
    doc.moveTo(48, tableTop + 22).lineTo(564, tableTop + 22).strokeColor(navy).stroke();

    const lineY = tableTop + 42;
    doc.fillColor(navy).font('Helvetica-Bold').fontSize(11).text('Reservation Cancellation', 60, lineY);
    doc.fillColor(gray).font('Helvetica').fontSize(9).text(summary.testMode ? 'Test-mode cancellation - no payment was captured' : 'Cancellation processed per property policy', 60, lineY + 17, { width: 230 });
    doc.fillColor('#2f3237').fontSize(10).text(money(summary.originalTotal), 320, lineY, { width: 95, align: 'right' });
    doc.text(summary.refund ? `(${money(summary.refund)})` : money(0), 430, lineY, { width: 70, align: 'right' });
    doc.text(money(summary.retained), 512, lineY, { width: 52, align: 'right' });

    const detailsTop = 450;
    doc.fillColor('#2f3237').font('Helvetica').fontSize(11).text('Original Total', 60, detailsTop);
    doc.font('Helvetica-Bold').text(money(summary.originalTotal), 170, detailsTop, { width: 90, align: 'right' });
    doc.font('Helvetica').text('Payment Method', 60, detailsTop + 30);
    doc.font('Helvetica-Bold').text(summary.testMode ? 'Paid' : `${summary.cardType} ending ${summary.last4}`, 170, detailsTop + 30, { width: 130, align: 'right' });
    doc.font('Helvetica').text('Refund Processed', 60, detailsTop + 60);
    doc.font('Helvetica-Bold').text(summary.refund ? `(${money(summary.refund)})` : money(0), 170, detailsTop + 60, { width: 90, align: 'right' });

    doc.fillColor(navy).rect(330, detailsTop, 190, 40).fill();
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11).text('TOTAL RETAINED', 346, detailsTop + 14);
    doc.text(money(summary.retained), 426, detailsTop + 14, { width: 78, align: 'right' });

    doc.fillColor(gold).font('Helvetica-Bold').fontSize(9).text('CANCELLATION NOTE', 48, 590, { characterSpacing: 1.2 });
    const note = cancellation.reason
      ? `Cancellation reason: ${cancellation.reason}`
      : summary.testMode
        ? 'This test-mode cancellation confirms the reservation has been marked cancelled. No payment was captured and no refund is due.'
        : 'Funds processed for refund should appear in your account within 5-10 business days depending on your financial institution.';
    doc.fillColor(gray).font('Helvetica').fontSize(9).text(note, 48, 610, { width: 516, lineGap: 2 });

    doc.moveTo(0, 700).lineTo(doc.page.width, 700).strokeColor(lightGray).stroke();
    doc.fillColor(gold).font('Times-Italic').fontSize(12).text('We hope to welcome you another time.', 48, 720, { width: 516, align: 'center' });
    doc.fillColor(navy).font('Helvetica').fontSize(9).text(`${RESERVATIONS_EMAIL} - (415) 555-0198`, 48, 740, { width: 516, align: 'center' });
    doc.fillColor(gray).font('Helvetica').fontSize(8).text('VILLA MARIS TIBURON | A PRIVATE LUXURY GUEST ESTATE', 48, 757, { width: 516, align: 'center', characterSpacing: 1 });

    doc.end();
  });
}

function createCancellationEmailHtml({ cancellation, quote, summary }) {
  const roomName = ROOM_NAMES[cancellation.room] || cancellation.room;
  const guestName = `${cancellation.firstName} ${cancellation.lastName}`.trim();
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f5f2ec;font-family:Arial,Helvetica,sans-serif;color:#26313d;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f2ec;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;width:100%;background:#ffffff;border:1px solid #e2ddd3;">
            <tr><td style="height:8px;background:#173b60;"><div style="height:8px;background:#b8964e;width:34%;margin-left:auto;"></div></td></tr>
            <tr>
              <td style="padding:34px 38px 18px;">
                <div style="font-family:Georgia,serif;font-size:32px;letter-spacing:.03em;color:#173b60;font-weight:bold;">VILLA MARIS</div>
                <div style="font-size:12px;letter-spacing:.22em;color:#b8964e;font-weight:bold;margin-top:6px;">TIBURON - PRIVATE LUXURY GUEST ESTATE</div>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 38px 26px;">
                <h1 style="font-family:Georgia,serif;font-size:30px;line-height:1.15;color:#173b60;margin:0 0 14px;">Your reservation has been cancelled</h1>
                <p style="font-size:15px;line-height:1.7;margin:0;color:#4a4f57;">Dear ${guestName},</p>
                <p style="font-size:15px;line-height:1.7;margin:10px 0 0;color:#4a4f57;">We have processed the cancellation for your Villa Maris Tiburon reservation. A cancellation receipt is attached as a PDF for your records.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 38px 28px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e7e1d7;">
                  <tr>
                    <td colspan="2" style="background:#173b60;color:#ffffff;padding:16px 18px;font-size:14px;font-weight:bold;letter-spacing:.08em;">CANCELLATION ${cancellation.confirmationNumber}</td>
                  </tr>
                  <tr>
                    <td style="padding:16px 18px;border-bottom:1px solid #eee;color:#7a6a49;font-size:12px;font-weight:bold;">Suite</td>
                    <td style="padding:16px 18px;border-bottom:1px solid #eee;text-align:right;">${roomName}</td>
                  </tr>
                  <tr>
                    <td style="padding:16px 18px;border-bottom:1px solid #eee;color:#7a6a49;font-size:12px;font-weight:bold;">Original dates</td>
                    <td style="padding:16px 18px;border-bottom:1px solid #eee;text-align:right;">${formatDate(cancellation.checkin)} - ${formatDate(cancellation.checkout)}</td>
                  </tr>
                  <tr>
                    <td style="padding:16px 18px;border-bottom:1px solid #eee;color:#7a6a49;font-size:12px;font-weight:bold;">Rate plan</td>
                    <td style="padding:16px 18px;border-bottom:1px solid #eee;text-align:right;">${quote.ratePlanName}</td>
                  </tr>
                  <tr>
                    <td style="padding:16px 18px;border-bottom:1px solid #eee;color:#7a6a49;font-size:12px;font-weight:bold;">Original total</td>
                    <td style="padding:16px 18px;border-bottom:1px solid #eee;text-align:right;font-weight:bold;">${money(quote.total)}</td>
                  </tr>
                  <tr>
                    <td style="padding:16px 18px;border-bottom:1px solid #eee;color:#7a6a49;font-size:12px;font-weight:bold;">Refund processed</td>
                    <td style="padding:16px 18px;border-bottom:1px solid #eee;text-align:right;font-weight:bold;">${summary.refund ? money(summary.refund) : money(0)}</td>
                  </tr>
                  <tr>
                    <td style="padding:16px 18px;color:#7a6a49;font-size:12px;font-weight:bold;">Amount retained</td>
                    <td style="padding:16px 18px;text-align:right;font-weight:bold;">${money(summary.retained)}${summary.testMode ? ' (test mode - no charge)' : ''}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 38px 34px;">
                <p style="font-size:14px;line-height:1.7;color:#4a4f57;margin:0;">If this cancellation was made in error or you would like to choose alternate dates, reply directly to this email and our team will be happy to assist.</p>
                <p style="font-size:14px;line-height:1.7;color:#4a4f57;margin:16px 0 0;">Warmly,<br>The Villa Maris Tiburon Team</p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 38px;background:#f8f6f1;text-align:center;color:#777;font-size:12px;line-height:1.6;">
                75 Rolling Hills Rd, Tiburon, CA 94920<br>
                ${RESERVATIONS_EMAIL} - (415) 555-0198
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

async function saveCancellationArtifacts({ confirmationNumber, pdfBuffer, emailHtml }) {
  const outputDir = path.join(__dirname, 'output', 'cancellations');
  await fs.promises.mkdir(outputDir, { recursive: true });
  const pdfPath = path.join(outputDir, `${confirmationNumber}-cancellation.pdf`);
  const emailPath = path.join(outputDir, `${confirmationNumber}-cancellation.html`);
  await fs.promises.writeFile(pdfPath, pdfBuffer);
  await fs.promises.writeFile(emailPath, emailHtml);
  return { pdfPath, emailPath };
}

async function sendCancellationEmail({ cancellation, quote, summary, pdfBuffer }) {
  const emailHtml = createCancellationEmailHtml({ cancellation, quote, summary });
  const artifacts = await saveCancellationArtifacts({ confirmationNumber: cancellation.confirmationNumber, pdfBuffer, emailHtml });

  if (!SMTP_CONFIGURED) {
    return { sent: false, skipped: true, reason: 'SMTP is not configured.', ...artifacts };
  }

  const transporter = createSmtpTransporter();

  const info = await transporter.sendMail({
    from: EMAIL_FROM,
    to: cancellation.email,
    bcc: process.env.RESERVATION_BCC || RESERVATIONS_EMAIL,
    subject: `Cancellation of your Villa Maris Tiburon reservation - ${cancellation.confirmationNumber}`,
    html: emailHtml,
    attachments: [{
      filename: `Villa-Maris-Cancellation-${cancellation.confirmationNumber}.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf'
    }]
  });

  return {
    sent: true,
    messageId: info.messageId,
    acceptedCount: Array.isArray(info.accepted) ? info.accepted.length : undefined,
    rejectedCount: Array.isArray(info.rejected) ? info.rejected.length : undefined,
    ...artifacts
  };
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/api/payment/config', (req, res) => {
  res.json({
    apiLoginID: AUTHNET_API_LOGIN_ID,
    clientKey: AUTHNET_PUBLIC_CLIENT_KEY,
    environment: AUTHNET_ENV === 'production' ? 'production' : 'sandbox',
    configured: CHECKOUT_TEST_MODE || Boolean(AUTHNET_API_LOGIN_ID && AUTHNET_PUBLIC_CLIENT_KEY),
    testMode: CHECKOUT_TEST_MODE
  });
});

app.get('/api/email/status', async (req, res) => {
  const status = {
    configured: SMTP_CONFIGURED,
    hostConfigured: Boolean(process.env.SMTP_HOST),
    userConfigured: Boolean(process.env.SMTP_USER),
    passwordConfigured: Boolean(process.env.SMTP_PASS),
    fromConfigured: Boolean(process.env.EMAIL_FROM || process.env.SMTP_FROM),
    reservationBccConfigured: Boolean(process.env.RESERVATION_BCC || RESERVATIONS_EMAIL)
  };

  if (req.query.verify === 'true' && SMTP_CONFIGURED) {
    try {
      await createSmtpTransporter().verify();
      status.verified = true;
    } catch (error) {
      console.error('SMTP verification failed:', error);
      status.verified = false;
      if (!isProduction && error?.message) {
        status.detail = error.message;
      }
    }
  }

  res.json(status);
});

app.post('/api/reservation', async (req, res) => {
  const { firstName, lastName, email, phone, country, room, ratePlan = 'flexible', checkin, checkout, guests, specialRequests, addons, opaqueData, paymentMethod } = req.body;
  if (!firstName || !lastName || !email || !room || !checkin || !checkout) {
    return res.status(400).json({ success: false, message: 'Missing required reservation or payment fields.' });
  }
  if (!CHECKOUT_TEST_MODE && (!opaqueData?.dataDescriptor || !opaqueData?.dataValue)) {
    return res.status(400).json({ success: false, message: 'Missing payment authorization data.' });
  }
  if (!CHECKOUT_TEST_MODE && (!AUTHNET_API_LOGIN_ID || !AUTHNET_TRANSACTION_KEY)) {
    return res.status(500).json({ success: false, message: 'Authorize.net credentials are not configured.' });
  }

  try {
    const quote = calculateStayQuote({ room, checkin, checkout, ratePlan });
    const confirmationNumber = 'VM-' + Date.now().toString(36).toUpperCase();
    const reservation = {
      firstName,
      lastName,
      email,
      phone,
      country,
      room,
      ratePlan: quote.ratePlan,
      checkin,
      checkout,
      guests,
      specialRequests,
      addons: Array.isArray(addons) ? addons : addons ? [addons] : []
    };
    const payment = CHECKOUT_TEST_MODE
      ? processTestPayment({ paymentMethod, amount: quote.amountDue, confirmationNumber })
      : await processAuthorizeNetPayment({
        opaqueData,
        amount: quote.amountDue,
        confirmationNumber,
        reservation
      });
    const pdfBuffer = await createReceiptPdfBuffer({ reservation, quote, payment, confirmationNumber });
    let emailStatus;
    try {
      emailStatus = await sendConfirmationEmail({ reservation, quote, payment, confirmationNumber, pdfBuffer });
    } catch (error) {
      console.error('Reservation confirmation email failed:', error);
      emailStatus = createEmailErrorStatus(error, 'Confirmation email could not be sent.');
    }

    res.json({
      success: true,
      message: CHECKOUT_TEST_MODE
        ? 'Reservation request received. Payment processed successfully.'
        : quote.paymentType === 'full'
          ? 'Reservation request received and prepaid stay processed successfully.'
          : 'Reservation request received and deposit processed successfully.',
      confirmation: confirmationNumber,
      payment,
      email: emailStatus,
      quote,
      details: reservation
    });
  } catch (error) {
    const status = error.message && error.message.toLowerCase().includes('payment') ? 402 : 400;
    return res.status(status).json({ success: false, message: error.message });
  }
});

app.post('/api/reservation/cancel', async (req, res) => {
  const {
    confirmationNumber,
    firstName,
    lastName,
    email,
    phone,
    room,
    ratePlan = 'flexible',
    checkin,
    checkout,
    reason,
    cancellationFee,
    paymentMethod
  } = req.body;

  if (!confirmationNumber || !firstName || !lastName || !email || !room || !checkin || !checkout) {
    return res.status(400).json({ success: false, message: 'Missing required cancellation fields.' });
  }

  try {
    const quote = calculateStayQuote({ room, checkin, checkout, ratePlan });
    const cancellation = {
      confirmationNumber: confirmationNumber.replace(/^#/, ''),
      firstName,
      lastName,
      email,
      phone,
      room,
      ratePlan: quote.ratePlan,
      checkin,
      checkout,
      reason
    };
    const summary = createCancellationSummary({ quote, paymentMethod, cancellationFee });
    const pdfBuffer = await createCancellationPdfBuffer({ cancellation, quote, summary });
    let emailStatus;

    try {
      emailStatus = await sendCancellationEmail({ cancellation, quote, summary, pdfBuffer });
    } catch (error) {
      console.error('Reservation cancellation email failed:', error);
      emailStatus = createEmailErrorStatus(error, 'Cancellation email could not be sent.');
    }

    res.json({
      success: true,
      message: CHECKOUT_TEST_MODE
        ? 'Cancellation processed successfully.'
        : 'Cancellation processed successfully.',
      cancellation,
      quote,
      summary,
      email: emailStatus
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

app.post('/api/contact', (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ success: false, message: 'Missing required fields.' });
  }
  res.json({ success: true, message: 'Your message has been received. We will respond within 24 hours.' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Villa Maris Tiburon server running on port ${PORT}`);
});

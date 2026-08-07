# Villa Maris Tiburon

Static Node.js site for Villa Maris Tiburon.

## Local Development

1. Install Node.js (version 20+ recommended).
2. In the project root, install dependencies:

```bash
npm install
```

3. Start the app locally:

```bash
npm start
```

4. Open in your browser:

```bash
http://localhost:5000
```

## Notes

- The app uses `server.js` with Express and serves the `public/` directory.
- The server listens on `process.env.PORT` or `5000`.
- Replit-specific files and workflow configuration have been removed for local use.

## Authorize.net Checkout

The reservation checkout currently runs in test mode by default. Test mode accepts any card number, approves the reservation, generates a receipt PDF, and does not charge the card.

```bash
CHECKOUT_TEST_MODE=true
```

When you are ready to process live payments, set `CHECKOUT_TEST_MODE=false`. The custom reservation checkout will use Authorize.net Accept.js to tokenize card details in the browser, then charge the 50% reservation deposit from the server.

Set these environment variables before processing payments:

```bash
CHECKOUT_TEST_MODE=false
AUTHORIZE_NET_ENV=sandbox
AUTHORIZE_NET_API_LOGIN_ID=your_api_login_id
AUTHORIZE_NET_TRANSACTION_KEY=your_transaction_key
AUTHORIZE_NET_PUBLIC_CLIENT_KEY=your_public_client_key
```

Use `AUTHORIZE_NET_ENV=production` with production Authorize.net credentials when the site is live.

## Reservation Email

Reservation confirmations include a receipt PDF attachment. On Render free services, use Resend because outbound SMTP ports are blocked:

```bash
RESEND_API_KEY=your_resend_api_key
RESEND_FROM="Villa Maris Tiburon <reservations@villamaristiburon.com>"
EMAIL_FROM="Villa Maris Tiburon <reservations@villamaristiburon.com>"
RESERVATION_BCC=reservations@villamaristiburon.com
```

The `RESEND_FROM` or `EMAIL_FROM` domain must be verified in Resend. SMTP is still supported as a fallback for local development or paid hosts:

```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_smtp_user
SMTP_PASS=your_smtp_password
EMAIL_FROM="Villa Maris Tiburon <reservations@villamaristiburon.com>"
RESERVATION_BCC=reservations@villamaristiburon.com
```

If email sending is not configured, the app still completes test reservations and writes preview files to `output/reservations/`.

Reservation management is available at:

```bash
http://localhost:5000/cancel-reservation.html
```

Guests authenticate with their booking reference and reservation email, then can update guest/stay details or cancel the reservation. Reservation records are stored in `ARTIFACT_STORAGE_DIR/reservations.json`; the Render deployment maps that directory to its persistent disk.

Cancellation confirmations use the same email settings. The cancellation email includes the generated PDF receipt as an attachment. If email is not configured, the cancellation email HTML and PDF previews are written to `output/cancellations/` and returned in the API response for verification.

## Docker

Build the production image:

```bash
docker build -t villa-maris-tiburon .
```

Run it locally:

```bash
docker run --rm -p 5000:5000 villa-maris-tiburon
```

Open `http://localhost:5000`.

## Deploy on Render

### Option 1: Render builds from this repo

1. Push this repository to GitHub, GitLab, or Bitbucket.
2. In Render, create a new Blueprint from the repo.
3. Render will use `render.yaml`, build the Dockerfile, and run `npm start`.

### Option 2: Push to a Docker registry first

Replace `YOUR_REGISTRY/YOUR_IMAGE:TAG` with your Docker Hub, GHCR, or other registry image name:

```bash
docker build -t YOUR_REGISTRY/YOUR_IMAGE:TAG .
docker push YOUR_REGISTRY/YOUR_IMAGE:TAG
```

In Render, create a new Web Service from an existing image and set the image URL to `YOUR_REGISTRY/YOUR_IMAGE:TAG`. For private images, add the registry credential in Render first.

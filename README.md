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

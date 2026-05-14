# Fee Explorer

Fee Explorer ingests FeeCollector contract events from an EVM chain and stores them in MongoDB. It also exposes a small Fastify API for querying stored events by integrator address.

The service is split into two processes:

- `api`: serves health checks and the `GET /events` endpoint.
- `ingestor`: reads FeeCollector events from the configured RPC endpoint and persists them.

## Requirements

- Node.js 22 or newer
- npm
- MongoDB, or Docker Compose for the bundled MongoDB service

## Configuration

Copy the example environment file and adjust values if needed:

```sh
cp .env.example .env
```

Important settings:

- `MONGODB_URI`: MongoDB connection string.
- `RPC_URL`: EVM RPC endpoint used by the ingestor.
- `CONTRACT_ADDRESS`: FeeCollector contract address.
- `START_BLOCK`: first block to ingest.
- `PORT`: API port, defaults to `3000`.

## Running Locally

Install dependencies:

```sh
npm install
```

Start MongoDB with Docker Compose:

```sh
docker compose up -d mongodb
```

Run the API:

```sh
npm run dev:api
```

Run the ingestor in a second terminal:

```sh
npm run dev:ingestor
```

The API listens on `http://localhost:3000` by default.

Example request:

```sh
curl "http://localhost:3000/events?integrator=0x0000000000000000000000000000000000000000&limit=100&offset=0"
```

`limit` defaults to `100` and is capped at `500`. `offset` defaults to `0`.

## Running With Docker Compose

Build and start MongoDB, the API, and the ingestor:

```sh
docker compose up --build
```

Stop the stack:

```sh
docker compose down
```

## Useful Commands

```sh
npm run test
npm run typecheck
npm run build
npm run format:check
```

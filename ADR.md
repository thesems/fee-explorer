# Fee Explorer Architecture

## Context
The FeeCollector contract is responsible for receiving fees from the various Li-Fi integrators.
It is an EVM smart contract that emits an event for each fee received. The event contains useful information such as
the sender account, integrator, integrator fee, and LI.FI fee. A new service called `fee-explorer` will be responsible
for processing these events embedded within blocks. It shall provide API functionality to query historical
events using a block-number range query and store them in MongoDB using the typegoose framework.

### Requirements

The `fee-explorer` service has several requirements:
- Ingest emitted events and store them in a MongoDB database.
    - Avoid reingesting the same events (improve efficiency).
    - Earliest block number for Polygon: 78600000
- Provide historical lookup of FeeCollector events via an API.
    - Block-number range query (from, to)
- Wrap the application in a Docker image and run it in a Docker container.

You are required to use the following stack:
- Language: TypeScript
- Database: MongoDB
- Database framework: typegoose
- RPCs: ethers.js
- Other: lifi contract types

Other libraries can be used in conjunction, but opinionated frameworks like NestJS should be avoided.

## Decision

We will build `fee-explorer` as two separate components:
- an ingestion component
- an API component

### Ingestion
The ingestion component is responsible for ingesting historical events from each block emitted by the FeeCollector smart contract. It stores the events in a MongoDB collection `events`, as described below. The component starts ingestion from the specified block number and ingests all data until the latest block. Then, it polls for the latest changes at a regular interval.

A single ingestion component can run at a time (a multi-worker design is presented in Alternatives). Upon restart or failure, it continues from where it left off.

#### Persistence

Collection `events` schema:
- uuid: string/UUID
- chainId: number
- contractAddress: string
- tokenAddress: string
- integrator: string
- integratorFee: string
- lifiFee: string
- blockNumber: number
- logIndex: number
- transactionHash: string
- timestamp: Date
- createdAt: Date

Indexes:
- Unique index on (chainId, contractAddress, blockNumber, logIndex)
- Index on (chainId, contractAddress, blockNumber)
- Index on (chainId, contractAddress, integrator, blockNumber)

Collection `progress` schema:
- chainId: number
- contractId: string
- lastProcessedBlock: number
- updatedAt: datetime

Indexes:
- Unique index on (chainId, contractId)

#### Configuration

Ingestion can configured to support different EVM chains (e.g. Polygon, Ethereum, etc.) or RPC providers. A single contract can be ingested per ingestion component. 

Configuration keys:
- CHAIN_ID (e.g. 137)
- RPC_URL (e.g. https://polygon-rpc.com)
- CONTRACT (e.g. 0xbD6C7B0d2f68c2b7805d88388319cfB6EcB50eA9)
- POLL_INTERVAL (e.g. 5s)

### API

The API component implements an endpoint for retrieving all events for a given integrator. The endpoint fetches the events directly from the MongoDB collection. If the collection is empty or not yet synced, it returns an error response.

The component does not interact directly with the ingestion component.

The component is using the following libraries:
- fastify for API server
- zod for user input validation
- typegoose as a MongoDB client

Endpoints for component health status are provided (/livez, /readyz).

## Consequences

Separating ingestion and API components simplifies the deployment process.
Each can be operated separately. The API can be scaled up to handle more traffic and it is abstracted from the RPC-related logic. Likewise, the ingestion component focuses on a single job, which is ingestion.

A single ingestion worker somewhat limits ingestion speed, as it sequentially fetches and processes all the events.

## Alternatives

### Multi-worker
- WorkRange collection (block start and end, status)
- WorkRange assigned by a `worker-assigner` component.
- `worker` components atomically claim WorkRanges and perform backfilling.

This was intentionally not selected for this assignment, as a single-worker favors correctness and simplicity. It can be later extended with a multi-worker setup using claimable work-ranges.

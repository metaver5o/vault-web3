FROM node:20-alpine

# Build deps for native addons
RUN apk add --no-cache python3 make g++ linux-headers

WORKDIR /app

COPY package*.json ./
COPY packages/contracts/package*.json packages/contracts/
RUN npm ci --workspace=packages/contracts

COPY packages/contracts/ packages/contracts/

WORKDIR /app/packages/contracts
RUN npx hardhat compile

# Run a persistent Hardhat node
EXPOSE 8545
CMD ["npx", "hardhat", "node", "--hostname", "0.0.0.0", "--port", "8545"]

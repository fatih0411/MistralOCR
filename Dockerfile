# Use official Node.js slim image
FROM node:18-slim

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the code
COPY . .

# Build the TypeScript project
RUN npm run build

# Set environment variable (override at runtime)
ENV MISTRAL_API_KEY=changeme

# Run the MCP server
CMD ["node", "build/index.js"]
FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src

ENV MCP_HOST=0.0.0.0
ENV MCP_PORT=8002
EXPOSE 8002
CMD ["node", "src/index.js"]

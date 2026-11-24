FROM node:22.13-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY public ./public
COPY src ./src
COPY LICENSE README.md ./

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/tasks.db

EXPOSE 3000

RUN mkdir -p /app/data

CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]

FROM mcr.microsoft.com/playwright:v1.55.0-noble
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY journeys.js check-agent.js ./
ENV NODE_ENV=production
CMD ["node", "journeys.js"]

FROM node:20-alpine

WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY public ./public
COPY data ./data
COPY db ./db

ENV NODE_ENV=production
ENV PORT=3050
ENV OAV_DB_FILE=/data/db.json

EXPOSE 3050
CMD ["node", "server.js"]

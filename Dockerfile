FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY server.js engine.js ./
COPY public ./public

RUN mkdir -p data/sessions

ENV PORT=8792
ENV HOST=0.0.0.0
EXPOSE 8792

CMD ["node", "server.js"]

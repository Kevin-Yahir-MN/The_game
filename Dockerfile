FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000

RUN mkdir -p /app/uploads/avatars

EXPOSE 3000

CMD ["npm", "start"]

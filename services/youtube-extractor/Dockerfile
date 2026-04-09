FROM node:20-slim

RUN apt-get update && apt-get install -y \
  python3 \
  python3-pip \
  ffmpeg \
  curl \
  --no-install-recommends \
  && pip3 install -U yt-dlp --break-system-packages \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

EXPOSE 3000
CMD ["node", "server.js"]

# Fly.io / Railway / 기타 컨테이너 호스트용 (Render는 Dockerfile 없이 render.yaml로도 됨)
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV PORT=8080
EXPOSE 8080
CMD ["npm", "start"]

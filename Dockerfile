FROM node:20-alpine

WORKDIR /app

# Step 1: Copia solo i file del backend necessari per npm install
COPY package*.json ./
RUN npm install

# Step 2: Copia il frontend e compila
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm install
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# Step 3: Sposta la build di vite (dist) nella cartella public del backend
RUN mkdir -p public && mv frontend/dist/* public/ && rm -rf frontend

# Step 4: Copia il resto del codice backend
COPY src/ ./src/
COPY .env ./

ENV HARDWARE_MODE=mock
EXPOSE 3001

CMD ["node", "src/server.js"]

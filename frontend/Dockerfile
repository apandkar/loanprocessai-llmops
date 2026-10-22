# Stage 1: Build React app
FROM node:20.11.1-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build   # creates /app/build

# Stage 2: Serve via nginx
FROM nginx:alpine

COPY --from=builder /app/build /usr/share/nginx/html

# (Cloud Run fix - recommended)
EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
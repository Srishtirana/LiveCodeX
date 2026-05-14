# LiveCodeX Deployment

## Render: Express API

Use these settings for the Express service:

```txt
Root Directory: apps/express-server
Build Command: npm install && npm run build
Start Command: npm start
```

Environment variables:

```txt
CLIENT_ORIGINS=https://your-frontend.vercel.app
REDIS_URL=
```

The API health check is:

```txt
https://your-express-service.onrender.com/health
```

## Render: WebSocket API

Use these settings for the WebSocket service:

```txt
Root Directory: apps/websocket-server
Build Command: npm install && npm run build
Start Command: npm start
```

Environment variables:

```txt
CLIENT_ORIGINS=https://your-frontend.vercel.app
REDIS_URL=
```

The WebSocket health check is:

```txt
https://your-websocket-service.onrender.com/health
```

## Vercel: Frontend

Use these settings for the frontend:

```txt
Root Directory: apps/frontend
Build Command: npm run build
Output Directory: dist
```

Environment variables:

```txt
VITE_EXPRESS_URL=https://your-express-service.onrender.com
VITE_WS_URL=wss://your-websocket-service.onrender.com
```

After changing Vercel environment variables, redeploy the frontend.

## Redis

Redis is optional. Without `REDIS_URL`, rooms are stored in memory and reset when the Render service restarts.

For persistent rooms, create a Render Key Value instance and set the same `REDIS_URL` on both backend services.

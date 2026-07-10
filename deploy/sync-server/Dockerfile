# No native addons — uses Node's built-in node:sqlite (stable in Node 24+).
FROM node:24-slim
WORKDIR /app
COPY package.json server.mjs ./
RUN mkdir -p /app/data
ENV PORT=4000 DB_PATH=/app/data/sync.db
VOLUME ["/app/data"]
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]

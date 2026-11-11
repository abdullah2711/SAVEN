FROM node:24.19.0-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node public ./public
RUN mkdir var && chown node:node var
USER node
ENV BIND_HOST=0.0.0.0 PUBLIC_ORIGIN=http://localhost:8787
EXPOSE 8787
CMD ["node", "scripts/server.mjs"]

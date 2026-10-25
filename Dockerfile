FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY . .

# Certificado das autoridades do Amazon RDS (para validar a conexão SSL com o banco)
RUN mkdir -p /app/certs \
 && wget -q -O /app/certs/rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
 && chmod 644 /app/certs/rds-global-bundle.pem

ENV PORT=8080
EXPOSE 8080

USER node
CMD ["sh", "-c", "node scripts/bootstrap.js && node src/server.js"]

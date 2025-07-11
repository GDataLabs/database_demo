FROM node:18-alpine

# Install SQLite
RUN apk add --no-cache sqlite

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy application files
COPY . .

# Create directory for SQLite database
RUN mkdir -p /app/data

# Set port
ENV PORT=8080

# Expose port
EXPOSE 8080

# Start the application
CMD ["node", "start.js"]
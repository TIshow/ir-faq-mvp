# Node.js 24（.tool-versions の nodejs 24.16.0 に合わせる。node:18 は EOL）
FROM node:24-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Remove devDependencies to reduce image size
RUN npm prune --production

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

# Change ownership of .next directory
RUN chown -R nextjs:nodejs /app/.next

# Switch to non-root user
USER nextjs

# Expose port (Cloud Run uses PORT env var, default to 3000)
EXPOSE 3000

# Set environment variable for production
ENV NODE_ENV=production
ENV PORT=3000

# Start the application
CMD ["npm", "start"]
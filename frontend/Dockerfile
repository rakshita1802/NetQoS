FROM node:18-alpine

# Set the working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
RUN npm install

# Copy the frontend source code
COPY . .

# Expose the Vite dev server port
EXPOSE 5173

# Start the dev server and bind to all network interfaces so host can access it
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

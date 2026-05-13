FROM nginx:alpine

# Install Python, pip, and Docker CLI (for compose commands)
RUN apk add --no-cache python3 py3-pip docker-cli docker-cli-compose

# Install Python dependencies
COPY requirements.txt /app/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r /app/requirements.txt

# Copy API server
COPY api_server.py /app/api_server.py

# Copy static files
COPY index.html /usr/share/nginx/html/
COPY css/styles.css /usr/share/nginx/html/css/
COPY js/utils.js /usr/share/nginx/html/js/
COPY js/main.js /usr/share/nginx/html/js/

# Update nginx configuration references
RUN sed -i 's|src="assets/utils.js"|src="js/utils.js"|g' /usr/share/nginx/html/index.html && \
    sed -i 's|src="assets/main.js"|src="js/main.js"|g' /usr/share/nginx/html/index.html && \
    sed -i 's|href="assets/styles.css"|href="css/styles.css"|g' /usr/share/nginx/html/index.html

# Copy nginx config (proxies /api/* to backend on 127.0.0.1:9000)
COPY nginx.conf /etc/nginx/nginx.conf
RUN rm -f /etc/nginx/conf.d/default.conf

# Copy startup script
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost/health || exit 1

CMD ["/app/start.sh"]

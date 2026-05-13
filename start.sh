#!/bin/sh

# Start the FastAPI backend
python3 /app/api_server.py &

# Start nginx in the foreground
nginx -g 'daemon off;'

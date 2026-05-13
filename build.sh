#!/bin/bash
# Build static HTML portal for Docker services

cd "$(dirname "$0")"

# Create nginx web user
if ! id -u nginx >/dev/null 2>&1; then
    echo "Creating nginx user..."
    useradd -r -s /bin/nologin nginx -M || true
fi

# Copy assets
echo "Copy assets..."
mkdir -p html/assets

# Copy JS files
cp js/*.js html/

# Update index.html to reference correct locations
sed -i 's|href="css/styles.css"|href="assets/styles.css"|g' html/index.html
sed -i 's|<script src="js/utils.js"></script>|<script src="assets/utils.js"></script>|g' html/index.html
sed -i 's|<script src="js/main.js"></script>|<script src="assets/main.js"></script>|g' html/index.html

# Compile and minify if available
if command -v htmlmin &>/dev/null; then
    echo "Minifying HTML..."
    htmlmin -o html/index.min.html html/index.html
    mv html/index.min.html html/index.html
fi

if command -v uglifyjs &>/dev/null; then
    echo "Minifying JS files..."
    uglifyjs -o html/assets/utils.min.js html/assets/utils.js
    uglifyjs -o html/assets/main.min.js html/assets/main.js
fi

echo "Build complete!"
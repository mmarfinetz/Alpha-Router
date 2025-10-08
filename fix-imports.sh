#!/bin/bash
# Fix .js imports to work with ts-node

echo "Fixing imports for ts-node..."

# Fix imports in src directory
find src -name "*.ts" -type f -exec sed -i '' "s/from '\.\(.*\)\.js'/from '.\1'/g" {} \;
find src -name "*.ts" -type f -exec sed -i '' 's/from "\.\(.*\)\.js"/from ".\1"/g' {} \;

echo "✅ Imports fixed!"

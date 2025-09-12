#!/bin/bash

# Script to clean up redundant scanner and test scripts
# This can be run to remove old scripts after verifying the new consolidated ones work

echo "🧹 Cleaning up redundant scripts..."
echo ""

# List of files to be removed
OLD_SCRIPTS=(
    "scripts/scanner/basic.sh"
    "scripts/scanner/advanced.sh"
    "scripts/test/mevshare.sh"
)

echo "The following files will be removed:"
for script in "${OLD_SCRIPTS[@]}"; do
    if [ -f "$script" ]; then
        echo "  • $script"
    fi
done

echo ""
read -p "Do you want to proceed with cleanup? (y/n) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    for script in "${OLD_SCRIPTS[@]}"; do
        if [ -f "$script" ]; then
            rm "$script"
            echo "✅ Removed: $script"
        fi
    done
    
    # Remove empty directories
    if [ -d "scripts/scanner" ] && [ -z "$(ls -A scripts/scanner)" ]; then
        rmdir "scripts/scanner"
        echo "✅ Removed empty directory: scripts/scanner"
    fi
    
    if [ -d "scripts/test" ] && [ ! "$(ls scripts/test/*.mjs 2>/dev/null)" ]; then
        echo "📌 Keeping scripts/test/ (contains hybrid.mjs)"
    fi
    
    echo ""
    echo "✅ Cleanup complete!"
else
    echo "❌ Cleanup cancelled"
fi
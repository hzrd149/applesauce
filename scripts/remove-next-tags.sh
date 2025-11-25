#!/bin/bash

# Script to remove all local git tags containing "0.0.0-next"

set -e

echo "Finding all local tags containing '0.0.0-next'..."

# Get all tags matching the pattern
tags=$(git tag | grep "0.0.0-next" || true)

if [ -z "$tags" ]; then
    echo "No tags matching '0.0.0-next' found."
    exit 0
fi

# Count the tags
tag_count=$(echo "$tags" | wc -l)
echo "Found $tag_count tag(s) to remove."

# Remove each tag
echo "$tags" | while read -r tag; do
    echo "Removing tag: $tag"
    git tag -d "$tag" || true
done

echo "Done! Removed all local '0.0.0-next' tags."


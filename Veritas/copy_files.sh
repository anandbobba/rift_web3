
#!/bin/bash
# Script to copy required files to the frontend project
# Usage: ./copy_files.sh <project_name>


project_name="$1"
frontend_root="./projects/${project_name}-frontend"

# Ensure directories exist
mkdir -p "${frontend_root}/src/components"

# Copy files
cp "./inject_content/Home.tsx" "${frontend_root}/src/Home.tsx"
cp "./inject_content/AppCalls.tsx" "${frontend_root}/src/components/AppCalls.tsx"

echo "Template completed successfully!"
# remove inject_content folder
rm -rf "./inject_content"
# self destruct the file
rm -f "$0"



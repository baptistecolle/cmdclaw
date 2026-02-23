#!/bin/bash
# Setup CLI tools with nice command names

mkdir -p ~/.local/bin

for tool in /app/cli/*.ts; do
  name=$(basename "$tool" .ts)
  cat > ~/.local/bin/"$name" << EOF
#!/bin/bash
exec tsx $tool "\$@"
EOF
  chmod +x ~/.local/bin/"$name"
done

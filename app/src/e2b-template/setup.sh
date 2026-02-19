#!/bin/bash
# Setup CLI tools from skills directory with nice command names

mkdir -p ~/.local/bin

for tool in /app/.claude/skills/*/src/*.ts; do
  name=$(basename "$tool" .ts)
  cat > ~/.local/bin/"$name" << EOF
#!/bin/bash
exec tsx $tool "\$@"
EOF
  chmod +x ~/.local/bin/"$name"
done

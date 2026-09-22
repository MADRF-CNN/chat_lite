#!/bin/sh
set -eu
backup_dir="${1:-./backups}"
mkdir -p "$backup_dir"
stamp=$(date +%Y%m%d-%H%M%S)
docker compose exec -T postgres pg_dump -U chat -d chat_lite -Fc > "$backup_dir/postgres-$stamp.dump"
docker compose exec -T minio sh -c 'tar -czf - /data' > "$backup_dir/minio-$stamp.tar.gz"
echo "Backup written to $backup_dir"

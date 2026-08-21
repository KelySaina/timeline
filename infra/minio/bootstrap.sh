#!/bin/sh
# Prepares the photo bucket and the credentials the API uses. Idempotent: it runs on every
# `docker compose up` and does nothing the second time.
#
# The point of this script is that the API never holds MinIO root credentials. It gets a user whose
# policy can only read, write and delete objects inside one bucket — nothing else, no other bucket,
# no admin surface.
set -eu

: "${MINIO_ROOT_USER:?MINIO_ROOT_USER is required}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD is required}"
: "${S3_BUCKET:?S3_BUCKET is required}"
: "${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID is required}"
: "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY is required}"

POLICY_NAME="timeline-photos-rw"
POLICY_FILE=/tmp/photos-policy.json

echo "[minio-init] waiting for minio"
until mc alias set store "http://minio:9000" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; do
  sleep 1
done

echo "[minio-init] bucket $S3_BUCKET"
mc mb --ignore-existing "store/$S3_BUCKET"

# Explicitly private. This single setting is the difference between "private photos" and a leak,
# so it is asserted on every boot rather than assumed from the default.
mc anonymous set none "store/$S3_BUCKET"

# Versioning is the durability argument for using an object store at all. A single-drive MinIO
# cannot do it — not fatal, but worth saying out loud instead of pretending we have it.
if mc version enable "store/$S3_BUCKET" >/dev/null 2>&1; then
  echo "[minio-init] versioning enabled"
else
  echo "[minio-init] versioning unavailable on this deployment (single drive) — back up the volume"
fi

# Written here rather than templated from a file: the mc image has no sed, and a heredoc keeps the
# policy readable in the one place that applies it. Object read/write in one bucket, nothing else.
cat > "$POLICY_FILE" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadBucketMetadata",
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": ["arn:aws:s3:::$S3_BUCKET"]
    },
    {
      "Sid": "ReadWritePhotoObjects",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::$S3_BUCKET/*"]
    }
  ]
}
JSON

if mc admin policy info store "$POLICY_NAME" >/dev/null 2>&1; then
  echo "[minio-init] policy $POLICY_NAME exists"
else
  mc admin policy create store "$POLICY_NAME" "$POLICY_FILE"
fi

if [ "${FORCE_KEY_ROTATION:-false}" = "true" ]; then
  # `user add` on an existing name replaces the secret — this is the rotation path.
  mc admin user add store "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY"
  echo "[minio-init] rotated the secret for $S3_ACCESS_KEY_ID"
elif mc admin user info store "$S3_ACCESS_KEY_ID" >/dev/null 2>&1; then
  echo "[minio-init] user $S3_ACCESS_KEY_ID exists"
else
  mc admin user add store "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY"
fi

mc admin policy attach store "$POLICY_NAME" --user "$S3_ACCESS_KEY_ID" >/dev/null 2>&1 ||
  echo "[minio-init] policy already attached"

echo "[minio-init] ready — API can reach s3://$S3_BUCKET with a scoped key only"

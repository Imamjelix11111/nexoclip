"""Minimal Cloudflare R2 (S3-compatible) uploader — same bucket the Node app uses."""
from __future__ import annotations

import os

import boto3


def _client():
    account_id = os.environ["R2_ACCOUNT_ID"]
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )


def upload_file_to_r2(local_path: str, key: str, content_type: str) -> str:
    bucket = os.environ["R2_BUCKET"]
    public_url = os.environ["R2_PUBLIC_URL"].rstrip("/")
    _client().upload_file(local_path, bucket, key, ExtraArgs={"ContentType": content_type})
    return f"{public_url}/{key}"

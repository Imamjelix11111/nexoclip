import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function createR2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${required('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: required('R2_ACCESS_KEY_ID'),
      secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
    },
  });
}

export class R2ObjectStorage {
  constructor({ bucket = required('R2_BUCKET'), publicUrl = required('R2_PUBLIC_URL'), client = createR2Client() } = {}) {
    this.bucket = bucket;
    this.publicUrl = publicUrl.replace(/\/+$/, '');
    this.client = client;
  }

  async put(key, body, contentType) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
    return `${this.publicUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  async get(key) {
    return this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

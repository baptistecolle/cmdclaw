import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/env";

// S3 client singleton
let s3Client: S3Client | null = null;

export function getS3Client(): S3Client {
  if (!s3Client) {
    if (
      !env.S3_ENDPOINT ||
      !env.S3_ACCESS_KEY_ID ||
      !env.S3_SECRET_ACCESS_KEY
    ) {
      throw new Error(
        "S3 configuration is incomplete. Check S3_ENDPOINT, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY.",
      );
    }

    s3Client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
  }
  return s3Client;
}

export const BUCKET_NAME = env.S3_BUCKET_NAME;

// Ensure bucket exists (call on startup or first upload)
export async function ensureBucket(): Promise<void> {
  const client = getS3Client();

  try {
    await client.send(new HeadBucketCommand({ Bucket: BUCKET_NAME }));
  } catch (error: unknown) {
    const err = error as {
      name?: string;
      $metadata?: { httpStatusCode?: number };
    };
    if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
      await client.send(new CreateBucketCommand({ Bucket: BUCKET_NAME }));
      console.log(`Created S3 bucket: ${BUCKET_NAME}`);
    } else {
      throw error;
    }
  }
}

// Upload file to S3
export async function uploadToS3(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const client = getS3Client();

  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

// Delete file from S3
export async function deleteFromS3(key: string): Promise<void> {
  const client = getS3Client();

  await client.send(
    new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    }),
  );
}

// Generate presigned URL for downloading
export async function getPresignedDownloadUrl(
  key: string,
  expiresInSeconds: number = 3600,
): Promise<string> {
  const client = getS3Client();

  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

// Download file content from S3 as Buffer
export async function downloadFromS3(key: string): Promise<Buffer> {
  const client = getS3Client();

  const response = await client.send(
    new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    }),
  );

  if (!response.Body) {
    throw new Error(`No body returned for S3 key: ${key}`);
  }

  // Convert the readable stream to a buffer
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Generate storage key for a skill document
export function generateStorageKey(
  userId: string,
  skillId: string,
  filename: string,
): string {
  const timestamp = Date.now();
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, "_");
  return `skills/${userId}/${skillId}/${timestamp}-${sanitizedFilename}`;
}

output "bucket_name" {
  description = "Name of the S3 bucket"
  value       = aws_s3_bucket.documents.id
}

output "bucket_arn" {
  description = "ARN of the S3 bucket"
  value       = aws_s3_bucket.documents.arn
}

output "bucket_region" {
  description = "Region of the S3 bucket"
  value       = aws_s3_bucket.documents.region
}

output "bucket_endpoint" {
  description = "S3 bucket endpoint"
  value       = "https://${aws_s3_bucket.documents.bucket}.s3.${var.aws_region}.amazonaws.com"
}

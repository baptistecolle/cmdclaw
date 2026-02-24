variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name (e.g., dev, staging, production)"
  type        = string
  default     = "production"
}

variable "bucket_name" {
  description = "Name of the S3 bucket for documents"
  type        = string
  default     = "cmdclaw-documents"
}

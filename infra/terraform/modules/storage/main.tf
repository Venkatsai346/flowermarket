/**
 * Flower Market — Terraform Storage Module.
 *
 * Creates:
 *   - S3 bucket for media uploads (product images, invoices)
 *   - S3 bucket for static assets (frontend build)
 *   - CloudFront CDN for static assets
 *   - S3 lifecycle policies (cost optimization)
 */

variable "environment" { type = string }
variable "domain_name" { type = string; default = "" }

locals {
  name = "flowermarket-${var.environment}"
  tags = { Project = "flowermarket", Environment = var.environment, ManagedBy = "terraform" }
}

# ── Media Bucket ──
resource "aws_s3_bucket" "media" {
  bucket = "${local.name}-media"
  tags   = local.tags
}

resource "aws_s3_bucket_versioning" "media" {
  bucket = aws_s3_bucket.media.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    id     = "archive-old"
    status = "Enabled"
    transition {
      days          = 90
      storage_class = "GLACIER"
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "POST"]
    allowed_origins = ["https://*.flowermarket.in", "http://localhost:5173"]
    max_age_seconds = 3600
  }
}

# ── Static Assets Bucket ──
resource "aws_s3_bucket" "static" {
  bucket = "${local.name}-static"
  tags   = local.tags
}

resource "aws_s3_bucket_public_access_block" "static" {
  bucket                  = aws_s3_bucket.static.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ── CloudFront Distribution ──
resource "aws_cloudfront_distribution" "static" {
  enabled             = true
  default_root_object = "index.html"
  price_class         = "PriceClass_200" # Global

  origin {
    domain_name = aws_s3_bucket.static.bucket_regional_domain_name
    origin_id   = "s3-static"
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-static"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 86400
    max_ttl     = 31536000
  }

  # SPA: redirect 404 to index.html
  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
    # Use acm_certificate_arn for custom domain
  }

  tags = local.tags
}

# ── Outputs ──
output "media_bucket" { value = aws_s3_bucket.media.id }
output "media_bucket_arn" { value = aws_s3_bucket.media.arn }
output "static_bucket" { value = aws_s3_bucket.static.id }
output "cdn_domain" { value = aws_cloudfront_distribution.static.domain_name }
output "cdn_distribution_id" { value = aws_cloudfront_distribution.static.id }

/**
 * Flower Market — Terraform root module (staging/production).
 *
 * Usage:
 *   cd infra/terraform/environments/staging
 *   terraform init && terraform plan && terraform apply
 */

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = { source = "hashicorp/aws"; version = "~> 5.0" }
  }

  backend "s3" {
    bucket         = "flowermarket-terraform-state"
    key            = "staging/terraform.tfstate"
    region         = "ap-south-1"
    dynamodb_table = "terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = "ap-south-1" # Mumbai — closest to India
  default_tags {
    tags = {
      Project     = "flowermarket"
      Environment = "staging"
      ManagedBy   = "terraform"
    }
  }
}

variable "environment" { default = "staging" }

module "vpc" {
  source      = "../../modules/vpc"
  environment = var.environment
  vpc_cidr    = "10.0.0.0/16"
}

module "eks" {
  source              = "../../modules/eks"
  environment         = var.environment
  vpc_id              = module.vpc.vpc_id
  private_subnet_ids  = module.vpc.private_subnet_ids
  node_instance_types = ["t3.medium"]
  node_desired        = 2
  node_min            = 1
  node_max            = 4
}

module "storage" {
  source      = "../../modules/storage"
  environment = var.environment
}

# ── Outputs ──
output "vpc_id" { value = module.vpc.vpc_id }
output "eks_endpoint" { value = module.eks.cluster_endpoint }
output "eks_cluster_name" { value = module.eks.cluster_name }
output "cdn_domain" { value = module.storage.cdn_domain }
output "media_bucket" { value = module.storage.media_bucket }

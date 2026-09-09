/**
 * Flower Market — Terraform VPC Module.
 *
 * Creates a production-grade VPC with:
 *   - 3 AZs for high availability
 *   - Public subnets (ALB, NAT gateways)
 *   - Private subnets (EKS nodes, databases)
 *   - NAT gateways for outbound internet
 *   - VPC flow logs for auditing
 */

variable "environment" {
  type        = string
  description = "Environment name (staging, production)"
}

variable "vpc_cidr" {
  type        = string
  default     = "10.0.0.0/16"
  description = "VPC CIDR block"
}

variable "azs" {
  type        = list(string)
  default     = ["ap-south-1a", "ap-south-1b", "ap-south-1c"]
  description = "Availability zones (Mumbai region for India)"
}

locals {
  name = "flowermarket-${var.environment}"
  tags = {
    Project     = "flowermarket"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# ── VPC ──
resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = merge(local.tags, { Name = local.name })
}

# ── Internet Gateway ──
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = merge(local.tags, { Name = "${local.name}-igw" })
}

# ── Public Subnets (ALB, NAT) ──
resource "aws_subnet" "public" {
  count                   = length(var.azs)
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, count.index)
  availability_zone       = var.azs[count.index]
  map_public_ip_on_launch = true

  tags = merge(local.tags, {
    Name                                           = "${local.name}-public-${var.azs[count.index]}"
    "kubernetes.io/role/elb"                        = "1"
    "kubernetes.io/cluster/${local.name}-eks"       = "shared"
  })
}

# ── Private Subnets (EKS nodes, DB) ──
resource "aws_subnet" "private" {
  count             = length(var.azs)
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index + length(var.azs))
  availability_zone = var.azs[count.index]

  tags = merge(local.tags, {
    Name                                           = "${local.name}-private-${var.azs[count.index]}"
    "kubernetes.io/role/internal-elb"               = "1"
    "kubernetes.io/cluster/${local.name}-eks"       = "shared"
  })
}

# ── Elastic IPs for NAT ──
resource "aws_eip" "nat" {
  count  = 1 # Single NAT for staging; 3 for production
  domain = "vpc"
  tags   = merge(local.tags, { Name = "${local.name}-nat-${count.index}" })
}

# ── NAT Gateway ──
resource "aws_nat_gateway" "main" {
  count         = 1
  allocation_id = aws_eip.nat[0].id
  subnet_id     = aws_subnet.public[0].id
  tags          = merge(local.tags, { Name = "${local.name}-nat" })

  depends_on = [aws_internet_gateway.main]
}

# ── Route Tables ──
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  tags   = merge(local.tags, { Name = "${local.name}-public-rt" })
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.main.id
}

resource "aws_route_table_association" "public" {
  count          = length(var.azs)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  tags   = merge(local.tags, { Name = "${local.name}-private-rt" })
}

resource "aws_route" "private_nat" {
  route_table_id         = aws_route_table.private.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.main[0].id
}

resource "aws_route_table_association" "private" {
  count          = length(var.azs)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# ── VPC Flow Logs ──
resource "aws_flow_log" "main" {
  vpc_id               = aws_vpc.main.id
  traffic_type         = "ALL"
  log_destination_type = "cloud-watch-logs"
  log_destination      = aws_cloudwatch_log_group.flow_logs.arn
  iam_role_arn         = aws_iam_role.flow_logs.arn
  tags                 = local.tags
}

resource "aws_cloudwatch_log_group" "flow_logs" {
  name              = "/aws/vpc/${local.name}-flow-logs"
  retention_in_days = 30
  tags              = local.tags
}

resource "aws_iam_role" "flow_logs" {
  name = "${local.name}-vpc-flow-logs"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "vpc-flow-logs.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "flow_logs" {
  name = "${local.name}-vpc-flow-logs"
  role = aws_iam_role.flow_logs.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams",
      ]
      Effect   = "Allow"
      Resource = "*"
    }]
  })
}

# ── Outputs ──
output "vpc_id" { value = aws_vpc.main.id }
output "public_subnet_ids" { value = aws_subnet.public[*].id }
output "private_subnet_ids" { value = aws_subnet.private[*].id }
output "nat_gateway_ip" { value = aws_eip.nat[0].public_ip }

# BCK Backup Manager — AWS Marketplace
# Deploy to AWS ECS Fargate

provider "aws" {
  region = var.aws_region
}

variable "aws_region" { default = "us-east-1" }
variable "environment" { default = "production" }
variable "db_password" { sensitive = true }
variable "jwt_secret" { sensitive = true }

resource "aws_vpc" "bck" {
  cidr_block = "10.0.0.0/16"
  tags = { Name = "bck-vpc" }
}

resource "aws_subnet" "bck_a" {
  vpc_id = aws_vpc.bck.id
  cidr_block = "10.0.1.0/24"
  availability_zone = "${var.aws_region}a"
}

resource "aws_subnet" "bck_b" {
  vpc_id = aws_vpc.bck.id
  cidr_block = "10.0.2.0/24"
  availability_zone = "${var.aws_region}b"
}

resource "aws_security_group" "bck" {
  vpc_id = aws_vpc.bck.id
  ingress {
    from_port = 8050; to_port = 8050; protocol = "tcp"; cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    from_port = 3000; to_port = 3000; protocol = "tcp"; cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port = 0; to_port = 0; protocol = "-1"; cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_instance" "bck" {
  engine = "postgres"; engine_version = "16"
  instance_class = "db.t3.medium"
  allocated_storage = 50
  db_name = "backupmanager"
  username = "bck_admin"
  password = var.db_password
  skip_final_snapshot = true
  vpc_security_group_ids = [aws_security_group.bck.id]
}

resource "aws_elasticache_cluster" "bck" {
  cluster_id = "bck-redis"
  engine = "redis"; engine_version = "7.0"
  node_type = "cache.t3.micro"
  num_cache_nodes = 1
}

resource "aws_ecs_cluster" "bck" { name = "bck-cluster" }

resource "aws_ecs_task_definition" "api" {
  family = "bck-api"
  requires_compatibilities = ["FARGATE"]
  network_mode = "awsvpc"
  cpu = 512; memory = 1024
  container_definitions = jsonencode([{
    name = "api"
    image = "bck/backup-api:latest"
    portMappings = [{ containerPort = 8050 }]
    environment = [
      { name = "DB_HOST"; value = aws_db_instance.bck.address },
      { name = "REDIS_HOST"; value = aws_elasticache_cluster.bck.cache_nodes[0].address },
    ]
  }])
}

resource "aws_ecs_service" "api" {
  name = "bck-api"
  cluster = aws_ecs_cluster.bck.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count = 2; launch_type = "FARGATE"
  network_configuration {
    subnets = [aws_subnet.bck_a.id, aws_subnet.bck_b.id]
    security_groups = [aws_security_group.bck.id]
    assign_public_ip = true
  }
}

output "api_endpoint" { value = aws_ecs_service.api.name }
output "db_endpoint" { value = aws_db_instance.bck.address }

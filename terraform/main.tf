// Terraform configuration to deploy the Birthday Wisher to AWS Lambda (Function URL).
// ---------------------------------------------------------------
// One function, one public Function URL. GET / serves the page.
// POST /wish returns a birthday wish; returns 403 outside the birthday.

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

// Pack the Lambda source code into a ZIP file.
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = var.source_dir
  output_path = "${path.module}/function.zip"

  excludes = [
    "test",
    "scripts",
    "terraform",
    ".git",
    ".gitignore",
    ".env",
    ".env.local",
    "README.md",
    "SPEC.md",
    "deploy.sh",
    "*.log",
    "npm-debug.log",
    ".DS_Store"
  ]
}

// IAM role used by the Lambda function.
resource "aws_iam_role" "lambda_exec" {
  name               = var.role_name
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy_attachment" "basic_execution" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

// Lambda function definition.
resource "aws_lambda_function" "birthday_wisher" {
  function_name = var.function_name
  handler       = var.handler
  runtime       = var.runtime
  role          = aws_iam_role.lambda_exec.arn
  filename       = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256
  timeout        = 30
  memory_size    = 256

  // Env vars – keep secrets out of the code base.
  environment {
    variables = {
      FRIEND_NAME      = var.friend_name
      BIRTH_DATE       = var.birth_date
      TIME_ZONE        = var.time_zone
      TONE             = var.tone
      MEMORIES         = var.memories
      AI_API_KEY       = var.ai_api_key
      AI_MODEL         = var.ai_model
      SELF_ORIGIN      = var.self_origin
    }
  }

  // Limit reserved concurrency — cost control since anyone with the URL can call /wish.
  reserved_concurrent_executions = var.reserved_concurrency

  // Ensure the ZIP is recreated when source files change.
  lifecycle {
    create_before_destroy = true
  }
}

// Function URL (public HTTP endpoint). No API Gateway required.
resource "aws_lambda_function_url" "public_url" {
  function_name = aws_lambda_function.birthday_wisher.function_name
  authorization_type = "NONE"

  cors {
    allow_credentials = false
    allow_headers    = ["Content-Type"]
    allow_methods    = ["GET", "POST"]
    allow_origins    = var.allowed_origins
  }
}

output "function_url" {
  description = "The public URL for the Lambda Function"
  value       = aws_lambda_function_url.public_url.function_url
}

variable "aws_region" {
  description = "AWS region for deployment"
  type        = string
  default     = "us-east-1"
}

variable "source_dir" {
  description = "Path to the source directory containing the Lambda function code"
  type        = string
  default     = ".."
}

variable "role_name" {
  description = "Name of the IAM role used by the Lambda function"
  type        = string
  default     = "birthday-wisher-lambda-role"
}

variable "function_name" {
  description = "Name of the Lambda function"
  type        = string
  default     = "birthday-wisher"
}

variable "handler" {
  description = "Lambda handler entrypoint"
  type        = string
  default     = "index.handler"
}

variable "runtime" {
  description = "Lambda runtime"
  type        = string
  default     = "nodejs22.x"
}

variable "friend_name" {
  description = "Friend's name for the birthday page (used in open state)"
  type        = string
  default     = "Friend"
}

variable "birth_date" {
  description = "Birthday date in YYYY-MM-DD format"
  type        = string
  default     = "2025-11-27"
}

variable "time_zone" {
  description = "IANA timezone for the state machine (server-side /wish enforcement). Client recomputes state from browser local time via Moment.js. Set to recipient's timezone (e.g. Asia/Dubai) so server enforcement matches their local midnight."
  type        = string
  default     = ""
}

variable "tone" {
  description = "Birthday wish tone: any custom sentence OR keyword (warm, funny, poetic, or a custom phrase)"
  type        = string
  default     = "warm"
}

variable "memories" {
  description = "JSON array of 3-5 short memory lines for the AI wish"
  type        = string
  default     = "[]"
}

variable "ai_api_key" {
  description = "AI provider API key for birthday wishes"
  type        = string
  sensitive  = true
}

variable "ai_model" {
  description = "AI model name for birthday wishes"
  type        = string
  default     = "gemini-2.5-flash"
}

variable "reserved_concurrency" {
  description = "Reserved concurrency limit for the Lambda (cost control)"
  type        = number
  default     = 5
}

variable "self_origin" {
  description = "Optional origin used for CORS and origin check"
  type        = string
  default     = ""
}

variable "allowed_origins" {
  description = "Allowed CORS origins for the Lambda Function URL"
  type        = list(string)
  default     = ["*"]
}

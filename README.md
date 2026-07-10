# Social Publisher Platform

[中文](#中文) · [English](#english)

## 中文

面向 Instagram、Facebook Page 和 X 的中英文社媒发布管理系统。项目采用模块化单体架构，提供安全凭据管理、标准 REST API、平台独立适配器、后台任务、可观测性和可诊断错误模型。

### 当前状态

项目处于基础架构阶段。本分支提供：

- Next.js 16 双语管理后台；
- NestJS 11 API；
- `zh-CN` / `en-US` 国际化基础；
- RFC 9457 风格错误响应；
- 三个平台 Adapter 合同与模块骨架；
- PostgreSQL/Prisma 数据模型；
- Redis/BullMQ 基础设施；
- AES-256-GCM 信封加密凭据保险库核心；
- 通用 OIDC Access Token 验证与 Workspace RBAC；
- Docker Compose；
- GitHub Actions CI。

### 快速开始

```bash
corepack enable
pnpm install
cp .env.example .env
docker compose up -d postgres redis
pnpm db:generate
pnpm dev
```

- Web: <http://localhost:3000/zh-CN>
- API: <http://localhost:3001/api/v1>
- Swagger: <http://localhost:3001/docs>

## English

A bilingual social publishing platform for Instagram, Facebook Pages, and X. The project uses a modular monolith architecture with secure credential management, a standards-based REST API, isolated platform adapters, background jobs, observability, and diagnosable errors.

### Status

The repository is in the foundation phase. Real OAuth credentials and publishing calls are intentionally not included yet. See the roadmap issues and pull requests for incremental delivery.

### Security

Never commit platform secrets or user tokens. Copy `.env.example` to `.env` for local-only values. Please report vulnerabilities according to [SECURITY.md](SECURITY.md).

Credential encryption and key-provider requirements are documented in [docs/security/credential-vault.md](docs/security/credential-vault.md). Credential CRUD is not exposed until the browser session, CSRF protection, and workspace RBAC boundary are complete.

API identity claims, role permissions, and route defaults are documented in [docs/security/authentication.md](docs/security/authentication.md).

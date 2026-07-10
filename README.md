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
- Authorization Code + PKCE 浏览器登录与服务端会话；
- 受 RBAC、CSRF 和 AWS KMS 保护的双语凭据中心；
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

当前三个平台的真实 OAuth、媒体处理与远程发布执行器仍处于 fail-closed 状态。生产 v1 的范围、里程碑和验收门槛见 [生产路线图](docs/roadmap/production-v1.md)。

## English

A bilingual social publishing platform for Instagram, Facebook Pages, and X. The project uses a modular monolith architecture with secure credential management, a standards-based REST API, isolated platform adapters, background jobs, observability, and diagnosable errors.

### Status

The repository is in the secure-foundation phase. Browser OIDC, workspace RBAC, AWS KMS-backed credential management, and the bilingual credential UI are implemented. Platform OAuth, media processing, scheduling, and remote publishing still fail closed. See the [production roadmap](docs/roadmap/production-v1.md).

### Security

Never commit platform secrets or user tokens. Copy `.env.example` to `.env` for local-only values. Please report vulnerabilities according to [SECURITY.md](SECURITY.md).

Credential encryption and key-provider requirements are documented in [docs/security/credential-vault.md](docs/security/credential-vault.md). Protected credential management is exposed only through the authenticated server BFF; plaintext values are never returned after submission.

API identity claims, role permissions, and route defaults are documented in [docs/security/authentication.md](docs/security/authentication.md).

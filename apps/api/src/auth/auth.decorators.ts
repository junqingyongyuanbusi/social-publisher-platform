import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@social/auth';
import { PUBLIC_ROUTE, REQUIRED_PERMISSION } from './auth.constants.js';

export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
export const RequirePermission = (permission: Permission) =>
  SetMetadata(REQUIRED_PERMISSION, permission);

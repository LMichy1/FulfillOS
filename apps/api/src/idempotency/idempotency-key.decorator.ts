import {
  BadRequestException,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';

const HEADER_NAME = 'idempotency-key';
const MAX_LENGTH = 200;

/**
 * Extracts and validates the caller-supplied `Idempotency-Key` header. Required on every
 * route that guards a write with the idempotency mechanism (see
 * docs/architecture/inventory.md#idempotency) — there is no fallback to a server-generated
 * key, since the whole point is that the *client* controls what counts as "the same request".
 */
export const IdempotencyKey = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const header = request.headers[HEADER_NAME];
    const value = Array.isArray(header) ? header[0] : header;

    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException(
        `The "${HEADER_NAME}" header is required for this request.`,
      );
    }
    if (value.length > MAX_LENGTH) {
      throw new BadRequestException(
        `The "${HEADER_NAME}" header must be at most ${MAX_LENGTH} characters.`,
      );
    }
    return value;
  },
);

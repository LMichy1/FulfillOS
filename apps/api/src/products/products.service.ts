import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../database/database.constants';
import type { Database } from '../database/database.module';
import { inventory, inventoryMovements, products } from '../database/schema';
import { PG_UNIQUE_VIOLATION, pgErrorCode } from '../common/pg-error.util';
import {
  decodeCursor,
  keysetBefore,
  normalizeLimit,
  paginate,
  type CursorPage,
} from '../common/pagination.util';
import type { CreateProductDto } from './dto/create-product.dto';

export interface ProductSummary {
  id: string;
  sku: string;
  name: string;
  unitPriceCents: number;
  status: 'active' | 'archived';
  createdAt: Date;
}

export interface ProductDetail extends ProductSummary {
  description: string | null;
  onHand: number;
  reserved: number;
  available: number;
}

/**
 * There is no idempotency-key mechanism on product creation (unlike fulfillment/cancellation,
 * see docs/architecture/order-lifecycle.md#idempotency): a retried create request is already
 * safe without one, because the organization-scoped SKU uniqueness constraint rejects an
 * accidental duplicate with a clean 409 on its own — there is no "partial" outcome an
 * idempotency key would need to protect against replaying differently.
 */
@Injectable()
export class ProductsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Creates a product and its initial inventory row in one transaction — a product is never
   * left without a corresponding inventory row, even momentarily. */
  async createProduct(
    organizationId: string,
    dto: CreateProductDto,
  ): Promise<ProductDetail> {
    const onHand = dto.initialOnHand ?? 0;

    try {
      return await this.db.transaction(async (tx) => {
        const [product] = await tx
          .insert(products)
          .values({
            organizationId,
            sku: dto.sku,
            name: dto.name,
            description: dto.description ?? null,
            unitPriceCents: dto.unitPriceCents,
          })
          .returning();

        const [inventoryRow] = await tx
          .insert(inventory)
          .values({
            organizationId,
            productId: product.id,
            onHand,
            reserved: 0,
          })
          .returning();

        if (onHand > 0) {
          await tx.insert(inventoryMovements).values({
            organizationId,
            productId: product.id,
            movementType: 'on_hand_adjustment',
            onHandDelta: onHand,
            reservedDelta: 0,
            reason: 'Initial stock at product creation',
            reference: {},
          });
        }

        return {
          id: product.id,
          sku: product.sku,
          name: product.name,
          description: product.description,
          unitPriceCents: product.unitPriceCents,
          status: product.status,
          createdAt: product.createdAt,
          onHand: inventoryRow.onHand,
          reserved: inventoryRow.reserved,
          available: inventoryRow.onHand - inventoryRow.reserved,
        };
      });
    } catch (error) {
      if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) {
        throw new ConflictException(
          'A product with this SKU already exists in this organization.',
        );
      }
      throw error;
    }
  }

  async listProducts(
    organizationId: string,
    query: { limit?: number; cursor?: string },
  ): Promise<CursorPage<ProductSummary>> {
    const limit = normalizeLimit(query.limit);
    const cursor = decodeCursor(query.cursor);
    if (query.cursor && !cursor) {
      throw new BadRequestException('Invalid pagination cursor.');
    }

    const rows = await this.db
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        unitPriceCents: products.unitPriceCents,
        status: products.status,
        createdAt: products.createdAt,
      })
      .from(products)
      .where(
        cursor
          ? and(
              eq(products.organizationId, organizationId),
              keysetBefore(products.createdAt, products.id, cursor),
            )
          : eq(products.organizationId, organizationId),
      )
      .orderBy(desc(products.createdAt), desc(products.id))
      .limit(limit + 1);

    return paginate(rows, limit);
  }

  async getProduct(
    organizationId: string,
    productId: string,
  ): Promise<ProductDetail> {
    const [row] = await this.db
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        description: products.description,
        unitPriceCents: products.unitPriceCents,
        status: products.status,
        createdAt: products.createdAt,
        onHand: inventory.onHand,
        reserved: inventory.reserved,
      })
      .from(products)
      .leftJoin(inventory, eq(inventory.productId, products.id))
      .where(
        and(
          eq(products.id, productId),
          eq(products.organizationId, organizationId),
        ),
      );

    if (!row) {
      throw new NotFoundException('Product not found in this organization.');
    }

    const onHand = row.onHand ?? 0;
    const reserved = row.reserved ?? 0;
    return {
      id: row.id,
      sku: row.sku,
      name: row.name,
      description: row.description,
      unitPriceCents: row.unitPriceCents,
      status: row.status,
      createdAt: row.createdAt,
      onHand,
      reserved,
      available: onHand - reserved,
    };
  }
}

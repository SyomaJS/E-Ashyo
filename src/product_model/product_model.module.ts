import { Module } from '@nestjs/common';
import { ProductModelService } from './product_model.service';
import { ProductModelController } from './product_model.controller';
import { SequelizeModule } from '@nestjs/sequelize';
import { ProductModel } from './model/product_model.model';
import { BrandCategory } from '../brand_category/models/brand_category.model';
import { Product } from '../product/models/product.model';
import { Attribute } from '../attributes/models/attribute.model';
import { AttributeGroup } from '../attribute_group/models/attribute_group.model';

@Module({
  imports: [
    SequelizeModule.forFeature([
      ProductModel,
      BrandCategory,
      Product,
      Attribute,
      AttributeGroup,
    ]),
  ],
  controllers: [ProductModelController],
  providers: [ProductModelService],
})
export class ProductModelModule {}

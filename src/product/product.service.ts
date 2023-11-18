import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { InjectModel } from '@nestjs/sequelize';
import { Product } from './models/product.model';
import { StockService } from '../stock/stock.service';
import { CreateStockDto } from '../stock/dto/create-stock.dto';
import { ProductViewService } from 'src/product_view/product_view.service';
import { SaleService } from '../sale/sale.service';
import { Op } from 'sequelize';
import { FilterProductDto } from './dto/filter-product.dto';
import { ProductInfo } from 'src/product_info/models/product_info.model';
import { Request, Response } from 'express';
import { getID } from 'src/common/helpers/getId';
import { JwtService } from '@nestjs/jwt';
import { AttributesService } from '../attributes/attributes.service';
import { CategoryModelBrandDto } from './dto/category-model-brand-id.dto';
import { CreateFullProductDto } from './dto/create-full-product.dto';
import { profile } from 'console';
import { ProductInfoService } from '../product_info/product_info.service';
import { CreateProductInfoDto } from '../product_info/dto/create-product_info.dto';
import { checkPrime } from 'crypto';
import { CategoryService } from 'src/category/category.service';
import { ProductModelService } from 'src/product_model/product_model.service';
import { BrandService } from 'src/brand/brand.service';

@Injectable()
export class ProductService {
  constructor(
    @InjectModel(Product) private productRepo: typeof Product,
    private readonly saleService: SaleService,
    private readonly stockService: StockService,
    private readonly productInfoService: ProductInfoService,
    private productViewService: ProductViewService,
    private readonly attributeService: AttributesService,
    private jwtService: JwtService,
    private categoryService: CategoryService,
    private productModelService: ProductModelService,
    private brandService: BrandService,
  ) {}

  async create(createProductDto: CreateProductDto) {
    const { category_id, model_id, brand_id } = createProductDto;

    const name = await this.returnProductName(category_id, model_id, brand_id);

    const product = await this.productRepo.create({
      ...createProductDto,
      name,
    });
    if (!product) {
      throw new BadRequestException('Error while creating product');
    }

    console.log('Quantity: ',createProductDto.quantity);

    const stockDto: CreateStockDto = {
      product_id: product.id,
      quantity: createProductDto.quantity,
    };
    try {
      await this.stockService.create(stockDto);
    } catch (error) {
      throw new InternalServerErrorException(
        'An error occurred while adding to stock',
      );
    }

    return { message: 'Created successfully', product };
  }

  async createFull(createFullPrductDto: CreateFullProductDto) {
    const { product_info, category_id, brand_id, price, model_id, quantity } =
      createFullPrductDto;

    const productsInDb: Product[] | null = await this.productRepo.findAll({
      where: { model_id: model_id },
      include: {
        model: ProductInfo,
      },
    });

    // * < Prepare dto and push it to create > * //
    const createDto: CreateProductDto = {
      category_id: category_id,
      model_id: model_id,
      brand_id: brand_id,
      price: price,
      quantity: quantity,
    };
    const { product } = await this.create(createDto);
    // * < Prepare dto and push it to create /> * //

    if (productsInDb.length) {
      // * < Find product with max attributes > * //
      let maxInfoProduct: any = productsInDb.reduce((prev, current) =>
        (current?.dataValues?.productInfo?.length || 0) >
        (prev?.dataValues?.productInfo?.length || 0)
          ? current
          : prev,
      );

      let maxRepeatedId: number = Number(maxInfoProduct?.id);
      // * < Find product with max attributes /> * //

      const productInfoArray = await this.productInfoService.findByProductId(
        maxRepeatedId,
      );

      for (const info of productInfoArray) {
        const isChangable = await this.attributeService.checkChangable(
          info?.dataValues?.attribute_id,
        );
        // * < Add all fiex values to the product /> * //
        if (!isChangable) {
          const newInfo: CreateProductInfoDto = {
            product_id: product.dataValues.id,
            attribute_id: info.dataValues?.attribute_id,
            attribute_value: info.dataValues?.attribute_value,
            show_in_main: info.dataValues?.show_in_main,
          };

          await this.productInfoService.create(newInfo);
        }
        // * < Add all fiex values to the product /> * //
      }
    }

    const entries = Object.entries(product_info);
    // * < Add all changable product info > * //
    for (const [key, value] of entries) {
      const newInfo: CreateProductInfoDto = {
        product_id: product.dataValues.id,
        attribute_id: Number(key),
        attribute_value: value,
        show_in_main: false,
      };

      await this.productInfoService.create(newInfo);
    }
    // * < Add all changable product info /> * //

    return await this.productRepo.findOne({
      where: { id: product.id },
      include: { model: ProductInfo },
    });
  }

  async findProductByModelAdmin(categoryModelBrandDto: CategoryModelBrandDto) {
    const { category_id, model_id } = categoryModelBrandDto;
    const product = await this.productRepo.findOne({
      where: {
        model_id: model_id,
      },
    });
    if (product) {
      const attrebutes = await this.attributeService.findAttributeByCategoryId(
        category_id,
        true,
      );

      return attrebutes;
    } else {
      const attrebutes = await this.attributeService.findAttributeByCategoryId(
        category_id,
      );

      return attrebutes;
    }
  }

  async findAll() {
    try {
      await this.saleService.checkAndSetSale();
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException(
        'An error occurred while setting the sale',
      );
    }

    const products = await this.productRepo.findAll({ include: { all: true } });
    return products;
  }

  async findPopular() {
    try {
      await this.saleService.checkAndSetSale();
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException(
        'An error occurred while setting the sale',
      );
    }
    const popular = await this.productViewService.findMostPopular();
    const products = await Promise.all(
      popular.map(async (item) => {
        const product = await this.productRepo.findByPk(
          item.dataValues.product_id,
        );
        return product;
      }),
    );
    return products;
  }

  async findLastViewed(accessToken: string, req: Request, res: Response) {
    try {
      await this.saleService.checkAndSetSale();
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException(
        'An error occurred while setting the sale',
      );
    }
    let user_id: string;
    if (!accessToken) {
      user_id = await getID(req, res);
    } else {
      const payload = this.jwtService.decode(accessToken);
      // @ts-ignore
      user_id = payload.id;
    }
    const last_viewed = await this.productViewService.findLastViewed(
      user_id.toString(),
    );
    const products = await Promise.all(
      last_viewed.map(async (item) => {
        const product = await this.productRepo.findByPk(
          item.dataValues.product_id,
        );
        return product;
      }),
    );
    return products;
  }

  // * Find all products which are in the sale
  async findSaleProducts() {
    const saleModels = await this.saleService.findInSale();
    let saleProducts: Product[] = [];

    for (const model of saleModels) {
      const products = await this.productRepo.findAll({
        where: { model_id: model.dataValues.id },
      });

      saleProducts.push(...products);
    }

    return saleProducts;
  }

  async findProductByCategory(category_id: number) {
    if (!category_id || typeof category_id != 'number') {
      throw new BadRequestException('Invalid category id');
    }
    const products = await this.productRepo.findAll({
      where: {
        category_id: category_id,
      },
    });

    return products;
  }

  async findProductByModel(model_id: number) {
    if (!model_id || typeof model_id != 'number') {
      throw new BadRequestException('Invalid model id');
    }
    const products = await this.productRepo.findAll({
      where: {
        model_id: model_id,
      },
    });

    return products;
  }

  async findById(id: number) {
    try {
      await this.saleService.checkAndSetSale();
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException(
        'An error occurred while setting the sale',
      );
    }
    const product = await this.productRepo.findByPk(id, {
      include: { all: true },
    });
    if (!product) {
      throw new NotFoundException('Product not found with such id');
    }

    return product;
  }

  async findOne(id: number, accessToken: string, req: Request, res: Response) {
    try {
      await this.saleService.checkAndSetSale();
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException(
        'An error occurred while setting the sale',
      );
    }
    const product = await this.productRepo.findByPk(id, {
      include: { all: true },
    });
    if (!product) {
      throw new NotFoundException('Product not found with such id');
    }

    let user_id: string;
    if (!accessToken) {
      user_id = await getID(req, res);
    } else {
      const payload = this.jwtService.decode(accessToken);
      // @ts-ignore
      user_id = payload.id;
    }

    const view = await this.productViewService.create(
      { product_id: id },
      user_id.toString(),
    );
    return product;
  }

  async filter(filterProductDto: FilterProductDto) {
    try {
      let filter: any = {};
      if (filterProductDto.brand_id) {
        filter.brand_id = filterProductDto.brand_id;
      }
      if (Object.entries(filterProductDto.price).length > 0) {
        filter.price = {
          [Op.gte]: filterProductDto.price.from,
          [Op.lt]: filterProductDto.price.to,
        };
      }
      let products: Product[];
      if (filterProductDto.attributes.length > 0) {
        const attributesConditions = filterProductDto.attributes.map(
          (attribute) => ({
            attribute_id: { [Op.eq]: attribute.attribute_id },
            attribute_value: { [Op.eq]: attribute.attribute_value },
          }),
        );
        products = await this.productRepo.findAll({
          where: filter,
          include: [
            {
              model: ProductInfo,
              where: {
                [Op.or]: attributesConditions,
              },
            },
          ],
        });
      } else {
        products = await this.productRepo.findAll({ where: filter });
      }
      return products;
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async update(id: number, updateProductDto: UpdateProductDto) {
    try {
      await this.saleService.checkAndSetSale();
    } catch (error) {
      throw new InternalServerErrorException(
        'An error occurred while setting the sale',
      );
    }
    const product = await this.productRepo.findByPk(id);
    if (!product) {
      throw new NotFoundException('Product not found with such id');
    }

    if (updateProductDto.quantity) {
      await this.stockService.update;
    }

    const updated = await this.productRepo.update(updateProductDto, {
      where: { id },
      returning: true,
    });
    if (!updated[0]) {
      throw new BadRequestException('Error, please check before you update');
    }
    return {
      message: 'Updated successfully',
      product: updated[1][0].dataValues,
    };
  }

  async remove(id: number) {
    const product = await this.productRepo.findByPk(id);
    if (!product) {
      throw new NotFoundException('Product not found with such id');
    }
    await this.stockService.deleteProdFromStock(product.id);
    await product.destroy();
    return { message: 'Deleted successfully' };
  }

  // * < Combine name and return > * //
  async returnProductName(
    category_id: number,
    brand_id: number,
    model_id: number,
  ): Promise<string> {
    const category = await this.categoryService.findOne(category_id);
    if (!category.parent_category_id) {
      throw new BadRequestException('Main category can not be in product');
    }

    const model = await this.productModelService.findOne(model_id);
    const brand = await this.brandService.findOne(brand_id);

    const name = `${category.category_name} ${brand.brand.brand_name} ${model.model_name}`;

    return name;
  }
  // * < Combine name and return /> * //
}

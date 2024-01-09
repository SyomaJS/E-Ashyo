import { Product } from 'src/product/models/product.model';
import { ModelAttributeService } from './../model_attribute/model_attribute.service';
import { ProductInfo } from './../product_info/models/product_info.model';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { InjectModel } from '@nestjs/sequelize';
import { StockService } from '../stock/stock.service';
import { CreateStockDto } from '../stock/dto/create-stock.dto';
import { ProductViewService } from 'src/product_view/product_view.service';
import { SaleService } from '../sale/sale.service';
import { Op } from 'sequelize';
import { FilterProductDto } from './dto/filter-product.dto';
import { Request, Response } from 'express';
import { getID } from 'src/common/helpers/getId';
import { JwtService } from '@nestjs/jwt';
import { AttributesService } from '../attributes/attributes.service';
import { CategoryModelBrandDto } from './dto/category-model-brand-id.dto';
import { CreateFullProductDto } from './dto/create-full-product.dto';
import { ProductInfoService } from '../product_info/product_info.service';
import { CreateProductInfoDto } from '../product_info/dto/create-product_info.dto';
import { CategoryService } from 'src/category/category.service';
import { ProductModelService } from 'src/product_model/product_model.service';
import { BrandService } from 'src/brand/brand.service';
import { all } from 'axios';
import { User } from '../user/models/user.model';
import * as uuid from 'uuid';
import { Attribute } from '../attributes/models/attribute.model';
import { ProductMedia } from '../product_media/models/product_media.model';
import { Stock } from '../stock/models/stock.model';
import { ProductModel } from '../product_model/model/product_model.model';
import { Brand } from '../brand/models/brand.model';
import { Category } from '../category/models/category.model';

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
    private modelAttributeService: ModelAttributeService,
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

  async productSearch(productName: string) {
    const searchWord = productName.trim();
    let products = [];

    const initialProducts = await Product.findAll({
      where: {
        name: {
          [Op.iLike]: `%${searchWord}%`,
        },
      },
      include: { all: true },
    });

    products.push(...initialProducts);

    if (!initialProducts.length && searchWord.includes(' ')) {
      const searchArr = searchWord.split(' ').map((word) => word.trim());

      for (const word of searchArr) {
        const someProduct = await this.productRepo.findAll({
          where: {
            name: {
              [Op.iLike]: `%${word}%`,
            },
          },
          include: { all: true },
        });

        products.push(...someProduct);
      }
    }

    if (!products.length) {
      let shortSearchWord = searchWord;

      while (shortSearchWord.length > 1) {
        shortSearchWord = shortSearchWord.slice(1, -1);

        // Perform a search with the shortened search word
        const shortedProducts = await this.productRepo.findAll({
          where: {
            name: {
              [Op.iLike]: `%${shortSearchWord}%`,
            },
          },
          include: { all: true },
        });

        products.push(...shortedProducts);
      }
    }

    return products;
  }

  async createFromModel(createFullPrductDto: CreateFullProductDto) {
    const { product_info, category_id, brand_id, price, model_id, quantity } =
      createFullPrductDto;
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

    const attributes = await this.modelAttributeService.getFixedAttributes(
      model_id,
    );

    for (const attr of attributes) {
      const [attribute_value] = attr.dataValues.attribute_value;
      const newInfo: CreateProductInfoDto = {
        product_id: product.dataValues.id,
        attribute_id: attr.dataValues?.attribute_id,
        attribute_value: attribute_value,
        show_in_main: false,
      };

      await this.productInfoService.create(newInfo);
    }

    // * < Add all changable product info > * //
    const entries = Object.entries(product_info);
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
    await this.saleService.checkAndSetSale();
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

  async findAll(limit: number, page: number) {
    limit = limit > 0 ? limit : null;
    page = page > 0 ? page : 1;
    try {
      await this.saleService.checkAndSetSale();
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException(
        'An error occurred while setting the sale',
      );
    }

    const products = await this.productRepo.findAll({
      include: { all: true },
      attributes: { exclude: ['createdAt', 'updatedAt'] },
      limit,
      offset: (page - 1) * limit,
    });
    const count = await this.productRepo.count();
    return { count, products };
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
    console.log(popular);
    const products = await Promise.all(
      popular.map(async (item) => {
        const product = await this.productRepo.findByPk(
          item.dataValues.product_id,
          { include: { all: true } },
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
    // console.log('COOKIE KELDI', req.cookies);
    let user_id: string;
    if (!accessToken) {
      user_id = await getID(req, res);
    } else {
      const payload = this.jwtService.decode(accessToken);
      // @ts-ignore
      user_id = payload.id;
    }
    console.log('USER_ID', user_id);
    const last_viewed = await this.productViewService.findLastViewed(
      user_id.toString(),
    );
    // console.log('last_viewed', last_viewed);
    const products = await Promise.all(
      last_viewed.map(async (item) => {
        const product = await this.productRepo.findByPk(
          item.dataValues.product_id,
          {
            include: { all: true },
            attributes: { exclude: ['createdAt', 'updatedAt'] },
          },
        );
        return product;
      }),
    );
    return products;
  }

  // * Find all products which are in the sale
  async findSaleProducts() {
    await this.saleService.checkAndSetSale();

    try {
      await this.saleService.checkAndSetSale();
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException(
        'An error occurred while setting the sale',
      );
    }

    const saleModels = await this.saleService.findInSale();
    console.log(saleModels);
    let saleProducts: Product[] = [];

    for (const model of saleModels) {
      const products = await this.productRepo.findAll({
        where: { model_id: model.dataValues.model_id },

        attributes: { exclude: ['createdAt', 'updatedAt'] },

        include: { all: true },
      });

      saleProducts.push(...products);
    }

    console.log('SALEPRODUCTS', saleProducts);
    return saleProducts;
  }

  async findProductByCategory(category_id: number) {
    await this.saleService.checkAndSetSale();

    if (!category_id || typeof category_id != 'number') {
      throw new BadRequestException('Invalid category id');
    }
    const products = await this.productRepo.findAll({
      where: {
        category_id: category_id,
      },
      include: { all: true },
      attributes: { exclude: ['createdAt', 'updatedAt'] },
    });

    return products;
  }

  async findProductByBrand(brand_id: number) {
    await this.saleService.checkAndSetSale();

    if (!brand_id || typeof brand_id != 'number') {
      throw new BadRequestException('Invalid brand id');
    }
    const products = await this.productRepo.findAll({
      where: {
        brand_id: brand_id,
      },
      attributes: { exclude: ['createdAt', 'updatedAt'] },
    });

    return products;
  }

  async findProductByModel(model_id: number) {
    await this.saleService.checkAndSetSale();
    if (!model_id || typeof model_id != 'number') {
      throw new BadRequestException('Invalid model id');
    }
    const products = await this.productRepo.findAll({
      where: {
        model_id: model_id,
      },
      attributes: { exclude: ['createdAt', 'updatedAt'] },
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
      attributes: { exclude: ['createdAt', 'updatedAt'] },
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
      throw new InternalServerErrorException(
        'An error occurred while setting the sale',
      );
    }

    const product = await this.productRepo.findByPk(id, {
      include: [
        {
          model: ProductInfo,
          attributes: { exclude: ['createdAt', 'updatedAt'] },
          include: [
            {
              model: Attribute,
              attributes: { exclude: ['createdAt', 'updatedAt'] },
            },
          ],
        },
        {
          model: ProductMedia,
          attributes: {
            exclude: ['createdAt', 'updatedAt'],
          },
        },
        {
          model: Stock,
          attributes: {
            exclude: ['createdAt', 'updatedAt'],
          },
        },
        {
          model: ProductModel,
          attributes: {
            exclude: ['createdAt', 'updatedAt'],
          },
        },
        {
          model: Brand,
          attributes: {
            exclude: ['createdAt', 'updatedAt'],
          },
        },
        {
          model: Category,
          attributes: {
            exclude: ['createdAt', 'updatedAt'],
          },
        },
      ],
      attributes: { exclude: ['createdAt', 'updatedAt'] },
    });
    if (!product) {
      throw new NotFoundException('Product not found with such id');
    }

    let user_id: string;
    if (!accessToken) {
      user_id = await getID(req, res);
      // user_id = req.cookies['user_id'];
      // console.log('req', req);
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
      await this.saleService.checkAndSetSale();
    } catch (error) {
      throw new InternalServerErrorException(
        'An error occurred while setting the sale',
      );
    }
    try {
      const { attributes } = filterProductDto;

      let filter: any = {};
      if (filterProductDto?.brand_id) {
        filter.brand_id = filterProductDto?.brand_id;
      }
      if (Object.entries(filterProductDto?.price)?.length > 0) {
        console.log('keloptimi', filterProductDto.price);
        filter.price = {
          [Op.gte]: filterProductDto.price.from,
          [Op.lte]: filterProductDto.price.to,
        };
      }
      let products: Product[];
      if (attributes?.length > 0) {
        const attributesConditions = attributes.map((attribute) => ({
          attribute_id: { [Op.eq]: attribute?.attribute_id },
          attribute_value: { [Op.eq]: attribute?.attribute_value },
        }));
        products = await this.productRepo.findAll({
          where: filter,
          include: [
            {
              model: ProductInfo,
              where: {
                [Op.or]: attributesConditions,
              },
            },
            {
              model: ProductMedia,
              attributes: {
                exclude: ['createdAt', 'updatedAt'],
              },
            },
            {
              model: Brand,
              attributes: {
                exclude: ['createdAt', 'updatedAt'],
              },
            },
          ],
          attributes: { exclude: ['createdAt', 'updatedAt'] },
        });

        products = products.filter(
          (product) =>
            product?.dataValues?.productInfo?.length == attributes?.length,
        );
      } else {
        products = await this.productRepo.findAll({
          where: filter,
          include: { all: true },
        });
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
    model_id: number,
    brand_id: number,
  ): Promise<string> {
    const category = await this.categoryService.findOne(category_id);
    if (!category.parent_category_id) {
      throw new BadRequestException('Main category can not be in product');
    }

    const model = await this.productModelService.findOne(model_id);
    const brand = await this.brandService.findOne(brand_id);

    const name = `${category.category_name} ${brand.brand_name} ${model.model_name}`;

    return name;
  }

  async findProductOnStorage(arr: Array<number>) {
    const products = [];
    for (const id of arr) {
      products.push(
        await this.productRepo.findByPk(id, {
          include: { all: true },
          attributes: { exclude: ['createdAt', 'updatedAt'] },
        }),
      );
    }
    console.log(products);
    return products;
  }
}

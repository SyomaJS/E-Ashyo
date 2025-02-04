import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { ProductService } from './product.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { StorageGetter } from 'src/decorators/storageGetter-cookie.decorator.ts';
import { FilterProductDto } from './dto/filter-product.dto';
import { Request, Response } from 'express';

@ApiTags('Product')
@Controller('product')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @ApiOperation({ summary: 'Create a new product' })
  @Post('create')
  create(@Body() createProductDto: CreateProductDto) {
    return this.productService.create(createProductDto);
  }

  @ApiOperation({ summary: 'Get all products' })
  @Get('get-all')
  findAll() {
    return this.productService.findAll();
  }

  @ApiOperation({ summary: 'Get most popular products' })
  @Get('get-popular')
  findMostPopular() {
    return this.productService.findPopular();
  }

  @ApiOperation({ summary: 'Get last viewed products' })
  @Get('last-view')
  findLastViewed(
    @StorageGetter() accessToken: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.productService.findLastViewed(accessToken, req, res);
  }

  @ApiOperation({ summary: 'Filter products' })
  @Post('filter')
  filter(@Body() filterProductDto: FilterProductDto) {
    return this.productService.filter(filterProductDto);
  }

  @ApiOperation({ summary: 'Get one product by id' })
  @Get('get/:id')
  findOne(
    @Param('id') id: string,
    @StorageGetter() accessToken: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.productService.findOne(+id, accessToken, req, res);
  }

  @ApiOperation({ summary: 'Update one product by id' })
  @Put('update/:id')
  update(@Param('id') id: string, @Body() updateProductDto: UpdateProductDto) {
    return this.productService.update(+id, updateProductDto);
  }

  @ApiOperation({ summary: 'Delete one product by id' })
  @Delete('delete/:id')
  remove(@Param('id') id: string) {
    return this.productService.remove(+id);
  }
}

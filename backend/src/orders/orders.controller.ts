import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common'
import { OrdersService } from './orders.service'
import { CreateOrderDto } from './dto/create-order.dto'
import { SessionAuthGuard } from '../common/guards/session-auth.guard'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../common/types/authenticated-user'

@Controller('orders')
@UseGuards(SessionAuthGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOrderDto) {
    return this.ordersService.createOrder(user.id, dto)
  }

  @Get('mine')
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.ordersService.listMyOrders(user.id)
  }
}

/**
 * Repository Layer — sole DB access boundary for Finance Data Layer.
 * Screens and UI must not import Prisma; they consume View Models via Services.
 */

export { orderRepository, type OrderRepository } from "./order-repository";
export { paymentRepository, type PaymentRepository } from "./payment-repository";
export {
  orderPaymentBreakdownRepository,
  type OrderPaymentBreakdownRepository,
} from "./order-payment-breakdown-repository";
export { customerRepository, type CustomerRepository } from "./customer-repository";
export {
  paymentMethodAllocationRepository,
  type PaymentMethodAllocationRepository,
} from "./payment-method-allocation-repository";
